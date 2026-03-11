interface LoginRateBucket {
	failures: number;
	windowStartedAt: number;
	blockedUntil: number;
}

interface LoginRateStatus {
	limited: boolean;
	retryAfterSeconds: number;
	remainingAttempts: number;
	maxAttempts: number;
}

function parseIntEnv(name: string, fallback: number, min: number, max: number) {
	const raw = Number.parseInt(String(import.meta.env[name] ?? ""), 10);
	if (!Number.isFinite(raw)) return fallback;
	return Math.min(max, Math.max(min, raw));
}

const LOGIN_MAX_ATTEMPTS = parseIntEnv("ADMIN_LOGIN_MAX_ATTEMPTS", 5, 1, 30);
const LOGIN_WINDOW_MS = parseIntEnv("ADMIN_LOGIN_WINDOW_MS", 15 * 60 * 1000, 60_000, 24 * 60 * 60 * 1000);
const LOGIN_BLOCK_MS = parseIntEnv("ADMIN_LOGIN_BLOCK_MS", 15 * 60 * 1000, 60_000, 24 * 60 * 60 * 1000);
const PRUNE_INTERVAL_MS = 60_000;
const ADMIN_REQUEST_HEADER = "x-ks-admin-request";
const ADMIN_REQUEST_HEADER_VALUE = "1";

const loginRateBuckets = new Map<string, LoginRateBucket>();
let lastPruneAt = 0;

function normalizeBucket(bucket: LoginRateBucket, nowMs: number) {
	if (bucket.blockedUntil > 0 && bucket.blockedUntil <= nowMs) {
		bucket.blockedUntil = 0;
	}

	if (nowMs - bucket.windowStartedAt >= LOGIN_WINDOW_MS) {
		bucket.failures = 0;
		bucket.windowStartedAt = nowMs;
	}
}

function getBucket(key: string, nowMs: number) {
	const existing = loginRateBuckets.get(key);
	if (existing) {
		normalizeBucket(existing, nowMs);
		return existing;
	}

	const created: LoginRateBucket = {
		failures: 0,
		windowStartedAt: nowMs,
		blockedUntil: 0
	};
	loginRateBuckets.set(key, created);
	return created;
}

function maybePruneBuckets(nowMs: number) {
	if (nowMs - lastPruneAt < PRUNE_INTERVAL_MS) return;
	lastPruneAt = nowMs;

	for (const [key, bucket] of loginRateBuckets) {
		normalizeBucket(bucket, nowMs);
		const isIdle = bucket.failures === 0 && bucket.blockedUntil === 0;
		const isExpired = nowMs - bucket.windowStartedAt > LOGIN_WINDOW_MS * 2;
		if (isIdle && isExpired) {
			loginRateBuckets.delete(key);
		}
	}
}

function buildLoginKeys(ip: string, email: string) {
	const safeIp = ip.trim() || "unknown";
	const safeEmail = email.trim().toLowerCase() || "unknown";
	return [`ip:${safeIp}`, `ip-email:${safeIp}:${safeEmail}`];
}

function buildRateStatus(keys: string[], nowMs: number): LoginRateStatus {
	const buckets = keys.map((key) => getBucket(key, nowMs));
	const blockedUntil = Math.max(...buckets.map((bucket) => bucket.blockedUntil), 0);
	if (blockedUntil > nowMs) {
		return {
			limited: true,
			retryAfterSeconds: Math.max(1, Math.ceil((blockedUntil - nowMs) / 1000)),
			remainingAttempts: 0,
			maxAttempts: LOGIN_MAX_ATTEMPTS
		};
	}

	const highestFailures = Math.max(...buckets.map((bucket) => bucket.failures), 0);
	return {
		limited: false,
		retryAfterSeconds: 0,
		remainingAttempts: Math.max(0, LOGIN_MAX_ATTEMPTS - highestFailures),
		maxAttempts: LOGIN_MAX_ATTEMPTS
	};
}

export function getAdminLoginRateLimit(ip: string, email: string): LoginRateStatus {
	const nowMs = Date.now();
	maybePruneBuckets(nowMs);
	const keys = buildLoginKeys(ip, email);
	return buildRateStatus(keys, nowMs);
}

export function registerAdminLoginFailure(ip: string, email: string): LoginRateStatus {
	const nowMs = Date.now();
	maybePruneBuckets(nowMs);
	const keys = buildLoginKeys(ip, email);

	for (const key of keys) {
		const bucket = getBucket(key, nowMs);
		bucket.failures += 1;
		if (bucket.failures >= LOGIN_MAX_ATTEMPTS) {
			bucket.blockedUntil = nowMs + LOGIN_BLOCK_MS;
		}
	}

	return buildRateStatus(keys, nowMs);
}

