// Basketball knowledge: a glossary of the game's terms in plain language,
// and a question answerer over one game's recorded figures.
//
// The answerer only reads GameFacts, which the engine builds from the
// event log. It never estimates: a figure the data cannot support is
// answered as "not available" with the reason, and a question it does
// not understand is answered with what it can be asked. Matching is by
// keywords, not a language model, so answers are predictable and cheap.

import type { MatchAnswer, Side, StatValue } from "../../core/types";
import { foulKindName, type BasketballRules } from "./rules";

export interface TeamFacts {
  side: Side;
  name: string;
  score: number;
  byPeriod: number[];
  values: Record<string, StatValue>;
  timeoutsLeft: number;
  teamFouls: number;
  bonus: "bonus" | "double" | null;
}

export interface PlayerFacts {
  id: string;
  name: string;
  number: number | null;
  side: Side;
  values: Record<string, StatValue>;
  onCourt: boolean;
}

export interface GameFacts {
  teams: TeamFacts[];
  players: PlayerFacts[];
  periodNames: string[];
  period: number;
  periodOpen: boolean;
  clock: number | null;
  periodLabel: string;
  overtime: boolean;
  regulationPeriods: number;
  leadChanges: number;
  timesTied: number;
  largestLead: Record<Side, number>;
  runs: { side: Side; points: number; period: string }[];
  possessionsTracked: boolean;
  possessions: Record<Side, number>;
  ball: Side | null;
  foulLimit: number;
  trackShotAttempts: boolean;
  plusMinusValid: boolean;
  rules: BasketballRules;
  /** why recent things happened, newest last */
  recent: { kind: string; side: Side | null; points: number; text: string }[];
  /** the free throw due now, if any */
  freeThrowDue: string | null;
}

