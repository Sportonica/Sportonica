"use client";

// Every scoring rule of a sport as a form: a preset to start from, then
// the rules in groups (the first open, the rest folded). Used by the
// tournament form, the scorer's tournament rules and one match's rules.
// The server validates on save; this only shapes the values.

import { useState } from "react";
import type { SportKey } from "@/lib/intelligence/core/types";
import { RULE_GROUPS, RULE_PRESETS, type RuleField } from "@/lib/intelligence/ruleFields";

type Rules = Record<string, unknown>;
interface Phase { name: string; from: number; to: number }

/** "console": the tournament console's ev-field look; "scorer": the live scorer's si- look. */
export type RuleFieldsLook = "console" | "scorer";

const keyLabel = (key: string): string => key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

const phasesText = (v: unknown): string =>
  Array.isArray(v) ? (v as Phase[]).map((p) => `${p.name}, ${p.from}, ${p.to}`).join("\n") : "";

/** "Powerplay, 1, 6" per line; a line that does not read is kept out (the server rejects bad ranges). */
function parsePhases(text: string): Phase[] {
  return text.split("\n").map((line) => line.split(",").map((x) => x.trim())).filter((p) => p.length === 3 && p[0])
    .map(([name, from, to]) => ({ name, from: Number(from), to: Number(to) }));
}

