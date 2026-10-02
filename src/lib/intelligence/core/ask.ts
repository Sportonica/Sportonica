// Game IQ: answers plain-language questions about one match, for any
// sport, from what the engine already produces (score card, summary,
// stat tables, analytics) plus a small knowledge module per sport:
// its glossary, its rules in words, the names fans use for its
// figures, and why the latest scoring happened.
//
// Nothing is estimated. A figure the tables do not hold is answered as
// not recorded; a question it cannot place gets a list of what it can
// answer. Matching is by keywords, so the same question always gets the
// same answer. (Basketball has its own, richer answerer.)

import type { MatchAnswer, MatchContext, Side, SportIntelligenceEngine, StatRow, StatTable, StatValue } from "./types";
import { formatStat, playerName, sideName } from "./util";

export interface GlossaryEntry { term: string; aliases?: string[]; meaning: string }

/** A rule in words, built from the competition's own settings. */
export interface RuleAnswer { re: RegExp; answer: string }

/** What fans call a figure, and where it lives in the stat tables. */
export interface StatTerm {
  re: RegExp;
  key: string;
  label: string;
  /** only tables whose key or title matches (cricket: batting vs bowling) */
  table?: RegExp;
  /** a lower value is better ("best economy") */
  lowerIsBetter?: boolean;
  format?: "pct" | "dec1" | "dec2" | "time";
}

/** Why the score did (or did not) change, from the latest recorded play. */
export interface Explanation { kind: "score" | "no_score" | "other"; text: string }

export type { GuideSection } from "./types";
import type { GuideSection } from "./types";

export interface SportKnowledge<R = unknown, S = unknown> {
  glossary: GlossaryEntry[];
  rules: (r: R) => RuleAnswer[];
  stats: StatTerm[];
  /** newest last */
  explain?: (s: S, ctx: MatchContext, r: R) => Explanation[];
  /** "How scoring works", in the competition's own terms */
  guide: (r: R) => GuideSection[];
  suggestions: string[];
  /** "What the data says": observations worked out from the match's recorded state */
  insights?: (s: S, ctx: MatchContext, r: R) => string[];
  /** questions the shared answerer cannot place for this sport (null: not handled) */
  custom?: (q: string, s: S, ctx: MatchContext, r: R) => string | null;
}

export const norm = (t: string): string => t.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9%+/'\- ]+/g, " ").replace(/\s+/g, " ").trim();
const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const hasWord = (q: string, w: string): boolean => new RegExp(`(^|[^a-z0-9])${esc(w)}([^a-z0-9]|$)`).test(q);
export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

function findTerm(q: string, glossary: GlossaryEntry[]): GlossaryEntry | null {
  let best: { e: GlossaryEntry; len: number } | null = null;
  for (const e of glossary) for (const name of [e.term, ...(e.aliases ?? [])]) {
    const n = norm(name);
    if (n.length > 1 && hasWord(q, n) && (!best || n.length > best.len)) best = { e, len: n.length };
  }
  return best?.e ?? null;
}

interface Person { id: string; name: string; number: number | null; side: Side }

// the rosters, or for a race with no sides (swimming) the entries in its results
function people(ctx: MatchContext, tables: StatTable[]): Person[] {
  if (!ctx.sides) {
    const seen = new Map<string, Person>();
    for (const t of tables) for (const r of t.rows) if (!seen.has(r.id)) seen.set(r.id, { id: r.id, name: r.name, number: null, side: (r.side ?? "a") as Side });
    return [...seen.values()];
  }
  return (["a", "b"] as Side[]).flatMap((side) => ctx.sides![side].players.map((p) => ({ id: p.id, name: p.name, number: p.number ?? null, side })));
}

