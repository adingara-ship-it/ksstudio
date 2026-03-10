import type { APIRoute } from "astro";
import { json, readJsonBody } from "../../../lib/api";
import { sendBookingConfirmationEmails } from "../../../lib/email";
import { getServiceByCode } from "../../../lib/services";
import { supabaseAdmin } from "../../../lib/supabase";

export const prerender = false;

function normalizeValue(value: unknown) {
	return String(value ?? "").trim();
}

export const POST: APIRoute = async ({ request }) => {
	const body = await readJsonBody(request);
	if (!body) return json(400, { error: "BODY_INVALID" });

	const serviceCode = normalizeValue(body.serviceCode);
	const slotId = normalizeValue(body.slotId);
	const firstName = normalizeValue(body.firstName);
	const lastName = normalizeValue(body.lastName);
	const phone = normalizeValue(body.phone);
	const email = normalizeValue(body.email).toLowerCase();

	if (!serviceCode || !slotId || !firstName || !lastName || !phone || !email) {
		return json(400, { error: "FIELDS_REQUIRED" });
	}

	const service = getServiceByCode(serviceCode);
	if (!service) return json(400, { error: "SERVICE_INVALID" });

	const { data: slotRow, error: lockError } = await supabaseAdmin
		.from("availability_slots")
		.update({ is_available: false })
		.eq("id", slotId)
		.eq("is_available", true)
		.select("id, slot_at")
		.single();

	if (lockError || !slotRow) {
		return json(409, { error: "SLOT_NOT_AVAILABLE" });
	}

	const slotAtIso = slotRow.slot_at as string;

	const { data: bookingRow, error: bookingError } = await supabaseAdmin
		.from("bookings")
		.insert({
			service_code: service.code,
			service_name: service.name,
			slot_id: slotId,
			slot_at: slotAtIso,
			first_name: firstName,
			last_name: lastName,
			phone,
			email,
			status: "confirmed"
		})
		.select("id, service_name, slot_at, first_name, last_name, phone, email")
		.single();

	if (bookingError || !bookingRow) {
		await supabaseAdmin
			.from("availability_slots")
			.update({ is_available: true })
			.eq("id", slotId);
		return json(500, {
			error: "BOOKING_CREATE_FAILED",
			details: bookingError?.message ?? "UNKNOWN"
		});
	}

	const emailPayload = {
		serviceName: bookingRow.service_name as string,
		slotAtIso: bookingRow.slot_at as string,
		firstName: bookingRow.first_name as string,
		lastName: bookingRow.last_name as string,
		phone: bookingRow.phone as string,
		email: bookingRow.email as string
	};

	let emailStatus: { sent: boolean; reason?: string; details?: string } = { sent: true };
	try {
		emailStatus = await sendBookingConfirmationEmails(emailPayload);
		if (!emailStatus.sent) {
			console.error("BOOKING_CONFIRMATION_MAIL_FAILED", {
				bookingId: bookingRow.id,
				reason: emailStatus.reason ?? "UNKNOWN",
				details: emailStatus.details ?? ""
			});
		}
	} catch (error) {
		emailStatus = {
			sent: false,
			reason: "MAIL_SEND_FAILED",
			details: error instanceof Error ? error.message : "UNKNOWN"
		};
		console.error("BOOKING_CONFIRMATION_MAIL_ERROR", {
			bookingId: bookingRow.id,
			error: error instanceof Error ? error.message : "UNKNOWN"
		});
	}

	return json(201, {
		success: true,
		booking: {
			id: bookingRow.id,
			serviceName: bookingRow.service_name,
			slotAt: bookingRow.slot_at,
			firstName: bookingRow.first_name,
			lastName: bookingRow.last_name
		},
		emailStatus
	});
};
