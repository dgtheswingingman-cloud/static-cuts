"use client";

// Admin-only: which Spotify, Deezer, Apple Music, Genius and Last.fm profile
// belongs to this artist, plus any other profiles they release under
// (another name, e.g. King Krule's "Archy Marshall"). The background jobs
// use these so they pull songs from the right artist when names clash, and
// read every one of an artist's Deezer profiles. Paste profile links; they're
// turned into IDs on save.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Service = "spotify" | "deezer" | "apple" | "genius" | "lastfm";
type Main = Record<Service, string | null>;
type Other = { service: Service; profile_id: string; name: string | null };

const LABEL: Record<Service, string> = { spotify: "Spotify", deezer: "Deezer", apple: "Apple Music", genius: "Genius", lastfm: "Last.fm" };
const ORDER: Service[] = ["spotify", "deezer", "apple", "genius", "lastfm"];
const PLACEHOLDER: Record<Service, string> = {
  spotify: "https://open.spotify.com/artist/…",
  deezer: "https://www.deezer.com/artist/…",
  apple: "https://music.apple.com/…/artist/…",
  genius: "https://genius.com/artists/…",
  lastfm: "https://www.last.fm/music/…",
};

function findUrl(service: Service, name: string) {
  const q = encodeURIComponent(name);
  return {
    spotify: `https://open.spotify.com/search/${q}/artists`,
    deezer: `https://www.deezer.com/search/${q}/artist`,
    apple: `https://music.apple.com/search?term=${q}`,
    genius: `https://genius.com/search?q=${q}`,
    lastfm: `https://www.last.fm/search/artists?q=${q}`,
  }[service];
}

function profileUrl(service: Service, id: string) {
  if (service === "spotify") return `https://open.spotify.com/artist/${id}`;
  if (service === "deezer") return `https://www.deezer.com/artist/${id}`;
  if (service === "apple") return `https://music.apple.com/artist/${id}`;
  if (service === "lastfm") return `https://www.last.fm/music/${encodeURIComponent(id)}`;
  return id.startsWith("name:") ? `https://genius.com/artists/${id.slice(5).replace(/ /g, "-")}` : id;
}

