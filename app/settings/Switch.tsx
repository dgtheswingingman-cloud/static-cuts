"use client";

// An on/off switch for settings.

export default function Switch({ on, onChange, disabled, label }: { on: boolean; onChange: () => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`st-switch ${on ? "on" : ""}`} disabled={disabled} onClick={onChange}>
      <span />
    </button>
  );
}
