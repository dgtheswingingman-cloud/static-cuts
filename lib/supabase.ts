import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Right after a sign-in token is renewed, the database can briefly see it as
// "issued in the future" (its clock is a second or two behind the sign-in
// server's) and refuse the request. Wait a moment and try once more instead
// of showing an error.
async function fetchWithClockRetry(input: RequestInfo | URL, init?: RequestInit) {
  const res = await fetch(input, init);
  if (res.status !== 401) return res;
  const text = await res.clone().text().catch(() => "");
  if (!/issued at future/i.test(text)) return res;
  await new Promise((r) => setTimeout(r, 2000));
  return fetch(input, init);
}

// A "forgot your password?" email link lands with #...type=recovery. Note it
// before the client reads (and clears) the address, so the site can send
// the person on to set a new password.
export const cameForPasswordReset =
  typeof window !== "undefined" && /type=recovery/.test(window.location.hash + window.location.search);

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: fetchWithClockRetry },
});
