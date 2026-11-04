// Supabase Edge Function: discord
//
// The Static Cuts Discord bot, through Discord's interactions endpoint (no
// always-on server). Discord sends each slash command here, signed; we
// check the signature and answer.
//   /song <name>      best match: status, artist, era, cover, link
//   /artist <name>    songs, unreleased, leaked, latest leaks, link
//   /leaks [artist]   latest real leaks (site-wide or one artist)
//   /alerts add|remove|list   new leaks/snippets/releases for an artist,
//                     posted in this channel (needs Manage Channels)
// Timer calls (x-cron-secret):
//   {mode: "post"}      posts waiting alerts (grouped per channel)
//   {mode: "register"}  sets up the slash commands with Discord
// Links only ever go to song/artist pages, never to files.
// Secrets (set in Supabase): DISCORD_PUBLIC_KEY, DISCORD_APP_ID, DISCORD_BOT_TOKEN.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const PUBLIC_KEY = Deno.env.get("DISCORD_PUBLIC_KEY") ?? "";
const APP_ID = Deno.env.get("DISCORD_APP_ID") ?? "";
const BOT_TOKEN = Deno.env.get("DISCORD_BOT_TOKEN") ?? "";
const SITE = "https://static-cuts.com";
const API = "https://discord.com/api/v10";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const reply = (data: Record<string, unknown>) => json({ type: 4, data: { allowed_mentions: { parse: [] }, ...data } });
const oops = (content: string) => reply({ content, flags: 64 });

const COLOUR: Record<string, number> = { leaked: 0xff3355, snippet: 0xffb020, released: 0x2bd67b, teased: 0xffb020 };
const colourOf = (s: string) => COLOUR[s] ?? 0x8b7cf6;
const NICE: Record<string, string> = { leaked: "LEAKED", snippet: "SNIPPET", released: "RELEASED", unconfirmed: "UNRELEASED", rumored: "RUMOURED", teased: "TEASED", announced: "ANNOUNCED" };
const n0 = (x: number) => Number(x ?? 0).toLocaleString("en-GB");
const day = (d: string | null | undefined) => d ? new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";

let secretCache: string | null = null;
async function secret() {
  if (secretCache) return secretCache;
  const { data } = await db.from("sc_private_settings").select("value").eq("key", "cron_secret").maybeSingle();
  secretCache = (data?.value as string) ?? "";
  return secretCache;
}

function hex(s: string) {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}
async function verified(req: Request, body: string) {
  const sig = req.headers.get("x-signature-ed25519");
  const ts = req.headers.get("x-signature-timestamp");
  if (!sig || !ts || !PUBLIC_KEY) return false;
  try {
    const key = await crypto.subtle.importKey("raw", hex(PUBLIC_KEY), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, hex(sig), new TextEncoder().encode(ts + body));
  } catch {
    return false;
  }
}

// ---- commands ----------------------------------------------------------
type Opt = { name: string; value?: string; options?: Opt[] };
const opt = (opts: Opt[] | undefined, name: string) => (opts ?? []).find((o) => o.name === name)?.value?.toString().trim() ?? "";

async function songCmd(q: string) {
  if (q.length < 2) return oops("Type at least 2 letters.");
  const { data } = await db.rpc("rpc_search_songs", { p_q: q, p_versions: true, p_sort: "best", p_offset: 0 });
  type S = { id: string; title: string; artist: string; artist_id: string; status: string; album: string | null; release_date: string | null; parent_track_id: string | null };
  const items = (((data as { items?: S[] } | null)?.items) ?? []).slice(0, 5);
  if (!items.length) return oops(`Nothing on Static Cuts matches “${q}”.`);
  const top = items[0];
  const { data: covers } = await db.rpc("rpc_track_covers", { p_ids: [top.id] });
  const cover = ((covers as { url: string | null }[] | null) ?? [])[0]?.url ?? null;
  const others = items.slice(1).map((s) => `• [${s.title}](${SITE}/song/${s.id}) · ${s.artist} · ${NICE[s.status] ?? s.status}`).join("\n");
  return reply({
    embeds: [{
      title: top.title.slice(0, 250),
      url: `${SITE}/song/${top.id}`,
      color: colourOf(top.status),
      author: { name: top.artist, url: `${SITE}/artist/${top.artist_id}` },
      description: [`**${NICE[top.status] ?? top.status}**`, top.album ? `Era: ${top.album}` : null, top.release_date ? `Out ${day(top.release_date)}` : null]
        .filter(Boolean).join(" · ") + (others ? `\n\n**Also matches**\n${others}` : ""),
      ...(cover ? { thumbnail: { url: cover } } : {}),
      footer: { text: "Static Cuts// · every song, leak and version" },
    }],
  });
}

