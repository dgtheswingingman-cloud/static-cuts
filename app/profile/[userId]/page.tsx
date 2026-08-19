"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";

type Profile = {
  id: string;
  display_name: string | null;
  show_completion_pct: boolean;
  show_collected_tracks: boolean;
  show_ratings: boolean;
};
type CollectedTrack = { track_id: string; tracks: { title: string; artist_id: string; artists: { name: string } | null } | null };
type RatedTrack = { track_id: string; value: number; tracks: { title: string; artist_id: string; artists: { name: string } | null } | null };

export default function ProfilePage() {
  const params = useParams();
  const router = useRouter();
  const { user: viewer } = useAuth();
  const userId = params.userId as string;

  const [profile, setProfile] = useState<Profile | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [stats, setStats] = useState<{ total_tracks: number; collected_tracks: number } | null>(null);
  const [collected, setCollected] = useState<CollectedTrack[] | null>(null);
  const [rated, setRated] = useState<RatedTrack[] | null>(null);

  useEffect(() => {
    async function load() {
      const { data: profileRow, error } = await supabase
        .from("profiles")
        .select("id, display_name, show_completion_pct, show_collected_tracks, show_ratings")
        .eq("id", userId)
        .single();
      if (error || !profileRow) {
        setNotFound(true);
        return;
      }
      setProfile(profileRow as Profile);

      if (profileRow.show_completion_pct) {
        const { data: statRow } = await supabase
          .from("user_completion_stats")
          .select("total_tracks, collected_tracks")
          .eq("user_id", userId)
          .maybeSingle();
        if (statRow) setStats(statRow as any);
      }

      if (profileRow.show_collected_tracks) {
        const { data } = await supabase
          .from("track_ownership")
          .select("track_id, tracks(title, artist_id, artists(name))")
          .eq("user_id", userId)
          .order("collected_at", { ascending: false })
          .limit(100);
        setCollected((data as any) ?? []);
      }

      if (profileRow.show_ratings) {
        const { data } = await supabase
          .from("ratings")
          .select("track_id, value, tracks(title, artist_id, artists(name))")
          .eq("user_id", userId)
          .order("updated_at", { ascending: false })
          .limit(100);
        setRated((data as any) ?? []);
      }
    }
    load();
  }, [userId]);

  const isOwnProfile = viewer?.id === userId;
  const pct = stats && stats.total_tracks > 0 ? Math.round((stats.collected_tracks / stats.total_tracks) * 100) : 0;

  return (
    <div className="wrap">
      <button className="back-btn" onClick={() => router.push("/")}>
        ← back to archive
      </button>

      {notFound && (
        <div className="empty-state" style={{ marginTop: 18 }}>
          That profile doesn&apos;t exist.
        </div>
      )}

      {profile && (
        <>
          <h1 className="detail-name">{profile.display_name ?? "anonymous"}</h1>

          {isOwnProfile && (
            <div className="detail-meta" style={{ marginBottom: 10 }}>
              This is your own profile — visitors only see what you&apos;ve turned on in{" "}
              <Link href="/settings" style={{ color: "var(--bone)" }}>
                privacy settings
              </Link>
              .
            </div>
          )}

          {stats && (
            <>
              <div className="detail-meta">
                {stats.collected_tracks} / {stats.total_tracks} tracks collected ({pct}%)
              </div>
              <div className="bar-track" style={{ height: 4, marginBottom: 22 }}>
                <div className="bar-fill" style={{ width: `${pct}%` }} />
              </div>
            </>
          )}

          {!stats && !profile.show_collected_tracks && !profile.show_ratings && (
            <div className="empty-state" style={{ marginTop: 16 }}>
              This user hasn&apos;t made anything public on their profile yet.
            </div>
          )}

          {collected && collected.length > 0 && (
            <>
              <div className="section-label">Collected tracks</div>
              {collected.map((c) => (
                <div key={c.track_id} className="track-row" style={{ cursor: "default" }}>
                  <span className="track-title">{c.tracks?.title ?? "unknown track"}</span>
                  {c.tracks?.artist_id && (
                    <Link href={`/artist/${c.tracks.artist_id}`} className="feature-tag" style={{ textDecoration: "none" }}>
                      {c.tracks.artists?.name ?? "unknown artist"}
                    </Link>
                  )}
                </div>
              ))}
            </>
          )}

          {rated && rated.length > 0 && (
            <>
              <div className="section-label">Ratings</div>
              {rated.map((r) => (
                <div key={r.track_id} className="track-row" style={{ cursor: "default" }}>
                  <span className="track-title">{r.tracks?.title ?? "unknown track"}</span>
                  {r.tracks?.artist_id && (
                    <Link href={`/artist/${r.tracks.artist_id}`} className="feature-tag" style={{ textDecoration: "none" }}>
                      {r.tracks.artists?.name ?? "unknown artist"}
                    </Link>
                  )}
                  <span className="rating-chip rated">{r.value}/10</span>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
