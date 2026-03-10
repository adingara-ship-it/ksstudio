import type { APIContext } from "astro";
import { isAdminAuthenticated } from "./adminAuth";

export function ensureAdmin(context: APIContext) {
	return isAdminAuthenticated(context.cookies);
}
