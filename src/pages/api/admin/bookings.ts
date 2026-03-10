import type { APIRoute } from "astro";
import { ensureAdmin } from "../../../lib/adminGuard";
import { json } from "../../../lib/api";
import { isSameOriginRequest } from "../../../lib/security";
import { supabaseAdmin } from "../../../lib/supabase";

export const prerender = false;
const CANCELLED_RETENTION_DAYS = 7;

export const GET: APIRoute = async (context) => {
	if (!ensureAdmin(context)) return json(401, { error: "UNAUTHORIZED" });

	const cutoffDate = new Date(Date.now() - CANCELLED_RETENTION_DAYS * 24 * 60 * 60 * 1000);
	const cutoffIso = cutoffDate.toISOString();

	const { error: cleanupError } = await supabaseAdmin
		.from("bookings")
		.delete()
		.eq("status", "cancelled")
		.lte("cancelled_at", cutoffIso);

	if (cleanupError) {
		return json(500, { error: "BOOKINGS_CLEANUP_FAILED", details: cleanupError.message });
	}

	const baseSelect =
		"id, service_name, slot_at, first_name, last_name, phone, email, status, created_at, cancelled_at";

	const [{ data: activeData, error: activeError }, { data: cancelledData, error: cancelledError }] =
		await Promise.all([
			supabaseAdmin
				.from("bookings")
				.select(baseSelect)
				.eq("status", "confirmed")
				.order("slot_at", { ascending: true })
				.limit(400),
			supabaseAdmin
				.from("bookings")
				.select(baseSelect)
				.eq("status", "cancelled")
				.order("cancelled_at", { ascending: false })
				.limit(300)
		]);

	if (activeError || cancelledError) {
		const details = activeError?.message ?? cancelledError?.message ?? "UNKNOWN";
		return json(500, { error: "BOOKINGS_FETCH_FAILED", details });
	}

	return json(200, {
		activeBookings: activeData ?? [],
		cancelledBookings: cancelledData ?? [],
		retentionDays: CANCELLED_RETENTION_DAYS
	});
};

export const DELETE: APIRoute = async (context) => {
	if (!ensureAdmin(context)) return json(401, { error: "UNAUTHORIZED" });
	if (!isSameOriginRequest(context.request, context.url.origin)) {
		return json(403, { error: "ORIGIN_FORBIDDEN" });
	}

	const scope = context.url.searchParams.get("scope");
	if (scope !== "cancelled") {
		return json(400, { error: "DELETE_SCOPE_REQUIRED" });
	}

	const { data: deletedRows, error } = await supabaseAdmin
		.from("bookings")
		.delete()
		.eq("status", "cancelled")
		.select("id");

	if (error) {
		return json(500, { error: "BOOKINGS_DELETE_FAILED", details: error.message });
	}

	return json(200, {
		success: true,
		deleted: deletedRows?.length ?? 0
	});
};
