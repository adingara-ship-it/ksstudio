import { createLocalIso, dateToLocalYmd } from "./bookingTime";
import { supabaseAdmin } from "./supabase";

type SlotRow = {
	slot_at: string;
	is_available: boolean;
};

const DEFAULT_HORIZON_DAYS = 120;
const DEFAULT_WEEKLY_TIMES: Record<number, string[]> = {
	2: ["09:30", "13:00", "15:30"], // mardi
	3: ["09:30", "13:00", "15:30"], // mercredi
	5: ["09:30", "13:00", "15:30", "17:30"], // vendredi
	6: ["09:30", "13:00", "15:30", "17:30"] // samedi
};

function isMissingBlockedTableError(error: { code?: string; message?: string } | null) {
	if (!error) return false;
	return error.code === "42P01" || String(error.message ?? "").includes("availability_blocked_slots");
}

function buildDefaultRows() {
	const rows: SlotRow[] = [];
	const nowMs = Date.now();
	const startDate = new Date();
	startDate.setHours(0, 0, 0, 0);

	for (let offset = 0; offset < DEFAULT_HORIZON_DAYS; offset += 1) {
		const currentDate = new Date(startDate);
		currentDate.setDate(startDate.getDate() + offset);
		const weekday = currentDate.getDay();
		const times = DEFAULT_WEEKLY_TIMES[weekday] ?? [];
		if (times.length === 0) continue;

		const localDate = dateToLocalYmd(currentDate);
		for (const time of times) {
			const iso = createLocalIso(localDate, time);
			if (!iso) continue;
			if (new Date(iso).getTime() <= nowMs) continue;
			rows.push({
				slot_at: iso,
				is_available: true
			});
		}
	}

	return rows;
}

export async function ensureDefaultAvailability() {
	const defaultRows = buildDefaultRows();
	if (defaultRows.length === 0) return { generated: 0, blocked: 0 };

	const firstIso = defaultRows[0].slot_at;
	const lastIso = defaultRows[defaultRows.length - 1].slot_at;

	let blockedSet = new Set<string>();
	const { data: blockedRows, error: blockedError } = await supabaseAdmin
		.from("availability_blocked_slots")
		.select("slot_at")
		.gte("slot_at", firstIso)
		.lte("slot_at", lastIso)
		.limit(2500);

	if (blockedError && !isMissingBlockedTableError(blockedError)) {
		throw new Error(`DEFAULT_BLOCKED_FETCH_FAILED: ${blockedError.message}`);
	}

	if (!blockedError) {
		blockedSet = new Set((blockedRows ?? []).map((row) => row.slot_at as string));
	}

	const rowsToInsert = defaultRows.filter((row) => !blockedSet.has(row.slot_at));
	if (rowsToInsert.length === 0) {
		return { generated: 0, blocked: blockedSet.size };
	}

	const { error: upsertError } = await supabaseAdmin
		.from("availability_slots")
		.upsert(rowsToInsert, { onConflict: "slot_at", ignoreDuplicates: true });

	if (upsertError) {
		throw new Error(`DEFAULT_SLOTS_UPSERT_FAILED: ${upsertError.message}`);
	}

	return {
		generated: rowsToInsert.length,
		blocked: blockedSet.size
	};
}

export function isMissingBlockedSlotsTableError(error: { code?: string; message?: string } | null) {
	return isMissingBlockedTableError(error);
}
