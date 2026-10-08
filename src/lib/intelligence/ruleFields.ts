// How each scoring rule is shown in a form: its label, a hint, and the
// kind of input. The engines only know keys and values; this is the
// wording an organiser reads. A sport missing here falls back to the
// keys themselves (see RuleFields).

import type { SportKey } from "./core/types";

export type RuleField = { key: string; label: string; help?: string } & (
  | { kind: "int"; min?: number; max?: number }
  /** a whole number, or empty for the `empty` meaning ("No limit", "Off") */
  | { kind: "limit"; empty: string }
  | { kind: "bool" }
  | { kind: "choice"; options: readonly (readonly [string, string])[] }
  /** cricket's named over ranges */
  | { kind: "phases" }
);

export interface RuleGroup { title: string; fields: RuleField[] }

export const RULE_PRESETS: Partial<Record<SportKey, readonly (readonly [string, string])[]>> = {
  basketball: [["fiba", "FIBA: 4 × 10 min"], ["nba", "NBA: 4 × 12 min"], ["ncaa", "College: 2 × 20 min"], ["3x3", "3x3: 10 min or first to 21"], ["custom", "Custom"]],
  cricket: [["t20", "T20: 20 overs"], ["odi", "One-day: 50 overs"], ["test", "Two innings, no over limit"], ["custom", "Custom overs (box cricket)"]],
};

const BASKETBALL: RuleGroup[] = [
  { title: "Game", fields: [
    { key: "periods", label: "Periods", kind: "int", min: 1, max: 8, help: "4 quarters, 2 halves, or 1 for 3x3" },
    { key: "periodMinutes", label: "Minutes per period", kind: "int", min: 1, max: 30 },
    { key: "targetScore", label: "Game ends when a team reaches", kind: "limit", empty: "No target", help: "3x3: 21. Empty: played to the clock" },
    { key: "allowTie", label: "Overtime", kind: "choice", options: [["false", "Until there's a winner"], ["true", "None: a game can end level"]] },
    { key: "overtimeMinutes", label: "Minutes per overtime", kind: "int", min: 1, max: 15 },
    { key: "overtimeTargetPoints", label: "Overtime ends when a team scores", kind: "limit", empty: "No target", help: "3x3: 2 points. Empty: played to the clock" },
    { key: "playersOnCourt", label: "Players on court", kind: "int", min: 1, max: 5 },
    { key: "gameRosterSize", label: "Players dressed for a game", kind: "int", min: 1, max: 20, help: "On court plus bench" },
    { key: "substitutionsPerGame", label: "Substitutions per team", kind: "limit", empty: "Unlimited" },
    { key: "quarterBreakMinutes", label: "Break between periods (min)", kind: "int", min: 0 },
    { key: "halftimeMinutes", label: "Half-time (min)", kind: "int", min: 0 },
  ] },
  { title: "Scoring", fields: [
    { key: "twoPointValue", label: "Basket inside the arc", kind: "int", min: 1, max: 5, help: "3x3: 1" },
    { key: "threePointValue", label: "Basket from beyond the arc", kind: "int", min: 1, max: 5, help: "3x3: 2" },
    { key: "freeThrowValue", label: "Free throw", kind: "int", min: 1, max: 3 },
    { key: "trackShotAttempts", label: "Record missed shots", kind: "bool", help: "Needed for shooting percentages" },
  ] },
  { title: "Shot clock and possession", fields: [
    { key: "shotClockSeconds", label: "Shot clock (seconds)", kind: "limit", empty: "Off" },
    { key: "shotClockReset", label: "After an offensive rebound (seconds)", kind: "limit", empty: "Full reset" },
    { key: "alternatingPossession", label: "Held ball", kind: "choice", options: [["true", "Alternating possession arrow"], ["false", "Jump ball"]] },
  ] },
  { title: "Fouls", fields: [
    { key: "foulLimit", label: "Fouls before a player fouls out", kind: "int", min: 1, help: "99: players never foul out (3x3)" },
    { key: "technicalsCountTowardFoulLimit", label: "Technicals count toward that limit", kind: "bool" },
    { key: "technicalEjectAt", label: "Technicals that eject a player", kind: "limit", empty: "Never" },
    { key: "unsportsmanlikeEjectAt", label: "Unsportsmanlike fouls that eject", kind: "limit", empty: "Never" },
    { key: "combinedEjectAt", label: "Technical + unsportsmanlike that eject", kind: "limit", empty: "Never" },
    { key: "teamFoulWindow", label: "Team fouls counted per", kind: "choice", options: [["period", "Period"], ["half", "Half"]] },
    { key: "bonusAfterFouls", label: "Free throws once a team has this many fouls", kind: "int", min: 0 },
    { key: "doubleBonusAfterFouls", label: "Double bonus after", kind: "limit", empty: "No double bonus" },
    { key: "overtimeTeamFouls", label: "Team fouls in overtime", kind: "choice", options: [["carry", "Carry on from the last period"], ["reset", "Start again"]] },
    { key: "bonusAfterFoulsOvertime", label: "Bonus in overtime after", kind: "limit", empty: "Same as regulation" },
    { key: "offensiveFoulsAreTeamFouls", label: "Offensive fouls count as team fouls", kind: "bool" },
    { key: "technicalsAreTeamFouls", label: "Technicals count as team fouls", kind: "bool" },
  ] },
  { title: "Free throws", fields: [
    { key: "bonusFreeThrows", label: "Free throws in the bonus", kind: "int", min: 0, max: 3 },
    { key: "oneAndOne", label: "One-and-one in the bonus", kind: "bool", help: "College rule: the second shot only if the first goes in" },
    { key: "technicalFreeThrows", label: "Free throws for a technical", kind: "int", min: 0, max: 3 },
    { key: "unsportsmanlikeFreeThrows", label: "Free throws for an unsportsmanlike foul", kind: "int", min: 0, max: 3 },
  ] },
  { title: "Timeouts", fields: [
    { key: "timeoutsPerGame", label: "Timeouts per game", kind: "limit", empty: "Allotted by half (below)" },
    { key: "timeoutsFirstHalf", label: "First half", kind: "int", min: 0 },
    { key: "timeoutsSecondHalf", label: "Second half", kind: "int", min: 0 },
    { key: "timeoutsPerOvertime", label: "Each overtime", kind: "int", min: 0 },
  ] },
  { title: "League table", fields: [
    { key: "standingsWinPoints", label: "Points for a win", kind: "int", min: 0 },
    { key: "standingsLossPoints", label: "Points for a loss", kind: "int", min: 0 },
    { key: "standingsForfeitLossPoints", label: "Points for a forfeit", kind: "int", min: 0 },
    { key: "standingsTiebreak", label: "Level on points", kind: "choice", options: [["head_to_head", "Games between them first"], ["point_difference", "Point difference first"]] },
  ] },
  { title: "Close-game statistics", fields: [
    { key: "clutchMinutes", label: "Last minutes of the game", kind: "int", min: 1 },
    { key: "clutchMargin", label: "Margin at most", kind: "int", min: 0 },
  ] },
];