// ── the competition's rules, in plain words ─────────────────────────

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function ruleAnswer(q: string, f: GameFacts): string | null {
  const r = f.rules;
  const reg = r.periods === 4 ? "the fourth quarter" : r.periods === 2 ? "the second half" : `period ${r.periods}`;
  const unit = r.periods === 2 ? "half" : r.periods === 4 ? "quarter" : "period";
  const worth = /how many points|worth|value of/.test(q);
  if (worth && /\b(free throw|foul shot|ft)\b/.test(q)) return `A made free throw is worth ${plural(r.freeThrowValue, "point")}. A missed one adds nothing.`;
  if (worth && /(three|3)[ -]?(pointer|point|pt)|\bthrees?\b|from (beyond|behind) the arc/.test(q)) return `A field goal from beyond the three-point line is worth ${plural(r.threePointValue, "point")}.`;
  if (worth && /(two|2)[ -]?(pointer|point|pt)|layup|dunk|field goal|basket|inside the arc/.test(q)) return `A field goal inside the three-point line is worth ${plural(r.twoPointValue, "point")}; from beyond it, ${r.threePointValue}.`;
  if (/(miss|missed)/.test(q) && /(change|count|score|add|points?)/.test(q) && /(free throw|shot|basket|ft)/.test(q)) {
    return "No. A missed shot or free throw adds nothing. Only a made field goal, a made free throw, or a basket awarded for goaltending changes the score.";
  }
  if (/(what happens|what if|when).*(tie|tied|level|draw)|when does overtime|overtime (start|begin)|how does overtime/.test(q)) {
    if (r.allowTie) return `This competition allows a tie: a game level at the end of ${reg} ends level, with no overtime.`;
    return `If the score is level at the end of ${reg}, a ${r.overtimeMinutes}-minute overtime is played, and another after it while the score is still level. There is no limit on overtimes.`;
  }
  if ((/how many fouls/.test(q) && /(can|before|take|until|allowed|limit|foul out|fouls out)/.test(q)) || (/foul(ed|s)? out/.test(q) && /(when|how many)/.test(q))) {
    if (/team/.test(q)) return null;
    const ejections = [r.technicalEjectAt && plural(r.technicalEjectAt, "technical foul"), r.unsportsmanlikeEjectAt && plural(r.unsportsmanlikeEjectAt, `${foulKindName("unsportsmanlike", r)} foul`)].filter(Boolean).join(" or ");
    return `A player fouls out on their ${r.foulLimit}th foul${r.technicalsCountTowardFoulLimit ? ", technical fouls included" : " (technical fouls do not count toward it)"}. ${ejections ? `${ejections[0].toUpperCase()}${ejections.slice(1)} also eject a player.` : ""}`.trim();
  }
  if (/(bonus|penalty)/.test(q) && /(what|how|explain|when)/.test(q) && !/\bwho\b|\bin the bonus\b.*\?$|are .* in/.test(q)) {
    const window = r.teamFoulWindow === "half" ? "half" : unit;
    const ot = r.overtimeTeamFouls === "reset" ? ` In overtime the count starts again${r.bonusAfterFoulsOvertime !== null ? ` and the penalty comes after ${r.bonusAfterFoulsOvertime}` : ""}.` : " Overtime continues the last count.";
    return `Team fouls are counted per ${window}. Once a team has ${plural(r.bonusAfterFouls, "team foul")}, every further common foul gives the other team ${plural(r.bonusFreeThrows, "free throw")}${r.oneAndOne ? " as a one-and-one (the second only if the first goes in)" : ""}.${r.doubleBonusAfterFouls !== null ? ` From the ${r.doubleBonusAfterFouls + 1}th foul it is two shots (double bonus).` : ""}${r.offensiveFoulsAreTeamFouls ? "" : " Offensive fouls do not count."}${ot}`;
  }
  if (/technical/.test(q) && /(what happens|after|consequence|penalty|result)/.test(q)) {
    return `The other team gets ${plural(r.technicalFreeThrows, "free throw")}, taken straight away by any of its players, and play resumes with the team that had the ball.${r.technicalEjectAt !== null ? ` A player with ${plural(r.technicalEjectAt, "technical foul")} is ejected.` : ""}${r.technicalsCountTowardFoulLimit ? " A player's technical also counts toward fouling out." : ""}`;
  }
  if (/shot clock/.test(q) && /(how long|how many seconds|what is|reset)/.test(q)) {
    if (r.shotClockSeconds === null) return "This competition plays without a shot clock.";
    return `A team has ${r.shotClockSeconds} seconds to get a shot to the rim.${r.shotClockReset !== null ? ` After an offensive rebound, a kicked ball or a defensive foul it goes back up to ${r.shotClockReset} if it was lower.` : ""} It is switched off when less game time is left than shot clock.`;
  }
  if (/how long/.test(q) && /(quarter|period|half|game|overtime)/.test(q)) {
    return `${r.periods} ${unit}s of ${r.periodMinutes} minutes, and ${r.overtimeMinutes}-minute overtimes when the score is level.`;
  }
  if (/how many players/.test(q)) return `${r.playersOnCourt} per team on court, and up to ${r.gameRosterSize} dressed for a game (${r.gameRosterSize - r.playersOnCourt} substitutes on the bench).`;
  if (/how many timeouts/.test(q) && !/left|remaining|still/.test(q)) {
    return r.timeoutsPerGame !== null
      ? `${plural(r.timeoutsPerGame, "timeout")} per team for the game, and ${r.timeoutsPerOvertime} in each overtime.`
      : `${r.timeoutsFirstHalf} in the first half and ${r.timeoutsSecondHalf} in the second, per team, and ${r.timeoutsPerOvertime} in each overtime.`;
  }
  return null;
}

// ── why something happened, from the recorded events ───────────────

function whyAnswer(q: string, f: GameFacts): string | null {
  if (!/\bwhy\b/.test(q)) return null;
  const latest = (pred: (e: GameFacts["recent"][number]) => boolean) => [...f.recent].reverse().find(pred);
  if (/(not count|didn'?t count|did not count|no points|disallowed|rejected|unchanged|(score|it) (not|didn'?t|did not) (change|go up|increase))/.test(q)) {
    const e = latest((x) => x.kind === "no_score" || x.kind === "violation");
    return `${e ? `${e.text} ` : ""}A basket the rules do not allow is never recorded: the scorer is told why at the moment it is refused.`;
  }
  if (/(score|points?)/.test(q) && /(increase|go up|went up|change|jump|add|rise)/.test(q)) {
    const by = /by (\d+)|\+(\d+)/.exec(q);
    const n = by ? Number(by[1] ?? by[2]) : null;
    const e = latest((x) => x.kind === "score" && (n === null || x.points === n));
    return e ? e.text : n !== null ? `No recent score change of +${n} is recorded.` : "No score change has been recorded yet.";
  }
  if (/(possession|ball)/.test(q) && /(change|get|got|have|has|switch|go|went|lose|lost)/.test(q)) {
    const e = latest((x) => x.kind === "possession" || x.kind === "violation");
    return e ? e.text : "No change of possession has been recorded yet.";
  }
  if (/free throw/.test(q)) {
    const e = latest((x) => x.kind === "foul" && /free throw/.test(x.text) && !/^.*no free throws/i.test(x.text));
    return e ? e.text : null;
  }
  return null;
}

