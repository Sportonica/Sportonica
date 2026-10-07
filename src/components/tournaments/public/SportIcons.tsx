// The sports icon set: flat, geometric, solid fills, drawn on a 24-unit
// grid with the same stroke weight, so any two sit happily side by side.
// Cricket in crimson and forest, basketball in court orange and black,
// the shared UI marks in the brand green. Player avatars take their
// colours from the team's crest so a player and their team match.

import { CRICKET } from "./CricketArt";
import { BASKETBALL } from "./BasketballArt";

type IconProps = { size?: number; title?: string; color?: string };
const svgProps = (size: number, title?: string) => ({
  width: size, height: size, viewBox: "0 0 24 24", role: title ? "img" : undefined, "aria-label": title, "aria-hidden": title ? undefined : true,
});

// ── cricket ─────────────────────────────────────────────────────

/** Three stumps and two bails. */
export function StumpsIcon({ size = 20, title, color = CRICKET.forest }: IconProps) {
  return (
    <svg {...svgProps(size, title)}>
      <g fill={color}>
        <rect x="5.2" y="6" width="2.6" height="15.5" rx="1.1" />
        <rect x="10.7" y="6" width="2.6" height="15.5" rx="1.1" />
        <rect x="16.2" y="6" width="2.6" height="15.5" rx="1.1" />
        <rect x="4.6" y="3.6" width="7.2" height="1.7" rx=".85" />
        <rect x="12.2" y="3.6" width="7.2" height="1.7" rx=".85" />
      </g>
      <rect x="2.5" y="21.2" width="19" height="1.3" rx=".65" fill={color} opacity=".25" />
    </svg>
  );
}

/** A champion's shield with a ball and a laurel line: for winners and awards. */
export function ChampionCrestIcon({ size = 20, title, color = CRICKET.crimson, accent = CRICKET.forest }: IconProps & { accent?: string }) {
  return (
    <svg {...svgProps(size, title)}>
      <path d="M12 1.6 L20.6 4.6 V11.2 C20.6 16.4 16.9 20.3 12 22.4 C7.1 20.3 3.4 16.4 3.4 11.2 V4.6 Z" fill={accent} />
      <path d="M12 3.9 L18.4 6.1 V11.2 C18.4 15.1 15.8 18.2 12 20 C8.2 18.2 5.6 15.1 5.6 11.2 V6.1 Z" fill="none" stroke="#F2EDE6" strokeWidth=".9" opacity=".5" />
      <circle cx="12" cy="11.2" r="4.4" fill={color} />
      <path d="M10.9 7 C 12.6 9.3 12.6 13.1 10.9 15.4 M12.5 6.9 C 14.2 9.2 14.2 13.2 12.5 15.5" fill="none" stroke="#FAFAFA" strokeWidth=".9" strokeLinecap="round" />
      <path d="M6.6 16.6 l1.4.9 M17.4 16.6 l-1.4.9" stroke="#F2EDE6" strokeWidth="1.1" strokeLinecap="round" opacity=".7" />
    </svg>
  );
}

// ── basketball ──────────────────────────────────────────────────

/** Backboard, rim and net. */
export function HoopIcon({ size = 20, title, color = BASKETBALL.ink, accent = BASKETBALL.orange }: IconProps & { accent?: string }) {
  return (
    <svg {...svgProps(size, title)}>
      <rect x="3" y="2" width="18" height="11" rx="1.4" fill="none" stroke={color} strokeWidth="1.8" />
      <rect x="9" y="6" width="6" height="4.2" fill="none" stroke={color} strokeWidth="1.4" />
      <rect x="7" y="12.4" width="10" height="1.9" rx=".95" fill={accent} />
      <path d="M7.8 14.3 L9.4 21.6 M16.2 14.3 L14.6 21.6 M10.6 14.3 L11.3 21.6 M13.4 14.3 L12.7 21.6 M8.5 17.6 H15.5 M9.2 20.6 H14.8" stroke={color} strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

/** The coach's clipboard with a play drawn on it: for scoring and the organiser's tools. */
export function ClipboardIcon({ size = 20, title, color = BASKETBALL.ink, accent = BASKETBALL.orange }: IconProps & { accent?: string }) {
  return (
    <svg {...svgProps(size, title)}>
      <rect x="4" y="3.2" width="16" height="19" rx="2.2" fill="none" stroke={color} strokeWidth="1.8" />
      <rect x="8.6" y="1.6" width="6.8" height="3.4" rx="1.2" fill={color} />
      <g fill="none" stroke={color} strokeWidth="1.3" strokeLinecap="round">
        <path d="M7.6 9.2 l2 2 M9.6 9.2 l-2 2" />
        <path d="M9.8 15.6 C 12 15.6 13 13.6 14.2 11.6" strokeDasharray="0.1 2.2" />
      </g>
      <circle cx="15.6" cy="10.2" r="1.8" fill={accent} />
      <path d="M13.8 18.8 H17" stroke={color} strokeWidth="1.3" strokeLinecap="round" opacity=".5" />
    </svg>
  );
}

// ── shared UI marks ─────────────────────────────────────────────

/** The live dot: a solid core inside a ring. */
export function LiveDotIcon({ size = 14, title, color = "#D6343A" }: IconProps) {
  return (
    <svg {...svgProps(size, title)} className="si-icon-live">
      <circle cx="12" cy="12" r="10" fill={color} opacity=".22" />
      <circle cx="12" cy="12" r="5.2" fill={color} />
    </svg>
  );
}

/** A calendar page with its clock: an upcoming match. */
export function CalendarIcon({ size = 18, title, color = "#006241" }: IconProps) {
  return (
    <svg {...svgProps(size, title)} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round">
      <rect x="3" y="4.5" width="18" height="16.5" rx="2.6" />
      <path d="M3 9.5 H21 M8 2.6 V6.2 M16 2.6 V6.2" />
      <circle cx="15.6" cy="15.6" r="3" strokeWidth="1.5" />
      <path d="M15.6 14.2 V15.8 L16.6 16.6" strokeWidth="1.3" />
      <rect x="6.2" y="12.6" width="2.4" height="2.2" rx=".5" fill={color} stroke="none" />
    </svg>
  );
}

/** Four teams into two into one: the knockout bracket. */
export function BracketIcon({ size = 18, title, color = "currentColor" }: IconProps) {
  return (
    <svg {...svgProps(size, title)} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 4 H7 V8 H2.5 M7 6 H11" />
      <path d="M2.5 16 H7 V20 H2.5 M7 18 H11" />
      <path d="M11 6 V18 M11 12 H16" />
      <rect x="16" y="9.6" width="5.5" height="4.8" rx="1.2" fill={color} stroke="none" opacity=".9" />
    </svg>
  );
}

// ── player avatars ──────────────────────────────────────────────

// FNV-1a, then a final mix: FNV's low bits barely change between short names, so without it most teams land on the same colourway
const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b); h ^= h >>> 16;
  return h >>> 0;
};

