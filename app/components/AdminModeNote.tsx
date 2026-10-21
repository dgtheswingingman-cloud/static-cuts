"use client";

// Admin mode is only for admin jobs. Rating, commenting, voting, collecting,
// following, lists and suggestions belong to your own account, so in admin
// mode those controls are hidden and these say where they went, with a
// button to switch straight over.

import Link from "next/link";
import { useAdminView } from "../AdminViewContext";

export function SwitchToAccountButton({ label = "switch to my account" }: { label?: string }) {
  const { setViewAsNonAdmin } = useAdminView();
  return (
    <button className="inline-link-btn" onClick={() => setViewAsNonAdmin(true)}>{label}</button>
  );
}

export default function AdminModeNote({ what = "rate, comment, vote or suggest" }: { what?: string }) {
  return (
    <div className="comment-meta admin-mode-note">
      You&apos;re in admin mode. To {what}, <SwitchToAccountButton />.
    </div>
  );
}

// Whole pages that only make sense for your own account (notifications,
// settings, your submissions).
export function AdminModePage({ title }: { title: string }) {
  return (
    <div className="wrap">
      <h1 className="detail-name page-title">{title}</h1>
      <div className="empty-state" style={{ marginTop: 10 }}>
        This page belongs to your own account, and you&apos;re in admin mode. <SwitchToAccountButton /> to see it.
      </div>
    </div>
  );
}
