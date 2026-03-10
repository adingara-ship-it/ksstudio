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

export function isSameOriginRequest(request: Request, expectedOrigin: string) {
	const origin = request.headers.get("origin");
	if (origin) return origin === expectedOrigin;

	const referer = request.headers.get("referer");
	if (!referer) return true;

	try {
		return new URL(referer).origin === expectedOrigin;
	} catch {
		return false;
	}
}