// ── glossary ────────────────────────────────────────────────────────

export const GLOSSARY: { term: string; aliases: string[]; meaning: string }[] = [
  { term: "Assist", aliases: ["assists", "dime"], meaning: "A pass that leads directly to a team mate's basket." },
  { term: "Alley-oop", aliases: ["alley oop", "lob"], meaning: "A pass thrown near the rim that a team mate catches in the air and scores before landing, usually with a dunk or layup." },
  { term: "And-one", aliases: ["and one", "and 1", "three point play"], meaning: "A player is fouled while scoring. The basket counts and they get one extra free throw." },
  { term: "Backcourt violation", aliases: ["backcourt", "over and back"], meaning: "Once the offence brings the ball over the half-way line, it may not take it back into its own half. Doing so gives the ball to the other team." },
  { term: "Ball handler", aliases: ["handler"], meaning: "The player dribbling or holding the ball, usually setting up the offence." },
  { term: "Bonus", aliases: ["penalty", "double bonus", "team foul penalty"], meaning: "After a team commits a set number of fouls in a period (or half), every further common foul gives the other team free throws. The number depends on the competition's rules." },
  { term: "Box-out", aliases: ["box out", "blocking out"], meaning: "Putting your body between an opponent and the basket after a shot so you can get the rebound." },
  { term: "Carrying", aliases: ["carry", "palming"], meaning: "A dribbling violation: the hand goes under the ball and holds it while dribbling. The ball goes to the other team." },
  { term: "Charge", aliases: ["charging", "offensive foul"], meaning: "An offensive foul: the player with the ball runs into a defender who had already set their position. It is also a turnover." },
  { term: "Closeout", aliases: ["close out"], meaning: "A defender sprinting to a shooter who has just caught the ball, to contest the shot without fouling." },
  { term: "Corner three", aliases: ["corner 3"], meaning: "A three-point shot from the corner, where the line is closest to the basket." },
  { term: "Cut", aliases: ["cutting", "backdoor cut", "backdoor"], meaning: "A quick move by a player without the ball toward the basket or an open space to receive a pass." },
  { term: "Double-double", aliases: ["double double"], meaning: "Ten or more in two of these in one game: points, rebounds, assists, steals, blocks." },
  { term: "Dribble", aliases: ["dribbling"], meaning: "Bouncing the ball with one hand while moving. It is how a player moves with the ball without travelling." },
  { term: "Dagger", aliases: [], meaning: "A late basket that effectively decides the game." },
  { term: "Fast break", aliases: ["fastbreak", "transition", "transition offense"], meaning: "Pushing the ball up the court quickly after gaining it, to score before the defence is set." },
  { term: "Flagrant foul", aliases: ["flagrant", "unsportsmanlike foul", "unsportsmanlike"], meaning: "A foul with excessive or unnecessary contact. It gives free throws and the ball, and repeated or serious ones eject the player. FIBA calls it unsportsmanlike." },
  { term: "Free throw", aliases: ["free throws", "foul shot", "ft"], meaning: "An uncontested shot from the free throw line after a foul, worth one point." },
  { term: "Goaltending", aliases: ["goal tending"], meaning: "Touching a shot on its way down toward the basket, or while it is on the rim. The basket is awarded." },
  { term: "Isolation", aliases: ["iso"], meaning: "The offence clears space so one player can take on a single defender." },
  { term: "Jump ball", aliases: ["tip-off", "tip off", "held ball"], meaning: "The referee throws the ball up between two players to start the game or settle who gets it. FIBA uses an alternating-possession arrow after the opening jump." },
  { term: "Pick and roll", aliases: ["pick-and-roll", "screen and roll", "pnr"], meaning: "A team mate sets a screen for the ball handler, then rolls toward the basket for a pass." },
  { term: "Pick and pop", aliases: ["pick-and-pop"], meaning: "Like a pick and roll, but the screener moves away to an open spot for a jump shot instead of rolling to the basket." },
  { term: "Post-up", aliases: ["post up", "posting up"], meaning: "A player sets up close to the basket with their back to the defender to receive the ball." },
  { term: "Shot clock", aliases: ["shot-clock", "24 second clock", "30 second clock"], meaning: "The time a team has to attempt a shot that hits the rim (24 seconds in FIBA and the NBA, 30 in NCAA)." },
  { term: "Steal", aliases: ["steals"], meaning: "A defender takes the ball from an opponent or intercepts a pass. It is also the opponent's turnover." },
  { term: "Technical foul", aliases: ["technical", "tech", "t"], meaning: "A foul for unsporting behaviour rather than contact, such as arguing with officials. It gives the other team a free throw." },
  { term: "Three-and-D", aliases: ["three and d", "3 and d"], meaning: "A player valued for three-point shooting and strong defence." },
  { term: "Traveling", aliases: ["travelling", "travel", "walking"], meaning: "Moving the feet illegally while holding the ball, for example taking too many steps. The ball goes to the other team." },
  { term: "Triple-double", aliases: ["triple double"], meaning: "Ten or more in three of these in one game: points, rebounds, assists, steals, blocks." },
  { term: "Turnover", aliases: ["turnovers", "tov"], meaning: "Losing the ball to the other team without taking a shot: a bad pass, a steal, travelling, an offensive foul." },
  { term: "Zone defense", aliases: ["zone defence", "zone", "2-3 zone"], meaning: "Each defender guards an area of the court rather than one opponent." },
  { term: "Man-to-man", aliases: ["man to man", "man defense", "man defence"], meaning: "Each defender is responsible for guarding one opponent." },
  { term: "Possession", aliases: ["possessions"], meaning: "One spell of a team having the ball. It ends with a score, a turnover, a defensive rebound or the end of a period. An offensive rebound continues the same possession." },
  { term: "Offensive rating", aliases: ["ortg", "off rating"], meaning: "Points scored per 100 possessions. Defensive rating is points allowed per 100 possessions; net rating is the difference." },
  { term: "Pace", aliases: [], meaning: "How many possessions a team has in a full regulation game. Higher means a faster game." },
  { term: "True shooting", aliases: ["ts%", "true shooting percentage"], meaning: "Scoring efficiency that counts threes and free throws: points divided by twice the shooting attempts (field goals plus 0.44 times free throws)." },
  { term: "Effective field goal percentage", aliases: ["efg", "efg%"], meaning: "Field goal percentage that gives a three 1.5 times the weight of a two, because it is worth more." },
  { term: "Plus/minus", aliases: ["plus minus", "+/-"], meaning: "The score difference while a player was on the court." },
  { term: "Clutch", aliases: ["clutch time"], meaning: "The end of a close game. Here: the last few minutes of the final period or overtime with the margin within a few points, as set in the competition rules." },
  { term: "Hedge", aliases: [], meaning: "A screen defender steps out toward the ball handler briefly to slow them, then recovers." },
  { term: "Drop coverage", aliases: ["drop"], meaning: "Against a pick and roll, the screener's defender drops back toward the basket instead of stepping up." },
  { term: "Trap", aliases: ["double team", "blitz"], meaning: "Two defenders guard the ball handler at once to force a bad pass or turnover." },
  { term: "Full-court press", aliases: ["press", "full court press"], meaning: "Defending the whole length of the court, pressuring the ball from the inbound." },
  { term: "Drive and kick", aliases: ["drive-and-kick"], meaning: "A player drives toward the basket to draw defenders, then passes out to an open shooter." },
];