function findPeople(q: string, ctx: MatchContext, tables: StatTable[]): Person[] {
  const all = people(ctx, tables);
  const num = /(?:#|number |no\.? ?)(\d{1,3})\b/.exec(q);
  if (num) { const hit = all.filter((p) => p.number === Number(num[1])); if (hit.length) return hit; }
  const full = all.filter((p) => hasWord(q, norm(p.name)));
  if (full.length) { const longest = Math.max(...full.map((p) => p.name.length)); return full.filter((p) => p.name.length === longest); }
  const teamWords = new Set(ctx.sides ? (["a", "b"] as Side[]).flatMap((s) => norm(ctx.sides![s].name).split(" ")) : []);
  return all.filter((p) => norm(p.name).split(" ").some((w) => w.length >= 3 && !teamWords.has(w) && hasWord(q, w)));
}

function findSides(q: string, ctx: MatchContext): Side[] {
  if (!ctx.sides) return [];
  const hits = (["a", "b"] as Side[]).filter((s) => hasWord(q, norm(ctx.sides![s].name)));
  if (hits.length === 2) {
    const [x, y] = hits.map((s) => norm(ctx.sides![s].name));
    if (x.includes(y)) return [hits[0]];
    if (y.includes(x)) return [hits[1]];
  }
  return hits;
}

const show = (v: StatValue, t: StatTerm): string => formatStat(v, t.format ?? (typeof v === "number" && !Number.isInteger(v) ? "dec2" : undefined));

/** "1 aces" -> "1 ace": the first word of a count's label, made singular for one. */
function unit(v: StatValue, t: StatTerm): string {
  if (v !== 1 || t.format) return t.label;
  // the first plural word: "shots on target", "smash winners", "yellow cards", "matches"
  const words = t.label.split(" ");
  const i = words.findIndex((w) => /^[a-z]+[^s]s$/.test(w));
  if (i < 0) return t.label;
  words[i] = /(ch|sh|x)es$/.test(words[i]) ? words[i].slice(0, -2) : words[i].slice(0, -1);
  return words.join(" ");
}
const figure = (v: StatValue, t: StatTerm): string => `${show(v, t)} ${unit(v, t)}`;

// digits only, to spot a summary line that repeats the brief ("3.0 ov" / "3.0 overs")
const digits = (t: string): string => t.replace(/\D/g, "");

/** Every (table, row) holding this figure for these row ids. */
function cells(tables: StatTable[], term: StatTerm, ids?: Set<string>): { table: StatTable; row: StatRow; v: StatValue }[] {
  const out: { table: StatTable; row: StatRow; v: StatValue }[] = [];
  for (const t of tables) {
    if (term.table && !term.table.test(`${t.key} ${t.title}`)) continue;
    if (!t.columns.some((c) => c.key === term.key)) continue;
    for (const row of t.rows) if ((!ids || ids.has(row.id)) && term.key in row.values) out.push({ table: t, row, v: row.values[term.key] });
  }
  return out;
}

const SCORE_Q = /\bscore\b|who is (winning|leading|ahead)|who'?s (winning|leading|ahead)|\bleading\b|\bwinning\b|\bresult\b|\bstatus\b|how is the (game|match)|who won/;

export function askMatch<R, S>(
  engine: SportIntelligenceEngine<R, S>, s: S, ctx: MatchContext, r: R, question: string, k: SportKnowledge<R, S>,
): MatchAnswer {
  const q = norm(question);
  const unknown = (): MatchAnswer => ({ kind: "unknown", answer: `I can only answer from this match's recorded data and its rules. Try: ${k.suggestions.map((x) => `"${x}"`).join(", ")}.` });
  if (!q) return unknown();
  const data = (answer: string): MatchAnswer => ({ kind: "data", answer });

  // questions only this sport can place (a race's winner, a disqualification)
  const custom = k.custom?.(q, s, ctx, r);
  if (custom) return data(custom);

  // why the score changed, from the latest recorded play
  if (/\bwhy\b/.test(q) && k.explain) {
    const recent = k.explain(s, ctx, r);
    const latest = (kinds: Explanation["kind"][]) => [...recent].reverse().find((e) => kinds.includes(e.kind));
    if (/(not count|didn'?t|did not|no point|no run|unchanged|not change|side out)/.test(q)) {
      const e = latest(["no_score"]);
      if (e) return data(e.text);
    }
    const e = latest(["score", "no_score", "other"]);
    return data(e ? e.text : "Nothing has been scored yet.");
  }

  const term = findTerm(q, k.glossary);
  const asksMeaning = /^(what is|what's|whats|what are|what does|what do|define|explain|meaning of|tell me about)\b/.test(q);
  // "what is a free hit", "what does deuce mean": a definition, whatever the match holds
  const definitional = /^(what is|what's|whats|what are) (a|an)\b|^what does .* mean|^define\b|^meaning of\b/.test(q) || (!!term && q === norm(term.term));
  const stats = engine.calculateStatistics(s, ctx, r);
  const sides = findSides(q, ctx);
  const persons = findPeople(q, ctx, stats.players);
  const stat = k.stats.find((t) => t.re.test(q)) ?? null;
  const aboutMatch = persons.length > 0 || sides.length > 0 || /\bwho\b|\bhow many\b/.test(q);
  const glossary = (): MatchAnswer => ({ kind: "glossary", answer: `${term!.term}: ${term!.meaning}` });

  if (term && definitional && !aboutMatch) return glossary();
  // the competition's rules, in its own numbers (a question naming a player or team is about the match)
  if (!persons.length && !sides.length) for (const rule of k.rules(r)) if (rule.re.test(q)) return { kind: "glossary", answer: rule.answer };
  // "what is the possession" asks for this match's figure, not a definition
  if (term && asksMeaning && !stat && !aboutMatch) return glossary();
  const nameOf = (row: StatRow): string => people(ctx, stats.players).find((x) => x.id === row.id)?.name ?? row.name;

  // one player
  if (persons.length > 1 && !/most|top|best|leader|highest/.test(q)) return data(`Which player? ${persons.map((p) => p.name).join(", ")} all match.`);
  if (persons.length === 1) {
    const p = persons[0];
    if (stat) {
      const hits = cells(stats.players, stat, new Set([p.id]));
      if (!hits.length) return data(`${p.name} has no ${stat.label} recorded in this match.`);
      if (hits.length === 1) return data(hits[0].v === null ? `${p.name}'s ${stat.label} is not available from the recorded data.` : `${p.name}: ${figure(hits[0].v, stat)}.`);
      return data(`${p.name}: ${hits.map((h) => `${figure(h.v, stat)} (${h.table.title})`).join("; ")}.`);
    }
    const lines = stats.players.flatMap((t) => t.rows.filter((row) => row.id === p.id).map((row) =>
      `${t.title}: ${t.columns.slice(0, 8).filter((c) => row.values[c.key] !== undefined && row.values[c.key] !== null).map((c) => `${c.label} ${formatStat(row.values[c.key], c.format)}`).join(", ")}`));
    return data(lines.length ? `${p.name}. ${lines.join(". ")}.` : `Nothing is recorded for ${p.name} yet.`);
  }

  // leaders
  if (stat && /\bmost\b|\btop\b|\bbest\b|leader|leading|highest|lowest|fewest/.test(q)) {
    const wantLow = stat.lowerIsBetter ? !/most|highest/.test(q) : /lowest|fewest/.test(q);
    const inScope = (h: { v: StatValue; row: StatRow }) => typeof h.v === "number" && (!sides.length || sides.includes(h.row.side as Side));
    let pool = cells(stats.players, stat).filter(inScope);
    // recorded for the team, not a named player: rank the teams instead
    if (!pool.some((h) => (h.v as number) !== 0)) pool = cells(stats.teams, stat).filter(inScope);
    if (!pool.length) return data(`No ${stat.label} recorded yet.`);
    const best = wantLow ? Math.min(...pool.map((h) => h.v as number)) : Math.max(...pool.map((h) => h.v as number));
    if (!wantLow && best <= 0) return data(`Nobody has any ${stat.label} yet.`);
    const top = [...new Set(pool.filter((h) => h.v === best).map((h) => nameOf(h.row)))];
    return data(`${top.join(" and ")} ${top.length === 1 ? "leads" : "lead"} with ${figure(best, stat)}.`);
  }

  // a team's figure, or both teams'
  if (stat && !SCORE_Q.test(q)) {
    const wanted = sides.length ? sides : (["a", "b"] as Side[]);
    const hits = cells(stats.teams, stat).filter((h) => h.row.side && wanted.includes(h.row.side));
    if (hits.length) return data(`${hits.map((h) => (h.v === null ? `${h.row.name}: ${stat.label} not recorded` : `${h.row.name}: ${figure(h.v, stat)}`)).join("; ")}.`);
    // no team table holds it: add the players' figures up, where they are counts
    const sums = wanted.map((side) => {
      const own = cells(stats.players, stat).filter((h) => h.row.side === side && typeof h.v === "number");
      const total = own.reduce((t, h) => t + (h.v as number), 0);
      return own.length ? `${sideName(ctx, side)}: ${figure(total, stat)}` : null;
    }).filter(Boolean);
    if (sums.length && !stat.format) return data(`${sums.join("; ")}.`);
    return data(`No ${stat.label} recorded for ${wanted.map((x) => sideName(ctx, x)).join(" or ")}.`);
  }

  // the score
  if (SCORE_Q.test(q) || (term === null && /how many (points|runs|games|sets)/.test(q))) {
    const v = engine.getCurrentState(s, ctx, r);
    const lines = engine.getMatchSummary(s, ctx, r);
    if (v.kind === "versus" && v.score && ctx.sides) {
      const by = v.periods && v.periods.length > 1 && !v.brief ? ` ${v.periods.map((p) => `${p.label} ${p.a}-${p.b}`).join(", ")}.` : "";
      const sc = (x: string) => x.trim() || "no score yet";
      // summary lines that only repeat the period or the brief are left out
      const more = lines.slice(1).filter((l) => l !== v.periodLabel && !(v.brief && (v.brief.includes(l) || l.includes(v.brief) || (digits(l) !== "" && digits(l) === digits(v.brief)))));
      return data(`${ctx.sides.a.name} ${sc(v.score.a)}, ${ctx.sides.b.name} ${sc(v.score.b)} (${v.periodLabel}).${v.brief ? ` ${v.brief}.` : ""}${by}${more.length ? ` ${more.join(". ")}.` : ""}`.replace(/\.\./g, "."));
    }
    return data(lines.join(". "));
  }

  if (term) return { kind: "glossary", answer: `${term.term}: ${term.meaning}` };
  return unknown();
}

/** The latest log lines as explanations: the fallback "why" for any sport. */
export function logExplanations(log: { seq: number; text: string }[], n = 10): Explanation[] {
  return log.slice(-n).map((l) => ({ kind: "other" as const, text: l.text }));
}

export const who = (ctx: MatchContext, side: Side, player?: string | null): string => (player ? playerName(ctx, player) : sideName(ctx, side));
