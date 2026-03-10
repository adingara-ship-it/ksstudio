import { createClient } from "@supabase/supabase-js";

function getEnvValue(...names: string[]) {
	for (const name of names) {
		const value = import.meta.env[name];
		if (value) return value;
	}

	throw new Error(`Missing required environment variable: ${names.join(" or ")}`);
}

const supabaseUrl = getEnvValue("SUPABASE_URL", "PUBLIC_SUPABASE_URL");
const supabaseServiceRoleKey = getEnvValue(
	"SUPABASE_SERVICE_ROLE_KEY",
	"SUPABASE_SERVICE_KEY",
	"SUPABASE_SECRET_KEY"
);

export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
	auth: {
		autoRefreshToken: false,
		persistSession: false
	}
});
