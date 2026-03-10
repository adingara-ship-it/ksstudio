import type { APIRoute } from "astro";

export function json(status: number, payload: unknown): ReturnType<APIRoute> {
	return new Response(JSON.stringify(payload), {
		status,
		headers: {
			"content-type": "application/json; charset=utf-8",
			"cache-control": "no-store"
		}
	});
}

export async function readJsonBody(request: Request) {
	try {
		return await request.json();
	} catch {
		return null;
	}
}
