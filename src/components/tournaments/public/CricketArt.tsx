// Cricket's own artwork, drawn in code: flat, geometric, no images to load.
// Used on cricket tournaments only; every other sport keeps the plain look.
//   - CricketBall: red (two-innings), white (limited overs), pink (day-night)
//   - CricketCrest: a team badge made from the team's name, in place of a
//     letter circle when the team has no logo of its own
//   - CricketHeroArt: the poster when a cricket tournament has no banner
//   - CricketStatus: Live / Upcoming / Completed

import "./cricket-art.css";

export const CRICKET = {
  crimson: "#CA023A",
  pink: "#FF1F6D",
  white: "#FAFAFA",
  forest: "#102A1E",
  navy: "#13294B",
  cream: "#F2EDE6",
};

const BALLS = {
  red: { fill: CRICKET.crimson, seam: "#FAFAFA" },
  white: { fill: CRICKET.white, seam: "#0B5D3B" },
  pink: { fill: CRICKET.pink, seam: "#111111" },
} as const;
export type BallKind = keyof typeof BALLS;

/** Which ball a competition plays with: red for two innings, white for limited overs. */
export const ballFor = (rules: unknown): BallKind => ((rules as { preset?: string } | null)?.preset === "test" ? "red" : "white");

export function CricketBall({ kind = "red", size = 16, title }: { kind?: BallKind; size?: number; title?: string }) {
  const b = BALLS[kind];
  return (
    <svg className="ck-art-ball" width={size} height={size} viewBox="0 0 24 24" role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <circle cx="12" cy="12" r="11" fill={b.fill} stroke={kind === "white" ? "rgba(16,42,30,.25)" : "none"} strokeWidth="1" />
      {/* the seam: a band through the middle, bowed slightly, stitched on both edges */}
      <path d="M10 1.4 C 13.6 7.4 13.6 16.6 10 22.6" fill="none" stroke={b.seam} strokeWidth="1.3" strokeLinecap="round" />
      <path d="M13.2 1.2 C 16.8 7.4 16.8 16.6 13.2 22.8" fill="none" stroke={b.seam} strokeWidth="1.3" strokeLinecap="round" />
      <path d="M10.4 4.6 l-1.5.5 M11.9 8.4 l-1.6.2 M12.3 12 h-1.6 M11.9 15.6 l-1.6-.2 M10.4 19.4 l-1.5-.5 M13.6 4.4 l1.5.5 M15.1 8.4 l1.6.2 M15.5 12 h1.6 M15.1 15.6 l1.6-.2 M13.6 19.6 l1.5-.5" stroke={b.seam} strokeWidth="1" strokeLinecap="round" opacity=".9" />
    </svg>
  );
}

// ── team crests ─────────────────────────────────────────────────

const PALETTES = [
  { bg: CRICKET.forest, fg: CRICKET.cream, mark: "#2E7D5B" },
  { bg: CRICKET.navy, fg: CRICKET.cream, mark: "#3B6BA5" },
  { bg: CRICKET.crimson, fg: CRICKET.white, mark: "#F26A8D" },
  { bg: CRICKET.cream, fg: CRICKET.forest, mark: "#C9BBA6" },
];

// FNV-1a, then a final mix: FNV's low bits barely change between short names, so without it most teams land on the same colourway
const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b); h ^= h >>> 16;
  return h >>> 0;
};

/** Up to two letters: "Sri Lanka" → "SL", "India" → "IN". */
export const initials = (name: string) => {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  return (words.length > 1 ? words[0][0] + words[words.length - 1][0] : words[0].slice(0, 2)).toUpperCase();
};

