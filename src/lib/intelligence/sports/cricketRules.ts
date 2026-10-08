// Cricket competition rules and their presets, in a module of their own
// so the tournament form can offer them without loading the engine.

import { DEFAULT_CRICKET_TABLE, type CricketTable } from "./cricketTable";

export interface CricketPhase { name: string; from: number; to: number }

export interface CricketRules {
  preset: "t20" | "odi" | "test" | "custom";
  oversPerInnings: number | null;
  inningsPerSide: number;
  ballsPerOver: number;
  wicketsPerInnings: number;
  maxOversPerBowler: number | null;
  wideRuns: number;
  noBallRuns: number;
  wideRebowled: boolean;
  noBallRebowled: boolean;
  freeHit: boolean;
  allowDeclaration: boolean;
  allowDraw: boolean;
  followOnLead: number | null;
  phases: CricketPhase[];
  /** the league table (points, tiebreakers, who goes through); not used to score a match */
  table: CricketTable;
}

const BASE = { ballsPerOver: 6, wicketsPerInnings: 10, wideRuns: 1, noBallRuns: 1, wideRebowled: true, noBallRebowled: true, table: DEFAULT_CRICKET_TABLE };

export const CRICKET_PRESETS: Record<CricketRules["preset"], CricketRules> = {
  t20: { ...BASE, preset: "t20", oversPerInnings: 20, inningsPerSide: 1, maxOversPerBowler: 4, freeHit: true, allowDeclaration: false, allowDraw: false, followOnLead: null,
    phases: [{ name: "Powerplay", from: 1, to: 6 }, { name: "Middle", from: 7, to: 15 }, { name: "Death", from: 16, to: 20 }] },
  odi: { ...BASE, preset: "odi", oversPerInnings: 50, inningsPerSide: 1, maxOversPerBowler: 10, freeHit: true, allowDeclaration: false, allowDraw: false, followOnLead: null,
    phases: [{ name: "Powerplay", from: 1, to: 10 }, { name: "Middle", from: 11, to: 40 }, { name: "Death", from: 41, to: 50 }] },
  test: { ...BASE, preset: "test", oversPerInnings: null, inningsPerSide: 2, maxOversPerBowler: null, freeHit: false, allowDeclaration: true, allowDraw: true, followOnLead: 200, phases: [] },
  custom: { ...BASE, preset: "custom", oversPerInnings: 20, inningsPerSide: 1, maxOversPerBowler: null, freeHit: false, allowDeclaration: false, allowDraw: false, followOnLead: null, phases: [] },
};
