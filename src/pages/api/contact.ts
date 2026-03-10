import type { APIRoute } from "astro";
import { json, readJsonBody } from "../../lib/api";
import { sendContactRequestEmail } from "../../lib/email";

export const prerender = false;

function normalizeValue(value: unknown) {
	return String(value ?? "").trim();
}

function isValidEmail(value: string) {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export const POST: APIRoute = async ({ request }) => {
	const body = await readJsonBody(request);
	if (!body) return json(400, { error: "BODY_INVALID" });

	const firstName = normalizeValue(body.firstName);
	const lastName = normalizeValue(body.lastName);
	const email = normalizeValue(body.email).toLowerCase();
	const subject = normalizeValue(body.subject);
	const message = normalizeValue(body.message);
	const website = normalizeValue(body.website);

	// Honeypot anti-spam.
	if (website) return json(200, { success: true });

	if (!firstName || !lastName || !email || !message) {
		return json(400, { error: "FIELDS_REQUIRED" });
	}

	if (!isValidEmail(email)) {
		return json(400, { error: "EMAIL_INVALID" });
	}

	if (message.length < 8) {
		return json(400, { error: "MESSAGE_TOO_SHORT" });
	}

	try {
		const mailStatus = await sendContactRequestEmail({
			firstName,
			lastName,
			email,
			subject,
			message
		});

		if (!mailStatus.sent) {
			console.error("CONTACT_MAIL_FAILED", {
				reason: mailStatus.reason ?? "MAIL_NOT_SENT",
				details: mailStatus.details ?? ""
			});
			return json(503, { error: mailStatus.reason ?? "MAIL_NOT_SENT" });
		}

		return json(200, { success: true });
	} catch (error) {
		console.error("CONTACT_MAIL_SEND_ERROR", {
			error: error instanceof Error ? error.message : "UNKNOWN"
		});
		return json(500, { error: "CONTACT_SEND_FAILED" });
	}
};
