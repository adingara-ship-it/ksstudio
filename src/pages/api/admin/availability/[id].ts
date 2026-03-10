import type { APIRoute } from "astro";
import { ensureAdmin } from "../../../../lib/adminGuard";
import { json } from "../../../../lib/api";
import { isMissingBlockedSlotsTableError } from "../../../../lib/defaultAvailability";
import { isSameOriginRequest } from "../../../../lib/security";
import { supabaseAdmin } from "../../../../lib/supabase";

export const prerender = false;

export const DELETE: APIRoute = async (context) => {
	if (!ensureAdmin(context)) return json(401, { error: "UNAUTHORIZED" });
	if (!isSameOriginRequest(context.request, context.url.origin)) {
		return json(403, { error: "ORIGIN_FORBIDDEN" });
	}

	const slotId = context.params.id;
	if (!slotId) return json(400, { error: "SLOT_ID_REQUIRED" });

	const { data: existingBooking, error: bookingError } = await supabaseAdmin
		.from("bookings")
		.select("id")
		.eq("slot_id", slotId)
		.eq("status", "confirmed")
		.maybeSingle();

	if (bookingError) {
		return json(500, { error: "BOOKING_CHECK_FAILED", details: bookingError.message });
	}
	if (existingBooking) {
		return json(409, { error: "SLOT_HAS_CONFIRMED_BOOKING" });
	}

	const { data: slotRow, error: slotError } = await supabaseAdmin
		.from("availability_slots")
		.select("id, slot_at")
		.eq("id", slotId)
		.single();

	if (slotError || !slotRow) {
		return json(404, { error: "SLOT_NOT_FOUND" });
	}

	const { error: blockError } = await supabaseAdmin
		.from("availability_blocked_slots")
		.upsert(
			{
				slot_at: slotRow.slot_at,
				reason: "admin_removed"
			},
			{ onConflict: "slot_at" }
		);

	if (blockError) {
		if (isMissingBlockedSlotsTableError(blockError)) {
			return json(500, {
				error: "BLOCKED_SLOTS_TABLE_MISSING",
				details:
					"Table availability_blocked_slots manquante. Executez la migration SQL pour activer la suppression persistante."
			});
		}
		return json(500, { error: "BLOCK_SLOT_FAILED", details: blockError.message });
	}

	const { error: deleteError } = await supabaseAdmin
		.from("availability_slots")
		.delete()
		.eq("id", slotId);

	if (deleteError) {
		return json(500, { error: "SLOT_DELETE_FAILED", details: deleteError.message });
	}

	return json(200, { success: true });
};
