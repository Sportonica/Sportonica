// The one place a sport is wired to its engine. Adding a sport is one
// file in ./sports plus one line here (see
// docs/sports-intelligence/04-adding-a-sport.md).

import { SPORT_KEYS, type SportIntelligenceEngine, type SportKey } from "./core/types";
import { basketballEngine } from "./sports/basketball";
import { pickleballEngine } from "./sports/pickleball";
import { cricketEngine } from "./sports/cricket";
import { volleyballEngine } from "./sports/volleyball";
import { badmintonEngine } from "./sports/badminton";
import { swimmingEngine } from "./sports/swimming";

export const ENGINES: Record<SportKey, SportIntelligenceEngine> = {
  basketball: basketballEngine,
  pickleball: pickleballEngine,
  cricket: cricketEngine,
  volleyball: volleyballEngine,
  badminton: badmintonEngine,
  swimming: swimmingEngine,
};

export const isSportKey = (v: unknown): v is SportKey => typeof v === "string" && (SPORT_KEYS as readonly string[]).includes(v);

export function getEngine(sport: SportKey): SportIntelligenceEngine {
  return ENGINES[sport];
}

/**
 * A tournament's sport name ("Basketball") -> engine key, or null when the
 * sport has no engine. Futsal deliberately has none: football keeps its
 * existing score entry.
 */
export function sportKeyFor(sportName: string | null | undefined): SportKey | null {
  const key = (sportName ?? "").trim().toLowerCase();
  return isSportKey(key) ? key : null;
}

export function listIntelligenceSportsSync(): { key: SportKey; label: string; eventTypes: readonly string[]; versus: boolean }[] {
  return SPORT_KEYS.map((key) => ({ key, label: ENGINES[key].label, eventTypes: ENGINES[key].eventTypes, versus: key !== "swimming" }));
}
