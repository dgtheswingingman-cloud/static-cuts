"use client";

// The Control room: one place for running the site, shaped by who you are.
//   To do        (moderators, admins, owner) every list waiting for a decision
//   Site health  (admins, owner) jobs, outside services, trackers, links
//   People       (admins, owner) sign-ups, how checked artists are, searches
//   Owner        (owner) the team, API keys, auto-approve, leak file links

import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../AuthProvider";
import { useIsAdmin, useIsModerator, useIsOwner } from "../useIsAdmin";
import NoAccess from "../components/NoAccess";
import ReviewHub from "./ReviewHub";
import HealthPanel from "./HealthPanel";
import OwnerPanel from "./OwnerPanel";
import LivePanel from "./LivePanel";

type Tab = "todo" | "health" | "people" | "owner";

function Card({ href, title, blurb }: { href: string; title: string; blurb: string }) {
  return (
    <Link href={href} className="mod-card">
      <span className="mod-card-top"><span className="mod-card-title">{title}</span></span>
      <span className="mod-card-blurb">{blurb}</span>
    </Link>
  );
}

function ControlInner() {
  const { loading } = useAuth();
  const canModerate = useIsModerator();
  const isAdmin = useIsAdmin();
  const isOwner = useIsOwner();
  const router = useRouter();
  const params = useSearchParams();

  if (!canModerate) return <NoAccess loading={loading} who="moderators" />;

  const tabs: [Tab, string][] = [
    ["todo", "To do"],
    ...(isAdmin ? ([["health", "Site health"], ["people", "People"]] as [Tab, string][]) : []),
    ...(isOwner ? ([["owner", "Owner"]] as [Tab, string][]) : []),
  ];
  const asked = (params.get("tab") ?? "todo") as Tab;
  const tab: Tab = tabs.some(([t]) => t === asked) ? asked : "todo";

  return (
    <div className="wrap">
      <button className="back-btn" onClick={() => router.push("/")}>← home</button>
      <h1 className="detail-name page-title">Control room</h1>
      <div className="tabs" style={{ marginBottom: 18 }}>
        {tabs.map(([t, label]) => (
          <button key={t} className={`tab ${tab === t ? "active" : ""}`}
            onClick={() => router.replace(t === "todo" ? "/control" : `/control?tab=${t}`, { scroll: false })}>
            {label}
          </button>
        ))}
      </div>

      {tab === "todo" && <ReviewHub />}
      {tab === "health" && (
        <>
          <div className="section-label" style={{ marginTop: 0 }}>Tools</div>
          <div className="mod-grid" style={{ marginBottom: 18 }}>
            <Card href="/admin/sheets" title="Spreadsheets" blurb="Import a community tracker, or re-check one." />
            <Card href="/admin/tracklist" title="Paste a tracklist" blurb="Add a whole album's songs at once." />
            <Card href="/admin/queue" title="Artist queue" blurb="Which artists get checked for new music next." />
            <Card href="/admin/batches" title="Undo history" blurb="Every bulk change, and undo for each." />
          </div>
          <LivePanel />
          <div style={{ height: 18 }} />
          <HealthPanel part="health" />
        </>
      )}
      {tab === "people" && <HealthPanel part="people" />}
      {tab === "owner" && (
        <>
          <div className="mod-grid" style={{ marginBottom: 18 }}>
            <Card href="/admin/moderators" title="Team" blurb="Choose admins and moderators, and see what they've done." />
            <Card href="/admin/api-keys" title="API keys" blurb="Read-only access for other fan sites and bots." />
            <Card href="/admin/auto-approve" title="Auto-approve" blurb="Rules for adding trusted finds without review." />
          </div>
          <OwnerPanel />
        </>
      )}
    </div>
  );
}

export default function ControlPage() {
  return (
    <Suspense fallback={<div className="wrap"><div className="empty-state">loading…</div></div>}>
      <ControlInner />
    </Suspense>
  );
}
