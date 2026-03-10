import crypto from "node:crypto";
import type { APIRoute } from "astro";
import { json, readJsonBody } from "../../../lib/api";
import { getAdminCredentials, setAdminSession } from "../../../lib/adminAuth";
import {
	clearAdminLoginFailures,
	getAdminLoginRateLimit,
	getClientIp,
	isSameOriginRequest,
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

	if (!isSameOriginRequest(request, url.origin)) {
		console.warn("[admin-auth] login rejected: invalid origin", { ipAddress });
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

	const admin = getAdminCredentials();

	const isEmailValid = safeTextEqual(email, admin.email.toLowerCase());
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
	setAdminSession(cookies, admin.email);
	console.info("[admin-auth] login success", {
		ipAddress,
		email: maskEmailAddress(email)
	});
	return json(200, { success: true });
};
