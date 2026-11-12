// Supabase Edge Function: billing
//
// Static-Cuts Premium through Stripe (product "Static-Cuts Premium", a
// monthly and a yearly price). Needs the STRIPE_SECRET_KEY secret.
//
// POST {action: "prices"}                    -> the two prices, for the page
// POST {action: "checkout", plan, origin}    -> Stripe checkout link (signed in)
// POST {action: "portal", origin}            -> Stripe "manage or cancel" link (signed in)
// POST {action: "sync"}                      -> re-read my subscription from Stripe (signed in)
// POST {action: "setup"} + x-cron-secret     -> creates the Stripe webhook and portal settings
// POST {action: "rewards"} + x-cron-secret   -> a month's credit for top contributors who already pay
// Stripe webhooks (stripe-signature header)  -> the event is fetched again from
//   Stripe by its id, so only real events count, then premium follows the
//   subscription (sc_stripe_subscription_save).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const db = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const PRODUCT = "Static-Cuts Premium";
const HOOK_URL = `${URL_}/functions/v1/billing`;
const HOOK_EVENTS = ["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Stripe wants form fields, with [brackets] for nested ones.
function form(obj: Record<string, unknown>, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => typeof x === "object" ? form(x as Record<string, unknown>, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(x)));
    else if (typeof v === "object") form(v as Record<string, unknown>, key, out);
    else out.append(key, String(v));
  }
  return out;
}
async function stripe(method: "GET" | "POST", path: string, body?: Record<string, unknown>) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: body ? form(body) : undefined,
  });
  const out = await res.json().catch(() => null);
  if (!res.ok) throw new Error(out?.error?.message ?? `Stripe said ${res.status}`);
  return out;
}

const ORIGIN_OK = /^(https:\/\/(www\.)?static-cuts\.com|https:\/\/[a-z0-9-]+\.vercel\.app|http:\/\/localhost:\d+)$/;
const origin = (x: unknown) => (typeof x === "string" && ORIGIN_OK.test(x) ? x : "https://static-cuts.com");

let priceCache: { at: number; month: any; year: any } | null = null;
async function prices() {
  if (priceCache && Date.now() - priceCache.at < 10 * 60_000) return priceCache;
  const r = await stripe("GET", "/prices?active=true&type=recurring&limit=100&expand[]=data.product");
  const mine = ((r?.data ?? []) as any[]).filter((p) => p?.product?.name === PRODUCT && p?.product?.active !== false);
  const pick = (interval: string) => mine.filter((p) => p.recurring?.interval === interval && (p.recurring?.interval_count ?? 1) === 1)
    .sort((a, b) => b.created - a.created)[0] ?? null;
  priceCache = { at: Date.now(), month: pick("month"), year: pick("year") };
  return priceCache;
}
const show = (p: any) => p ? { id: p.id, amount: p.unit_amount, currency: p.currency } : null;

function periodEnd(sub: any): number {
  return sub?.current_period_end ?? Math.max(0, ...((sub?.items?.data ?? []) as any[]).map((i) => i?.current_period_end ?? 0));
}
async function saveSub(sub: any) {
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  const end = periodEnd(sub);
  if (!customer || !end) return null;
  const { data, error } = await db.rpc("sc_stripe_subscription_save", {
    p_customer: customer, p_subscription: sub.id, p_status: sub.status, p_period_end: new Date(end * 1000).toISOString(),
  });
  if (error) throw new Error(error.message);
  return data;
}

async function signedIn(req: Request) {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data } = await db.auth.getUser(jwt);
  return data?.user ?? null;
}
async function customerFor(user: { id: string; email?: string }, make: boolean): Promise<string | null> {
  const { data } = await db.from("stripe_customers").select("customer_id").eq("user_id", user.id).maybeSingle();
  if (data?.customer_id) return data.customer_id;
  if (!make) return null;
  const c = await stripe("POST", "/customers", { email: user.email, metadata: { user_id: user.id } });
  const { error } = await db.rpc("sc_stripe_customer_save", { p_user: user.id, p_customer: c.id });
  if (error) throw new Error(error.message);
  return c.id;
}

async function webhook(raw: string) {
  const id = (() => { try { return JSON.parse(raw)?.id; } catch { return null; } })();
  if (typeof id !== "string" || !id.startsWith("evt_")) return json({ error: "no event" }, 400);
  const ev = await stripe("GET", `/events/${id}`); // the real event, straight from Stripe
  const o = ev?.data?.object;
  if (ev.type === "checkout.session.completed" && o?.subscription) {
    const sub = await stripe("GET", `/subscriptions/${typeof o.subscription === "string" ? o.subscription : o.subscription.id}`);
    return json({ ok: true, saved: await saveSub(sub) });
  }
  if (String(ev.type).startsWith("customer.subscription.")) {
    const sub = await stripe("GET", `/subscriptions/${o.id}`).catch(() => o); // deleted ones may only exist in the event
    return json({ ok: true, saved: await saveSub(sub) });
  }
  return json({ ok: true, ignored: ev.type });
}

