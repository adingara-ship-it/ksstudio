import crypto from "node:crypto";
import type { APIRoute } from "astro";
import { json, readJsonBody } from "../../../lib/api";
import { getAdminCredentials, setAdminSession } from "../../../lib/adminAuth";
import {
	clearAdminLoginFailures,
	getAdminLoginRateLimit,
	getClientIp,
	isTrustedAdminMutationRequest,
	maskEmailAddress,
	registerAdminLoginFailure
} from "../../../lib/security";

export const prerender = false;

function safeTextEqual(left: string, right: string) {
	const leftHash = crypto.createHash("sha256").update(left).digest();
	const rightHash = crypto.createHash("sha256").update(right).digest();
	return crypto.timingSafeEqual(leftHash, rightHash);
}

export const POST: APIRoute = async (context) => {
	const { request, cookies, url, clientAddress } = context;
	const ipAddress = getClientIp(request, clientAddress);
	const originHeader = request.headers.get("origin");
	const refererHeader = request.headers.get("referer");
	const forwardedHost = request.headers.get("x-forwarded-host");
	const hostHeader = request.headers.get("host");

	if (!isTrustedAdminMutationRequest(request, url.origin)) {
		console.warn("[admin-auth] login rejected: invalid origin", { ipAddress });
		console.warn("[admin-auth] login rejected: origin details", {
			expectedOrigin: url.origin,
			originHeader,
			refererHeader,
			forwardedHost,
			hostHeader
		});
		return json(403, { error: "ORIGIN_FORBIDDEN" });
	}

	const body = await readJsonBody(request);
	if (!body) return json(400, { error: "BODY_INVALID" });

	const email = String(body.email ?? "").trim().toLowerCase();
	const password = String(body.password ?? "");
	if (!email || !password) {
		return json(400, { error: "FIELDS_REQUIRED" });
	}

	const rateBeforeCheck = getAdminLoginRateLimit(ipAddress, email);
	if (rateBeforeCheck.limited) {
		console.warn("[admin-auth] login blocked: too many attempts", {
			ipAddress,
			email: maskEmailAddress(email),
			retryAfterSeconds: rateBeforeCheck.retryAfterSeconds
		});
		return json(429, {
			error: "TOO_MANY_ATTEMPTS",
			retryAfterSeconds: rateBeforeCheck.retryAfterSeconds
		});
	}

	let admin: { email: string; password: string };
	try {
		admin = getAdminCredentials();
	} catch (error) {
		console.error("[admin-auth] login failed: missing auth config", {
			ipAddress,
			error: error instanceof Error ? error.message : "UNKNOWN"
		});
		return json(500, { error: "AUTH_CONFIG_MISSING" });
	}

	const isEmailValid = safeTextEqual(email, admin.email);
	const isPasswordValid = safeTextEqual(password, admin.password);

	if (!isEmailValid || !isPasswordValid) {
		const rateAfterFailure = registerAdminLoginFailure(ipAddress, email);
		const logPayload = {
			ipAddress,
			email: maskEmailAddress(email),
			remainingAttempts: rateAfterFailure.remainingAttempts,
			retryAfterSeconds: rateAfterFailure.retryAfterSeconds
		};
		if (rateAfterFailure.limited) {
			console.warn("[admin-auth] login blocked after invalid credentials", logPayload);
			return json(429, {
				error: "TOO_MANY_ATTEMPTS",
				retryAfterSeconds: rateAfterFailure.retryAfterSeconds
			});
		}
		console.warn("[admin-auth] login failed: invalid credentials", logPayload);
		return json(401, { error: "INVALID_CREDENTIALS" });
	}

	clearAdminLoginFailures(ipAddress, email);
	try {
		setAdminSession(cookies, admin.email);
	} catch (error) {
		console.error("[admin-auth] login failed: session config invalid", {
			ipAddress,
			error: error instanceof Error ? error.message : "UNKNOWN"
		});
		return json(500, { error: "AUTH_CONFIG_MISSING" });
	}
	console.info("[admin-auth] login success", {
		ipAddress,
		email: maskEmailAddress(email)
	});
	return json(200, { success: true });
};
