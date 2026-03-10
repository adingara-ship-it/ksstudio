import type { APIRoute } from "astro";
import { ensureAdmin } from "../../../../../lib/adminGuard";
import { json } from "../../../../../lib/api";
import { sendBookingCancellationEmails } from "../../../../../lib/email";
import { isSameOriginRequest } from "../../../../../lib/security";
import { supabaseAdmin } from "../../../../../lib/supabase";

export const prerender = false;

async function markSlotAsAvailable(slotId: string) {
	const { error } = await supabaseAdmin
		.from("availability_slots")
		.update({ is_available: true })
		.eq("id", slotId);
	return error;
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
		const reopenError = await markSlotAsAvailable(bookingRow.slot_id as string);
		if (reopenError) {
			return json(500, {
				error: "SLOT_REOPEN_FAILED",
				details: reopenError.message,
				alreadyCancelled: true
			});
		}
		return json(200, { success: true, alreadyCancelled: true });
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

	const reopenError = await markSlotAsAvailable(bookingRow.slot_id as string);
	if (reopenError) {
		return json(500, {
			error: "SLOT_REOPEN_FAILED",
			details: reopenError.message
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

	return json(200, { success: true, emailStatus });
};
