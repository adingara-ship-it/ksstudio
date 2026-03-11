import type { APIRoute } from "astro";
import { clearAdminSession } from "../../../lib/adminAuth";
import { json } from "../../../lib/api";
import { isTrustedAdminMutationRequest } from "../../../lib/security";

export const prerender = false;

export const POST: APIRoute = async (context) => {
	if (!isTrustedAdminMutationRequest(context.request, context.url.origin)) {
		return json(403, { error: "ORIGIN_FORBIDDEN" });
	}

	const { cookies } = context;
	clearAdminSession(cookies);
	return json(200, { success: true });
};
