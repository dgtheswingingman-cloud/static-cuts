"use client";

// The top of an artist page: their photo, a short "about", and the bands
// they're in (or, for a band, its members). Songs released as the band show
// on each member's page under "With <band>". Members and bands come from
// MusicBrainz (with instrument and years) and from moderators; people
// without a page here are listed by name.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Info = { image_url: string | null; bio: string | null; bio_source: string | null; bio_source_url: string | null };
type Person = { id: string | null; name: string; mbid: string | null; roles: string[]; from: number | null; to: number | null; former: boolean };
type Group = Person & { songs: number; recent: { id: string; title: string; status: string | null }[] };
type Groups = { mbid: string | null; members: Person[]; groups: Group[] };

// "drums, 1990–1994" / "vocals" / "" (years only for people who've left).
function detail(p: Person) {
  const years = p.former && (p.from || p.to) ? `${p.from ?? "?"}–${p.to ?? "?"}` : "";
  return [p.roles.slice(0, 3).join(", "), years].filter(Boolean).join(", ");
}

function PeopleList({ label, people, canModerate, onRemove }: {
  label: string; people: Person[]; canModerate: boolean; onRemove: (p: Person) => void;
}) {
  if (!people.length) return null;
  return (
    <div className="detail-meta" style={{ marginBottom: 6 }}>
      {label}:{" "}
      {people.map((m, i) => {
        const d = detail(m);
        return (
          <span key={m.id ?? m.mbid ?? m.name}>
            {i > 0 && (i === people.length - 1 ? " and " : ", ")}
            {m.id ? <Link href={`/artist/${m.id}`} className="text-link">{m.name}</Link> : m.name}
            {d && <span className="comment-meta"> ({d})</span>}
            {canModerate && <button className="inline-link-btn" title="Remove (wrong link)" onClick={() => onRemove(m)}> ×</button>}
          </span>
        );
      })}
    </div>
  );
}