const CRICKET: RuleGroup[] = [
  { title: "Match", fields: [
    { key: "oversPerInnings", label: "Overs per side", kind: "limit", empty: "No limit" },
    { key: "wicketsPerInnings", label: "Wickets that end an innings", kind: "int", min: 1, max: 10, help: "Players per side minus one: 7 for 8-a-side, 10 for 11-a-side" },
    { key: "maxOversPerBowler", label: "Max overs per bowler", kind: "limit", empty: "No limit" },
    { key: "ballsPerOver", label: "Balls per over", kind: "int", min: 1, max: 9 },
    { key: "inningsPerSide", label: "Innings per side", kind: "choice", options: [["1", "One"], ["2", "Two"]] },
    { key: "allowDraw", label: "A match can be drawn", kind: "bool" },
    { key: "allowDeclaration", label: "Declarations allowed", kind: "bool" },
    { key: "followOnLead", label: "Follow-on after a lead of", kind: "limit", empty: "No follow-on" },
  ] },
  { title: "Extras", fields: [
    { key: "wideRuns", label: "Runs for a wide", kind: "int", min: 0 },
    { key: "noBallRuns", label: "Runs for a no-ball", kind: "int", min: 0 },
    { key: "wideRebowled", label: "A wide is bowled again", kind: "bool" },
    { key: "noBallRebowled", label: "A no-ball is bowled again", kind: "bool" },
    { key: "freeHit", label: "Free hit after a no-ball", kind: "bool" },
  ] },
  { title: "Phases (for the phase table)", fields: [
    { key: "phases", label: "One per line: name, first over, last over", kind: "phases" },
  ] },
];

export const RULE_GROUPS: Partial<Record<SportKey, RuleGroup[]>> = { basketball: BASKETBALL, cricket: CRICKET };
