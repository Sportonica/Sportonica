// Cricket Game IQ: the Laws in words, from the competition's settings
// (T20, ODI, Test or custom), and why each ball changed the score.

import type { Explanation, SportKnowledge } from "../core/ask";
import { plural } from "../core/ask";
import { sideName } from "../core/util";
import type { CricketRules, CricketState } from "../sports/cricket";

const format = (r: CricketRules) =>
  r.oversPerInnings === null ? `${`${r.inningsPerSide} innings`} per side, no over limit` : `${`${r.inningsPerSide} innings`} of ${plural(r.oversPerInnings, "over")} per side`;
const extrasRule = (r: CricketRules) =>
  `A wide gives ${plural(r.wideRuns, "run")} to the batting side${r.wideRebowled ? " and is bowled again" : ""}. A no-ball gives ${plural(r.noBallRuns, "run")}${r.noBallRebowled ? " and is bowled again" : ""}${r.freeHit ? "; the next ball is a free hit" : ""}. Byes and leg-byes are runs taken without the bat, credited to extras.`;
const winRule = (r: CricketRules) =>
  `The side with more runs wins. Chasing, a side wins as soon as it passes the target, by the wickets it has left; defending, it wins by the runs between the scores.${r.allowDraw ? " If time runs out before a result, the match is drawn." : " Level scores are a tie."}`;

/** "4", "1wd", "2lb", "3nb+W", "W" -> why the total changed (or did not). */
function ballText(code: string, over: string, batting: string): Explanation {
  const wicket = code.endsWith("W");
  const tag = wicket ? code.replace(/\+?W$/, "") : code;
  const m = /^(\d+)(wd|nb|b|lb)?$/.exec(tag);
  const runs = m ? Number(m[1]) : 0;
  const kind = m?.[2];
  const out = wicket ? " A wicket fell." : "";
  if (!tag || (runs === 0 && !kind)) {
    return { kind: "no_score", text: `Ball ${over}: ${wicket ? "a wicket, no run" : "a dot ball, no run"}. ${batting}'s total did not change.` };
  }
  const why = kind === "wd" ? `a wide (${plural(runs, "run")} in extras, not off the bat)`
    : kind === "nb" ? `a no-ball (${plural(runs, "run")} including the no-ball penalty)`
    : kind === "b" ? `${plural(runs, "bye")} (run without touching the bat)`
    : kind === "lb" ? `${plural(runs, "leg-bye")} (off the body)`
    : runs === 4 ? "a four" : runs === 6 ? "a six" : `${plural(runs, "run")} off the bat`;
  return { kind: "score", text: `Ball ${over}: ${batting} added ${runs} from ${why}.${out}` };
}

