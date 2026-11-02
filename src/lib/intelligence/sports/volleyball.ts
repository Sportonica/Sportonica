// Volleyball: rallies -> points -> sets -> match.
// Rules: docs/sports-intelligence/02-sport-rules.md (defaults are FIVB indoor).

import { askMatch } from "../core/ask";
import { VOLLEYBALL_KNOWLEDGE } from "../knowledge/volleyball";
import {
  RulesError, SIDES, isSide, otherSide,
  type Analytics, type Issue, type MatchContext, type MatchResult, type ScoreView,
  type Side, type SportIntelligenceEngine, type StatColumn, type StatLine, type StatTable, type StatValue,
} from "../core/types";
import { add, isNonNegInt, isPosInt, mergeRules, pct, playerName, playersOf, ratio, round, sideName, sideOfPlayer, str } from "../core/util";
import { gameWonBy, progressionCharts, rallyRaw, scoringRuns, streaks, type GameScore, type Rally } from "./rally";
import {
  BACK_ROW, FRONT_ROW_ENTRY, VOLLEYBALL_LINE_KEYS, VOLLEYBALL_PRESETS, VOLLEYBALL_TIEBREAKS, attackEfficiency, checkSetScores, mvpRating, pointsScored, volleyballRulesOf,
  type SetScore, type VolleyballRules,
} from "./volleyballRules";

export type { VolleyballRules } from "./volleyballRules";

const HOWS = ["ace", "kill", "block", "service_error", "foot_fault", "attack_error", "block_error", "reception_error", "setting_error", "net_fault", "rotation_fault", "opponent_error", "other"] as const;
const BY_WINNER = new Set(["ace", "kill", "block"]);
const BY_LOSER = new Set(["service_error", "foot_fault", "attack_error", "block_error", "reception_error", "setting_error", "net_fault", "rotation_fault", "opponent_error"]);
const CARDS = ["yellow", "red", "expulsion", "disqualification"] as const;
const CARD_NAME: Record<string, string> = { yellow: "Yellow card", red: "Red card", expulsion: "Expulsion", disqualification: "Disqualification" };
const OFFICIAL_ROLES = ["First referee", "Second referee", "Scorer", "Line judge"];
const TOUCH_KINDS = ["attack", "dig", "assist", "reception"] as const;
const RECEPTION_QUALITY = ["perfect", "good", "poor", "error"] as const;

export interface VolleyballState {
  sets: GameScore[];
  setsWon: Record<Side, number>;
  serving: Side | null;
  setFirstServer: Side | null;
  /** rotation order, position 1 (the server) first; null until a lineup is given */
  rotation: Record<Side, string[] | null>;
  timeouts: Record<Side, number>;
  subs: Record<Side, number>;
  rallies: Rally[];
  decided: Side | null;
  team: Record<Side, Record<string, number>>;
  players: Record<string, Record<string, number>>;
  log: { seq: number; text: string }[];
  /** the order last confirmed for each side: a new set starts from it */
  starting: Record<Side, string[] | null>;
  liberos: Record<Side, string[]>;
  /** the Libero on court and the player waiting for them to come off */
  liberoOn: Record<Side, { libero: string; player: string } | null>;
  /** this set's substitutions: each player, who they swap with and how many times they've swapped */
  pairs: Record<Side, Record<string, { with: string; uses: number }>>;
  /** out for the rest of the set (expelled) or the match (disqualified) */
  outForSet: string[];
  outForMatch: string[];
  rotationLog: { seq: number; set: number; side: Side; order: string[]; why: string }[];
  sanctions: { seq: number; set: number; side: Side; player: string | null; card: string }[];
  /** which sets each player was on court in */
  setsBy: Record<string, number[]>;
  /** when each set's first and latest points were scored */
  setTimes: { start: string; end: string }[];
  /** the final set scores were entered by hand after the match */
  manual: boolean;
  mvp: string | null;
  notes: string | null;
  officials: { role: string; name: string }[];
}

const cur = (s: VolleyballState): GameScore => s.sets[s.sets.length - 1];
const isDeciding = (s: VolleyballState, rules: VolleyballRules): boolean => rules.bestOf > 1 && s.sets.length === rules.bestOf;
const target = (s: VolleyballState, rules: VolleyballRules): number => (isDeciding(s, rules) ? rules.decidingSetPoints : rules.setPoints);

function credit(s: VolleyballState, side: Side, player: string | null, key: string): void {
  add(s.team[side], key);
  if (player) add((s.players[player] ??= {}), key);
}

const RAW_COLUMNS: StatColumn[] = [
  { key: "serves", label: "Serves", kind: "raw" },
  { key: "aces", label: "Aces", kind: "raw" },
  { key: "serviceErrors", label: "Service errors", kind: "raw" },
  { key: "attacks", label: "Attacks", kind: "raw" },
  { key: "kills", label: "Kills", kind: "raw" },
  { key: "attackErrors", label: "Attack errors", kind: "raw" },
  { key: "blocks", label: "Block points", kind: "raw" },
  { key: "blockErrors", label: "Block errors", kind: "raw" },
  { key: "digs", label: "Digs", kind: "raw" },
  { key: "assists", label: "Assists", kind: "raw" },
  { key: "settingErrors", label: "Setting errors", kind: "raw" },
  { key: "receptions", label: "Receptions", kind: "raw" },
  { key: "receptionPositive", label: "Positive receptions", kind: "raw" },
  { key: "receptionErrors", label: "Reception errors", kind: "raw" },
  { key: "substitutions", label: "Substitutions", kind: "raw" },
  { key: "yellowCards", label: "Yellow cards", kind: "raw" },
  { key: "redCards", label: "Red cards", kind: "raw" },
];