/** The badge's motif, faint behind the initials: stumps, crossed bats, a ball's path or a seam. */
function Motif({ kind, color }: { kind: number; color: string }) {
  switch (kind) {
    case 0: // three stumps and bails
      return <g fill={color}><rect x="12" y="10" width="2.6" height="16" rx="1" /><rect x="18.7" y="10" width="2.6" height="16" rx="1" /><rect x="25.4" y="10" width="2.6" height="16" rx="1" /><rect x="11" y="8" width="8.5" height="1.6" rx=".8" /><rect x="20.5" y="8" width="8.5" height="1.6" rx=".8" /></g>;
    case 1: // crossed bats
      return <g fill={color}><rect x="18.5" y="4" width="3" height="30" rx="1.5" transform="rotate(35 20 20)" /><rect x="18.5" y="4" width="3" height="30" rx="1.5" transform="rotate(-35 20 20)" /></g>;
    case 2: // a ball's path from the bowler's hand
      return <g fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round"><path d="M4 30 C 14 6, 26 6, 36 26" strokeDasharray="0.1 4.2" /><circle cx="36" cy="26" r="3.2" fill={color} stroke="none" /></g>;
    default: // the seam, large
      return <g fill="none" stroke={color} strokeWidth="2"><path d="M14 2 C 22 12 22 28 14 38" /><path d="M19 2 C 27 12 27 28 19 38" /></g>;
  }
}

export function CricketCrest({ name, size = 32 }: { name: string; size?: number }) {
  const h = hash(name || "?");
  const p = PALETTES[(h >>> 8) % PALETTES.length];
  return (
    <svg className="ck-art-crest" width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="19.5" fill={p.bg} />
      <circle cx="20" cy="20" r="16.8" fill="none" stroke={p.mark} strokeWidth="1" />
      <g opacity=".55"><Motif kind={(h >>> 4) % 4} color={p.mark} /></g>
      <text x="20" y="21" textAnchor="middle" dominantBaseline="middle" fill={p.fg} fontFamily="Inter, system-ui, sans-serif" fontWeight="900" fontSize={initials(name).length > 1 ? 13 : 15} letterSpacing=".02em">{initials(name)}</text>
    </svg>
  );
}

// ── tournament poster ───────────────────────────────────────────

/** Abstract pitch and ball: a crimson ball crossing a forest-green field at 45°, on cream. */
export function CricketHeroArt() {
  return (
    <svg className="ck-art-hero" viewBox="0 0 800 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="800" height="300" fill={CRICKET.cream} />
      {/* the field: a forest-green block cut at 45 degrees */}
      <path d="M380 300 L640 40 L800 40 L800 300 Z" fill={CRICKET.forest} />
      {/* the pitch strip and creases, faint on the field */}
      <g transform="rotate(-45 640 220)" opacity=".22" fill="none" stroke={CRICKET.cream} strokeWidth="2">
        <rect x="560" y="196" width="190" height="48" />
        <path d="M584 196 v48 M726 196 v48" />
      </g>
      {/* the ball's path, then the ball crossing the field's edge */}
      <path d="M40 250 C 200 70, 330 50, 470 130" fill="none" stroke={CRICKET.crimson} strokeWidth="3" strokeLinecap="round" strokeDasharray="0.1 14" opacity=".55" />
      <circle cx="520" cy="160" r="104" fill={CRICKET.crimson} />
      <path d="M470 66 C 532 120 532 200 470 254" fill="none" stroke={CRICKET.white} strokeWidth="6" strokeLinecap="round" opacity=".9" />
      <path d="M494 58 C 560 116 560 204 494 262" fill="none" stroke={CRICKET.white} strokeWidth="6" strokeLinecap="round" opacity=".9" />
      {/* a quiet grid of dots in the copy space */}
      <g fill={CRICKET.forest} opacity=".08">
        {Array.from({ length: 6 }, (_, r) => Array.from({ length: 10 }, (_, c) => <circle key={`${r}-${c}`} cx={40 + c * 26} cy={40 + r * 26} r="2.2" />))}
      </g>
    </svg>
  );
}

// ── status badges ───────────────────────────────────────────────

export type CricketStatusKind = "live" | "upcoming" | "completed";

export function CricketStatus({ kind }: { kind: CricketStatusKind }) {
  return (
    <span className={`ck-art-status ${kind}`}>
      {kind === "live" ? <i className="ck-art-pulse" aria-hidden="true" />
        : kind === "upcoming" ? (
          <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <rect x="1.5" y="2.5" width="13" height="12" rx="2" /><path d="M1.5 6.5h13M5 1v3M11 1v3" /><path d="M8 9v2.2l1.4 1" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5l3.2 3.2L13 4.5" /></svg>
        )}
      {kind === "live" ? "Live" : kind === "upcoming" ? "Upcoming" : "Completed"}
    </span>
  );
}
