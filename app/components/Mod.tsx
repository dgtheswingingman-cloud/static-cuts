"use client";

// The building blocks every moderator and admin page uses, so they all look
// and behave the same: the page frame (back link, title, one-line intro), the
// toolbar (tabs with counts on the left, filters on the right), one row
// layout, one set of buttons, and the same loading / empty / error messages
// in the same place.

import Link from "next/link";
import type { ReactNode, MouseEvent } from "react";

// Page frame: "← control room", the title, a short intro, then the page.
export function ModPage({ title, intro, back = "/control", backLabel = "control room", actions, children }: {
  title: ReactNode;
  intro?: ReactNode;
  back?: string | null;
  backLabel?: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="wrap mod-page">
      {back && <Link href={back} className="mod-back">← {backLabel}</Link>}
      <div className="mod-head">
        <h1 className="detail-name page-title">{title}</h1>
        {actions && <div className="mod-head-actions">{actions}</div>}
      </div>
      {intro && <div className="detail-meta mod-intro">{intro}</div>}
      {children}
    </div>
  );
}

// Toolbar under the intro: tabs/filters on the left, extra controls on the
// right. Sticks to the top while scrolling a long list.
export function ModToolbar({ children, right, sticky = false }: { children?: ReactNode; right?: ReactNode; sticky?: boolean }) {
  return (
    <div className={`mod-toolbar${sticky ? " sticky" : ""}`}>
      <div className="mod-toolbar-left">{children}</div>
      {right && <div className="mod-toolbar-right">{right}</div>}
    </div>
  );
}

export type ModTab<K extends string> = { key: K; label: ReactNode; count?: number | null };

// Tabs with counts ("check these 2,573").
export function ModTabs<K extends string>({ tabs, value, onChange }: { tabs: ModTab<K>[]; value: K; onChange: (k: K) => void }) {
  return (
    <div className="mod-tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={t.key === value} className={`tab${t.key === value ? " active" : ""}`} onClick={() => onChange(t.key)}>
          {t.label}
          {t.count != null && <ModCount n={t.count} />}
        </button>
      ))}
    </div>
  );
}

export function ModCount({ n }: { n: number }) {
  return <span className="mod-count">{n.toLocaleString()}</span>;
}

// Buttons. approve: solid; dismiss: outline; danger: red, asks first when
// `confirm` is given; plain: secondary actions.
export function ModButton({ kind = "plain", confirm: ask, busy, disabled, onClick, children, title, type = "button" }: {
  kind?: "approve" | "dismiss" | "danger" | "plain";
  confirm?: string;
  busy?: boolean;
  disabled?: boolean;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
  title?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      title={title}
      className={`mod-btn ${kind}${busy ? " busy" : ""}`}
      disabled={disabled || busy}
      onClick={(e) => {
        if (ask && !window.confirm(ask)) return;
        onClick?.(e);
      }}
    >
      {children}
    </button>
  );
}

// One row: optional tick box, title line, small details underneath, actions
// on the right.
export function ModRow({ check, title, meta, actions, children, dim }: {
  check?: { checked: boolean; onChange: (v: boolean) => void };
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  dim?: boolean;
}) {
  return (
    <div className={`mod-row${check ? " has-check" : ""}${dim ? " dim" : ""}`}>
      {check && <input type="checkbox" checked={check.checked} onChange={(e) => check.onChange(e.target.checked)} />}
      <div className="mod-row-main">
        <div className="mod-row-title">{title}</div>
        {meta && <div className="mod-row-meta">{meta}</div>}
        {children}
      </div>
      {actions && <div className="mod-row-actions">{actions}</div>}
    </div>
  );
}

export function ModTag({ children, kind }: { children: ReactNode; kind?: "good" | "warn" }) {
  return <span className={`mod-tag${kind ? ` ${kind}` : ""}`}>{children}</span>;
}

// "N ticked: approve / dismiss" bar for lists with tick boxes.
export function ModBulkBar({ count, children, onClear }: { count: number; children: ReactNode; onClear?: () => void }) {
  if (count === 0) return null;
  return (
    <div className="mod-bulk">
      <span className="mod-bulk-count">{count.toLocaleString()} ticked</span>
      {children}
      {onClear && <button className="mod-link" onClick={onClear}>clear</button>}
    </div>
  );
}

// Messages: errors and results in one place, under the toolbar.
export function ModNotice({ kind = "info", children, onClose }: { kind?: "info" | "error" | "done"; children: ReactNode; onClose?: () => void }) {
  return (
    <div className={`mod-notice ${kind}`} role={kind === "error" ? "alert" : "status"}>
      <div>{children}</div>
      {onClose && <button className="mod-link" onClick={onClose} aria-label="close">✕</button>}
    </div>
  );
}

// Loading / empty, same look everywhere.
export function ModLoading({ what }: { what?: string }) {
  return <div className="empty-state mod-state">Loading{what ? ` ${what}` : ""}…</div>;
}
export function ModEmpty({ children }: { children: ReactNode }) {
  return <div className="empty-state mod-state">{children}</div>;
}

// A section heading inside a page ("Waiting", "Done").
export function ModSection({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mod-section">
      <span>{children}</span>
      {right}
    </div>
  );
}
