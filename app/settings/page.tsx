"use client";

// Settings: account, look, notifications, privacy, connections and your
// data, each in its own box (two columns on computers). Importing and
// exporting your collection lives in My Library.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../AuthProvider";
import { useTheme } from "../ThemeProvider";
import { useIsAdmin } from "../useIsAdmin";
import { AdminModePage } from "../components/AdminModeNote";
import { useProfileStyle } from "../profile/[userId]/PremiumProfile";
import ChatGPTRoutine from "./ChatGPTRoutine";
import SpotifySync from "./SpotifySync";
import PhoneAlerts from "./PhoneAlerts";
import YourData from "./YourData";
import LastfmLink from "./LastfmLink";
import Switch from "./Switch";
import DevOptions from "./DevOptions";

type Prefs = {
  show_completion_pct: boolean;
  show_collected_tracks: boolean;
  show_ratings: boolean;
  show_followed_artists: boolean;
  show_contributions: boolean;
  notify_followed_daily: boolean;
  notify_collected: boolean;
};
type Me = { display_name: string | null; avatar_url: string | null; created_at: string | null };

const PRIVACY: [keyof Prefs, string][] = [
  ["show_completion_pct", "Show my completion % publicly"],
  ["show_collected_tracks", "Show my collected tracks publicly"],
  ["show_ratings", "Show my ratings publicly"],
  ["show_followed_artists", "Show artists I follow publicly"],
  ["show_contributions", "Show my contributions publicly"],
];
const NOTIFY: [keyof Prefs, string][] = [
  ["notify_followed_daily", "Daily round-up for artists I follow"],
  ["notify_collected", "Tell me when songs I've collected change status"],
];

export default function SettingsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const isAdmin = useIsAdmin();
  const { theme, setTheme } = useTheme();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const { style } = useProfileStyle(user?.id ?? "");

  useEffect(() => {
    if (!authLoading && !user && !isAdmin) router.push("/login");
  }, [authLoading, user, router, isAdmin]);

  useEffect(() => {
    if (!user) return;
    supabase.from("profiles")
      .select("display_name, avatar_url, created_at, show_completion_pct, show_collected_tracks, show_ratings, show_followed_artists, show_contributions, notify_followed_daily, notify_collected")
      .eq("id", user.id).single()
      .then(({ data }) => {
        if (!data) return;
        const d = data as Prefs & Me;
        setPrefs(d);
        setMe({ display_name: d.display_name, avatar_url: d.avatar_url, created_at: d.created_at });
      });
  }, [user]);

  async function toggle(key: keyof Prefs) {
    if (!user || !prefs) return;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    await supabase.from("profiles").update({ [key]: next[key] }).eq("id", user.id);
  }

  async function logOut() {
    await supabase.auth.signOut({ scope: "local" });
    window.location.assign("/");
  }

  if (isAdmin) return <><AdminModePage title="Settings" /><div className="wrap st-page"><DevOptions /></div></>;

  const since = me?.created_at ? new Date(me.created_at).toLocaleDateString("en-GB", { month: "short", year: "numeric" }) : null;
  const accent = style?.premium ? style.accent ?? null : null;
  const H = ({ children }: { children: string }) => <h2 className="nw-h st-h">{children}<span>//</span></h2>;

  return (
    <div className="wrap st-page">
      <h1 className="ls-title st-title">SETTINGS<span>//</span></h1>

      <div className="st-grid">
        <section className="nw-panel st-box">
          <H>Account</H>
          <div className="st-account">
            {me?.avatar_url
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={me.avatar_url} alt="" className="ms-avatar" style={{ width: 64, height: 64 }} />
              : <span className="ms-avatar ms-avatar-blank" style={{ width: 64, height: 64 }} />}
            <span className="st-account-text">
              <strong>{me?.display_name ?? "…"}</strong>
              {since && <small>Member since {since}</small>}
            </span>
            {user && <Link href={`/profile/${user.id}`} className="st-edit">Edit profile//</Link>}
          </div>
          {user?.email && (
            <div className="st-row">
              <span className="st-row-text"><span>Email</span></span>
              <small className="st-value">{user.email}</small>
            </div>
          )}
          <button className="st-btn st-wide" onClick={logOut}>Log out//</button>
        </section>

        <section className="nw-panel st-box">
          <H>Appearance</H>
          <div className="st-row">
            <span className="st-row-text"><span>Theme</span></span>
            <span className="st-seg" role="group" aria-label="Theme">
              <button className={theme === "dark" ? "on" : undefined} aria-pressed={theme === "dark"} onClick={() => setTheme("dark")}>Dark//</button>
              <button className={theme === "light" ? "on" : undefined} aria-pressed={theme === "light"} onClick={() => setTheme("light")}>Light//</button>
            </span>
          </div>
          <div className="st-row">
            <span className="st-row-text"><span>Profile colour</span></span>
            <span className="st-colour">
              <span className="st-swatch" style={{ background: accent ?? "var(--accent)" }} />
              <span className="st-row-text">
                {user && <Link href={`/profile/${user.id}`} className="text-link">Change in Edit profile//</Link>}
                <small>Supporters only.</small>
              </span>
            </span>
          </div>
        </section>

        <section className="nw-panel st-box" id="notifications">
          <H>Notifications</H>
          <PhoneAlerts />
          {prefs && NOTIFY.map(([k, label]) => (
            <div key={k} className="st-row">
              <span className="st-row-text"><span>{label}</span></span>
              <Switch on={prefs[k]} label={label} onChange={() => toggle(k)} />
            </div>
          ))}
          <small className="st-foot">Alerts per artist (instant / daily / off) are set with the bell on each artist page. &ldquo;Remind me&rdquo; on the release radar always notifies you.</small>
        </section>

        <section className="nw-panel st-box">
          <H>Privacy</H>
          {prefs && PRIVACY.map(([k, label]) => (
            <div key={k} className="st-row">
              <span className="st-row-text"><span>{label}</span></span>
              <Switch on={prefs[k]} label={label} onChange={() => toggle(k)} />
            </div>
          ))}
          <small className="st-foot">Nothing is public until you turn it on. Friends always see everything.</small>
        </section>

        <section className="nw-panel st-box st-full">
          <H>Connections</H>
          <SpotifySync />
          <Link href="/library#export" className="st-link-row">
            <span className="st-icon" aria-hidden="true">⇅</span>
            <span className="st-row-text">
              <span>Import &amp; export</span>
              <small>Bring your Spotify, Apple Music or a file in, or take your collection out. In My Library.</small>
            </span>
            <span className="hf-chev" aria-hidden="true">›</span>
          </Link>
          <LastfmLink />
          {user && <ChatGPTRoutine userId={user.id} />}
        </section>

        <section className="nw-panel st-box st-full">
          <H>Your data</H>
          <YourData />
        </section>

        <DevOptions />
      </div>
    </div>
  );
}