export default function ArtistAbout({ artistId, artistName, isAdmin, canModerate, hidePhoto = false }: {
  artistId: string; artistName: string; isAdmin: boolean; canModerate: boolean; hidePhoto?: boolean;
}) {
  const [info, setInfo] = useState<Info | null>(null);
  const [groups, setGroups] = useState<Groups | null>(null);
  const [more, setMore] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [photoDraft, setPhotoDraft] = useState("");
  const [memberQ, setMemberQ] = useState("");
  const [hits, setHits] = useState<{ id: string; name: string }[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  function load() {
    supabase.from("artists").select("image_url, bio, bio_source, bio_source_url").eq("id", artistId).maybeSingle()
      .then(({ data }) => setInfo((data as Info) ?? null));
    supabase.rpc("rpc_artist_groups", { p_artist_id: artistId }).then(({ data }) => setGroups((data as Groups) ?? null));
  }
  useEffect(load, [artistId]);

  useEffect(() => {
    const q = memberQ.trim();
    if (q.length < 2) { setHits([]); return; }
    const t = setTimeout(() => {
      supabase.from("artists").select("id, name").ilike("name", `%${q}%`).neq("id", artistId).order("name").limit(8)
        .then(({ data }) => setHits((data as { id: string; name: string }[]) ?? []));
    }, 250);
    return () => clearTimeout(t);
  }, [memberQ, artistId]);

  async function saveAbout() {
    const { error } = await supabase.rpc("admin_set_artist_about", { p_artist_id: artistId, p_bio: draft, p_image_url: photoDraft });
    if (error) { setMessage(error.message); return; }
    setEditing(false);
    load();
  }
  async function remove(p: Person) {
    if (!window.confirm(`Remove ${p.name} from this page's band info?`)) return;
    const { error } = p.mbid
      ? await supabase.rpc("admin_hide_mb_link", { p_artist: artistId, p_other_mbid: p.mbid })
      : await supabase.rpc("admin_set_group_member", { p_group_id: artistId, p_member_id: p.id, p_on: false });
    if (error) { setMessage(error.message); return; }
    load();
  }
  async function wrongMatch() {
    if (!window.confirm(`MusicBrainz matched the wrong artist? This removes the band info it gave ${artistName}.`)) return;
    const { error } = await supabase.rpc("admin_set_musicbrainz", { p_artist: artistId, p_value: null });
    if (error) { setMessage(error.message); return; }
    load();
  }
  async function setMember(memberId: string, on: boolean) {
    const { error } = await supabase.rpc("admin_set_group_member", { p_group_id: artistId, p_member_id: memberId, p_on: on });
    if (error) { setMessage(error.message); return; }
    setMemberQ("");
    load();
  }

  const bio = info?.bio ?? "";
  const short = bio.length > 280 && !more ? bio.slice(0, 280).replace(/\s+\S*$/, "") + "…" : bio;
  const hasAnything = !!(info?.image_url || bio || groups?.members?.length || groups?.groups?.length);
  if (!hasAnything && !isAdmin && !canModerate) return null;

  return (
    <div className="artist-about">
      {info?.image_url && !hidePhoto && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={info.image_url} alt={artistName} className="artist-photo" width={120} height={120} />
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        {groups && (
          <>
            <PeopleList label="Members" people={groups.members.filter((m) => !m.former)} canModerate={canModerate} onRemove={remove} />
            <PeopleList label="Former members" people={groups.members.filter((m) => m.former)} canModerate={canModerate} onRemove={remove} />
            <PeopleList label="Also in" people={groups.groups.filter((g) => !g.former)} canModerate={canModerate} onRemove={remove} />
            <PeopleList label="Formerly in" people={groups.groups.filter((g) => g.former)} canModerate={canModerate} onRemove={remove} />
            {groups.mbid && (groups.members.some((m) => m.mbid) || groups.groups.some((g) => g.mbid)) && (
              <div className="comment-meta" style={{ marginBottom: 6 }}>
                Band info from <a href={`https://musicbrainz.org/artist/${groups.mbid}`} target="_blank" rel="noopener noreferrer" className="text-link">MusicBrainz</a>
                {canModerate && <> · <button className="inline-link-btn" onClick={wrongMatch}>wrong artist?</button></>}
              </div>
            )}
          </>
        )}
        {bio && !editing && (
          <div className="artist-bio">
            {short}{" "}
            {bio.length > 280 && <button className="inline-link-btn" onClick={() => setMore(!more)}>{more ? "less" : "more"}</button>}
            {info?.bio_source && info.bio_source !== "Static Cuts" && (
              <span className="comment-meta">
                {" "}· from {info.bio_source_url ? <a href={info.bio_source_url} target="_blank" rel="noopener noreferrer" className="text-link">{info.bio_source}</a> : info.bio_source}
              </span>
            )}
          </div>
        )}
        {isAdmin && !editing && (
          <button className="inline-link-btn comment-meta" onClick={() => { setDraft(bio); setPhotoDraft(info?.image_url ?? ""); setEditing(true); }}>
            {bio ? "edit about / photo" : "write an about / add a photo"}
          </button>
        )}
        {editing && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 560 }}>
            <textarea className="comment-textarea" value={draft} onChange={(e) => setDraft(e.target.value)}
              placeholder={`A few lines about ${artistName}`} rows={4} />
            <input className="search-input" value={photoDraft} onChange={(e) => setPhotoDraft(e.target.value)} placeholder="Photo link (https://…)" />
            <div style={{ display: "flex", gap: 6 }}>
              <button className="tab active" onClick={saveAbout}>save</button>
              <button className="tab" onClick={() => setEditing(false)}>cancel</button>
            </div>
          </div>
        )}
        {canModerate && (
          <div style={{ marginTop: 6 }}>
            <input className="search-input" style={{ maxWidth: 320 }} value={memberQ} onChange={(e) => setMemberQ(e.target.value)}
              placeholder={`Band or duo? Add a member of ${artistName}…`} />
            {hits.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                {hits.map((h) => <button key={h.id} className="rating-chip" onClick={() => setMember(h.id, true)}>+ {h.name}</button>)}
              </div>
            )}
          </div>
        )}
        {message && <div className="comment-meta">{message}</div>}
      </div>
      {groups && groups.groups.map((g) => g.id && g.recent.length > 0 && (
        <div key={g.id} className="artist-group-songs">
          <div className="section-label" style={{ margin: "6px 0" }}>
            With <Link href={`/artist/${g.id}`} className="text-link">{g.name}</Link> ({g.songs} songs)
          </div>
          <div className="feed-tracks">
            {g.recent.map((t) => <Link key={t.id} href={`/song/${t.id}`} className="feed-track">{t.title}</Link>)}
            {g.songs > g.recent.length && <Link href={`/artist/${g.id}`} className="feed-track">all {g.songs} →</Link>}
          </div>
        </div>
      ))}
    </div>
  );
}