export const CRICKET_KNOWLEDGE: SportKnowledge<CricketRules, CricketState> = {
  glossary: [
    { term: "Over", aliases: ["overs"], meaning: "A set of legal deliveries (usually six) bowled by one bowler from one end." },
    { term: "Innings", meaning: "A side's turn to bat, ending when it is all out, its overs run out, it declares, or it reaches the target." },
    { term: "Wicket", aliases: ["wickets"], meaning: "A batter being dismissed; also the stumps and bails." },
    { term: "Bowled", meaning: "The ball hits the stumps and dislodges a bail: the batter is out." },
    { term: "Caught", meaning: "A fielder catches the ball off the bat before it bounces: the batter is out." },
    { term: "LBW", aliases: ["leg before wicket", "leg before"], meaning: "Leg before wicket: the ball would have hit the stumps but struck the batter's body first. The batter is out." },
    { term: "Run out", aliases: ["runout"], meaning: "A batter is short of their crease when the stumps at that end are broken with the ball." },
    { term: "Stumped", aliases: ["stumping"], meaning: "The wicketkeeper breaks the stumps while the batter is out of their crease and not attempting a run." },
    { term: "Wide", aliases: ["wides"], meaning: "A ball too far from the batter to hit. It gives the batting side an extra run and must be bowled again." },
    { term: "No-ball", aliases: ["no ball", "noball"], meaning: "An illegal delivery, such as overstepping the crease. It gives an extra run and is bowled again; in limited-overs cricket the next ball is a free hit." },
    { term: "Free hit", aliases: ["freehit"], meaning: "The ball after a no-ball, on which the batter cannot be out except by a run out (and a few rare ways)." },
    { term: "Bye", aliases: ["byes"], meaning: "Runs taken when the ball passes the batter without touching bat or body. Extras, not credited to the batter." },
    { term: "Leg bye", aliases: ["leg-bye", "leg byes"], meaning: "Runs taken after the ball hits the batter's body (not the bat). Extras." },
    { term: "Extras", aliases: ["sundries"], meaning: "Runs not scored off the bat: wides, no-balls, byes, leg-byes and penalties." },
    { term: "Maiden", aliases: ["maiden over"], meaning: "An over in which the bowler concedes no runs." },
    { term: "Boundary", aliases: ["four", "six"], meaning: "The ball reaching the edge of the field: 4 runs along the ground, 6 if it clears it in the air." },
    { term: "Duck", aliases: ["golden duck"], meaning: "A batter out for zero; a golden duck is out first ball." },
    { term: "Hat-trick", aliases: ["hat trick"], meaning: "A bowler taking wickets with three consecutive deliveries." },
    { term: "Run rate", aliases: ["rr", "current run rate"], meaning: "Runs per over scored so far." },
    { term: "Required run rate", aliases: ["rrr", "required rate", "asking rate"], meaning: "Runs per over the chasing side needs from the overs left." },
    { term: "Economy", aliases: ["economy rate"], meaning: "Runs a bowler concedes per over. Lower is better." },
    { term: "Strike rate", aliases: ["sr"], meaning: "For a batter, runs per 100 balls. For a bowler, balls per wicket." },
    { term: "Partnership", meaning: "Runs added by two batters together before one of them is out." },
    { term: "Powerplay", meaning: "The opening overs of a limited-overs innings with fielding restrictions." },
    { term: "Follow-on", aliases: ["follow on"], meaning: "In a two-innings match, a side that trails by a set margin after the first innings can be made to bat again straight away." },
    { term: "Declaration", aliases: ["declare", "declared"], meaning: "The batting captain ending the innings early, usually to have time to bowl the other side out." },
    { term: "Yorker", meaning: "A full delivery aimed at the batter's feet." },
    { term: "Bouncer", meaning: "A short delivery that rises towards the batter's head." },
    { term: "DLS", aliases: ["duckworth lewis", "duckworth-lewis-stern"], meaning: "A method that resets a target after a rain-shortened chase. Sportonica records a revised target when the scorer enters one; it does not calculate DLS itself." },
  ],
  rules: (r) => [
    { re: /how many overs (can|may|does) (a|each|one) bowler|bowler.*(limit|maximum|overs)/, answer: r.maxOversPerBowler !== null ? `Each bowler may bowl at most ${plural(r.maxOversPerBowler, "over")}, and not two overs in a row.` : "There is no limit on a bowler's overs, but no bowler may bowl two overs in a row." },
    { re: /how many overs|overs (per|in an?) innings|how long is (an? )?innings|format/, answer: `This match is ${format(r)}, ${plural(r.ballsPerOver, "ball")} an over.` },
    { re: /how many balls (in|per|an) over/, answer: `${plural(r.ballsPerOver, "legal ball")} an over. Wides and no-balls do not count${r.wideRebowled || r.noBallRebowled ? " and are bowled again" : ""}.` },
    { re: /how many wickets/, answer: `An innings ends when ${plural(r.wicketsPerInnings, "wicket")} have fallen (all out).` },
    { re: /\bwides?\b|no.?balls?|extras|byes?|free hit/, answer: extrasRule(r) },
    { re: /how (is|does) (a|the) (match|game) (won|end)|who wins|how do you win|tie|tied|draw/, answer: winRule(r) },
    { re: /follow.?on/, answer: r.followOnLead !== null ? `A side that trails by ${plural(r.followOnLead, "run")} or more after the first innings can be asked to follow on.` : "There is no follow-on in this format." },
    { re: /declar/, answer: r.allowDeclaration ? "The batting captain may declare the innings closed at any time." : "Declarations are not allowed in this format." },
    { re: /powerplay|phases?/, answer: r.phases.length ? `Phases: ${r.phases.map((p) => `${p.name} overs ${p.from} to ${p.to}`).join(", ")}.` : "No phases are set for this format." },
    { re: /how many (runs|points) (is|for) a (boundary|four|six)/, answer: "A ball that reaches the boundary along the ground is 4 runs; one that clears it in the air is 6." },
  ],
  stats: [
    { re: /economy/, key: "econ", label: "economy (runs per over)", table: /bowl/, lowerIsBetter: true, format: "dec2" },
    { re: /bowling average/, key: "avg", label: "bowling average", table: /bowl/, lowerIsBetter: true, format: "dec2" },
    { re: /maidens?/, key: "maidens", label: "maidens", table: /bowl/ },
    { re: /runs (conceded|given)|conceded/, key: "runs", label: "runs conceded", table: /bowl/ },
    { re: /wickets? (taken|did .* take)|how many wickets|most wickets|\bwickets\b/, key: "wickets", label: "wickets", table: /bowl/ },
    { re: /\bwides?\b/, key: "wides", label: "wides", table: /bowl/ },
    { re: /no.?balls?/, key: "noBalls", label: "no-balls", table: /bowl/ },
    { re: /overs bowled|how many overs (did|has)/, key: "overs", label: "overs", table: /bowl/ },
    { re: /strike rate|\bsr\b/, key: "sr", label: "strike rate", table: /bat/, format: "dec2" },
    { re: /\bfours?\b|boundaries/, key: "fours", label: "fours", table: /bat/ },
    { re: /\bsix(es)?\b/, key: "sixes", label: "sixes", table: /bat/ },
    { re: /balls (faced|did)|how many balls/, key: "balls", label: "balls faced", table: /bat/ },
    { re: /run rate|\brr\b/, key: "rr", label: "run rate", format: "dec2" },
    { re: /\bextras\b/, key: "extras", label: "extras" },
    { re: /\bruns?\b|scored|top scorer|highest score/, key: "runs", label: "runs", table: /bat|innings/ },
  ],
  explain: (s, ctx, r) => {
    const out: Explanation[] = [];
    for (const inn of s.innings.slice(-2)) {
      const batting = sideName(ctx, inn.batting);
      for (const over of inn.overs.slice(-3)) {
        let legal = 0;
        for (const code of over.balls) {
          const extraNotLegal = (/wd/.test(code) && r.wideRebowled) || (/nb/.test(code) && r.noBallRebowled);
          if (!extraNotLegal) legal += 1;
          // a ball bowled again keeps the number of the ball still to come
          out.push(ballText(code, `${over.n - 1}.${extraNotLegal ? legal + 1 : legal}`, batting));
        }
      }
    }
    return out.slice(-12);
  },
  guide: (r) => [
    { title: "Format", lines: [`${format(r)}, ${plural(r.ballsPerOver, "ball")} an over, ${plural(r.wicketsPerInnings, "wicket")} an innings.`, r.maxOversPerBowler !== null ? `A bowler may bowl at most ${plural(r.maxOversPerBowler, "over")}.` : "No limit on a bowler's overs."] },
    { title: "Runs", lines: ["Runs off the bat: run between the wickets, 4 for a ball reaching the boundary, 6 for one clearing it.", extrasRule(r)] },
    { title: "Result", lines: [winRule(r)] },
    { title: "What the scorer records", lines: ["Each delivery: runs off the bat, any extra, and any wicket with how and who.", "The engine works out overs, strike, partnerships, run rates and the target."] },
  ],
  insights: (s, ctx, r) => cricketInsights(s, ctx, r),
  suggestions: ["What is the score?", "Who has the most wickets?", "What is the best economy?", "Why did the score change?", "What is a free hit?"],
};