export function clearAdminLoginFailures(ip: string, email: string) {
	for (const key of buildLoginKeys(ip, email)) {
		loginRateBuckets.delete(key);
	}
}

export function getClientIp(request: Request, fallbackAddress = "") {
	const forwardedFor = request.headers.get("x-forwarded-for");
	if (forwardedFor) {
		const firstIp = forwardedFor
			.split(",")
			.map((value) => value.trim())
			.find(Boolean);
		if (firstIp) return firstIp;
	}

	const realIp = request.headers.get("x-real-ip");
	if (realIp?.trim()) return realIp.trim();

	const cloudflareIp = request.headers.get("cf-connecting-ip");
	if (cloudflareIp?.trim()) return cloudflareIp.trim();

	return fallbackAddress.trim() || "unknown";
}

export function maskEmailAddress(email: string) {
	const value = email.trim().toLowerCase();
	const [local = "", domain = ""] = value.split("@");
	if (!local || !domain) return "unknown";
	if (local.length === 1) return `*@${domain}`;
	return `${local.slice(0, 2)}***@${domain}`;
}

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

function normalizeOrigin(value: string) {
	const raw = value.trim();
	if (!raw) return "";
	try {
		return new URL(raw).origin;
	} catch {
		return "";
	}
}

function normalizeComparableOrigin(value: string) {
	const origin = normalizeOrigin(value);
	if (!origin) return "";

	try {
		const parsed = new URL(origin);
		const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
		const port = parsed.port ? `:${parsed.port}` : "";
		return `${parsed.protocol}//${hostname}${port}`;
	} catch {
		return "";
	}
}

function originsMatch(left: string, right: string) {
	const leftComparable = normalizeComparableOrigin(left);
	const rightComparable = normalizeComparableOrigin(right);
	if (!leftComparable || !rightComparable) return false;
	return leftComparable === rightComparable;
}

function addOriginIfValid(target: Set<string>, candidate: string) {
	const normalized = normalizeOrigin(candidate);
	if (!normalized) return;
	target.add(normalized);
}

function buildAllowedOrigins(request: Request, expectedOrigin: string) {
	const allowed = new Set<string>();
	addOriginIfValid(allowed, expectedOrigin);

	const siteEnvNames = ["SITE_URL", "PUBLIC_SITE_URL", "APP_URL"];
	for (const envName of siteEnvNames) {
		const raw = import.meta.env[envName];
		if (typeof raw !== "string") continue;
		const normalized = normalizeEnvValue(raw);
		addOriginIfValid(allowed, normalized);
	}

	const forwardedHostRaw = request.headers.get("x-forwarded-host") ?? "";
	const forwardedProtoRaw = request.headers.get("x-forwarded-proto") ?? "";
	const hostRaw = request.headers.get("host") ?? "";

	const forwardedHost = forwardedHostRaw
		.split(",")
		.map((value) => value.trim())
		.find(Boolean);
	const forwardedProto = forwardedProtoRaw
		.split(",")
		.map((value) => value.trim())
		.find(Boolean);
	const host = hostRaw
		.split(",")
		.map((value) => value.trim())
		.find(Boolean);

	const expectedProtocol = normalizeOrigin(expectedOrigin)
		? new URL(expectedOrigin).protocol.replace(":", "")
		: "https";
	const protocol = forwardedProto || expectedProtocol || "https";

	if (forwardedHost) addOriginIfValid(allowed, `${protocol}://${forwardedHost}`);
	if (host) addOriginIfValid(allowed, `${protocol}://${host}`);

	return allowed;
}

export function isSameOriginRequest(request: Request, expectedOrigin: string) {
	const allowedOrigins = buildAllowedOrigins(request, expectedOrigin);
	const origin = request.headers.get("origin")?.trim() ?? "";
	const referer = request.headers.get("referer")?.trim() ?? "";

	if (origin && origin.toLowerCase() !== "null") {
		for (const allowed of allowedOrigins) {
			if (originsMatch(origin, allowed)) return true;
		}
	}

	if (referer) {
		try {
			const refererOrigin = new URL(referer).origin;
			for (const allowed of allowedOrigins) {
				if (originsMatch(refererOrigin, allowed)) return true;
			}
		} catch {
			return false;
		}
	}

	if (!origin && !referer) return true;
	return false;
}

export function hasAdminMutationHeader(request: Request) {
	return request.headers.get(ADMIN_REQUEST_HEADER)?.trim() === ADMIN_REQUEST_HEADER_VALUE;
}

export function isTrustedAdminMutationRequest(request: Request, expectedOrigin: string) {
	return hasAdminMutationHeader(request) && isSameOriginRequest(request, expectedOrigin);
}