// a player's own record only: points added by hand never reach a team's figures or score
const PLAYER_POINTS_COLUMN: StatColumn = { key: "manualPoints", label: "Added points", kind: "raw" };

const DERIVED_COLUMNS: StatColumn[] = [
  { key: "pointsScored", label: "Points won", kind: "derived", format: "int" },
  { key: "attackPct", label: "Attack %", kind: "derived", format: "pct" },
  { key: "killPct", label: "Kill %", kind: "derived", format: "pct" },
  { key: "serviceEff", label: "Service efficiency %", kind: "derived", format: "pct" },
  { key: "receptionEff", label: "Reception efficiency %", kind: "derived", format: "pct" },
  { key: "rating", label: "MVP rating", kind: "derived", format: "dec1" },
];

const TEAM_EXTRA_RAW: StatColumn[] = [
  { key: "points", label: "Points", kind: "raw" },
  { key: "setsWon", label: "Sets won", kind: "raw" },
  { key: "received", label: "Rallies received", kind: "raw" },
  { key: "returnWon", label: "Side-outs won", kind: "raw" },
  { key: "longestStreak", label: "Longest run", kind: "raw" },
];

const TEAM_EXTRA_DERIVED: StatColumn[] = [
  { key: "sideOutPct", label: "Side-out %", kind: "derived", format: "pct" },
  { key: "pointsPerSet", label: "Points per set", kind: "derived", format: "dec1" },
];

function derive(raw: Record<string, number>): Record<string, StatValue> {
  const n = (k: string) => raw[k] ?? 0;
  return {
    pointsScored: pointsScored(raw),
    attackPct: attackEfficiency(raw),
    rating: mvpRating(raw),
    killPct: round(pct(raw.kills, raw.attacks), 1),
    serviceEff: round(pct(n("aces") - n("serviceErrors"), raw.serves), 1),
    receptionEff: round(pct(n("receptionPositive") - n("receptionErrors"), raw.receptions), 1),
    sideOutPct: round(pct(raw.returnWon, raw.received), 1),
    pointsPerSet: round(ratio(raw.points, raw.setsPlayed), 1),
  };
}

function teamRaw(s: VolleyballState, side: Side): Record<string, number> {
  const r = rallyRaw(s.rallies, side);
  // set scores entered by hand are the record of the points, whatever rallies came before them
  if (s.manual) {
    r.points = s.sets.reduce((t, g) => t + g[side], 0);
    r.pointsAgainst = s.sets.reduce((t, g) => t + g[otherSide(side)], 0);
  }
  return {
    ...r, ...s.team[side], serves: s.team[side].serves ?? r.served, setsWon: s.setsWon[side], setsLost: s.setsWon[otherSide(side)],
    setsPlayed: s.sets.filter((x) => x.a + x.b > 0).length,
  };
}

const onCourtNow = (s: VolleyballState, set: number, ids: readonly string[]) => {
  for (const id of ids) {
    const list = (s.setsBy[id] ??= []);
    if (!list.includes(set)) list.push(set);
  }
};

function logRotation(s: VolleyballState, seq: number, side: Side, why: string): void {
  const order = s.rotation[side];
  if (order) s.rotationLog.push({ seq, set: s.sets.length, side, order: [...order], why });
}

/** The point, the serve, the rotation and the set: what every rally and penalty shares. */
function awardPoint(s: VolleyballState, seq: number, at: string, winner: Side, how: string, shots: number | undefined, ctx: MatchContext, rules: VolleyballRules): void {
  const serving = s.serving!;
  const g = cur(s);
  if (g.a + g.b === 0) {
    for (const side of SIDES) onCourtNow(s, s.sets.length, s.rotation[side] ?? []);
    s.setTimes[s.sets.length - 1] = { start: at, end: at };
  } else if (s.setTimes[s.sets.length - 1]) s.setTimes[s.sets.length - 1].end = at;
  g[winner] += 1;
  s.rallies.push({ seq, w: winner, srv: serving, pt: winner, g: s.sets.length - 1, a: g.a, b: g.b, ...(shots !== undefined ? { shots } : {}), how });

  // Side out: the receiving side takes the serve and rotates one place.
  if (winner !== serving) {
    s.serving = winner;
    const rot = s.rotation[winner];
    if (rot && rot.length > 1) {
      rot.push(rot.shift()!);
      logRotation(s, seq, winner, "Won the serve");
      // the Libero never plays the front row: they come off as they would reach it
      const on = s.liberoOn[winner];
      if (on && rot[FRONT_ROW_ENTRY] === on.libero) {
        rot[FRONT_ROW_ENTRY] = on.player;
        s.liberoOn[winner] = null;
        onCourtNow(s, s.sets.length, [on.player]);
        s.log.push({ seq, text: `${playerName(ctx, on.libero)} off, ${playerName(ctx, on.player)} back on as the Libero reaches the front row` });
        logRotation(s, seq, winner, "Libero came off");
      }
    }
  }

  const won = gameWonBy(g, target(s, rules), rules.winBy, rules.pointCap);
  if (!won) return;
  g.winner = won;
  s.setsWon[won] += 1;
  s.log.push({ seq, text: `${sideName(ctx, won)} won set ${s.sets.length} ${g[won]}-${g[otherSide(won)]}` });
  if (s.setsWon[won] > rules.bestOf / 2) {
    s.decided = won;
    s.log.push({ seq, text: `${sideName(ctx, won)} won the match ${s.setsWon[won]}-${s.setsWon[otherSide(won)]}` });
    return;
  }
  const first = s.setFirstServer ?? serving;
  s.sets.push({ a: 0, b: 0, winner: null });
  s.timeouts = { a: 0, b: 0 };
  s.subs = { a: 0, b: 0 };
  s.pairs = { a: {}, b: {} };
  s.liberoOn = { a: null, b: null };
  s.outForSet = [];
  // each set starts from a confirmed order, not wherever the last set's rotation stopped
  for (const side of SIDES) {
    s.rotation[side] = s.starting[side] ? [...s.starting[side]!] : null;
    logRotation(s, seq, side, `Set ${s.sets.length} starting order`);
  }
  if (isDeciding(s, rules) && rules.decidingSetToss) { s.serving = null; s.setFirstServer = null; }
  else { s.serving = otherSide(first); s.setFirstServer = s.serving; }
}

