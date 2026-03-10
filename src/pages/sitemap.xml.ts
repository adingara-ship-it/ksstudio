import type { APIRoute } from "astro";

const PUBLIC_ROUTES = ["/", "/a-propos", "/contact", "/reservation", "/mentions-legales"];

function escapeXml(value: string) {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}

export const GET: APIRoute = ({ url }) => {
	const now = new Date().toISOString();
	const rows = PUBLIC_ROUTES.map((route) => {
		const loc = escapeXml(new URL(route, url.origin).toString());
		return `<url><loc>${loc}</loc><lastmod>${now}</lastmod></url>`;
	}).join("");

	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${rows}</urlset>`;

	return new Response(xml, {
		headers: {
			"content-type": "application/xml; charset=utf-8",
			"cache-control": "public, max-age=3600"
		}
	});
};
