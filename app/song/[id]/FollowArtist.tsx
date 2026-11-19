"use client";

// "Get told when <artist> leaks or drops something": a follow card on song
// pages, which get most of the site's visits. Signed out, it goes to sign-up
// and the follow is kept (PendingFollow) until they're signed in, even if they
// sign in later from the confirmation email. Hidden once you follow them.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";
import { useIsAdmin } from "../../useIsAdmin";
import { savePendingFollow } from "../../PendingFollow";

export default function FollowArtist({ artistId, artistName, trackId }: { artistId: string; artistName: string; trackId: string }) {
  const { user, loading } = useAuth();
  const isAdmin = useIsAdmin();
  const router = useRouter();
  const [following, setFollowing] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) { setFollowing(false); return; }
    supabase.from("follows").select("artist_id").eq("user_id", user.id).eq("artist_id", artistId).maybeSingle()
      .then(({ data }) => setFollowing(!!data));
  }, [user, loading, artistId]);

  // Followed just now by PendingFollow (back from signing up).
  useEffect(() => {
    const on = (e: Event) => { if ((e as CustomEvent).detail === artistId) { setDone(true); setFollowing(true); } };
    window.addEventListener("sc-followed", on);
    return () => window.removeEventListener("sc-followed", on);
  }, [artistId]);

  if (isAdmin || loading || following === null) return null;
  if (following && !done) return null;

  async function follow() {
    if (!user) {
      savePendingFollow(artistId, artistName);
      router.push(`/login?mode=signup&next=${encodeURIComponent(`/song/${trackId}`)}`);
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("follows").upsert({ user_id: user.id, artist_id: artistId }, { onConflict: "user_id,artist_id", ignoreDuplicates: true });
    setBusy(false);
    if (!error) { setDone(true); setFollowing(true); }
  }

  if (done) return <div className="sp-follow"><div><strong>✓ Following {artistName}</strong><small>You&apos;ll get alerts when something new turns up.</small></div></div>;

  return (
    <div className="sp-follow">
      <div>
        <strong>Get told when {artistName} leaks or drops something</strong>
        <small>Follow them for alerts on new songs, leaks and releases.</small>
      </div>
      <button className="tab active" disabled={busy} onClick={follow}>
        {user ? `Follow ${artistName}` : "Sign up to follow"}
      </button>
    </div>
  );
}
