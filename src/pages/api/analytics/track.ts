import type { APIRoute } from "astro";
import { json, readJsonBody } from "../../../lib/api";
import { isSameOriginRequest } from "../../../lib/security";
import { supabaseAdmin } from "../../../lib/supabase";

export const prerender = false;

type EventType = "page_view" | "heartbeat";

function normalizePath(value: unknown) {
	const path = String(value ?? "").trim();
	if (!path || path.length > 200 || !path.startsWith("/")) return "";
	return path;
}

function normalizeSessionId(value: unknown) {
	const sessionId = String(value ?? "").trim();
	if (!sessionId || sessionId.length > 80) return "";
	if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) return "";
	return sessionId;
}

function normalizeEventType(value: unknown): EventType | "" {
	const eventType = String(value ?? "").trim();
	if (eventType === "page_view" || eventType === "heartbeat") return eventType;
	return "";
}

function normalizeText(value: unknown, maxLength = 500) {
	const text = String(value ?? "").trim();
	if (!text) return null;
	return text.slice(0, maxLength);
}

function isMissingAnalyticsTables(error: { code?: string; message?: string } | null) {
	if (!error) return false;
	if (error.code === "42P01") return true;
	const message = String(error.message ?? "");
	return message.includes("analytics_live_sessions") || message.includes("analytics_page_views");
}

export const POST: APIRoute = async (context) => {
	if (!isSameOriginRequest(context.request, context.url.origin)) {
		return json(403, { error: "ORIGIN_FORBIDDEN" });
	}

	const body = await readJsonBody(context.request);
	if (!body) return json(400, { error: "BODY_INVALID" });

	const eventType = normalizeEventType(body.eventType);
	const sessionId = normalizeSessionId(body.sessionId);
	const pagePath = normalizePath(body.path);

	if (!eventType || !sessionId || !pagePath) {
		return json(400, { error: "FIELDS_INVALID" });
	}

	const nowIso = new Date().toISOString();
	const referrer = normalizeText(body.referrer, 500);
	const userAgent = normalizeText(context.request.headers.get("user-agent"), 255);

	const { error: liveError } = await supabaseAdmin
		.from("analytics_live_sessions")
		.upsert(
			{
				session_id: sessionId,
				last_seen_at: nowIso,
				current_path: pagePath,
				referrer,
				user_agent: userAgent,
				updated_at: nowIso
			},
			{ onConflict: "session_id" }
		);

	if (liveError) {
		if (isMissingAnalyticsTables(liveError)) {
			return json(200, { success: false, reason: "ANALYTICS_TABLES_MISSING" });
		}
		return json(500, { error: "ANALYTICS_LIVE_UPSERT_FAILED", details: liveError.message });
	}

	if (eventType === "page_view") {
		const { error: eventError } = await supabaseAdmin.from("analytics_page_views").insert({
			session_id: sessionId,
			page_path: pagePath,
			referrer,
			user_agent: userAgent
		});

		if (eventError) {
			if (isMissingAnalyticsTables(eventError)) {
				return json(200, { success: false, reason: "ANALYTICS_TABLES_MISSING" });
			}
			return json(500, { error: "ANALYTICS_PAGE_VIEW_INSERT_FAILED", details: eventError.message });
		}
	}

	if (Math.random() < 0.02) {
		const staleIso = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
		await supabaseAdmin
			.from("analytics_live_sessions")
			.delete()
			.lt("last_seen_at", staleIso);
	}

	return json(200, { success: true });
};
