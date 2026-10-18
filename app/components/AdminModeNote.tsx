"use client";

// Admin mode is only for admin jobs. Rating, commenting, voting, collecting,
// following and suggesting are done from the "Regular user" view, so in
// admin mode those controls are hidden and this note says where they went.

export default function AdminModeNote({ what = "rate, comment, vote or suggest" }: { what?: string }) {
  return (
    <div className="comment-meta admin-mode-note">
      Admin mode. To {what}, switch your role to &ldquo;Regular user&rdquo; (under your name on the home page).
    </div>
  );
}