const hasPlayer = (ctx: MatchContext, id: unknown): boolean => typeof id === "string" && sideOfPlayer(ctx, id) !== null;

export const volleyballEngine: SportIntelligenceEngine<VolleyballRules, VolleyballState> = {
  sport: "volleyball",
  label: "Volleyball",
  eventTypes: ["FIRST_SERVE", "LINEUP", "RALLY_WON", "TOUCH", "SUBSTITUTION", "TIMEOUT", "LIBERO_SET", "LIBERO_IN", "LIBERO_OUT", "SANCTION", "MATCH_MVP", "OFFICIALS", "FINAL_SETS", "PLAYER_POINTS"],
  statisticalEvents: ["PLAYER_POINTS"],
  ruleChoices: { preset: Object.keys(VOLLEYBALL_PRESETS) },

  answerQuestion(s, ctx, rules, question) { return askMatch(this, s, ctx, rules, question, VOLLEYBALL_KNOWLEDGE); },
  rulesGuide: (rules) => VOLLEYBALL_KNOWLEDGE.guide(rules),

  resolveRules(input) {
    const r = mergeRules(volleyballRulesOf(input), input);
    if (!(r.preset in VOLLEYBALL_PRESETS)) throw new RulesError("Unknown volleyball format");
    if (!isPosInt(r.bestOf) || r.bestOf % 2 === 0) throw new RulesError("bestOf must be an odd number of sets");
    if (!isPosInt(r.setPoints) || !isPosInt(r.decidingSetPoints)) throw new RulesError("set points must be positive whole numbers");
    if (!isPosInt(r.winBy)) throw new RulesError("winBy must be at least 1");
    if (r.pointCap !== null && (!isPosInt(r.pointCap) || r.pointCap < r.setPoints)) throw new RulesError("pointCap must be empty or at least setPoints");
    if (!isPosInt(r.playersOnCourt)) throw new RulesError("playersOnCourt must be a positive whole number");
    if (!isNonNegInt(r.timeoutsPerSet) || !isNonNegInt(r.substitutionsPerSet)) throw new RulesError("timeouts and substitutions per set cannot be negative");
    if (!isNonNegInt(r.maxLiberos)) throw new RulesError("maxLiberos cannot be negative");
    for (const k of ["tableWinPoints", "tableDecidingWinPoints", "tableDecidingLossPoints", "tableLossPoints", "tableForfeitLossPoints"] as const) {
      if (!isNonNegInt(r[k])) throw new RulesError("League table points cannot be negative");
    }
    if (!Array.isArray(r.tiebreakers) || r.tiebreakers.some((t) => !VOLLEYBALL_TIEBREAKS.includes(t))) throw new RulesError("Unknown table tiebreak");
    return r;
  },

  initializeMatch() {
    return {
      sets: [{ a: 0, b: 0, winner: null }], setsWon: { a: 0, b: 0 }, serving: null, setFirstServer: null,
      rotation: { a: null, b: null }, timeouts: { a: 0, b: 0 }, subs: { a: 0, b: 0 },
      rallies: [], decided: null, team: { a: {}, b: {} }, players: {}, log: [],
      starting: { a: null, b: null }, liberos: { a: [], b: [] }, liberoOn: { a: null, b: null }, pairs: { a: {}, b: {} },
      outForSet: [], outForMatch: [], rotationLog: [], sanctions: [], setsBy: {}, setTimes: [],
      manual: false, mvp: null, notes: null, officials: [],
    };
  },

  validateEvent(s, ev, ctx, rules) {
    const p = ev.payload;
    const g = cur(s);
    if (ev.type === "PLAYER_POINTS") {
      if (!hasPlayer(ctx, p.player)) return "That player is not in this match";
      return isPosInt(p.points) && Number.isSafeInteger(p.points) ? null : "Points must be a whole number, 1 or more";
    }
    if (ev.type === "OFFICIALS") {
      const list = p.officials;
      if (!Array.isArray(list) || list.length > 8) return "List the match officials";
      for (const o of list as { role?: unknown; name?: unknown }[]) {
        if (typeof o?.role !== "string" || !OFFICIAL_ROLES.includes(o.role)) return "Unknown official's role";
        if (typeof o.name !== "string" || !o.name.trim() || o.name.length > 80) return "Enter each official's name";
      }
      return null;
    }
    if (ev.type === "MATCH_MVP") {
      if (!s.decided) return "The MVP is named once the match is decided";
      return p.player === null || hasPlayer(ctx, p.player) ? null : "That player is not in this match";
    }
    if (ev.type === "FINAL_SETS") {
      if (s.manual) return "This match's result was already entered. Correct it instead";
      if (s.rallies.length && p.overrideLive !== true) return "This match has been scored live. Confirm that the entered result replaces the live score";
      const list = p.sets;
      if (!Array.isArray(list) || list.some((x) => !x || typeof x !== "object")) return "Enter the set scores";
      const check = checkSetScores(list as SetScore[], rules);
      if (check.errors.length) return check.errors[0];
      if (p.mvp != null && !hasPlayer(ctx, p.mvp)) return "The MVP is not in this match";
      if (p.notes != null && (typeof p.notes !== "string" || p.notes.length > 500)) return "Match notes can be up to 500 characters";
      if (p.lines != null) {
        if (!Array.isArray(p.lines)) return "Player statistics are not in the right form";
        const seen = new Set<string>();
        for (const l of p.lines as Record<string, unknown>[]) {
          if (!hasPlayer(ctx, l?.player)) return "A statistics line names a player who is not in this match";
          if (seen.has(l.player as string)) return "A player appears twice in the statistics";
          seen.add(l.player as string);
          for (const [k, v] of Object.entries(l)) {
            if (k === "player") continue;
            if (!(VOLLEYBALL_LINE_KEYS as readonly string[]).includes(k)) return `Unknown statistic: ${k}`;
            if (!isNonNegInt(v)) return "Player statistics must be whole numbers, 0 or more";
          }
          const c = (k: string) => (l[k] as number | undefined) ?? 0;
          const who = playerName(ctx, l.player as string);
          if (c("kills") + c("attackErrors") > c("attacks") && c("attacks") > 0) return `${who}: kills and attack errors can't be more than attacks`;
          if (c("aces") + c("serviceErrors") > c("serves") && c("serves") > 0) return `${who}: aces and service errors can't be more than serves`;
          if (c("receptionPositive") + c("receptionErrors") > c("receptions") && c("receptions") > 0) return `${who}: good and failed receptions can't be more than receptions`;
        }
      }
      return null;
    }
    if (s.manual) return "This match's result was entered by hand. Correct the entered result instead";
    if (s.decided) return "The match is already decided";
    switch (ev.type) {
      case "FIRST_SERVE":
        if (s.serving) return "The first server of this set is already set";
        if (g.a !== 0 || g.b !== 0) return "The first server can only be set before the first rally of a set";
        return isSide(p.side) ? null : "Say which side serves first";
      case "LINEUP": {
        if (!isSide(p.side)) return "Say which side the lineup is for";
        if (g.a !== 0 || g.b !== 0) return "A lineup can only be given before the first rally of a set";
        const list = p.players;
        if (!Array.isArray(list) || list.length !== rules.playersOnCourt) return `A lineup needs exactly ${rules.playersOnCourt} players`;
        if (new Set(list).size !== list.length) return "A player appears twice in the lineup";
        if (list.some((id) => typeof id !== "string" || sideOfPlayer(ctx, id) !== p.side)) return "Every lineup player must belong to that side";
        if (list.some((id) => s.liberos[p.side as Side].includes(id as string))) return "A Libero can't be in the starting order. They come on for a back-row player";
        if (list.some((id) => s.outForSet.includes(id as string) || s.outForMatch.includes(id as string))) return "A player in the lineup has been sent off";
        return null;
      }
      case "LIBERO_SET": {
        if (!isSide(p.side)) return "Say which side";
        if (!rules.liberoAllowed || rules.playersOnCourt !== 6) return "This format has no Libero";
        if (g.a !== 0 || g.b !== 0) return "The Libero is named before the first rally of a set";
        const list = p.players;
        if (!Array.isArray(list) || list.length > rules.maxLiberos) return `A team can name up to ${rules.maxLiberos} Liberos`;
        if (new Set(list).size !== list.length) return "A player appears twice";
        if (list.some((id) => typeof id !== "string" || sideOfPlayer(ctx, id) !== p.side)) return "A Libero must belong to that side";
        if (list.some((id) => s.rotation[p.side as Side]?.includes(id as string))) return "A player in the starting order can't be the Libero";
        return null;
      }
      case "LIBERO_IN": {
        if (!isSide(p.side)) return "Say which side";
        if (!s.liberos[p.side].includes(p.libero as string)) return "That player isn't this team's Libero";
        const rot = s.rotation[p.side];
        if (!rot) return "Set the lineup before the Libero comes on";
        if (s.liberoOn[p.side]) return "The Libero is already on court";
        if (s.outForSet.includes(p.libero as string) || s.outForMatch.includes(p.libero as string)) return "That Libero has been sent off";
        const at = rot.indexOf(p.for as string);
        if (at < 0) return "The player coming off is not on court";
        if (!(BACK_ROW as readonly number[]).includes(at)) return "The Libero can only replace a back-row player";
        if (at === 0 && s.serving === p.side) return "The Libero can't serve. The server stays on";
        return null;
      }
      case "LIBERO_OUT":
        if (!isSide(p.side)) return "Say which side";
        return s.liberoOn[p.side] ? null : "The Libero is not on court";
      case "SANCTION": {
        if (!isSide(p.side)) return "Say which side";
        if (typeof p.card !== "string" || !(CARDS as readonly string[]).includes(p.card)) return "Unknown sanction";
        if (p.player != null && (typeof p.player !== "string" || sideOfPlayer(ctx, p.player) !== p.side)) return "That player is not on that side";
        if ((p.card === "expulsion" || p.card === "disqualification") && !p.player) return "Say which player is sent off";
        if (p.card === "red" && !s.serving) return "Set who serves first: a red card gives the other team a point and the serve";
        return null;
      }
      case "RALLY_WON": {
        if (!s.serving) return isDeciding(s, rules) ? "Set who serves first in the deciding set" : "Set who serves first before scoring";
        if (!isSide(p.winner)) return "Say which side won the rally";
        const how = p.how == null ? "other" : p.how;
        if (typeof how !== "string" || !(HOWS as readonly string[]).includes(how)) return "Unknown way of winning the rally";
        if (how === "ace" && p.winner !== s.serving) return "Only the serving side can serve an ace";
        if (how === "service_error" && p.winner === s.serving) return "A service error gives the point to the receiving side";
        if (how === "foot_fault" && p.winner === s.serving) return "A foot fault gives the point to the receiving side";
        if (how === "reception_error" && p.winner !== s.serving) return "A reception error gives the point to the serving side";
        if (p.player != null) {
          if (typeof p.player !== "string") return "player must be a player id";
          const ps = sideOfPlayer(ctx, p.player);
          if (!ps) return "That player is not in this match";
          if (BY_WINNER.has(how) && ps !== p.winner) return "A kill, block or ace belongs to the side that won the rally";
          if (BY_LOSER.has(how) && ps === p.winner) return "That error belongs to the side that lost the rally";
        }
        if (p.shots != null && !isPosInt(p.shots)) return "Rally length must be a positive whole number";
        return null;
      }
      case "TOUCH": {
        if (!isSide(p.side)) return "Say which side";
        if (typeof p.kind !== "string" || !(TOUCH_KINDS as readonly string[]).includes(p.kind)) return "Unknown touch";
        if (p.player != null && (typeof p.player !== "string" || sideOfPlayer(ctx, p.player) !== p.side)) return "That player is not on that side";
        if (p.kind === "reception" && p.quality != null && !(RECEPTION_QUALITY as readonly unknown[]).includes(p.quality)) return "Unknown reception quality";
        return null;
      }
      case "SUBSTITUTION": {
        if (!isSide(p.side)) return "Say which side";
        const forced = s.outForSet.includes(p.out as string) || s.outForMatch.includes(p.out as string);
        // a player sent off must be replaced, even when the team's substitutions have run out
        if (!forced && s.subs[p.side] >= rules.substitutionsPerSet) return `${sideName(ctx, p.side)} has used all ${rules.substitutionsPerSet} substitutions this set`;
        if (typeof p.in !== "string" || typeof p.out !== "string") return "Say who comes on and who goes off";
        if (sideOfPlayer(ctx, p.in) !== p.side || sideOfPlayer(ctx, p.out) !== p.side) return "Both players must belong to that side";
        if (s.liberos[p.side].includes(p.in) || s.liberos[p.side].includes(p.out)) return "A Libero comes on and off as a Libero replacement, not a substitution";
        if (s.liberoOn[p.side]?.player === p.out) return "That player is off for the Libero. Bring the Libero off first";
        if (s.outForSet.includes(p.in) || s.outForMatch.includes(p.in)) return "That player has been sent off";
        if (rules.substitutionPairs && !forced) {
          const pairs = s.pairs[p.side];
          for (const [who, partner] of [[p.in, p.out], [p.out, p.in]] as const) {
            if (pairs[who] && pairs[who].with !== partner) return `${playerName(ctx, who)} can only swap with ${playerName(ctx, pairs[who].with)} this set`;
          }
          if ((pairs[p.out]?.uses ?? 0) >= 2) return `${playerName(ctx, p.out)} has already gone off and come back this set`;
        }
        const rot = s.rotation[p.side];
        if (rot) {
          if (!rot.includes(p.out)) return "The player going off is not on court";
          if (rot.includes(p.in)) return "The player coming on is already on court";
        }
        return null;
      }
      case "TIMEOUT":
        if (!isSide(p.side)) return "Say which side";
        return s.timeouts[p.side] >= rules.timeoutsPerSet ? `${sideName(ctx, p.side)} has no timeouts left this set` : null;
    }
    return null;
  },

  updateScore(s, ev, ctx, rules) {
    const p = ev.payload;
    switch (ev.type) {
      case "FIRST_SERVE": s.serving = p.side as Side; s.setFirstServer = s.serving; return s;
      case "LINEUP": {
        const side = p.side as Side;
        s.rotation[side] = [...(p.players as string[])];
        s.starting[side] = [...(p.players as string[])];
        logRotation(s, ev.seq, side, "Starting order confirmed");
        return s;
      }
      case "LIBERO_SET": s.liberos[p.side as Side] = [...(p.players as string[])]; return s;
      case "LIBERO_IN": {
        const side = p.side as Side, rot = s.rotation[side]!;
        rot[rot.indexOf(p.for as string)] = p.libero as string;
        s.liberoOn[side] = { libero: p.libero as string, player: p.for as string };
        onCourtNow(s, s.sets.length, [p.libero as string]);
        logRotation(s, ev.seq, side, "Libero came on");
        return s;
      }
      case "LIBERO_OUT": {
        const side = p.side as Side, rot = s.rotation[side]!, on = s.liberoOn[side]!;
        rot[rot.indexOf(on.libero)] = on.player;
        s.liberoOn[side] = null;
        onCourtNow(s, s.sets.length, [on.player]);
        logRotation(s, ev.seq, side, "Libero came off");
        return s;
      }
      case "SANCTION": {
        const side = p.side as Side, who = str(p.player), card = p.card as string;
        s.sanctions.push({ seq: ev.seq, set: s.sets.length, side, player: who, card });
        if (card === "yellow") credit(s, side, who, "yellowCards");
        else credit(s, side, who, "redCards");
        if (card === "expulsion" && who) s.outForSet.push(who);
        if (card === "disqualification" && who) s.outForMatch.push(who);
        s.log.push({ seq: ev.seq, text: `${CARD_NAME[card]}: ${who ? playerName(ctx, who) : sideName(ctx, side)}` });
        if (card === "red") awardPoint(s, ev.seq, ev.occurredAt, otherSide(side), "penalty", undefined, ctx, rules);
        return s;
      }
      case "PLAYER_POINTS": add((s.players[p.player as string] ??= {}), "manualPoints", p.points as number); return s;
      case "MATCH_MVP": s.mvp = str(p.player); return s;
      case "OFFICIALS": s.officials = (p.officials as { role: string; name: string }[]).map((o) => ({ role: o.role, name: o.name.trim() })); return s;
      case "FINAL_SETS": {
        const list = (p.sets as SetScore[]).map((x) => ({ a: x.a, b: x.b }));
        const check = checkSetScores(list, rules);
        s.sets = list.map((x, i) => ({ ...x, winner: check.winners[i] }));
        s.setsWon = check.setsWon;
        s.decided = check.winner;
        s.serving = null;
        s.manual = true;
        s.notes = typeof p.notes === "string" && p.notes.trim() ? p.notes.trim() : null;
        if (p.mvp !== undefined) s.mvp = str(p.mvp);
        for (const l of (p.lines ?? []) as Record<string, unknown>[]) {
          const who = l.player as string, side = sideOfPlayer(ctx, who)!;
          for (const k of VOLLEYBALL_LINE_KEYS) {
            const v = l[k];
            if (typeof v === "number" && v > 0) { add(s.team[side], k, v); add((s.players[who] ??= {}), k, v); }
          }
          onCourtNow(s, 1, [who]);
        }
        s.log.push({ seq: ev.seq, text: `Result entered: ${s.sets.map((x) => `${x.a}-${x.b}`).join(", ")}` });
        return s;
      }
      case "TIMEOUT": s.timeouts[p.side as Side] += 1; return s;
      case "SUBSTITUTION": {
        const side = p.side as Side;
        s.subs[side] += 1;
        const rot = s.rotation[side];
        if (rot) { rot[rot.indexOf(p.out as string)] = p.in as string; logRotation(s, ev.seq, side, "Substitution"); }
        const pairs = s.pairs[side], use = (pairs[p.out as string]?.uses ?? 0) + 1;
        pairs[p.out as string] = { with: p.in as string, uses: use };
        pairs[p.in as string] = { with: p.out as string, uses: use };
        credit(s, side, p.in as string, "substitutions");
        onCourtNow(s, s.sets.length, [p.in as string]);
        return s;
      }
      case "TOUCH": {
        const side = p.side as Side, who = str(p.player);
        if (p.kind === "attack") credit(s, side, who, "attacks");
        else if (p.kind === "dig") credit(s, side, who, "digs");
        else if (p.kind === "assist") credit(s, side, who, "assists");
        else {
          credit(s, side, who, "receptions");
          if (p.quality === "perfect" || p.quality === "good") credit(s, side, who, "receptionPositive");
          if (p.quality === "error") credit(s, side, who, "receptionErrors");
        }
        return s;
      }
    }

    // RALLY_WON
    const winner = p.winner as Side, loser = otherSide(winner);
    const serving = s.serving!;
    const how = (p.how as string | undefined) ?? "other";
    const server = s.rotation[serving]?.[0] ?? null;
    const named = str(p.player);

    if (server && how !== "rotation_fault") add((s.players[server] ??= {}), "serves");
    switch (how) {
      case "ace": credit(s, winner, named ?? server, "aces"); break;
      case "service_error": credit(s, loser, named ?? server, "serviceErrors"); break;
      case "foot_fault": credit(s, loser, named ?? server, "serviceErrors"); credit(s, loser, named ?? server, "footFaults"); break;
      case "kill": credit(s, winner, named, "attacks"); credit(s, winner, named, "kills"); break;
      case "attack_error": credit(s, loser, named, "attacks"); credit(s, loser, named, "attackErrors"); break;
      case "block": credit(s, winner, named, "blocks"); break;
      case "opponent_error": credit(s, loser, named, "errors"); break;
      case "block_error": credit(s, loser, named, "blockErrors"); break;
      case "setting_error": credit(s, loser, named, "settingErrors"); break;
      case "reception_error": credit(s, loser, named, "receptions"); credit(s, loser, named, "receptionErrors"); break;
      case "net_fault": credit(s, loser, named, "netFaults"); break;
      case "rotation_fault": credit(s, loser, named, "rotationFaults"); break;
    }
    awardPoint(s, ev.seq, ev.occurredAt, winner, how, isPosInt(p.shots) ? p.shots : undefined, ctx, rules);
    return s;
  },

  validateScore(s, _ctx, rules) {
    const issues: Issue[] = [];
    s.sets.forEach((g, i) => {
      const t = rules.bestOf > 1 && i === rules.bestOf - 1 ? rules.decidingSetPoints : rules.setPoints;
      if (g.winner !== gameWonBy(g, t, rules.winBy, rules.pointCap)) {
        issues.push({ severity: "error", code: "IMPOSSIBLE_SCORE", message: `Set ${i + 1} is ${g.a}-${g.b}, which does not match its recorded winner` });
      }
      if (i < s.sets.length - 1 && !g.winner) issues.push({ severity: "error", code: "IMPOSSIBLE_SCORE", message: `Set ${i + 1} was left unfinished` });
    });
    const need = Math.ceil(rules.bestOf / 2);
    if (s.setsWon.a > need || s.setsWon.b > need) issues.push({ severity: "error", code: "IMPOSSIBLE_SCORE", message: "A side has won more sets than the format allows" });
    if (s.sets.length > rules.bestOf) issues.push({ severity: "error", code: "IMPOSSIBLE_SCORE", message: "More sets were played than the format allows" });
    return issues;
  },

  getCurrentState(s, ctx, rules) {
    const g = cur(s);
    const view: ScoreView = {
      kind: "versus",
      // during a set the points are the headline, with sets won under them; at the end, the sets
      score: s.decided ? { a: String(s.setsWon.a), b: String(s.setsWon.b) } : { a: String(g.a), b: String(g.b) },
      subScore: null,
      periodLabel: s.decided ? "Final" : `Set ${s.sets.length}`,
      brief: s.decided ? s.sets.map((x) => `${x.a}-${x.b}`).join(", ") : `${g.a} : ${g.b}`,
      serving: s.decided ? null : s.serving,
      periods: s.sets.map((x, i) => ({ label: `S${i + 1}`, a: String(x.a), b: String(x.b) })),
      notes: [],
    };
    if (!s.decided) {
      view.facts = [
        { label: "Sets won", a: String(s.setsWon.a), b: String(s.setsWon.b) },
        { label: "Timeouts left", a: String(Math.max(rules.timeoutsPerSet - s.timeouts.a, 0)), b: String(Math.max(rules.timeoutsPerSet - s.timeouts.b, 0)) },
        ...(rules.substitutionsPerSet > 0 ? [{ label: "Substitutions left", a: String(Math.max(rules.substitutionsPerSet - s.subs.a, 0)), b: String(Math.max(rules.substitutionsPerSet - s.subs.b, 0)) }] : []),
      ];
    }
    if (!s.decided && s.serving) {
      const server = s.rotation[s.serving]?.[0];
      if (server) view.notes.push(`${playerName(ctx, server)} serving`);
    }
    if (s.mvp) view.notes.push(`MVP: ${playerName(ctx, s.mvp)}`);
    return view;
  },

  getMatchSummary(s, ctx, rules) {
    if (s.decided) return [`${sideName(ctx, s.decided)} won ${s.setsWon[s.decided]} sets to ${s.setsWon[otherSide(s.decided)]}`, s.sets.map((x) => `${x.a}-${x.b}`).join(", ")];
    const g = cur(s);
    const sets = s.setsWon.a === s.setsWon.b
      ? `Sets level at ${s.setsWon.a}-${s.setsWon.b}`
      : `${sideName(ctx, s.setsWon.a > s.setsWon.b ? "a" : "b")} leads ${Math.max(s.setsWon.a, s.setsWon.b)} sets to ${Math.min(s.setsWon.a, s.setsWon.b)}`;
    const lines = [sets, `Current set: ${g.a}-${g.b}`];
    if (isDeciding(s, rules)) lines.push(`Deciding set to ${rules.decidingSetPoints}`);
    return lines;
  },

  calculatePlayerStatistics(s, ctx) {
    const columns = [PLAYER_POINTS_COLUMN, ...RAW_COLUMNS, ...DERIVED_COLUMNS];
    const rows = SIDES.flatMap((side) => playersOf(ctx, side).map((pl) => {
      const raw = s.players[pl.id] ?? {};
      const d = derive(raw);
      return { id: pl.id, name: pl.name, side, values: { ...Object.fromEntries([PLAYER_POINTS_COLUMN, ...RAW_COLUMNS].map((c) => [c.key, raw[c.key] ?? 0])), ...Object.fromEntries(DERIVED_COLUMNS.map((c) => [c.key, d[c.key]])) } };
    }));
    return [{ key: "players", title: "Players", columns, rows }];
  },

  calculateTeamStatistics(s, ctx) {
    const raws = [...TEAM_EXTRA_RAW, ...RAW_COLUMNS];
    const rows = SIDES.map((side) => {
      const raw = teamRaw(s, side);
      return { id: side, name: sideName(ctx, side), side, values: { ...Object.fromEntries(raws.map((c) => [c.key, raw[c.key] ?? 0])), ...derive(raw), longestRally: raw.ralliesWithLength ? raw.longestRally : null } };
    });
    return [{ key: "sides", title: "Match statistics", columns: [...raws, { key: "longestRally", label: "Longest rally", kind: "raw" }, ...DERIVED_COLUMNS, ...TEAM_EXTRA_DERIVED], rows }];
  },

  calculateStatistics(s, ctx, rules) {
    const lines: StatLine[] = [];
    if (ctx.sides) {
      for (const side of SIDES) {
        lines.push({ subject: "team", subjectKey: ctx.sides[side].teamId, side, teamId: ctx.sides[side].teamId, teamPlayerId: null, userId: null, eventKey: null,
          raw: { ...teamRaw(s, side), matches: 1, wins: s.decided === side ? 1 : 0 } });
        const setsPlayed = s.sets.filter((x) => x.a + x.b > 0).length;
        for (const pl of ctx.sides[side].players) {
          // a player's record is only what was recorded: nothing for someone never on court or named
          const raw = s.players[pl.id];
          const sets = s.setsBy[pl.id]?.length ?? 0;
          if (!raw && !sets) continue;
          lines.push({ subject: "player", subjectKey: pl.id, side, teamId: ctx.sides[side].teamId, teamPlayerId: pl.id, userId: pl.userId ?? null, eventKey: null,
            raw: { ...(raw ?? {}), matches: 1, setsPlayed: s.manual ? setsPlayed : sets, ...(s.mvp === pl.id ? { matchMvps: 1 } : {}) } });
        }
      }
    }
    return { players: this.calculatePlayerStatistics(s, ctx, rules), teams: this.calculateTeamStatistics(s, ctx, rules), lines };
  },

  calculateAdvancedAnalytics(s, ctx) {
    const names = { a: sideName(ctx, "a"), b: sideName(ctx, "b") };
    const st = streaks(s.rallies);
    const runs = scoringRuns(s.rallies, 4);
    const eff: StatTable = {
      key: "efficiency", title: "Attack and service efficiency",
      columns: [...DERIVED_COLUMNS, ...TEAM_EXTRA_DERIVED],
      rows: SIDES.map((side) => ({ id: side, name: names[side], side, values: derive(teamRaw(s, side)) })),
    };
    const runTable: StatTable = {
      key: "runs", title: "Scoring runs (4 or more)",
      columns: [{ key: "set", label: "Set", kind: "raw" }, { key: "length", label: "Points in a row", kind: "raw" }],
      rows: runs.map((r, i) => ({ id: String(i), name: names[r.side], side: r.side, values: { set: r.g + 1, length: r.length } })),
    };
    const lengths = s.rallies.filter((r) => r.shots !== undefined).map((r) => r.shots!);
    return {
      cards: [
        { label: "Longest run", value: `${names.a} ${st.longest.a}, ${names.b} ${st.longest.b}` },
        { label: "Current run", value: st.current.side ? `${names[st.current.side]} ${st.current.length}` : "n/a" },
        { label: "Longest rally", value: lengths.length ? `${Math.max(...lengths)} touches` : "n/a", hint: lengths.length ? undefined : "Rally length was not recorded" },
      ],
      charts: [
        { key: "sets", title: "Points by set", type: "bar", labels: s.sets.map((_, i) => `Set ${i + 1}`), series: SIDES.map((side) => ({ name: names[side], side, values: s.sets.map((g) => g[side]) })), format: "int" },
        ...progressionCharts(s.rallies, names, "Set"),
      ],
      tables: [eff, runTable],
    } satisfies Analytics;
  },

  validateMatchCompletion(s, _ctx, rules) {
    const need = Math.ceil(rules.bestOf / 2);
    return s.decided ? null : `The match cannot be completed until a side has won ${need} sets`;
  },

  finalizeMatch(s): MatchResult {
    const w = s.decided!;
    return { outcome: "win", winner: w, method: "played", margin: `${s.setsWon[w]}-${s.setsWon[otherSide(w)]}: ${s.sets.map((g) => `${g.a}-${g.b}`).join(", ")}` };
  },

  mirrorScore: (s) => ({ scoreA: s.setsWon.a, scoreB: s.setsWon.b }),

  deriveStats(subject, raw) {
    const d = derive(raw);
    const perMatch = (k: string) => round(ratio(raw[k], raw.matches), 1);
    const avg: StatColumn[] = [
      { key: "killsPerMatch", label: "Kills per match", kind: "derived", format: "dec1" },
      { key: "blocksPerMatch", label: "Blocks per match", kind: "derived", format: "dec1" },
      { key: "digsPerMatch", label: "Digs per match", kind: "derived", format: "dec1" },
    ];
    const columns = subject === "team"
      ? [{ key: "matches", label: "Matches", kind: "raw" as const }, { key: "wins", label: "Wins", kind: "raw" as const }, ...TEAM_EXTRA_RAW, ...RAW_COLUMNS, ...avg, ...DERIVED_COLUMNS, ...TEAM_EXTRA_DERIVED]
      : [{ key: "matches", label: "Matches", kind: "raw" as const }, PLAYER_POINTS_COLUMN, ...RAW_COLUMNS, ...avg, ...DERIVED_COLUMNS];
    return { columns, values: { ...raw, ...d, killsPerMatch: perMatch("kills"), blocksPerMatch: perMatch("blocks"), digsPerMatch: perMatch("digs") } };
  },

  derivedLog: (s) => s.log,

  describeEvent(ev, ctx) {
    const p = ev.payload;
    const who = str(p.player) ? ` by ${playerName(ctx, str(p.player))}` : "";
    const side = isSide(p.side) ? sideName(ctx, p.side) : "";
    switch (ev.type) {
      case "FIRST_SERVE": return `${side} to serve first`;
      case "LINEUP": return `${side} lineup set`;
      case "TIMEOUT": return `Timeout ${side}`;
      case "LIBERO_SET": return `${side} Libero: ${((p.players as string[]) ?? []).map((id) => playerName(ctx, id)).join(", ") || "none"}`;
      case "LIBERO_IN": return `${side}: Libero ${playerName(ctx, str(p.libero))} on for ${playerName(ctx, str(p.for))}`;
      case "LIBERO_OUT": return `${side}: Libero off`;
      case "SANCTION": return `${CARD_NAME[String(p.card)] ?? "Sanction"}: ${side}${who}`;
      case "MATCH_MVP": return str(p.player) ? `Match MVP: ${playerName(ctx, str(p.player))}` : "Match MVP cleared";
      case "PLAYER_POINTS": return `+${String(p.points)} added to ${playerName(ctx, str(p.player))}'s points`;
      case "OFFICIALS": return "Match officials set";
      case "FINAL_SETS": return `Result entered: ${((p.sets as SetScore[]) ?? []).map((x) => `${x.a}-${x.b}`).join(", ")}`;
      case "SUBSTITUTION": return `${side}: ${playerName(ctx, str(p.in))} on for ${playerName(ctx, str(p.out))}`;
      case "TOUCH": return `${side} ${String(p.kind)}${who}${p.quality ? ` (${String(p.quality)})` : ""}`;
      default: {
        const how = typeof p.how === "string" && p.how !== "other" ? ` (${p.how.replace(/_/g, " ")}${who})` : "";
        return `Point ${isSide(p.winner) ? sideName(ctx, p.winner) : ""}${how}`;
      }
    }
  },
};
