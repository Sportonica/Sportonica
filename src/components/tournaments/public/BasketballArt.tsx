// Basketball's own artwork, drawn in code: flat, geometric, no images.
// Used on basketball tournaments only; every other sport keeps its look.
//   - BasketballBall: court orange with black ribs
//   - BasketballCrest: a team badge from the team's name (hoop and net,
//     backboard, a shot's arc or the key), in place of a letter circle
//   - BasketballHeroArt: the poster when a tournament has no banner
//   - BasketballStatus: Live / Upcoming / Completed

import "./basketball-art.css";

export const BASKETBALL = {
  orange: "#E65C00",
  ink: "#1A1A1A",
  maple: "#F9F6F0",
  charcoal: "#2B2B2B",
  tan: "#E9D8BF",
};

export function BasketballBall({ size = 16, title }: { size?: number; title?: string }) {
  return (
    <svg className="bb-art-ball" width={size} height={size} viewBox="0 0 24 24" role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <circle cx="12" cy="12" r="10.8" fill={BASKETBALL.orange} stroke={BASKETBALL.ink} strokeWidth="1.4" />
      <g fill="none" stroke={BASKETBALL.ink} strokeWidth="1.3" strokeLinecap="round">
        <path d="M12 1.2 V22.8" />
        <path d="M1.2 12 H22.8" />
        <path d="M4.4 4.4 C 8.6 8.4 8.6 15.6 4.4 19.6" />
        <path d="M19.6 4.4 C 15.4 8.4 15.4 15.6 19.6 19.6" />
      </g>
    </svg>
  );
}

// ── team crests ─────────────────────────────────────────────────

const PALETTES = [
  { bg: BASKETBALL.orange, fg: "#FFFFFF", mark: "#FF9A57" },
  { bg: BASKETBALL.ink, fg: BASKETBALL.maple, mark: "#5A5A5A" },
  { bg: BASKETBALL.maple, fg: BASKETBALL.ink, mark: BASKETBALL.tan },
  { bg: BASKETBALL.tan, fg: BASKETBALL.ink, mark: "#D2B48A" },
];

// FNV-1a, then a final mix: FNV's low bits barely change between short names, so without it most teams land on the same colourway
const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b); h ^= h >>> 16;
  return h >>> 0;
};

/** Up to two letters: "United States" → "US", "Japan" → "JA". */
const initials = (name: string) => {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  return (words.length > 1 ? words[0][0] + words[words.length - 1][0] : words[0].slice(0, 2)).toUpperCase();
};

/** The badge's motif, faint behind the initials. */
function Motif({ kind, color }: { kind: number; color: string }) {
  switch (kind) {
    case 0: // hoop and net
      return <g fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round"><ellipse cx="20" cy="12" rx="9" ry="2.6" /><path d="M11.4 12.6 L14 27 M28.6 12.6 L26 27 M15.5 13.6 L17.6 27 M24.5 13.6 L22.4 27 M14 27 H26 M12.6 18 H27.4 M13.4 22.6 H26.6" /></g>;
    case 1: // backboard and rim
      return <g fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round"><rect x="9" y="6" width="22" height="15" rx="1.5" /><rect x="15.5" y="12" width="9" height="6" /><path d="M14 23 H26" strokeLinecap="round" /></g>;
    case 2: // a shot's arc into the hoop
      return <g fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round"><path d="M4 32 C 10 4, 26 2, 33 16" strokeDasharray="0.1 4.4" /><path d="M29 18 H37" /><circle cx="8" cy="29" r="3.2" fill={color} stroke="none" /></g>;
    default: // the key and the free-throw circle
      return <g fill="none" stroke={color} strokeWidth="1.8"><rect x="13" y="16" width="14" height="24" /><circle cx="20" cy="16" r="7" /><path d="M2 40 C 4 14, 36 14, 38 40" /></g>;
  }
}

export function BasketballCrest({ name, size = 32 }: { name: string; size?: number }) {
  const h = hash(name || "?");
  const p = PALETTES[(h >>> 8) % PALETTES.length];
  const text = initials(name);
  return (
    <svg className="bb-art-crest" width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="19.5" fill={p.bg} />
      <clipPath id={`bbc-${h}`}><circle cx="20" cy="20" r="19.5" /></clipPath>
      <g opacity=".6" clipPath={`url(#bbc-${h})`}><Motif kind={(h >>> 4) % 4} color={p.mark} /></g>
      <text x="20" y="21" textAnchor="middle" dominantBaseline="middle" fill={p.fg} fontFamily="Inter, system-ui, sans-serif" fontWeight="900" fontSize={text.length > 1 ? 13 : 15} letterSpacing=".02em">{text}</text>
    </svg>
  );
}

// ── tournament poster ───────────────────────────────────────────

/** A simplified half court on maple, a charcoal block at 45° and a big court-orange ball crossing it. */
export function BasketballHeroArt() {
  return (
    <svg className="bb-art-hero" viewBox="0 0 800 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="800" height="300" fill={BASKETBALL.maple} />
      {/* court lines: the three-point arc, the key and the centre circle, faint */}
      <g fill="none" stroke={BASKETBALL.ink} strokeWidth="2.5" opacity=".1">
        <path d="M0 40 H140 C 300 40, 300 260, 140 260 H0" />
        <rect x="0" y="105" width="120" height="90" />
        <circle cx="120" cy="150" r="45" />
        <path d="M400 0 V300" />
        <circle cx="400" cy="150" r="58" />
      </g>
      {/* the charcoal block cut at 45 degrees */}
      <path d="M420 300 L660 60 L800 60 L800 300 Z" fill={BASKETBALL.charcoal} />
      {/* the shot's arc, then the ball */}
      <path d="M60 250 C 190 40, 360 30, 480 110" fill="none" stroke={BASKETBALL.orange} strokeWidth="3" strokeLinecap="round" strokeDasharray="0.1 14" opacity=".6" />
      <g transform="translate(560 160)">
        <circle r="104" fill={BASKETBALL.orange} />
        <g fill="none" stroke={BASKETBALL.ink} strokeWidth="6" strokeLinecap="round">
          <path d="M0 -104 V104" />
          <path d="M-104 0 H104" />
          <path d="M-73 -74 C -36 -36 -36 36 -73 74" />
          <path d="M73 -74 C 36 -36 36 36 73 74" />
        </g>
      </g>
    </svg>
  );
}

// ── status badges ───────────────────────────────────────────────

export type BasketballStatusKind = "live" | "upcoming" | "completed";

export function BasketballStatus({ kind }: { kind: BasketballStatusKind }) {
  return (
    <span className={`bb-art-status ${kind}`}>
      {kind === "live" ? <i className="bb-art-pulse" aria-hidden="true" />
        : kind === "upcoming" ? (
          <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <rect x="1.5" y="2.5" width="13" height="12" rx="2" /><path d="M1.5 6.5h13M5 1v3M11 1v3" /><path d="M8 9v2.2l1.4 1" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5l3.2 3.2L13 4.5" /></svg>
        )}
      {kind === "live" ? "Live" : kind === "upcoming" ? "Upcoming" : "Final"}
    </span>
  );
}
