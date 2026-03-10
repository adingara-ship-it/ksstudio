import type { APIRoute } from "astro";
import {
	createLocalIso,
	dateToLocalYmd,
	minutesToTimeLabel
} from "../../../lib/bookingTime";
import { ensureAdmin } from "../../../lib/adminGuard";
import { json, readJsonBody } from "../../../lib/api";
import {
	ensureDefaultAvailability,
	isMissingBlockedSlotsTableError
} from "../../../lib/defaultAvailability";
import { isSameOriginRequest } from "../../../lib/security";
import { supabaseAdmin } from "../../../lib/supabase";

export const prerender = false;

export const GET: APIRoute = async (context) => {
	if (!ensureAdmin(context)) return json(401, { error: "UNAUTHORIZED" });

	try {
		await ensureDefaultAvailability();
	} catch (error) {
		return json(500, {
			error: "DEFAULT_SLOTS_SYNC_FAILED",
			details: error instanceof Error ? error.message : "UNKNOWN"
		});
	}

	const nowIso = new Date().toISOString();

	const { data, error } = await supabaseAdmin
		.from("availability_slots")
		.select("id, slot_at, is_available")
		.gte("slot_at", nowIso)
		.order("slot_at", { ascending: true })
		.limit(600);

	if (error) {
		return json(500, {
			error: "AVAILABILITY_FETCH_FAILED",
			details: error.message
		});
	}

	return json(200, { slots: data ?? [] });
};

function timeToMinutes(time: string) {
	const [h, m] = time.split(":").map((chunk) => Number(chunk));
	if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
	if (h < 0 || h > 23 || m < 0 || m > 59) return null;
	return h * 60 + m;
}

export const POST: APIRoute = async (context) => {
	if (!ensureAdmin(context)) return json(401, { error: "UNAUTHORIZED" });
	if (!isSameOriginRequest(context.request, context.url.origin)) {
		return json(403, { error: "ORIGIN_FORBIDDEN" });
	}

	const body = await readJsonBody(context.request);
	if (!body) return json(400, { error: "BODY_INVALID" });

	const date = String(body.date ?? "");
	const singleTime = String(body.time ?? "");
	const startTime = String(body.startTime ?? "");
	const endTime = String(body.endTime ?? "");
	const intervalMinutes = Number(body.intervalMinutes ?? 30);

	const rows: { slot_at: string; is_available: boolean }[] = [];
	let candidates = 0;
	let skippedPast = 0;
	const nowMs = Date.now();

	if (!date) {
		return json(400, { error: "FIELDS_INVALID" });
	}

	// Mode principal: ajout manuel d'un creneau unique (date + heure).
	if (singleTime) {
		const singleMinutes = timeToMinutes(singleTime);
		if (singleMinutes === null) {
			return json(400, { error: "FIELDS_INVALID" });
		}
		candidates = 1;
		const iso = createLocalIso(date, minutesToTimeLabel(singleMinutes));
		if (iso && new Date(iso).getTime() > nowMs) {
			rows.push({ slot_at: iso, is_available: true });
		} else {
			skippedPast = 1;
		}
	} else {
		// Fallback: conserve la compatibilite avec l'ancien format plage horaire.
		const startMinutes = timeToMinutes(startTime);
		const endMinutes = timeToMinutes(endTime);

		if (startMinutes === null || endMinutes === null) {
			return json(400, { error: "FIELDS_INVALID" });
		}

		if (endMinutes <= startMinutes) {
			return json(400, { error: "TIME_RANGE_INVALID" });
		}

		if (!Number.isInteger(intervalMinutes) || intervalMinutes < 10 || intervalMinutes > 180) {
			return json(400, { error: "INTERVAL_INVALID" });
		}

		for (let value = startMinutes; value + intervalMinutes <= endMinutes; value += intervalMinutes) {
			candidates += 1;
			const iso = createLocalIso(date, minutesToTimeLabel(value));
			if (!iso) continue;
			if (new Date(iso).getTime() <= nowMs) {
				skippedPast += 1;
				continue;
			}
			rows.push({ slot_at: iso, is_available: true });
		}
	}

	if (rows.length === 0) {
		return json(400, {
			error: "NO_FUTURE_SLOTS",
			candidates,
			skippedPast
		});
	}

	const slotAtValues = rows.map((row) => row.slot_at);
	const { error: unblockError } = await supabaseAdmin
		.from("availability_blocked_slots")
		.delete()
		.in("slot_at", slotAtValues);

	if (unblockError && !isMissingBlockedSlotsTableError(unblockError)) {
		return json(500, {
			error: "AVAILABILITY_UNBLOCK_FAILED",
			details: unblockError.message
		});
	}

	const { data: insertedRows, error } = await supabaseAdmin
		.from("availability_slots")
		.upsert(rows, { onConflict: "slot_at", ignoreDuplicates: true })
		.select("id");

	if (error) {
		return json(500, { error: "AVAILABILITY_UPSERT_FAILED", details: error.message });
	}

	const inserted = insertedRows?.length ?? 0;
	const ignoredDuplicates = Math.max(0, rows.length - inserted);

	return json(200, {
		success: true,
		date: dateToLocalYmd(new Date(`${date}T12:00:00`)),
		generated: rows.length,
		inserted,
		ignoredDuplicates,
		candidates,
		skippedPast
	});
};
