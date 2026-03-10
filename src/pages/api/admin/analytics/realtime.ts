import type { APIRoute } from "astro";
import { ensureAdmin } from "../../../../lib/adminGuard";
import { json } from "../../../../lib/api";
import { supabaseAdmin } from "../../../../lib/supabase";

export const prerender = false;

function readActiveWindowMinutes() {
	const raw = Number.parseInt(String(import.meta.env.ANALYTICS_ACTIVE_WINDOW_MINUTES ?? ""), 10);
	if (!Number.isFinite(raw)) return 5;
	return Math.min(60, Math.max(1, raw));
}

function toTopItems(counter: Map<string, number>, limit = 8) {
	return Array.from(counter.entries())
		.sort((left, right) => right[1] - left[1])
		.slice(0, limit)
		.map(([path, count]) => ({ path, count }));
}

function isMissingAnalyticsTables(error: { code?: string; message?: string } | null) {
	if (!error) return false;
	if (error.code === "42P01") return true;
	const message = String(error.message ?? "");
	return message.includes("analytics_live_sessions") || message.includes("analytics_page_views");
}

export const GET: APIRoute = async (context) => {
	if (!ensureAdmin(context)) return json(401, { error: "UNAUTHORIZED" });

	const activeWindowMinutes = readActiveWindowMinutes();
	const nowMs = Date.now();
	const activeSinceIso = new Date(nowMs - activeWindowMinutes * 60 * 1000).toISOString();
	const daySinceIso = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
	const staleIso = new Date(nowMs - 48 * 60 * 60 * 1000).toISOString();

	await supabaseAdmin
		.from("analytics_live_sessions")
		.delete()
		.lt("last_seen_at", staleIso);

	const [activeSessionsResult, pageViewsCountResult, pageViewsRowsResult] = await Promise.all([
		supabaseAdmin
			.from("analytics_live_sessions")
			.select("session_id, current_path, last_seen_at")
			.gte("last_seen_at", activeSinceIso)
			.order("last_seen_at", { ascending: false })
			.limit(200),
		supabaseAdmin
			.from("analytics_page_views")
			.select("id", { head: true, count: "exact" })
			.gte("created_at", daySinceIso),
		supabaseAdmin
			.from("analytics_page_views")
			.select("page_path")
			.gte("created_at", daySinceIso)
			.order("created_at", { ascending: false })
			.limit(2500)
	]);

	const errors = [
		activeSessionsResult.error,
		pageViewsCountResult.error,
		pageViewsRowsResult.error
	].filter(Boolean);
	if (errors.length > 0) {
		const firstError = errors[0]!;
		if (isMissingAnalyticsTables(firstError)) {
			return json(500, {
				error: "ANALYTICS_TABLES_MISSING",
				details: "Executez la migration SQL pour analytics_live_sessions et analytics_page_views."
			});
		}
		return json(500, { error: "ANALYTICS_FETCH_FAILED", details: firstError.message });
	}

	const activeSessions = activeSessionsResult.data ?? [];
	const activePagesCounter = new Map<string, number>();
	for (const session of activeSessions) {
		const path = String(session.current_path ?? "");
		if (!path) continue;
		activePagesCounter.set(path, (activePagesCounter.get(path) ?? 0) + 1);
	}

	const viewsCounter = new Map<string, number>();
	for (const row of pageViewsRowsResult.data ?? []) {
		const path = String(row.page_path ?? "");
		if (!path) continue;
		viewsCounter.set(path, (viewsCounter.get(path) ?? 0) + 1);
	}

	return json(200, {
		activeWindowMinutes,
		activeVisitors: activeSessions.length,
		pageViews24h: pageViewsCountResult.count ?? 0,
		activePages: toTopItems(activePagesCounter),
		topPages24h: toTopItems(viewsCounter),
		recentSessions: activeSessions.map((session) => ({
			sessionId: session.session_id,
			path: session.current_path,
			lastSeenAt: session.last_seen_at
		}))
	});
};
