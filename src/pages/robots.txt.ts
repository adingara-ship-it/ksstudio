import type { APIRoute } from "astro";

const DISALLOWED_PREFIXES = ["/admin", "/api/admin"];

export const GET: APIRoute = ({ url }) => {
	const lines = [
		"User-agent: *",
		"Allow: /",
		...DISALLOWED_PREFIXES.map((path) => `Disallow: ${path}`),
		"",
		`Sitemap: ${url.origin}/sitemap.xml`
	];

	return new Response(lines.join("\n"), {
		headers: {
			"content-type": "text/plain; charset=utf-8",
			"cache-control": "public, max-age=3600"
		}
	});
};
