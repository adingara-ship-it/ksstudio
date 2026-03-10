import type { APIRoute } from "astro";
import { ensureDefaultAvailability } from "../../../lib/defaultAvailability";
import { getDayBoundaryIso } from "../../../lib/bookingTime";
import { json } from "../../../lib/api";
import { supabaseAdmin } from "../../../lib/supabase";

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
	try {
		await ensureDefaultAvailability();
	} catch (error) {
		return json(500, {
			error: "DEFAULT_SLOTS_SYNC_FAILED",
			details: error instanceof Error ? error.message : "UNKNOWN"
		});
	}

	const date = url.searchParams.get("date");

	let query = supabaseAdmin
		.from("availability_slots")
		.select("id, slot_at")
		.eq("is_available", true)
		.order("slot_at", { ascending: true });

	if (date) {
		const boundary = getDayBoundaryIso(date);
		if (!boundary) {
			return json(400, { error: "DATE_INVALID" });
		}
		query = query
			.gte("slot_at", boundary.startIso)
			.lte("slot_at", boundary.endIso);
	} else {
		const nowIso = new Date().toISOString();
		query = query.gte("slot_at", nowIso).limit(500);
	}

	const { data, error } = await query;
	if (error) {
		return json(500, { error: "SLOTS_FETCH_FAILED", details: error.message });
	}

	const slots = (data ?? []).map((row) => ({
		id: row.id,
		slotAt: row.slot_at
	}));

	const dates = Array.from(
		new Set(slots.map((slot) => slot.slotAt.slice(0, 10)))
	);

	return json(200, { slots, dates });
};