const norm = (t: string): string => t.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9%+/'\- ]+/g, " ").replace(/\s+/g, " ").trim();
const has = (q: string, word: string): boolean => new RegExp(`(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(q);

function findTerm(q: string) {
  let best: { entry: (typeof GLOSSARY)[number]; len: number } | null = null;
  for (const entry of GLOSSARY) {
    for (const name of [entry.term, ...entry.aliases]) {
      const n = norm(name);
      if (n.length > 1 && has(q, n) && (!best || n.length > best.len)) best = { entry, len: n.length };
    }
  }
  return best?.entry ?? null;
}

// ── facts lookup ────────────────────────────────────────────────────

interface StatSpec { key: string; re: RegExp; label: string; pct?: boolean }

// most specific first
const STATS: StatSpec[] = [
  { key: "oreb", re: /offensive rebounds?|\boreb/, label: "offensive rebounds" },
  { key: "dreb", re: /defensive rebounds?|\bdreb/, label: "defensive rebounds" },
  { key: "tpPct", re: /(three|3)[ -]?(point|pt)?\w* (shooting )?(percentage|%|percent)|3p%/, label: "three point percentage", pct: true },
  { key: "ftPct", re: /free throw (shooting )?(percentage|%|percent)|ft%/, label: "free throw percentage", pct: true },
  { key: "fgPct", re: /(field goal|shooting) (percentage|%|percent)|fg%|shooting/, label: "field goal percentage", pct: true },
  { key: "tpm", re: /three[ -]?pointers?|threes|\b3[ -]?pointers?|\b3s\b|\b3pm\b|three point(er)?s? made/, label: "three pointers made" },
  { key: "ftm", re: /free throws?/, label: "free throws made" },
  { key: "reb", re: /rebounds?|boards|\breb\b/, label: "rebounds" },
  { key: "ast", re: /assists?|\bast\b/, label: "assists" },
  { key: "stl", re: /steals?|\bstl\b/, label: "steals" },
  { key: "blk", re: /blocks?|blocked|\bblk\b/, label: "blocks" },
  { key: "tov", re: /turnovers?|\btov\b|\bto\b/, label: "turnovers" },
  { key: "pf", re: /fouls?|\bpf\b/, label: "fouls" },
  { key: "plusMinus", re: /plus[ /-]?minus|\+\/-/, label: "plus/minus" },
  { key: "min", re: /minutes?|\bmin\b/, label: "minutes" },
  { key: "eff", re: /efficiency|\beff\b/, label: "efficiency" },
  { key: "paintPts", re: /paint/, label: "points in the paint" },
  { key: "secondChancePts", re: /second[ -]chance/, label: "second chance points" },
  { key: "ptsOffTov", re: /off (of )?turnovers/, label: "points off turnovers" },
  { key: "fastBreakPts", re: /fast[ -]?break/, label: "fast break points" },
  { key: "benchPts", re: /bench/, label: "bench points" },
  { key: "pts", re: /points?|scored?|scoring|\bpts\b/, label: "points" },
];

const statOf = (q: string): StatSpec | null => STATS.find((s) => s.re.test(q)) ?? null;

const fmt = (v: StatValue, pctLike?: boolean): string => (v === null || v === undefined ? "n/a" : typeof v === "number" ? (pctLike ? `${v.toFixed(1)}%` : Number.isInteger(v) ? String(v) : v.toFixed(1)) : v);

function unavailable(key: string, f: GameFacts): string {
  if (["fgPct", "tpPct", "ftPct", "eff", "secondChancePts", "ptsOffTov"].includes(key) && !f.trackShotAttempts) return "is not available: missed shots are not being recorded in this game";
  if (key === "min") return "is not available: it needs both lineups and a clock on every substitution";
  if (key === "plusMinus") return "is not available: it needs both lineups set before the first basket";
  if (key === "benchPts") return "is not available: the starting lineup was not recorded";
  if (key.endsWith("Pct")) return "is not available: there are no attempts yet";
  return "is not available from the recorded events";
}

function findTeams(q: string, f: GameFacts): TeamFacts[] {
  const hits = f.teams.filter((t) => has(q, norm(t.name)));
  // the longer name wins when one contains the other ("Kings" and "Kings B")
  if (hits.length === 2 && norm(hits[0].name).includes(norm(hits[1].name))) return [hits[0]];
  if (hits.length === 2 && norm(hits[1].name).includes(norm(hits[0].name))) return [hits[1]];
  return hits;
}

function findPlayers(q: string, f: GameFacts): PlayerFacts[] {
  const num = /(?:#|number |no\.? ?)(\d{1,3})\b/.exec(q);
  if (num) {
    const byNum = f.players.filter((p) => p.number === Number(num[1]));
    if (byNum.length) return byNum;
  }
  const full = f.players.filter((p) => has(q, norm(p.name)));
  if (full.length) {
    const longest = Math.max(...full.map((p) => p.name.length));
    return full.filter((p) => p.name.length === longest);
  }
  // a single distinctive word of a name ("how many points has Sharma scored")
  const teamWords = new Set(f.teams.flatMap((t) => norm(t.name).split(" ")));
  return f.players.filter((p) => norm(p.name).split(" ").some((w) => w.length >= 3 && !teamWords.has(w) && has(q, w)));
}

function findPeriod(q: string, f: GameFacts): number | null {
  const ordinals: Record<string, number> = { first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4 };
  const m = /\b(q|p|h)([1-9])\b/.exec(q) ?? /\b(?:quarter|period|half) ([1-9])\b/.exec(q);
  if (m) return Number(m[m.length - 1]);
  for (const [w, n] of Object.entries(ordinals)) if (new RegExp(`\\b${w} (quarter|period|half)\\b`).test(q)) return n;
  const ot = /\b(?:ot|overtime)\s*([1-9])?\b/.exec(q);
  if (ot) return f.regulationPeriods + Number(ot[1] ?? 1);
  return null;
}

const leaderOf = (f: GameFacts): TeamFacts | null => (f.teams[0].score === f.teams[1].score ? null : f.teams[0].score > f.teams[1].score ? f.teams[0] : f.teams[1]);
const other = (f: GameFacts, t: TeamFacts): TeamFacts => f.teams.find((x) => x.side !== t.side)!;
const num = (v: StatValue): number => (typeof v === "number" ? v : 0);

function playerLine(p: PlayerFacts): string {
  const v = p.values;
  const parts = [`${fmt(v.pts)} points`, `${fmt(v.reb)} rebounds`, `${fmt(v.ast)} assists`];
  if (num(v.stl)) parts.push(`${v.stl} steals`);
  if (num(v.blk)) parts.push(`${v.blk} blocks`);
  return `${p.name} has ${parts.join(", ")} (FG ${v.fg}, 3P ${v.tp}, FT ${v.ft}${num(v.pf) ? `, ${v.pf} fouls` : ""}).`;
}

function explainLead(f: GameFacts): string {
  const lead = leaderOf(f);
  if (!lead) return `The game is level at ${f.teams[0].score}.`;
  const opp = other(f, lead);
  const diff = (k: string) => num(lead.values[k]) - num(opp.values[k]);
  const reasons: { text: string; weight: number }[] = [];
  const add = (weight: number, text: string) => { if (weight > 0) reasons.push({ text, weight }); };
  add(diff("tpm") * 3, `${diff("tpm")} more three pointers made (${diff("tpm") * 3} points)`);
  add(diff("ftm"), `${diff("ftm")} more free throws made`);
  add(diff("paintPts"), `${diff("paintPts")} more points in the paint`);
  if (f.possessionsTracked) {
    add(diff("secondChancePts"), `${diff("secondChancePts")} more second chance points`);
    add(diff("ptsOffTov"), `${diff("ptsOffTov")} more points off turnovers`);
  }
  add(diff("fastBreakPts"), `${diff("fastBreakPts")} more fast break points`);
  add(-diff("tov"), `${-diff("tov")} fewer turnovers`);
  add(diff("reb"), `${diff("reb")} more rebounds`);
  const run = f.runs.filter((r) => r.side === lead.side).sort((x, y) => y.points - x.points)[0];
  if (run && run.points >= 6) reasons.push({ text: `a ${run.points}-0 run in ${run.period}`, weight: run.points });
  const top = reasons.sort((x, y) => y.weight - x.weight).slice(0, 3).map((r) => r.text);
  const margin = lead.score - opp.score;
  return top.length
    ? `${lead.name} lead by ${margin}. Compared with ${opp.name} they have ${top.join("; ")}.`
    : `${lead.name} lead by ${margin}; no single recorded category stands out.`;
}

const SUGGESTIONS = "Try: \"What is the score?\", \"Who has the most rebounds?\", \"How many points has <player> scored?\", \"How many threes has <team> made?\", \"What was the biggest run?\", \"What caused the lead?\", \"What is a pick and roll?\"";

export function answerBasketballQuestion(question: string, f: GameFacts): MatchAnswer {
  const q = norm(question);
  if (!q) return { kind: "unknown", answer: SUGGESTIONS };
  const data = (answer: string): MatchAnswer => ({ kind: "data", answer });

  const why = whyAnswer(q, f);
  if (why) return data(why);
  const rule = ruleAnswer(q, f);
  if (rule) return { kind: "glossary", answer: rule };
  if (/free throws?/.test(q) && /(who|how many).*(shoot|shooting|taking|left|to take|due)/.test(q)) {
    return data(f.freeThrowDue ? `Next: ${f.freeThrowDue}.` : "No free throws are due.");
  }

  // glossary: "what is a charge", "explain zone defence"
  const term = findTerm(q);
  const asksMeaning = /^(what is|what's|whats|what are|what does|what do|define|explain|meaning of|tell me about)\b/.test(q) || q === norm(term?.term ?? "#");
  if (term && asksMeaning && !/\bwho\b|\bhow many\b|\bthis game\b|\bin the game\b/.test(q) && !findPlayers(q, f).length && !findTeams(q, f).length) {
    return { kind: "glossary", answer: `${term.term}: ${term.meaning}` };
  }

  const started = f.period > 0;
  const [A, B] = f.teams;
  const teams = findTeams(q, f);
  const players = findPlayers(q, f);
  const stat = statOf(q);

  // the game state
  if (/overtime|\bot\b/.test(q) && /^(is|are|did|has|have|will|was|does)\b/.test(q) && !/points|score/.test(q)) {
    if (!started) return data("The game has not started.");
    return data(f.overtime ? `Yes, the game is in ${f.periodNames[f.period - 1]} (${f.periodLabel}).` : `No. ${f.periodLabel}.`);
  }
  if (/who (has|have) the ball|possession arrow|who has possession|whose (ball|possession)/.test(q)) {
    return data(f.ball ? `${f.teams.find((t) => t.side === f.ball)!.name} have the ball.` : "The recorded events do not show who has the ball right now.");
  }
  if (/possessions?/.test(q) && /how many|number of|count/.test(q)) {
    if (!f.possessionsTracked) return data("Possessions are not available: missed shots are not being recorded, so possessions cannot be counted from the play-by-play.");
    return data(`${A.name} have had ${f.possessions.a} possessions, ${B.name} ${f.possessions.b}. ${A.name} score ${fmt(A.values.ppp)} points per possession, ${B.name} ${fmt(B.values.ppp)}.`);
  }
  if (/\brun\b|\bruns\b|unanswered/.test(q)) {
    const best = [...f.runs].sort((x, y) => y.points - x.points)[0];
    if (!best) return data("No points have been scored yet.");
    return data(`The biggest run is ${best.points}-0 by ${f.teams.find((t) => t.side === best.side)!.name} in ${best.period}.`);
  }
  if (/lead chang/.test(q)) return data(`The lead has changed ${f.leadChanges} time${f.leadChanges === 1 ? "" : "s"}; the score has been tied ${f.timesTied} time${f.timesTied === 1 ? "" : "s"}.`);
  if (/(largest|biggest) lead/.test(q)) return data(`Largest lead: ${A.name} ${f.largestLead.a}, ${B.name} ${f.largestLead.b}.`);
  if (/(why|what caused|what has caused|how did|how are|how is|explain).*(lead|winning|ahead|up by)/.test(q)) return data(explainLead(f));
  if (/double[ -]double|triple[ -]double/.test(q)) {
    const need = /triple/.test(q) ? 3 : 2;
    const cats = ["pts", "reb", "ast", "stl", "blk"];
    const list = f.players.filter((p) => cats.filter((k) => num(p.values[k]) >= 10).length >= need);
    return data(list.length ? `${list.map((p) => p.name).join(", ")} ${list.length === 1 ? "has" : "have"} a ${need === 3 ? "triple" : "double"}-double.` : `Nobody has a ${need === 3 ? "triple" : "double"}-double.`);
  }
  if (/timeouts?/.test(q)) {
    const list = teams.length ? teams : f.teams;
    return data(list.map((t) => `${t.name} have ${t.timeoutsLeft} timeout${t.timeoutsLeft === 1 ? "" : "s"} left`).join("; ") + ".");
  }
  if (/bonus|penalty|team fouls/.test(q)) {
    const list = teams.length ? teams : f.teams;
    return data(list.map((t) => `${t.name}: ${t.teamFouls} team foul${t.teamFouls === 1 ? "" : "s"} in this window${other(f, t).bonus ? `, so ${other(f, t).name} ${other(f, t).bonus === "double" ? "are in the double bonus" : "are in the bonus"}` : ""}`).join("; ") + ".");
  }

  // one player
  if (players.length > 1 && !/most|leader|leading|top/.test(q)) return data(`Which player? ${players.map((p) => p.name).join(", ")} all match.`);
  if (players.length === 1) {
    const p = players[0];
    if (!stat || /stats|line|box|doing|game\b/.test(q) && stat.key === "pts" && !/how many points|points/.test(q)) return data(playerLine(p));
    const v = p.values[stat.key];
    if (v === null || v === undefined) return data(`${p.name}'s ${stat.label} ${unavailable(stat.key, f)}.`);
    if (stat.key === "pf") return data(`${p.name} has ${v} foul${v === 1 ? "" : "s"}${num(v) >= f.foulLimit ? " and has fouled out" : num(v) === f.foulLimit - 1 ? ", one from fouling out" : ""}.`);
    if (stat.key === "fgPct") return data(`${p.name} is shooting ${fmt(v, true)} from the field (${p.values.fg}).`);
    if (stat.key === "tpPct") return data(`${p.name} is shooting ${fmt(v, true)} from three (${p.values.tp}).`);
    if (stat.key === "ftPct") return data(`${p.name} is shooting ${fmt(v, true)} on free throws (${p.values.ft}).`);
    return data(`${p.name} has ${fmt(v, stat.pct)} ${stat.label}.`);
  }

  // leaders: "who has the most rebounds", "top scorer"
  if (/\bmost\b|\bleads? in\b|leader|leading scorer|top scorer|best scorer|highest/.test(q) && !/team/.test(q)) {
    const spec = stat ?? STATS.find((s) => s.key === "pts")!;
    const pool = (teams.length ? f.players.filter((p) => teams.some((t) => t.side === p.side)) : f.players)
      .filter((p) => typeof p.values[spec.key] === "number");
    if (!pool.length) return data(`${spec.label[0].toUpperCase()}${spec.label.slice(1)} ${unavailable(spec.key, f)}.`);
    const best = Math.max(...pool.map((p) => num(p.values[spec.key])));
    if (best <= 0 && spec.key !== "plusMinus") return data(`Nobody has recorded any ${spec.label} yet.`);
    const top = pool.filter((p) => num(p.values[spec.key]) === best);
    return data(`${top.map((p) => p.name).join(" and ")} ${top.length === 1 ? "leads" : "lead"} with ${fmt(best, spec.pct)} ${spec.label}.`);
  }

  // a team's figures, or both teams'
  const period = findPeriod(q, f);
  if (period !== null && (stat?.key === "pts" || /score|scored/.test(q))) {
    if (period > f.period) return data(`${f.periodNames[period - 1] ?? "That period"} has not been played.`);
    const list = teams.length ? teams : f.teams;
    return data(`In ${f.periodNames[period - 1]}: ${list.map((t) => `${t.name} ${t.byPeriod[period - 1] ?? 0}`).join(", ")}.`);
  }
  if (stat && stat.key !== "pts" || (stat?.key === "pts" && teams.length)) {
    const spec = stat!;
    const list = teams.length ? teams : f.teams;
    const parts = list.map((t) => {
      const v = spec.key === "min" || spec.key === "plusMinus" || spec.key === "eff" ? null : t.values[spec.key];
      if (v === null || v === undefined) return `${t.name}: ${spec.label} ${unavailable(spec.key, f)}`;
      if (spec.key === "tpm") return `${t.name} have made ${v} three pointers (${t.values.tp})`;
      if (spec.key === "ftm") return `${t.name} have made ${v} free throws (${t.values.ft})`;
      if (spec.key === "fgPct") return `${t.name} are shooting ${fmt(v, true)} from the field (${t.values.fg})`;
      if (spec.key === "pts") return `${t.name} have ${t.score} points`;
      return `${t.name} have ${fmt(v, spec.pct)} ${spec.label}`;
    });
    return data(`${parts.join("; ")}.`);
  }

  // the score
  if (/score|who is (winning|leading|ahead)|who'?s (winning|leading|ahead)|leading|winning|result|status|how is the game/.test(q) || stat?.key === "pts") {
    if (!started) return data(`The game has not started. ${A.name} v ${B.name}.`);
    const lead = leaderOf(f);
    const where = f.periodLabel;
    return data(lead ? `${lead.name} lead ${lead.score}-${other(f, lead).score} (${where}).` : `Level at ${A.score}-${B.score} (${where}).`);
  }

  if (term) return { kind: "glossary", answer: `${term.term}: ${term.meaning}` };
  return { kind: "unknown", answer: `I can only answer from this game's recorded data. ${SUGGESTIONS}` };
}