async function artistCmd(q: string) {
  if (!q) return oops("Which artist?");
  const { data } = await db.rpc("sc_discord_artist", { p_secret: await secret(), p_q: q });
  const a = data as { id: string; name: string; photo: string | null; songs: number; unreleased: number; leaked: number; latest: { id: string; title: string; status: string; on: string | null }[] } | null;
  if (!a) return oops(`No artist called “${q}” on Static Cuts yet.`);
  const latest = a.latest.map((s) => `• [${s.title}](${SITE}/song/${s.id}) · ${NICE[s.status] ?? s.status}${s.on ? ` · ${day(s.on)}` : ""}`).join("\n");
  return reply({
    embeds: [{
      title: a.name,
      url: `${SITE}/artist/${a.id}`,
      color: 0x8b7cf6,
      fields: [
        { name: "Songs", value: n0(a.songs), inline: true },
        { name: "Unreleased", value: n0(a.unreleased), inline: true },
        { name: "Leaked", value: n0(a.leaked), inline: true },
        ...(latest ? [{ name: "Latest leaks & snippets", value: latest.slice(0, 1000) }] : []),
      ],
      ...(a.photo ? { thumbnail: { url: a.photo } } : {}),
      footer: { text: "Static Cuts// · every song, leak and version" },
    }],
  });
}

async function leaksCmd(q: string) {
  const { data } = await db.rpc("sc_discord_leaks", { p_secret: await secret(), p_artist_q: q });
  const r = data as { artist: string | null; items: { id: string; title: string; artist: string; on: string }[] } | null;
  if (!r) return oops(`No artist called “${q}” on Static Cuts yet.`);
  if (!r.items.length) return reply({ content: r.artist ? `No new ${r.artist} leaks in the last 60 days.` : "No new leaks in the last 60 days." });
  return reply({
    embeds: [{
      title: r.artist ? `Latest ${r.artist} leaks` : "Latest leaks",
      url: `${SITE}/weekly`,
      color: 0xff3355,
      description: r.items.map((s) => `• [${s.title}](${SITE}/song/${s.id})${r.artist ? "" : ` · ${s.artist}`} · ${day(s.on)}`).join("\n").slice(0, 4000),
      footer: { text: "Static Cuts// · every song, leak and version" },
    }],
  });
}

const MANAGE = (1n << 3n) | (1n << 4n) | (1n << 5n); // admin, manage channels, manage server
async function alertsCmd(i: any) {
  const sub: Opt | undefined = i.data.options?.[0];
  if (!i.guild_id) return oops("Alerts work in servers, not DMs.");
  const perms = BigInt(i.member?.permissions ?? "0");
  if (!(perms & MANAGE)) return oops("You need Manage Channels to set up alerts here.");
  const s = await secret();
  if (sub?.name === "list") {
    const { data } = await db.rpc("sc_discord_subs", { p_secret: s, p_channel: i.channel_id });
    const list = (data as { artist: string }[] | null) ?? [];
    return oops(list.length ? `This channel gets alerts for: ${list.map((x) => `**${x.artist}**`).join(", ")}` : "This channel has no alerts yet. Try `/alerts add`.");
  }
  const artist = opt(sub?.options, "artist");
  const on = sub?.name === "add";
  const { data, error } = await db.rpc("sc_discord_sub", { p_secret: s, p_guild: i.guild_id, p_channel: i.channel_id, p_artist_q: artist, p_on: on, p_user: i.member?.user?.id ?? null });
  if (error) return oops("Something went wrong. Try again in a minute.");
  const r = data as { ok: boolean; error?: string; artist?: string };
  if (!r.ok) return oops(r.error ?? "Couldn't do that.");
  return reply({ content: on ? `🔔 New **${r.artist}** leaks, snippets and releases will be posted here.` : `🔕 No more **${r.artist}** alerts here.` });
}

// ---- timer jobs --------------------------------------------------------
async function discord(path: string, init: RequestInit = {}) {
  return await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bot ${BOT_TOKEN}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
}

