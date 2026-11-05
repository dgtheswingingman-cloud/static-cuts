"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../AuthProvider";
import { useIsAdmin, usePersonalUser } from "../useIsAdmin";
import { AdminModePage } from "../components/AdminModeNote";
import { thumb } from "@/lib/thumb";

type Submission = {
  id: string;
  type: string;
  artist_id: string | null;
  payload: any;
  status: string;
  created_at: string;
  reviewer_note: string | null;
  resulting_id: string | null;
};

export default function MySubmissionsPage() {
  const { loading: authLoading } = useAuth();
  const user = usePersonalUser();
  const isAdmin = useIsAdmin();
  const router = useRouter();
  const [submissions, setSubmissions] = useState<Submission[] | null>(null);
  const [artistNames, setArtistNames] = useState<Record<string, string>>({});
  const [trackTitles, setTrackTitles] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [trust, setTrust] = useState<{ approved: number; rejected: number; trusted: boolean } | null>(null);
  const [pics, setPics] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected">("all");

  useEffect(() => {
    supabase.rpc("rpc_my_trust").then(({ data }) => setTrust(data ?? null));
  }, []);

  useEffect(() => {
    if (!authLoading && !user && !isAdmin) router.push("/login");
  }, [authLoading, user, router]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function load() {
    if (!user) return;
    const { data } = await supabase
      .from("submissions")
      .select("id, type, artist_id, payload, status, created_at, reviewer_note, resulting_id")
      .eq("submitted_by", user.id)
      .order("created_at", { ascending: false });
    setSubmissions(data ?? []);

    const artistIds = Array.from(new Set((data ?? []).map((s) => s.artist_id).filter(Boolean)));
    if (artistIds.length > 0) {
      const { data: artists } = await supabase.from("artists").select("id, name, image_url").in("id", artistIds as string[]);
      const map: Record<string, string> = {};
      const img: Record<string, string> = {};
      (artists ?? []).forEach((a: any) => { map[a.id] = a.name; if (a.image_url) img[`a:${a.id}`] = a.image_url; });
      setArtistNames(map);
      setPics((p) => ({ ...p, ...img }));
    }

    // Referenced track ids -- for corrections/flags/new_versions, so we can
    // show which track it's actually about instead of a bare id.
    const trackIds = Array.from(
      new Set(
        (data ?? [])
          .map((s) => referencedTrackId(s))
          .filter((x): x is string => !!x)
      )
    );
    if (trackIds.length > 0) {
      const { data: tracks } = await supabase.from("tracks").select("id, title, cover_url").in("id", trackIds);
      const map: Record<string, string> = {};
      const img: Record<string, string> = {};
      (tracks ?? []).forEach((t: any) => { map[t.id] = t.title; if (t.cover_url) img[`t:${t.id}`] = t.cover_url; });
      setTrackTitles(map);
      setPics((p) => ({ ...p, ...img }));
    }
  }

  function referencedTrackId(s: Submission): string | null {
    if (s.type === "correction" || s.type === "flag_link" || s.type === "status_change") return s.payload.track_id ?? null;
    if (s.type === "new_version") return s.payload.parent_track_id ?? null;
    if (s.type === "new_track" && s.resulting_id) return s.resulting_id;
    return null;
  }

  function describe(s: Submission) {
    if (s.type === "new_artist") return `New artist: "${s.payload.name}"`;
    if (s.type === "status_change") return `Status change: ${s.payload.from_status ?? "?"} → ${s.payload.to_status}`;
    if (s.type === "new_track") return `New track for ${artistNames[s.artist_id ?? ""] ?? "…"}: "${s.payload.title}"`;
    if (s.type === "new_version") {
      const parentTitle = s.payload.parent_track_id ? trackTitles[s.payload.parent_track_id] : null;
      return `Alt version of "${parentTitle ?? "an existing track"}": "${s.payload.title}"`;
    }
    if (s.type === "correction") {
      const title = s.payload.track_id ? trackTitles[s.payload.track_id] : null;
      return `Edit to "${title ?? "an existing track"}"`;
    }
    if (s.type === "flag_link") {
      const title = s.payload.track_id ? trackTitles[s.payload.track_id] : null;
      return `Flagged link on "${title ?? "an existing track"}"`;
    }
    if (s.type === "flag_deletion") {
      const title = s.payload.track_id ? trackTitles[s.payload.track_id] : null;
      return `Asked to delete "${title ?? s.payload.track_title ?? "a track"}"`;
    }
    if (s.type === "artist_merge") return `Same artist: "${s.payload.from_name}" and "${s.payload.into_name}"`;
    return s.type;
  }

  async function viewEntry(s: Submission) {
    if (s.type === "new_artist" || s.type === "artist_merge") {
      if (s.type === "artist_merge" && s.status !== "approved") { router.push(`/artist/${s.artist_id}`); return; }
      if (s.status !== "approved" || !s.resulting_id) return;
      const { data } = await supabase.from("artists").select("id").eq("id", s.resulting_id).maybeSingle();
      if (data) {
        router.push(`/artist/${s.resulting_id}`);
      } else {
        if (window.confirm("This artist has since been removed. Remove this entry from your history?")) {
          await removeEntry(s.id, false);
        }
      }
      return;
    }

    const trackId = referencedTrackId(s);
    if (!trackId || !s.artist_id) return;
    const { data } = await supabase.from("tracks").select("id").eq("id", trackId).maybeSingle();
    if (data) {
      router.push(`/song/${trackId}`);
    } else {
      if (window.confirm("This track has since been removed. Remove this entry from your history?")) {
        await removeEntry(s.id, false);
      }
    }
  }

  async function removeEntry(id: string, confirmFirst = true) {
    if (confirmFirst && !window.confirm("Remove this entry from your submission history?")) return;
    setBusyId(id);
    await supabase.from("submissions").delete().eq("id", id);
    setBusyId(null);
    setSubmissions((prev) => (prev ? prev.filter((s) => s.id !== id) : prev));
  }

  async function clearAll() {
    if (!user) return;
    if (!window.confirm("Remove ALL entries from your submission history? This can't be undone.")) return;
    await supabase.from("submissions").delete().eq("submitted_by", user.id);
    setSubmissions([]);
  }

  const canView = (s: Submission) => {
    if (s.type === "new_artist" || s.type === "new_track" || s.type === "new_version") {
      return s.status === "approved";
    }
    return true; // correction/flag_link point at a track that already exists regardless of status
  };

  if (isAdmin) return <AdminModePage title="My submissions" />;

  const counts = {
    all: submissions?.length ?? 0,
    pending: (submissions ?? []).filter((x) => x.status === "pending").length,
    approved: (submissions ?? []).filter((x) => x.status === "approved").length,
    rejected: (submissions ?? []).filter((x) => x.status === "rejected").length,
  };
  const shown = (submissions ?? []).filter((x) => filter === "all" || x.status === filter);
  const pic = (x: Submission) => {
    const t = referencedTrackId(x);
    return (t && pics[`t:${t}`]) || (x.artist_id && pics[`a:${x.artist_id}`]) || null;
  };

  return (
    <div className="wrap sb-page">
      <header className="sb-head">
        <div>
          <h1 className="ls-title sb-title">MY SUBMISSIONS<span>//</span></h1>
          <p className="sb-lead">Everything you&apos;ve suggested, and where it&apos;s got to.</p>
        </div>
        <Link href="/submit" className="sb-mine">+ Suggest something</Link>
      </header>
      {trust && (
        <div className="sb-trust">
          <span className="sb-trust-icon" aria-hidden="true"><i /><i /><i /></span>
          <span>{trust.trusted
            ? <><b>Trusted contributor.</b> Your suggestions go live straight away (removing songs still waits for a moderator).</>
            : <><b>{trust.approved} of 25 approved:</b> at 25 your suggestions go live straight away.</>}</span>
          {trust.trusted ? <span className="sb-trusted">Trusted ✓</span>
            : <span className="sb-trust-bar"><span style={{ width: `${Math.min(100, (trust.approved / 25) * 100)}%` }} /></span>}
        </div>
      )}

      <nav className="rd-chips nt-chips" aria-label="Show">
        {(["all", "pending", "approved", "rejected"] as const).map((k) => (
          <button key={k} className={filter === k ? "on" : undefined} aria-pressed={filter === k} onClick={() => setFilter(k)}>
            {k[0].toUpperCase() + k.slice(1)} ({counts[k]})
          </button>
        ))}
      </nav>

      {submissions === null && <div className="empty-state">loading…</div>}
      {submissions && submissions.length === 0 && (
        <div className="empty-state">Nothing yet. <Link href="/submit" className="text-link">Suggest a song or an artist</Link>.</div>
      )}
      {submissions && submissions.length > 0 && shown.length === 0 && <div className="empty-state">None here.</div>}

      <ul className="nt-list ms-subs">
        {shown.map((x) => {
          const st = x.status === "approved" ? "released" : x.status === "rejected" ? "leaked" : "";
          const p = pic(x);
          return (
            <li key={x.id} className="nt-row">
              <button className="nt-main" onClick={() => canView(x) && viewEntry(x)} disabled={!canView(x)}>
                <span className={`nt-pic ${x.type === "new_artist" ? "round" : ""}`}>
                  {p
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={thumb(p)} alt="" width={56} height={56} loading="lazy" />
                    : <span className="nw-blank">SC//</span>}
                </span>
                <span className="nt-text">
                  <span className="nt-what">{describe(x)}</span>
                  {x.reviewer_note && <span className="nt-body">Moderator: {x.reviewer_note}</span>}
                </span>
              </button>
              <span className="nt-meta">
                <span className={`feature-tag st ${st ? `st-${st}` : ""} nt-tag sb-st-${x.status}`}>{x.status}</span>
                <span className="nt-when">{new Date(x.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
              </span>
              <span className="nt-dot" />
              <button className="nt-x" aria-label="Remove from history" disabled={busyId === x.id} onClick={() => removeEntry(x.id)}>✕</button>
            </li>
          );
        })}
      </ul>
      {submissions && submissions.length > 0 && (
        <div style={{ textAlign: "center", marginTop: 20 }}><button className="st-btn" onClick={clearAll}>Clear history</button></div>
      )}
    </div>
  );
}