// The "profiles" button lives in the artist page's admin row; this renders
// the panel when it's open. linkedCount reports how many main ones are linked (0-5).
export default function ArtistProfiles({
  artistId,
  artistName,
  open,
  onLinkedCount,
}: {
  artistId: string;
  artistName: string;
  open: boolean;
  onLinkedCount?: (n: number) => void;
}) {
  const [saved, setSaved] = useState<Main | null>(null);
  const [values, setValues] = useState<Record<Service, string>>({ spotify: "", deezer: "", apple: "", genius: "", lastfm: "" });
  const [others, setOthers] = useState<Other[]>([]);
  const [addService, setAddService] = useState<Service>("spotify");
  const [addLink, setAddLink] = useState("");
  const [addName, setAddName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase.rpc("rpc_artist_profiles", { p_artist: artistId });
    const main = ((data as { main?: Main })?.main ?? { spotify: null, deezer: null, apple: null, genius: null, lastfm: null }) as Main;
    setSaved(main);
    setValues({
      spotify: main.spotify ? profileUrl("spotify", main.spotify) : "",
      deezer: main.deezer ? profileUrl("deezer", main.deezer) : "",
      apple: main.apple ? profileUrl("apple", main.apple) : "",
      genius: main.genius ?? "",
      lastfm: main.lastfm ?? "",
    });
    setOthers(((data as { other?: Other[] })?.other ?? []) as Other[]);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artistId]);

  async function save() {
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.rpc("admin_set_artist_profiles", {
      p_artist_id: artistId,
      p_spotify: values.spotify,
      p_genius: values.genius,
      p_lastfm: values.lastfm,
    });
    let err = error?.message ?? null;
    for (const service of ["deezer", "apple"] as const) {
      if (err) break;
      const before = saved?.[service] ? profileUrl(service, saved[service]!) : "";
      if (values[service].trim() === before) continue;
      const { error: e } = await supabase.rpc("admin_set_artist_main_profile", { p_artist: artistId, p_service: service, p_link: values[service] });
      err = e?.message ?? null;
    }
    setBusy(false);
    if (err) { setMessage(err); return; }
    setMessage("Saved.");
    load();
  }

  async function addOther() {
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.rpc("admin_add_artist_profile", { p_artist: artistId, p_service: addService, p_link: addLink, p_name: addName });
    setBusy(false);
    if (error) { setMessage(error.message); return; }
    setAddLink("");
    setMessage("Added.");
    load();
  }

  async function removeOther(o: Other) {
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.rpc("admin_remove_artist_profile", { p_artist: artistId, p_service: o.service, p_profile: o.profile_id });
    setBusy(false);
    if (error) { setMessage(error.message); return; }
    load();
  }

  const linked = saved ? ORDER.filter((s) => saved[s]).length : 0;

  useEffect(() => {
    onLinkedCount?.(linked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked]);

  if (!open) return null;

  return (
    <div className="comments-panel" style={{ maxWidth: 520, marginBottom: 20 }}>
      <div className="comment-meta" style={{ marginBottom: 10 }}>
        Link this artist to their profiles so the background jobs pull songs from the right artist. Paste the
        profile link from each site (use &quot;find&quot; to search for it). Leave a box empty to unlink.
      </div>
      {ORDER.map((service) => (
        <div key={service} style={{ marginBottom: 8 }}>
          <div className="section-label" style={{ display: "flex", gap: 8 }}>
            {LABEL[service]}
            <a href={findUrl(service, artistName)} target="_blank" rel="noopener noreferrer" className="listen-link" style={{ fontSize: "0.65rem" }}>
              find ↗
            </a>
          </div>
          <input
            className="search-input"
            style={{ width: "100%" }}
            placeholder={PLACEHOLDER[service]}
            value={values[service]}
            onChange={(e) => setValues({ ...values, [service]: e.target.value })}
          />
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 18 }}>
        <button className="tab active" disabled={busy} onClick={save}>{busy ? "saving…" : "save"}</button>
        {message && <span className="comment-meta">{message}</span>}
      </div>

      <div className="section-label">Other names</div>
      <div className="comment-meta" style={{ marginBottom: 8 }}>
        Profiles for other names they release under (e.g. King Krule as &ldquo;Archy Marshall&rdquo;). Their releases
        land on this page, marked &ldquo;as &lt;name&gt;&rdquo;.
      </div>
      {others.length === 0 && <div className="comment-meta" style={{ marginBottom: 8 }}>None yet.</div>}
      {others.map((o) => (
        <div key={`${o.service}:${o.profile_id}`} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
          <span className="comment-body">{o.name ?? "(no name)"}</span>
          <a href={profileUrl(o.service, o.profile_id)} target="_blank" rel="noopener noreferrer" className="listen-link" style={{ fontSize: "0.7rem" }}>
            {LABEL[o.service]} ↗
          </a>
          <button className="rating-clear" disabled={busy} onClick={() => removeOther(o)}>remove</button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
        <input className="search-input" style={{ flex: "1 1 140px" }} placeholder="Name (e.g. Archy Marshall)" value={addName} onChange={(e) => setAddName(e.target.value)} />
        <select className="search-input" style={{ flex: "0 0 auto" }} value={addService} onChange={(e) => setAddService(e.target.value as Service)}>
          {ORDER.map((s) => <option key={s} value={s}>{LABEL[s]}</option>)}
        </select>
        <input className="search-input" style={{ flex: "1 1 100%" }} placeholder={PLACEHOLDER[addService]} value={addLink} onChange={(e) => setAddLink(e.target.value)} />
        <button className="tab" disabled={busy || !addLink.trim()} onClick={addOther}>add</button>
        {addName.trim() && (
          <a href={findUrl(addService, addName.trim())} target="_blank" rel="noopener noreferrer" className="listen-link" style={{ fontSize: "0.65rem" }}>
            find ↗
          </a>
        )}
      </div>
    </div>
  );
}