export default function RuleFields({ sport, rules, onChange, onPreset, look, choices }: {
  sport: SportKey;
  rules: Rules;
  onChange: (rules: Rules) => void;
  /** a preset is a whole set of values: the caller fetches or builds them */
  onPreset?: (preset: string) => void;
  look: RuleFieldsLook;
  /** for a sport without labelled fields: rules whose value is one of a fixed set */
  choices?: Record<string, readonly string[]>;
}) {
  const set = (k: string, v: unknown) => onChange({ ...rules, [k]: v });
  const groups = RULE_GROUPS[sport];
  const presets = RULE_PRESETS[sport];
  // the phases text is edited as typed; parsed on every change
  const [phases, setPhases] = useState(() => phasesText(rules.phases));
  // a preset (or a discard) replaces the phases from outside: show those, not the old text
  const phasesShown = JSON.stringify(parsePhases(phases)) === JSON.stringify(rules.phases ?? []) ? phases : phasesText(rules.phases);

  const field = (f: RuleField) => {
    const v = rules[f.key];
    const input = (() => {
      switch (f.kind) {
        case "bool":
          return <select value={v ? "yes" : "no"} onChange={(e) => set(f.key, e.target.value === "yes")}><option value="yes">Yes</option><option value="no">No</option></select>;
        case "choice": {
          // the stored value may be a boolean or number ("allowTie", "inningsPerSide"): keep its type
          const toValue = (s: string): unknown => (typeof v === "boolean" ? s === "true" : typeof v === "number" ? Number(s) : s);
          const pick = (x: string) => (f.key === "preset" && onPreset ? onPreset(x) : set(f.key, toValue(x)));
          return <select value={String(v)} onChange={(e) => pick(e.target.value)}>{f.options.map(([o, l]) => <option key={o} value={o}>{l}</option>)}</select>;
        }
        case "limit":
          return <input type="number" inputMode="numeric" min={0} value={v === null || v === undefined ? "" : String(v)} placeholder={f.empty}
            onChange={(e) => set(f.key, e.target.value.trim() === "" ? null : Math.max(0, Math.round(Number(e.target.value) || 0)))} />;
        case "phases":
          return <textarea rows={3} value={phasesShown} placeholder={"Powerplay, 1, 6\nDeath, 16, 20"}
            onChange={(e) => { setPhases(e.target.value); set(f.key, parsePhases(e.target.value)); }} />;
        default:
          // left empty while typing: the server says what is missing on save
          return <input type="number" inputMode="numeric" min={f.min} max={f.max} value={v === null || v === undefined ? "" : String(v)}
            onChange={(e) => set(f.key, e.target.value.trim() === "" ? "" : Math.round(Number(e.target.value)))} />;
      }
    })();
    const hint = f.kind === "limit" && !f.help ? `Empty: ${f.empty.toLowerCase()}` : f.help;
    return look === "console" ? (
      <div className="ev-field" key={f.key} style={{ marginBottom: 12 }}>
        <label>{f.label}</label>
        {input}
        {hint ? <small className="tc-dim" style={{ fontSize: 11.5, marginTop: 4 }}>{hint}</small> : null}
      </div>
    ) : (
      <label className="si-label rf-scorer" key={f.key}>{f.label}{input}
        {hint ? <span className="si-muted" style={{ fontSize: 11.5, fontWeight: 500 }}>{hint}</span> : null}
      </label>
    );
  };

  // the preset select calls onPreset instead of setting one field
  const presetEl = presets && onPreset ? (
    look === "console" ? (
      <div className="ev-field" style={{ marginBottom: 12 }}>
        <label>Start from</label>
        <select value={String(rules.preset)} onChange={(e) => onPreset(e.target.value)}>{presets.map(([o, l]) => <option key={o} value={o}>{l}</option>)}</select>
        <small className="tc-dim" style={{ fontSize: 11.5, marginTop: 4 }}>Fills in every rule below. Change any of them afterwards.</small>
      </div>
    ) : (
      <label className="si-label rf-scorer">Start from
        <select value={String(rules.preset)} onChange={(e) => onPreset(e.target.value)}>{presets.map(([o, l]) => <option key={o} value={o}>{l}</option>)}</select>
      </label>
    )
  ) : null;

  const grid = (children: React.ReactNode) => look === "console"
    ? <div className="rf-grid">{children}</div>
    : <div className="si-form">{children}</div>;

  if (!groups) {
    // a sport without labels: every simple rule by its key
    const all: Record<string, readonly string[]> = { ...choices };
    const editable = Object.entries(rules).filter(([, v]) => v === null || ["number", "boolean", "string"].includes(typeof v));
    return <>{look === "scorer" ? <style>{RF_CSS}</style> : null}{grid(editable.map(([k, v]) => field(
      all[k] ? { key: k, label: keyLabel(k), kind: "choice", options: all[k].map((c) => [c, c.replace(/_/g, " ")] as const) }
        : typeof v === "boolean" ? { key: k, label: keyLabel(k), kind: "bool" }
        : v === null ? { key: k, label: keyLabel(k), kind: "limit", empty: "No limit" }
        : { key: k, label: keyLabel(k), kind: "int" },
    )))}</>;
  }

  return (
    <div className="rf">
      <style>{RF_CSS}</style>
      {grid(<>{presetEl}{groups[0].fields.map(field)}</>)}
      {groups.slice(1).map((g) => (
        <details key={g.title} className={look === "console" ? "rf-more" : "si-more"}>
          <summary>{g.title}</summary>
          {grid(g.fields.map(field))}
        </details>
      ))}
    </div>
  );
}

const RF_CSS = `
.rf-grid { display: grid; grid-template-columns: 1fr 1fr; column-gap: 12px; }
@media (max-width: 560px) { .rf-grid { grid-template-columns: 1fr; } }
.rf-more { margin: 4px 0 8px; }
.rf-more > summary { cursor: pointer; font-size: 13px; font-weight: 700; padding: 10px 0; list-style: none; }
.rf-more > summary::-webkit-details-marker { display: none; }
.rf-more > summary::after { content: " +"; }
.rf-more[open] > summary::after { content: " -"; }
.rf-scorer select, .rf-scorer input, .rf-scorer textarea { min-height: 44px; padding: 8px 12px; border-radius: 12px; border: 1px solid var(--si-line); background: var(--si-surface); color: var(--si-text); font: inherit; font-size: 15px; min-width: 0; }
.ev-field textarea { font-family: inherit; }
`;
