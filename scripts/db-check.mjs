import { createClient } from "@supabase/supabase-js";

function pickEnv(names) {
	for (const name of names) {
		const value = process.env[name]?.trim();
		if (value) return { name, value };
	}
	return null;
}

function isPlaceholder(value) {
	const lower = value.toLowerCase();
	return (
		lower.includes("your_project") ||
		lower.includes("your_service_role_key") ||
		lower.includes("change-this") ||
		lower.includes("example.com")
	);
}

function printFailure(message) {
	console.error(`\n[db:check] ${message}`);
}

const urlEntry = pickEnv(["SUPABASE_URL", "PUBLIC_SUPABASE_URL"]);
const keyEntry = pickEnv([
	"SUPABASE_SERVICE_ROLE_KEY",
	"SUPABASE_SERVICE_KEY",
	"SUPABASE_SECRET_KEY"
]);

if (!urlEntry) {
	printFailure(
		"Variable manquante: SUPABASE_URL (ou PUBLIC_SUPABASE_URL). Remplis ton fichier .env."
	);
	process.exit(1);
}

if (!keyEntry) {
	printFailure(
		"Variable manquante: SUPABASE_SERVICE_ROLE_KEY (ou SUPABASE_SERVICE_KEY / SUPABASE_SECRET_KEY)."
	);
	process.exit(1);
}

if (isPlaceholder(urlEntry.value) || isPlaceholder(keyEntry.value)) {
	printFailure(
		"Les variables Supabase semblent etre des placeholders. Remplace les valeurs dans .env."
	);
	process.exit(1);
}

console.log(`[db:check] URL chargee depuis ${urlEntry.name}`);
console.log(`[db:check] Cle chargee depuis ${keyEntry.name}`);

const supabase = createClient(urlEntry.value, keyEntry.value, {
	auth: {
		autoRefreshToken: false,
		persistSession: false
	}
});

function isMissingTable(error) {
	return error?.code === "42P01" || String(error?.message ?? "").includes("schema cache");
}

async function assertTable(tableName, probeColumn) {
	const probeResult = await supabase
		.from(tableName)
		.select(probeColumn)
		.limit(1);

	if (probeResult.error) {
		if (isMissingTable(probeResult.error)) {
			printFailure(
				`La table ${tableName} est introuvable. Execute d'abord supabase/schema.sql dans Supabase SQL Editor.`
			);
			process.exit(1);
		}

		printFailure(`Erreur sur ${tableName}: ${probeResult.error.message}`);
		process.exit(1);
	}

	const countResult = await supabase
		.from(tableName)
		.select(probeColumn, { head: true, count: "exact" })
		.limit(1);

	if (countResult.error) {
		return probeResult.data?.length ?? 0;
	}

	return typeof countResult.count === "number" ? countResult.count : probeResult.data?.length ?? 0;
}

const availabilityCount = await assertTable("availability_slots", "id");
const blockedCount = await assertTable("availability_blocked_slots", "id");
const bookingsCount = await assertTable("bookings", "id");
const analyticsLiveCount = await assertTable("analytics_live_sessions", "session_id");
const analyticsViewsCount = await assertTable("analytics_page_views", "id");

console.log("[db:check] Connexion Supabase OK.");
console.log(
	`[db:check] Tables detectees: availability_slots (${availabilityCount} lignes), availability_blocked_slots (${blockedCount} lignes), bookings (${bookingsCount} lignes), analytics_live_sessions (${analyticsLiveCount} lignes), analytics_page_views (${analyticsViewsCount} lignes).`
);