const overs = (balls: number, per: number) => `${Math.floor(balls / per)}.${balls % per}`;
const rate = (runs: number, balls: number, per: number) => (balls ? (runs * per) / balls : null);

/** "What the data says" for cricket, from the innings as recorded. */
export function cricketInsights(s: CricketState, ctx: import("../core/types").MatchContext, r: CricketRules): string[] {
  const out: string[] = [];
  const name = (side: "a" | "b") => sideName(ctx, side);
  const pl = (id: string) => ctx.sides ? [...ctx.sides.a.players, ...ctx.sides.b.players].find((p) => p.id === id)?.name ?? "Unknown" : "Unknown";
  const per = r.ballsPerOver;
  const cur = s.innings[s.innings.length - 1];
  if (!cur) return out;

  // where the match stands, and the chase in words
  if (s.result) {
    out.push(s.result.winner ? `${name(s.result.winner)} won ${s.result.margin ?? ""}.`.replace(" .", ".") : s.result.outcome === "tie" ? "The match was tied." : "The match ended without a winner.");
  } else if (cur.target !== null && !cur.closed) {
    const need = cur.target - cur.runs;
    const left = cur.maxBalls !== null ? cur.maxBalls - cur.balls : null;
    const req = left ? rate(need, left, per) : null;
    const now = rate(cur.runs, cur.balls, per);
    out.push(`${name(cur.batting)} need ${need} run${need === 1 ? "" : "s"}${left !== null ? ` from ${left} ball${left === 1 ? "" : "s"}` : ""} with ${r.wicketsPerInnings - cur.wickets} wicket${r.wicketsPerInnings - cur.wickets === 1 ? "" : "s"} in hand.${req !== null && now !== null ? ` Required rate ${req.toFixed(2)}, current rate ${now.toFixed(2)}.` : ""}`);
  } else if (cur.closed && s.innings.length === 1 && r.inningsPerSide === 1) {
    // innings break in a one-innings match: what the chase needs
    const chasing = cur.batting === "a" ? "b" : "a";
    out.push(`${name(cur.batting)} made ${cur.runs}/${cur.wickets} in ${overs(cur.balls, per)} overs. ${name(chasing)} need ${cur.runs + 1} to win${r.oversPerInnings !== null ? ` from ${r.oversPerInnings} overs (${((cur.runs + 1) / r.oversPerInnings).toFixed(2)} an over)` : ""}.`);
  } else {
    out.push(`${name(cur.batting)} ${cur.runs}/${cur.wickets} in ${overs(cur.balls, per)} overs${cur.closed ? " (innings over)" : ""}.`);
  }

  for (const inn of s.innings) {
    const bat = name(inn.batting);
    // top scorer, fifties and hundreds
    const batters = Object.entries(inn.batters).sort((x, y) => y[1].runs - x[1].runs);
    const top = batters[0];
    if (top && top[1].runs >= 10) out.push(`${pl(top[0])} top-scored for ${bat} with ${top[1].runs}${top[1].out ? "" : "*"} off ${top[1].balls} balls.`);
    for (const [id, b] of batters) if (b.runs >= 50) out.push(`${pl(id)} made ${b.runs >= 100 ? "a hundred" : "a fifty"} (${b.runs}).`);
    // best bowling
    const bowl = Object.entries(inn.bowlers).filter(([, b]) => b.balls > 0).sort((x, y) => y[1].wickets - x[1].wickets || x[1].runs - y[1].runs)[0];
    if (bowl && bowl[1].wickets >= 2) out.push(`${pl(bowl[0])} took ${bowl[1].wickets}/${bowl[1].runs} in ${overs(bowl[1].balls, per)} overs.`);
    // the most expensive over
    const big = [...inn.overs].sort((x, y) => y.runs - x.runs)[0];
    if (big && big.runs >= 15) out.push(`Over ${big.n} of ${bat}'s innings went for ${big.runs} (${big.balls.join(" ")}).`);
    // extras and boundaries
    const extras = inn.extras.wides + inn.extras.noBalls + inn.extras.byes + inn.extras.legByes + inn.extras.penalty;
    if (extras >= 10) out.push(`${bat} were given ${extras} extras (${inn.extras.wides} in wides).`);
    // the best partnership, and a collapse (3 or more wickets for 15 runs or fewer)
    const stands = [...inn.partnerships, ...(inn.closed ? [] : [inn.stand])].filter((x) => x.batters.length === 2).sort((x, y) => y.runs - x.runs);
    if (stands[0] && stands[0].runs >= 40) out.push(`The best ${bat} partnership was ${stands[0].runs} between ${stands[0].batters.map(pl).join(" and ")}.`);
    for (let i = 0; i + 2 < inn.fow.length; i++) {
      const runs = inn.fow[i + 2].runs - (i ? inn.fow[i - 1].runs : 0);
      if (runs <= 15) { out.push(`${bat} lost ${3} wickets for ${runs} runs (from ${i ? inn.fow[i - 1].runs : 0}/${i} to ${inn.fow[i + 2].runs}/${i + 3}).`); break; }
    }
  }
  return out;
}