async function register() {
  const commands = [
    { name: "song", description: "Look up a song on Static Cuts", options: [{ type: 3, name: "name", description: "Song title (and artist, if you like)", required: true }] },
    { name: "artist", description: "An artist's page: songs, unreleased, latest leaks", options: [{ type: 3, name: "name", description: "Artist name", required: true }] },
    { name: "leaks", description: "The latest leaks", options: [{ type: 3, name: "artist", description: "Only this artist", required: false }] },
    {
      name: "alerts", description: "Post an artist's new leaks, snippets and releases in this channel", default_member_permissions: String(1 << 4), dm_permission: false,
      options: [
        { type: 1, name: "add", description: "Get alerts for an artist here", options: [{ type: 3, name: "artist", description: "Artist name", required: true }] },
        { type: 1, name: "remove", description: "Stop alerts for an artist here", options: [{ type: 3, name: "artist", description: "Artist name", required: true }] },
        { type: 1, name: "list", description: "Which artists this channel gets alerts for" },
      ],
    },
  ];
  const res = await discord(`/applications/${APP_ID}/commands`, { method: "PUT", body: JSON.stringify(commands) });
  return json({ ok: res.ok, status: res.status, registered: res.ok ? commands.map((c) => c.name) : await res.text() }, res.ok ? 200 : 502);
}

const LABEL: Record<string, string> = { leaked: "🔴 New leak", snippet: "🟡 New snippet", released: "🟢 Out now" };
async function post() {
  const { data, error } = await db.rpc("sc_discord_take", { p_secret: await secret(), p_limit: 60 });
  if (error) return json({ error: error.message }, 500);
  type A = { channel_id: string; kind: string; track_id: string; title: string; artist: string; artist_id: string; album: string | null; cover: string | null };
  const byChannel = new Map<string, A[]>();
  for (const a of (data ?? []) as A[]) byChannel.set(a.channel_id, [...(byChannel.get(a.channel_id) ?? []), a]);
  const done = { channels: 0, messages: 0, failed: 0 };
  for (const [channel, list] of byChannel) {
    for (let k = 0; k < list.length; k += 10) {
      const { data: t } = await db.rpc("sc_api_allow", { p_service: "discord", p_want: 1 });
      if (t !== 1) return json({ ok: true, ...done, waiting: "no ticket" });
      const embeds = list.slice(k, k + 10).map((a) => ({
        title: `${a.title}`.slice(0, 250),
        url: `${SITE}/song/${a.track_id}`,
        color: colourOf(a.kind),
        author: { name: `${LABEL[a.kind] ?? "Update"} · ${a.artist}`, url: `${SITE}/artist/${a.artist_id}` },
        ...(a.album ? { description: `Era: ${a.album}` } : {}),
        ...(a.cover ? { thumbnail: { url: a.cover } } : {}),
      }));
      const res = await discord(`/channels/${channel}/messages`, { method: "POST", body: JSON.stringify({ embeds, allowed_mentions: { parse: [] } }) }).catch(() => null);
      if (res && res.status === 429) {
        await db.from("sc_private_settings").upsert({ key: "discord_pause_until", value: new Date(Date.now() + 60_000).toISOString() }, { onConflict: "key" });
        return json({ ok: true, ...done, paused: true });
      }
      if (res?.ok) done.messages++; else done.failed++;
    }
    done.channels++;
  }
  return json({ ok: true, ...done });
}

Deno.serve(async (req) => {
  // Timer calls.
  const cron = req.headers.get("x-cron-secret");
  if (cron) {
    if (cron !== (await secret())) return json({ error: "not authorized" }, 403);
    if (!BOT_TOKEN || !APP_ID) return json({ ok: true, skipped: "Discord isn't set up" });
    const body = await req.json().catch(() => ({}));
    return body?.mode === "register" ? await register() : await post();
  }

  // Discord.
  const raw = await req.text();
  if (!(await verified(req, raw))) return new Response("bad signature", { status: 401 });
  const i = JSON.parse(raw);
  if (i.type === 1) return json({ type: 1 }); // ping
  if (i.type !== 2) return json({ type: 1 });
  try {
    switch (i.data?.name) {
      case "song": return await songCmd(opt(i.data.options, "name"));
      case "artist": return await artistCmd(opt(i.data.options, "name"));
      case "leaks": return await leaksCmd(opt(i.data.options, "artist"));
      case "alerts": return await alertsCmd(i);
      default: return oops("I don't know that one.");
    }
  } catch {
    return oops("Something went wrong. Try again in a minute.");
  }
});
