import nodemailer from "nodemailer";

interface BookingMailPayload {
	serviceName: string;
	slotAtIso: string;
	firstName: string;
	lastName: string;
	phone: string;
	email: string;
}

interface ContactMailPayload {
	firstName: string;
	lastName: string;
	email: string;
	subject?: string;
	message: string;
}

function getOptionalEnv(name: string) {
	return import.meta.env[name] || "";
}

function isPlaceholderValue(value: string) {
	const lower = value.toLowerCase();
	return (
		lower.includes("example.com") ||
		lower.includes("change-this") ||
		lower.includes("your_")
	);
}

function formatBookingDate(iso: string) {
	const timezone = getOptionalEnv("BOOKING_TIMEZONE") || "Europe/Brussels";
	return new Intl.DateTimeFormat("fr-FR", {
		timeZone: timezone,
		dateStyle: "full",
		timeStyle: "short"
	}).format(new Date(iso));
}

function escapeHtml(value: string) {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function normalizeAbsoluteUrl(value: string) {
	const candidate = value.trim();
	if (!candidate) return "";

	try {
		const parsed = new URL(candidate);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
		return parsed.toString();
	} catch {
		return "";
	}
}

function normalizeCtaUrl(value: string) {
	const candidate = value.trim();
	if (!candidate) return "";

	try {
		const parsed = new URL(candidate);
		const protocol = parsed.protocol.toLowerCase();
		if (protocol !== "http:" && protocol !== "https:" && protocol !== "mailto:") return "";
		return parsed.toString();
	} catch {
		return "";
	}
}

function getEmailLogoUrl() {
	const explicitLogoUrl = normalizeAbsoluteUrl(getOptionalEnv("MAIL_LOGO_URL"));
	if (explicitLogoUrl) return explicitLogoUrl;

	const siteUrl = normalizeAbsoluteUrl(
		getOptionalEnv("SITE_URL") || getOptionalEnv("PUBLIC_SITE_URL") || getOptionalEnv("APP_URL")
	);
	if (!siteUrl) return "";

	const withoutTrailingSlash = siteUrl.replace(/\/$/, "");
	return `${withoutTrailingSlash}/logoks.png`;
}

const EMAIL_LOGO_URL = getEmailLogoUrl();

function getSiteUrl() {
	return normalizeAbsoluteUrl(
		getOptionalEnv("SITE_URL") || getOptionalEnv("PUBLIC_SITE_URL") || getOptionalEnv("APP_URL")
	);
}

interface MailShellOptions {
	title: string;
	preheader: string;
	intro: string;
	detailsRowsHtml: string;
	outro: string;
	badge: string;
	notice?: string;
	ctaLabel?: string;
	ctaUrl?: string;
}

function renderMailShell(options: MailShellOptions) {
	const safeTitle = escapeHtml(options.title);
	const safePreheader = escapeHtml(options.preheader);
	const safeIntro = escapeHtml(options.intro);
	const safeOutro = escapeHtml(options.outro).replaceAll("\n", "<br />");
	const safeBadge = escapeHtml(options.badge);
	const safeLogoUrl = escapeHtml(EMAIL_LOGO_URL);
	const safeNotice = options.notice ? escapeHtml(options.notice) : "";
	const safeCtaLabel = options.ctaLabel ? escapeHtml(options.ctaLabel) : "";
	const safeCtaUrl = options.ctaUrl ? normalizeCtaUrl(options.ctaUrl) : "";
	const canRenderCta = Boolean(safeCtaLabel && safeCtaUrl);

	return `
<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${safeTitle}</title>
  </head>
  <body style="margin:0;padding:0;background:#ececea;font-family:Arial,sans-serif;color:#2a221d;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      ${safePreheader}
    </div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#ececea;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#f8f6f3;border:1px solid #dfd8d0;border-radius:14px;overflow:hidden;">
            <tr>
              <td style="height:5px;background:linear-gradient(90deg,#2a221d 0%,#5d4d40 55%,#b39a82 100%);font-size:0;line-height:0;">&nbsp;</td>
            </tr>
            <tr>
              <td style="background:#2a221d;color:#ffffff;padding:16px 24px 18px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td style="vertical-align:middle;width:50px;">
                      ${
											safeLogoUrl
												? `<img src="${safeLogoUrl}" alt="KS Studio" width="38" height="38" style="display:block;width:38px;height:38px;object-fit:contain;border:0;" />`
                        : ""
										}
                    </td>
                    <td style="vertical-align:middle;color:#ffffff;">
                      <p style="margin:0;font-family:Georgia,serif;font-size:34px;line-height:1;">KS Studio</p>
                      <p style="margin:4px 0 0;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;opacity:0.88;">${safeBadge}</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;">
                <h1 style="margin:0 0 10px;font-family:Georgia,serif;font-size:34px;line-height:1.1;color:#2a221d;">${safeTitle}</h1>
                <p style="margin:0 0 18px;font-size:16px;line-height:1.55;color:#61554a;">${safeIntro}</p>
	                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#ffffff;border:1px solid #e2dbd3;border-radius:12px;overflow:hidden;">
	                  ${options.detailsRowsHtml}
	                </table>
                ${
									safeNotice
										? `<p style="margin:14px 0 0;padding:12px 14px;border-radius:10px;border:1px solid #e7dccf;background:#fdf8f3;color:#61554a;font-size:13px;line-height:1.45;">${safeNotice}</p>`
										: ""
								}
                ${
									canRenderCta
										? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin-top:18px;"><tr><td><a href="${escapeHtml(
												safeCtaUrl
											)}" style="display:inline-block;padding:11px 18px;border-radius:999px;background:#2a221d;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">${safeCtaLabel}</a></td></tr></table>`
										: ""
								}
                <p style="margin:18px 0 0;font-size:15px;line-height:1.55;color:#61554a;">${safeOutro}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:14px 24px;border-top:1px solid #e2dbd3;color:#7b6f63;font-size:12px;line-height:1.45;">
                Email automatique KS Studio.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`.trim();
}

function detailRow(label: string, value: string) {
	return `
<tr>
  <td style="padding:12px 14px;border-bottom:1px solid #f0ebe6;color:#61554a;font-size:14px;font-weight:700;width:38%;">${escapeHtml(label)}</td>
  <td style="padding:12px 14px;border-bottom:1px solid #f0ebe6;color:#2a221d;font-size:14px;">${escapeHtml(value)}</td>
</tr>
`.trim();
}

function getTransporter() {
	const host = getOptionalEnv("SMTP_HOST");
	const port = Number(getOptionalEnv("SMTP_PORT") || 587);
	const user = getOptionalEnv("SMTP_USER");
	const pass = getOptionalEnv("SMTP_PASS");

	if (!host || !user || !pass) return null;
	if (isPlaceholderValue(host) || isPlaceholderValue(user) || isPlaceholderValue(pass)) return null;

	return nodemailer.createTransport({
		host,
		port,
		secure: port === 465,
		auth: { user, pass }
	});
}

function shouldSendEmails() {
	return Boolean(getTransporter());
}

export async function sendBookingConfirmationEmails(payload: BookingMailPayload) {
	const transporter = getTransporter();
	if (!transporter) return { sent: false, reason: "SMTP_NOT_CONFIGURED" };

	const from = getOptionalEnv("SMTP_FROM");
	const ownerEmail = getOptionalEnv("BOOKING_OWNER_EMAIL");
	if (!from || !ownerEmail) return { sent: false, reason: "SMTP_NOT_CONFIGURED" };
	if (isPlaceholderValue(from) || isPlaceholderValue(ownerEmail)) {
		return { sent: false, reason: "SMTP_NOT_CONFIGURED" };
	}

	const siteUrl = getSiteUrl();
	const normalizedSiteUrl = siteUrl.replace(/\/$/, "");
	const reservationUrl = normalizedSiteUrl ? `${normalizedSiteUrl}/reservation` : "";
	const adminUrl = normalizedSiteUrl ? `${normalizedSiteUrl}/admin` : "";
	const formattedDate = formatBookingDate(payload.slotAtIso);

	const clientSubject = "Confirmation de votre rendez-vous - KS Studio";
	const ownerSubject = "Nouveau rendez-vous client - KS Studio";

	const clientText = `Bonjour ${payload.firstName},

Votre rendez-vous est bien confirmé.

Prestation: ${payload.serviceName}
Date: ${formattedDate}

À bientôt,
KS Studio`;

	const ownerText = `Nouveau rendez-vous confirmé.

Cliente: ${payload.firstName} ${payload.lastName}
Téléphone: ${payload.phone}
Email: ${payload.email}
Prestation: ${payload.serviceName}
Date: ${formattedDate}`;

	const clientHtml = renderMailShell(
		{
			title: "Réservation confirmée",
			preheader: `Votre rendez-vous du ${formattedDate} est confirmé.`,
			intro: `Bonjour ${payload.firstName}, votre rendez-vous est bien confirmé.`,
			detailsRowsHtml: [
				detailRow("Prestation", payload.serviceName),
				detailRow("Date", formattedDate),
				detailRow("Nom", `${payload.firstName} ${payload.lastName}`)
			].join(""),
			outro: "À bientôt,\nKS Studio",
			badge: "Confirmation",
			notice: "Merci d'arriver 5 minutes avant l'heure prévue.",
			ctaLabel: reservationUrl ? "Voir le site" : undefined,
			ctaUrl: reservationUrl || undefined
		}
	);

	const ownerHtml = renderMailShell(
		{
			title: "Nouveau rendez-vous client",
			preheader: `${payload.firstName} ${payload.lastName} a réservé ${payload.serviceName}.`,
			intro: "Un nouveau rendez-vous vient d'être réservé sur le site.",
			detailsRowsHtml: [
				detailRow("Cliente", `${payload.firstName} ${payload.lastName}`),
				detailRow("Téléphone", payload.phone),
				detailRow("Email", payload.email),
				detailRow("Prestation", payload.serviceName),
				detailRow("Date", formattedDate)
			].join(""),
			outro: "Pensez à vérifier la disponibilité du planning dans l'espace admin.",
			badge: "Nouveau rendez-vous",
			ctaLabel: adminUrl ? "Ouvrir l'espace admin" : undefined,
			ctaUrl: adminUrl || undefined
		}
	);

	await Promise.all([
		transporter.sendMail({
			from,
			to: payload.email,
			subject: clientSubject,
			text: clientText,
			html: clientHtml
		}),
		transporter.sendMail({
			from,
			to: ownerEmail,
			subject: ownerSubject,
			text: ownerText,
			html: ownerHtml
		})
	]);

	return { sent: true };
}

export async function sendBookingCancellationEmails(payload: BookingMailPayload) {
	const transporter = getTransporter();
	if (!transporter) return { sent: false, reason: "SMTP_NOT_CONFIGURED" };

	const from = getOptionalEnv("SMTP_FROM");
	const ownerEmail = getOptionalEnv("BOOKING_OWNER_EMAIL");
	if (!from || !ownerEmail) return { sent: false, reason: "SMTP_NOT_CONFIGURED" };
	if (isPlaceholderValue(from) || isPlaceholderValue(ownerEmail)) {
		return { sent: false, reason: "SMTP_NOT_CONFIGURED" };
	}

	const siteUrl = getSiteUrl();
	const normalizedSiteUrl = siteUrl.replace(/\/$/, "");
	const reservationUrl = normalizedSiteUrl ? `${normalizedSiteUrl}/reservation` : "";
	const adminUrl = normalizedSiteUrl ? `${normalizedSiteUrl}/admin` : "";
	const formattedDate = formatBookingDate(payload.slotAtIso);

	const clientSubject = "Annulation de votre rendez-vous - KS Studio";
	const ownerSubject = "Rendez-vous annulé - KS Studio";

	const clientText = `Bonjour ${payload.firstName},

Votre rendez-vous prévu le ${formattedDate} a été annulé.

Vous pouvez réserver un nouveau créneau directement sur le site.

À bientôt,
KS Studio`;

	const ownerText = `Rendez-vous annulé.

Cliente: ${payload.firstName} ${payload.lastName}
Téléphone: ${payload.phone}
Email: ${payload.email}
Prestation: ${payload.serviceName}
Date initiale: ${formattedDate}`;

	const clientHtml = renderMailShell(
		{
			title: "Rendez-vous annulé",
			preheader: `Votre rendez-vous du ${formattedDate} a été annulé.`,
			intro: `Bonjour ${payload.firstName}, votre rendez-vous a été annulé.`,
			detailsRowsHtml: [
				detailRow("Prestation", payload.serviceName),
				detailRow("Date initiale", formattedDate),
				detailRow("Nom", `${payload.firstName} ${payload.lastName}`)
			].join(""),
			outro: "Vous pouvez réserver un nouveau créneau directement sur le site.\nÀ bientôt,\nKS Studio",
			badge: "Annulation",
			notice: "Le créneau a été libéré. Vous pouvez choisir un autre horaire quand vous voulez.",
			ctaLabel: reservationUrl ? "Réserver un nouveau créneau" : undefined,
			ctaUrl: reservationUrl || undefined
		}
	);

	const ownerHtml = renderMailShell(
		{
			title: "Rendez-vous annulé",
			preheader: `Annulation enregistrée pour ${payload.firstName} ${payload.lastName}.`,
			intro: "Un rendez-vous a été annulé depuis l'espace admin.",
			detailsRowsHtml: [
				detailRow("Cliente", `${payload.firstName} ${payload.lastName}`),
				detailRow("Téléphone", payload.phone),
				detailRow("Email", payload.email),
				detailRow("Prestation", payload.serviceName),
				detailRow("Date initiale", formattedDate)
			].join(""),
			outro: "La plage horaire est repassée en disponible dans le planning.",
			badge: "Annulation",
			ctaLabel: adminUrl ? "Retour admin" : undefined,
			ctaUrl: adminUrl || undefined
		}
	);

	await Promise.all([
		transporter.sendMail({
			from,
			to: payload.email,
			subject: clientSubject,
			text: clientText,
			html: clientHtml
		}),
		transporter.sendMail({
			from,
			to: ownerEmail,
			subject: ownerSubject,
			text: ownerText,
			html: ownerHtml
		})
	]);

	return { sent: true };
}

export async function sendContactRequestEmail(payload: ContactMailPayload) {
	const transporter = getTransporter();
	if (!transporter) return { sent: false, reason: "SMTP_NOT_CONFIGURED" };

	const from = getOptionalEnv("SMTP_FROM");
	const ownerEmail = getOptionalEnv("CONTACT_OWNER_EMAIL") || getOptionalEnv("BOOKING_OWNER_EMAIL");
	if (!from || !ownerEmail) return { sent: false, reason: "SMTP_NOT_CONFIGURED" };
	if (isPlaceholderValue(from) || isPlaceholderValue(ownerEmail)) {
		return { sent: false, reason: "SMTP_NOT_CONFIGURED" };
	}

	const normalizedSubject = payload.subject?.trim() || "Non précisé";
	const normalizedMessage = payload.message.trim();
	const encodedReplySubject = encodeURIComponent("Re: Message contact - KS Studio");
	const replyCtaUrl = `mailto:${payload.email}?subject=${encodedReplySubject}`;

	const ownerSubject = "Nouveau message contact - KS Studio";
	const ownerText = `Nouveau message depuis le formulaire contact.

Nom: ${payload.firstName} ${payload.lastName}
Email: ${payload.email}
Objet: ${normalizedSubject}

Message:
${normalizedMessage}`;

	const ownerHtml = renderMailShell(
		{
			title: "Nouveau message contact",
			preheader: `${payload.firstName} ${payload.lastName} a envoyé un message depuis la page contact.`,
			intro: "Un nouveau message a été envoyé depuis le formulaire du site.",
			detailsRowsHtml: [
				detailRow("Nom", `${payload.firstName} ${payload.lastName}`),
				detailRow("Email", payload.email),
				detailRow("Objet", normalizedSubject)
			].join(""),
			outro: `Message:\n${normalizedMessage}`,
			badge: "Contact",
			ctaLabel: "Répondre",
			ctaUrl: replyCtaUrl
		}
	);

	await transporter.sendMail({
		from,
		to: ownerEmail,
		replyTo: payload.email,
		subject: ownerSubject,
		text: ownerText,
		html: ownerHtml
	});

	return { sent: true };
}

export function isEmailServiceConfigured() {
	return shouldSendEmails();
}