async function setup() {
  const out: Record<string, unknown> = {};
  const hooks = await stripe("GET", "/webhook_endpoints?limit=100");
  const have = ((hooks?.data ?? []) as any[]).find((h) => h.url === HOOK_URL);
  if (have) {
    await stripe("POST", `/webhook_endpoints/${have.id}`, { enabled_events: HOOK_EVENTS, disabled: false });
    out.webhook = "updated";
  } else {
    await stripe("POST", "/webhook_endpoints", { url: HOOK_URL, enabled_events: HOOK_EVENTS, description: "Static-Cuts premium" });
    out.webhook = "made";
  }
  const p = await prices();
  if (!p.month && !p.year) throw new Error(`No recurring prices found on "${PRODUCT}".`);
  const portal = {
    business_profile: { headline: "STATIC-CUTS// Premium", privacy_policy_url: "https://static-cuts.com/legal", terms_of_service_url: "https://static-cuts.com/legal" },
    default_return_url: "https://static-cuts.com/premium",
    features: {
      customer_update: { enabled: true, allowed_updates: ["email"] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: "at_period_end" },
      subscription_update: {
        enabled: !!(p.month && p.year), default_allowed_updates: ["price"], proration_behavior: "create_prorations",
        products: p.month && p.year ? [{ product: p.month.product.id, prices: [p.month.id, p.year.id] }] : undefined,
      },
    },
  };
  const confs = await stripe("GET", "/billing_portal/configurations?active=true&limit=10");
  const def = ((confs?.data ?? []) as any[]).sort((x, y) => Number(y.is_default) - Number(x.is_default) || y.created - x.created)[0];
  if (def) { await stripe("POST", `/billing_portal/configurations/${def.id}`, portal); out.portal = "updated"; }
  else { await stripe("POST", "/billing_portal/configurations", portal); out.portal = "made"; }
  out.prices = { month: show(p.month), year: show(p.year) };
  return json({ ok: true, ...out });
}

// Top contributors who already pay: a month's credit on their Stripe balance
// (the next invoice uses it up), once each (sc_rewards_pending / sc_reward_done).
async function rewards(secret: string) {
  const { data: todo, error } = await db.rpc("sc_rewards_pending", { p_secret: secret });
  if (error) throw new Error(error.message);
  const p = await prices();
  const amount = p.month?.unit_amount ?? 300;
  const done: string[] = [];
  for (const r of (todo ?? []) as { month: string; user_id: string; customer: string; rank: number }[]) {
    await stripe("POST", `/customers/${r.customer}/balance_transactions`, {
      amount: -amount, currency: "gbp", description: `Top ${r.rank} contributor, ${r.month.slice(0, 7)}: a free month of Premium`,
    });
    const { error: e2 } = await db.rpc("sc_reward_done", { p_secret: secret, p_month: r.month, p_user: r.user_id });
    if (e2) throw new Error(e2.message);
    done.push(r.user_id);
  }
  return json({ ok: true, credited: done.length });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  if (!KEY) return json({ error: "Payments aren't set up yet." }, 503);
  const raw = await req.text();
  try {
    if (req.headers.get("stripe-signature")) return await webhook(raw);
    let body: any = {};
    try { body = JSON.parse(raw || "{}"); } catch { /* empty */ }

    if (body.action === "prices") {
      const p = await prices();
      return json({ month: show(p.month), year: show(p.year), test: KEY.startsWith("sk_test_") });
    }
    if (body.action === "setup" || body.action === "rewards") {
      const secret = req.headers.get("x-cron-secret");
      const { data: ok } = await db.from("sc_private_settings").select("value").eq("key", "cron_secret").maybeSingle();
      if (!secret || secret !== ok?.value) return json({ error: "not authorized" }, 403);
      return body.action === "setup" ? await setup() : await rewards(secret);
    }

    const user = await signedIn(req);
    if (!user) return json({ error: "Sign in first." }, 401);
    const back = origin(body.origin);

    if (body.action === "checkout") {
      const p = await prices();
      const price = body.plan === "year" ? p.year : p.month;
      if (!price) return json({ error: "That plan isn't available right now." }, 400);
      const customer = await customerFor(user, true);
      const s = await stripe("POST", "/checkout/sessions", {
        mode: "subscription", customer, client_reference_id: user.id,
        line_items: [{ price: price.id, quantity: 1 }],
        allow_promotion_codes: true,
        subscription_data: { metadata: { user_id: user.id } },
        success_url: `${back}/premium?done=1`, cancel_url: `${back}/premium`,
      });
      return json({ url: s.url });
    }
    if (body.action === "portal") {
      const customer = await customerFor(user, false);
      if (!customer) return json({ error: "There's no subscription on this account." }, 400);
      const confs = await stripe("GET", "/billing_portal/configurations?active=true&limit=10");
      const conf = ((confs?.data ?? []) as any[]).sort((x, y) => Number(y.is_default) - Number(x.is_default) || y.created - x.created)[0];
      const s = await stripe("POST", "/billing_portal/sessions", { customer, return_url: `${back}/premium`, configuration: conf?.id });
      return json({ url: s.url });
    }
    if (body.action === "sync") {
      const customer = await customerFor(user, false);
      if (!customer) return json({ ok: true, none: true });
      const subs = await stripe("GET", `/subscriptions?customer=${customer}&status=all&limit=10`);
      const list = ((subs?.data ?? []) as any[]).sort((a, b) => periodEnd(b) - periodEnd(a));
      const live = list.find((s) => ["active", "trialing", "past_due"].includes(s.status)) ?? list[0];
      return json({ ok: true, saved: live ? await saveSub(live) : null });
    }
    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