// the same four colourways as each sport's team crests, so a player wears their team's colours
const KIT = {
  cricket: [
    { bg: CRICKET.forest, kit: CRICKET.cream, trim: CRICKET.crimson },
    { bg: CRICKET.navy, kit: CRICKET.cream, trim: "#3B6BA5" },
    { bg: CRICKET.crimson, kit: CRICKET.white, trim: CRICKET.forest },
    { bg: CRICKET.cream, kit: CRICKET.forest, trim: CRICKET.crimson },
  ],
  basketball: [
    { bg: BASKETBALL.orange, kit: BASKETBALL.ink, trim: "#FFFFFF" },
    { bg: BASKETBALL.ink, kit: BASKETBALL.orange, trim: BASKETBALL.maple },
    { bg: BASKETBALL.maple, kit: BASKETBALL.charcoal, trim: BASKETBALL.orange },
    { bg: BASKETBALL.tan, kit: BASKETBALL.orange, trim: BASKETBALL.ink },
  ],
};

/**
 * A round, faceless athlete in their team's kit: a cricketer in a helmet
 * with its grille, or a basketball player in a vest with their number.
 * `team` picks the colourway (the same one as the team's crest).
 */
export function PlayerAvatar({ sport, team, number, size = 36, title }: {
  sport: "cricket" | "basketball"; team: string; number?: number | null; size?: number; title?: string;
}) {
  // the same bits as the team crest picks its colourway with, so a player matches their team
  const k = KIT[sport][(hash(team || "?") >>> 8) % 4];
  const skin = "#C98E63";
  return (
    <svg className="si-avatar" width={size} height={size} viewBox="0 0 40 40" role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <clipPath id={`av-${sport}-${hash(team)}`}><circle cx="20" cy="20" r="20" /></clipPath>
      <g clipPath={`url(#av-${sport}-${hash(team)})`}>
        <rect width="40" height="40" fill={k.bg} />
        {sport === "cricket" ? (
          <>
            {/* shirt with a collar */}
            <path d="M5 40 C 6 31 12 27.6 20 27.6 C 28 27.6 34 31 35 40 Z" fill={k.kit} />
            <path d="M16.4 28 L20 32 L23.6 28" fill="none" stroke={k.trim} strokeWidth="1.6" strokeLinejoin="round" />
            <rect x="17.4" y="22.6" width="5.2" height="5.4" fill={skin} />
            {/* helmet: shell, peak, grille */}
            <path d="M11.2 17.4 C 11.2 10.4 15.2 7 20 7 C 24.8 7 28.8 10.4 28.8 17.4 Z" fill={k.trim} />
            <rect x="9.6" y="16.4" width="20.8" height="2.4" rx="1.2" fill={k.trim} />
            <rect x="13.6" y="18.4" width="12.8" height="6" rx="2.2" fill={skin} />
            <g stroke="#E8E2D8" strokeWidth="1" strokeLinecap="round"><path d="M13 20.2 H27 M13 22.6 H27 M16.4 18.6 V24.6 M20 18.6 V24.6 M23.6 18.6 V24.6" /></g>
          </>
        ) : (
          <>
            {/* vest with deep armholes, number on the chest */}
            <path d="M6 40 C 7 32 11.6 28.6 15 28 L16.4 30.2 C 18 31.6 22 31.6 23.6 30.2 L25 28 C 28.4 28.6 33 32 34 40 Z" fill={k.kit} />
            <path d="M15 28 C 13.6 30.6 13.2 34 13.6 40 M25 28 C 26.4 30.6 26.8 34 26.4 40" fill="none" stroke={k.trim} strokeWidth="1.2" opacity=".8" />
            <rect x="17.4" y="22.8" width="5.2" height="6" fill={skin} />
            {/* head and headband */}
            <ellipse cx="20" cy="16.4" rx="6.6" ry="7.4" fill={skin} />
            <path d="M13.4 14.8 C 13.6 10 16.4 8.2 20 8.2 C 23.6 8.2 26.4 10 26.6 14.8 C 24.4 13.2 15.6 13.2 13.4 14.8 Z" fill="#2A1E18" />
            <rect x="13.2" y="13.6" width="13.6" height="2.2" rx="1.1" fill={k.trim} />
            {number != null ? (
              <text x="20" y="36.6" textAnchor="middle" fill={k.trim} fontFamily="Inter, system-ui, sans-serif" fontWeight="900" fontSize="6.4">{number}</text>
            ) : null}
          </>
        )}
      </g>
    </svg>
  );
}
