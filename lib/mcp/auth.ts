import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Public URL of the site, e.g. https://static-cuts.com. Falls back to the
// request's own origin (fine on Vercel preview deployments).
export function siteOrigin(req: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "");
  if (configured) return configured;
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export function authorizationServer(): string {
  return `${SUPABASE_URL.replace(/\/+$/, "")}/auth/v1`;
}

export function mcpResource(req: Request): string {
  return `${siteOrigin(req)}/api/mcp`;
}

export function protectedResourceMetadataUrl(req: Request): string {
  return `${siteOrigin(req)}/.well-known/oauth-protected-resource`;
}

// Validates the bearer token with Supabase Auth and returns a database
// client that acts as that user (so auth.uid() and RLS apply).
export async function authenticate(
  req: Request
): Promise<{ user: User; db: SupabaseClient } | null> {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1].trim();

  const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return null;
  return { user: data.user, db };
}
