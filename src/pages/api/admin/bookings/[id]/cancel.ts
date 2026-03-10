import type { APIRoute } from "astro";
import { ensureAdmin } from "../../../../../lib/adminGuard";
import { json } from "../../../../../lib/api";
import { sendBookingCancellationEmails } from "../../../../../lib/email";
import { isSameOriginRequest } from "../../../../../lib/security";
import { supabaseAdmin } from "../../../../../lib/supabase";

export const prerender = false;

interface SlotReopenStatus {
	reopened: boolean;
	reason?: string;
	details?: string;
}

function normalizeText(value: unknown) {
	return String(value ?? "").trim();
}

async function reopenSlotAfterCancellation({
	bookingId,
	slotId,
	slotAtIso
}: {
	bookingId: string;
	slotId: unknown;
	slotAtIso: unknown;
}): Promise<SlotReopenStatus> {
	const normalizedSlotAt = normalizeText(slotAtIso);
	if (!normalizedSlotAt) {
		return { reopened: false, reason: "SLOT_AT_MISSING" };
	}

	const { data: otherConfirmedBookings, error: bookingCheckError } = await supabaseAdmin
		.from("bookings")
		.select("id")
		.eq("status", "confirmed")
		.eq("slot_at", normalizedSlotAt)
		.neq("id", bookingId)
		.limit(1);

	if (bookingCheckError) {
		return {
			reopened: false,
			reason: "SLOT_CHECK_FAILED",
			details: bookingCheckError.message
		};
	}

	if ((otherConfirmedBookings?.length ?? 0) > 0) {
		return { reopened: false, reason: "SLOT_HAS_CONFIRMED_BOOKING" };
	}

	const normalizedSlotId = normalizeText(slotId);
	if (normalizedSlotId) {
		const { data: updatedById, error: reopenByIdError } = await supabaseAdmin
			.from("availability_slots")
			.update({ is_available: true })
			.eq("id", normalizedSlotId)
			.select("id");

		if (reopenByIdError) {
			return {
				reopened: false,
				reason: "SLOT_REOPEN_FAILED",
				details: reopenByIdError.message
			};
		}

		if ((updatedById?.length ?? 0) > 0) {
			return { reopened: true };
		}
	}

	const { error: reopenByDateError } = await supabaseAdmin
		.from("availability_slots")
		.upsert(
			{
				slot_at: normalizedSlotAt,
				is_available: true
			},
			{ onConflict: "slot_at" }
		);

	if (reopenByDateError) {
		return {
			reopened: false,
			reason: "SLOT_REOPEN_FAILED",
			details: reopenByDateError.message
		};
	}

	return { reopened: true, reason: "REOPENED_WITH_SLOT_AT_FALLBACK" };
}

export const POST: APIRoute = async (context) => {
	if (!ensureAdmin(context)) return json(401, { error: "UNAUTHORIZED" });
	if (!isSameOriginRequest(context.request, context.url.origin)) {
		return json(403, { error: "ORIGIN_FORBIDDEN" });
	}

	const bookingId = context.params.id;
	if (!bookingId) return json(400, { error: "BOOKING_ID_REQUIRED" });

	const { data: bookingRow, error: fetchError } = await supabaseAdmin
		.from("bookings")
		.select(
			"id, service_name, slot_at, first_name, last_name, phone, email, status, slot_id"
		)
		.eq("id", bookingId)
		.single();

	if (fetchError || !bookingRow) return json(404, { error: "BOOKING_NOT_FOUND" });

	if (bookingRow.status === "cancelled") {
		const slotStatus = await reopenSlotAfterCancellation({
			bookingId: bookingRow.id as string,
			slotId: bookingRow.slot_id,
			slotAtIso: bookingRow.slot_at
		});
		return json(200, { success: true, alreadyCancelled: true, slotStatus });
	}

	const { error: cancelError } = await supabaseAdmin
		.from("bookings")
		.update({
			status: "cancelled",
			cancelled_at: new Date().toISOString()
		})
		.eq("id", bookingId);

	if (cancelError) {
		return json(500, { error: "BOOKING_CANCEL_FAILED", details: cancelError.message });
	}

	const slotStatus = await reopenSlotAfterCancellation({
		bookingId: bookingRow.id as string,
		slotId: bookingRow.slot_id,
		slotAtIso: bookingRow.slot_at
	});

	if (!slotStatus.reopened) {
		console.error("BOOKING_SLOT_REOPEN_FAILED", {
			bookingId: bookingRow.id,
			reason: slotStatus.reason ?? "UNKNOWN",
			details: slotStatus.details ?? ""
		});
	}

	let emailStatus: { sent: boolean; reason?: string } = { sent: true };
	try {
		emailStatus = await sendBookingCancellationEmails({
			serviceName: bookingRow.service_name as string,
			slotAtIso: bookingRow.slot_at as string,
			firstName: bookingRow.first_name as string,
			lastName: bookingRow.last_name as string,
			phone: bookingRow.phone as string,
			email: bookingRow.email as string
		});
	} catch {
		emailStatus = { sent: false, reason: "MAIL_SEND_FAILED" };
	}

	return json(200, { success: true, emailStatus, slotStatus });
};
