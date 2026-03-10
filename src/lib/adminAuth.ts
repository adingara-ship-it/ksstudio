import crypto from "node:crypto";
import type { AstroCookies } from "astro";

const COOKIE_NAME = "ks_admin_session";
const DEFAULT_SESSION_DURATION_SECONDS = 60 * 60 * 8;

function getSessionDurationSeconds() {
	const raw = Number.parseInt(String(import.meta.env.ADMIN_SESSION_DURATION_SECONDS ?? ""), 10);
	if (!Number.isFinite(raw)) return DEFAULT_SESSION_DURATION_SECONDS;
	return Math.min(24 * 60 * 60, Math.max(30 * 60, raw));
}

const SESSION_DURATION_SECONDS = getSessionDurationSeconds();

function normalizeEnvValue(value: string) {
	const trimmed = value.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1).trim();
	}
	return trimmed;
}

function getEnvValue(name: string) {
	const raw = import.meta.env[name];
	const value = typeof raw === "string" ? normalizeEnvValue(raw) : "";
	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}
	return value;
}

function encodeBase64Url(value: string) {
	return Buffer.from(value, "utf-8").toString("base64url");
}

function decodeBase64Url(value: string) {
	return Buffer.from(value, "base64url").toString("utf-8");
}

function signPayload(payloadBase64: string) {
	const secret = getEnvValue("ADMIN_SESSION_SECRET");
	return crypto.createHmac("sha256", secret).update(payloadBase64).digest("base64url");
}

function safeEqual(a: string, b: string) {
	const aBuffer = Buffer.from(a);
	const bBuffer = Buffer.from(b);
	if (aBuffer.length !== bBuffer.length) return false;
	return crypto.timingSafeEqual(aBuffer, bBuffer);
}

export function getAdminCredentials() {
	return {
		email: getEnvValue("ADMIN_EMAIL").toLowerCase(),
		password: getEnvValue("ADMIN_PASSWORD")
	};
}

export function setAdminSession(cookies: AstroCookies, email: string) {
	const expiresAt = Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS;
	const payload = encodeBase64Url(JSON.stringify({ email, exp: expiresAt }));
	const signature = signPayload(payload);
	const token = `${payload}.${signature}`;

	cookies.set(COOKIE_NAME, token, {
		path: "/",
		httpOnly: true,
		sameSite: "strict",
		secure: import.meta.env.PROD,
		maxAge: SESSION_DURATION_SECONDS
	});
}

export function clearAdminSession(cookies: AstroCookies) {
	cookies.delete(COOKIE_NAME, { path: "/" });
}

export function isAdminAuthenticated(cookies: AstroCookies) {
	const token = cookies.get(COOKIE_NAME)?.value;
	if (!token) return false;

	const [payload, signature] = token.split(".");
	if (!payload || !signature) return false;

	try {
		const expectedSignature = signPayload(payload);
		if (!safeEqual(expectedSignature, signature)) return false;

		const parsed = JSON.parse(decodeBase64Url(payload)) as {
			email?: string;
			exp?: number;
		};
		if (!parsed.email || !parsed.exp) return false;
		if (parsed.exp < Math.floor(Date.now() / 1000)) return false;
		return parsed.email.toLowerCase() === getAdminCredentials().email;
	} catch {
		return false;
	}
}
