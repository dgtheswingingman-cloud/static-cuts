"use client";

// How NIX is learning (sub-version checks for now):
//   accuracy   how often each model's yes/no matched what you decided
//   lessons    your past decisions it now shows the AI as worked examples
//   rules      version tags you always decide the same way; switch one on
//              and NIX applies it to new suggestions (undoable)

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useIsOwner } from "../useIsAdmin";

type Rule = { id: number; pattern: string; action: "link" | "dismiss"; state: "suggested" | "on"; said_yes: number; said_no: number; examples: string[]; applied: number };
type Learning = {
  models: { model: string; decided: number; said: number; right: number; unsure: number }[];
  answers_30d: number;
  lessons: number;
  lesson_examples: { line: string; answer: string }[];
  rules: Rule[];
  open_matching: Record<string, number>;
};

const modelName = (m: string) => (m.startsWith("claude") ? "Claude" : `NIX on PC (${m})`);

export default function Learning() {
  const isOwner = useIsOwner();
  const [d, setD] = useState<Learning | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => supabase.rpc("admin_nix_learning").then(({ data, error }) => {
    if (error) setErr(error.message); else setD((data as Learning) ?? null);
  });
  useEffect(() => { load(); const t = setInterval(load, 120000); return () => clearInterval(t); }, []);

  async function setRule(id: number, state: "on" | "no" | "suggested") {
    setBusy(id);
    const { error } = await supabase.rpc("admin_nix_rule_set", { p_id: id, p_state: state });
    if (error) setErr(error.message);
    await load();
    setBusy(null);
  }

  if (!d) return null;
  const suggested = d.rules.filter((r) => r.state === "suggested");
  const on = d.rules.filter((r) => r.state === "on");

  return (
    <section className="cr-box">
      <div className="section-label">How NIX is learning</div>
      <div className="comment-meta" style={{ marginBottom: 8 }}>
        Sub-version checks. Every answer is kept with the model that gave it and compared with what you decided on{" "}
        <Link href="/review/versions" className="text-link">the review page</Link>. Cases where you decided differently go
        into its next prompts as worked examples ({d.lessons} in use now), so it stops repeating the same mistakes.
      </div>

      <div className="cr-sub">Accuracy (your decisions, last 90 days)</div>
      {d.models.length === 0 ? (
        <div className="comment-meta">Nothing to compare yet: this fills in as you review its answers.</div>
      ) : d.models.map((m) => (
        <div key={m.model} className="review-row nix-row">
          <div style={{ minWidth: 0 }}>
            <div className="review-row-title">{modelName(m.model)}</div>
            <div className="review-row-meta">
              {m.said > 0
                ? <span>agreed with you on {m.right} of {m.said} yes/no answers ({Math.round((m.right / m.said) * 100)}%)</span>
                : <span>no yes/no answers reviewed yet</span>}
              {m.unsure > 0 && <span>{m.unsure} left to you as unsure</span>}
            </div>
          </div>
        </div>
      ))}

      <div className="cr-sub">Rules it suggests</div>
      {suggested.length === 0 && <div className="comment-meta">None right now. NIX looks for new ones every night.</div>}
      {suggested.map((r) => (
        <div key={r.id} className="review-row nix-row">
          <div style={{ minWidth: 0 }}>
            <div className="review-row-title">
              {r.action === "link" ? "Always link" : "Always dismiss"} &ldquo;{r.pattern}&rdquo; versions
            </div>
            <div className="review-row-meta">
              <span>you {r.action === "link" ? `approved ${r.said_yes}` : `dismissed ${r.said_no}`} of {r.said_yes + r.said_no}</span>
              {(d.open_matching[String(r.id)] ?? 0) > 0 && <span>{d.open_matching[String(r.id)]} waiting now</span>}
            </div>
            {r.examples?.[0] && <div className="review-row-meta nix-wrap"><span>e.g. {r.examples[0]}</span></div>}
          </div>
          {isOwner && (
            <div className="nix-actions">
              <button className="st-btn" disabled={busy === r.id} onClick={() => setRule(r.id, "on")}>Turn on</button>
              <button className="st-btn" disabled={busy === r.id} onClick={() => setRule(r.id, "no")}>No</button>
            </div>
          )}
        </div>
      ))}

      {on.length > 0 && (
        <>
          <div className="cr-sub">Rules on</div>
          {on.map((r) => (
            <div key={r.id} className="review-row nix-row">
              <div style={{ minWidth: 0 }}>
                <div className="review-row-title">{r.action === "link" ? "Always link" : "Always dismiss"} &ldquo;{r.pattern}&rdquo; versions</div>
                <div className="review-row-meta"><span>applied to {r.applied} so far (undoable on <Link href="/admin/batches" className="text-link">Undo</Link>)</span></div>
              </div>
              {isOwner && (
                <button className="st-btn" disabled={busy === r.id} onClick={() => setRule(r.id, "suggested")}>Turn off</button>
              )}
            </div>
          ))}
        </>
      )}
      {err && <p className="comment-meta" style={{ color: "var(--red)" }}>{err}</p>}
    </section>
  );
}
