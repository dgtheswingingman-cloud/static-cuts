"use client";

// OAuth consent screen. Supabase Auth sends the browser here (the
// "Authorization Path" setting) when an app such as ChatGPT asks to connect
// to a user's Static Cuts account.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";

type Details = {
  authorization_id: string;
  redirect_uri: string;
  client: { id: string; name: string; uri?: string; logo_uri?: string };
  scope: string;
};

export default function OAuthConsentPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [authorizationId, setAuthorizationId] = useState<string | null>(null);
  const [details, setDetails] = useState<Details | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setAuthorizationId(new URLSearchParams(window.location.search).get("authorization_id"));
  }, []);

  useEffect(() => {
    if (loading || authorizationId === null) return;
    if (!authorizationId) {
      setError("This link is missing its authorization request. Start the connection again from ChatGPT.");
      return;
    }
    if (!user) {
      const back = `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
      router.push(`/login?next=${encodeURIComponent(back)}`);
      return;
    }
    (async () => {
      const { data, error: err } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
      if (err || !data) {
        setError(err?.message ?? "This request has expired. Start the connection again from ChatGPT.");
        return;
      }
      // Already approved before: Supabase hands back where to go straight away.
      if (!("authorization_id" in data)) {
        window.location.href = data.redirect_url;
        return;
      }
      setDetails(data as Details);
    })();
  }, [loading, user, authorizationId, router]);

  async function decide(approve: boolean) {
    if (!authorizationId) return;
    setBusy(true);
    setError(null);
    const fn = approve ? supabase.auth.oauth.approveAuthorization : supabase.auth.oauth.denyAuthorization;
    const { data, error: err } = await fn.call(supabase.auth.oauth, authorizationId, { skipBrowserRedirect: true });
    if (err || !data) {
      setBusy(false);
      setError(err?.message ?? "Something went wrong. Try again from ChatGPT.");
      return;
    }
    window.location.href = data.redirect_url;
  }

  return (
    <div className="wrap" style={{ maxWidth: 560 }}>
      <h1 className="detail-name" style={{ fontSize: "2rem" }}>Connect an app</h1>

      {error && (
        <div className="empty-state" style={{ borderColor: "#a33", marginTop: 16 }}>{error}</div>
      )}

      {!error && !details && <div className="empty-state" style={{ marginTop: 16 }}>loading…</div>}

      {details && (
        <div style={{ marginTop: 16 }}>
          <p style={{ lineHeight: 1.6 }}>
            <b>{details.client.name || "An app"}</b> wants to connect to your Static Cuts account
            {user?.email ? <> (<span className="comment-meta">{user.email}</span>)</> : null}.
          </p>
          <div className="section-label" style={{ marginTop: 18 }}>It will be able to</div>
          <ul style={{ lineHeight: 1.7, paddingLeft: 18 }}>
            <li>See which artists you follow</li>
            <li>Look up songs already in the archive</li>
            <li>Report songs and status changes it finds, for review before anything goes live</li>
          </ul>
          <div className="section-label" style={{ marginTop: 14 }}>It won&apos;t be able to</div>
          <ul style={{ lineHeight: 1.7, paddingLeft: 18 }}>
            <li>Edit tracklists, approve anything, or use admin tools</li>
            <li>Change your follows, profile, ratings or comments</li>
          </ul>
          <p className="comment-meta" style={{ marginTop: 10 }}>
            You can disconnect it any time from ChatGPT&apos;s connector settings.
          </p>
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button className="tab active" disabled={busy} onClick={() => decide(true)} style={{ padding: "10px 18px" }}>
              {busy ? "…" : "Allow"}
            </button>
            <button className="tab" disabled={busy} onClick={() => decide(false)} style={{ padding: "10px 18px" }}>
              Deny
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
