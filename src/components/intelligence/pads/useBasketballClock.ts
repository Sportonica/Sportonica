"use client";

// The basketball game clock and shot clock, running on the scorer's
// device. They are kept per contest in this browser, so a reload or a
// locked phone picks up where they were (a running clock keeps running).
// They stop by themselves at zero, and on the whistle: a timeout, a foul,
// a violation or the ball going out. The scorer restarts them.

import { useCallback, useEffect, useState } from "react";
import type { BasketballState } from "@/lib/intelligence/sports/basketball";
import { breakAfter, periodSeconds, type BasketballRules } from "@/lib/intelligence/sports/basketball/rules";
import { shotClockAfter } from "@/lib/intelligence/sports/basketball/clock";

interface Stored {
  /** the period these clocks belong to */
  period: number;
  /** seconds left on each clock when it was last started or stopped */
  game: number;
  shot: number;
  running: boolean;
  /** Date.now() when the clocks last started */
  since: number | null;
  /** the clock has been run in this period: until then events carry no clock */
  used: boolean;
  /** Date.now() when the last period ended, for the break timer */
  breakFrom: number | null;
}

const WHISTLE = new Set(["TIMEOUT", "FOUL", "VIOLATION", "OUT_OF_BOUNDS", "HELD_BALL", "GOALTENDING"]);

export interface BasketballClock {
  /** seconds left now */
  game: number;
  /** null: no shot clock in this competition */
  shot: number | null;
  /** the shot clock is switched off: less game time left than shot clock */
  shotOff: boolean;
  running: boolean;
  used: boolean;
  /** seconds of the interval left, while one is running */
  breakLeft: number | null;
  breakHalftime: boolean;
  toggle: () => void;
  setGame: (seconds: number) => void;
  setShot: (seconds: number) => void;
  /** after an event is sent: the shot clock resets by rule, the whistle stops the clocks */
  afterEvent: (type: string, payload: Record<string, unknown>) => void;
  periodStarted: (period: number) => void;
  periodEnded: () => void;
}

export function useBasketballClock(contestId: string, s: BasketballState, rules: BasketballRules): BasketballClock {
  const key = `si-bb-clock-${contestId}`;
  const shotFull = rules.shotClockSeconds;
  const fresh = useCallback((period: number): Stored => {
    const full = period > 0 ? periodSeconds(period, rules) : periodSeconds(1, rules);
    // another device may have been scoring this period: start from its last reading
    const last = period === s.period && s.periodOpen && s.clock !== null ? s.clock : full;
    return { period, game: last, shot: shotFull ?? 0, running: false, since: null, used: last < full, breakFrom: null };
  }, [rules, shotFull, s.period, s.periodOpen, s.clock]);

  const [stored, setStored] = useState<Stored | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // read back after mount (never during the server render)
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(key) ?? "null") as Stored | null;
        if (saved && typeof saved.game === "number") setStored(saved);
      } catch { /* storage unavailable: the clocks start fresh */ }
    }, 0);
    return () => clearTimeout(t);
  }, [key]);

  // clocks saved for another period (it ended, or another device moved on) start afresh
  const base: Stored = stored && stored.period === s.period ? stored : { ...fresh(s.period), breakFrom: stored?.breakFrom ?? null };

  const elapsed = base.running && base.since !== null ? (now - base.since) / 1000 : 0;
  const game = Math.max(0, base.game - elapsed);
  const shotRaw = shotFull === null ? null : Math.max(0, base.shot - elapsed);
  const shotOff = shotRaw !== null && game < shotRaw;

  const save = useCallback((next: Stored) => {
    setStored(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* as above */ }
  }, [key]);

  // freeze both clocks at their current readings
  const frozen = (running: boolean): Stored => ({
    ...base, game, shot: shotRaw ?? 0, running, since: running ? Date.now() : null, used: base.used || running,
  });

  // tick while running
  useEffect(() => {
    if (!base.running) return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [base.running]);
  // stop at zero: the game clock, or the shot clock while it is on
  const mustStop = base.running && (game <= 0 || (shotRaw !== null && !shotOff && shotRaw <= 0));
  const stopped = { ...base, game, shot: shotRaw ?? 0, running: false, since: null };
  useEffect(() => {
    if (!mustStop) return;
    const t = setTimeout(() => save(stopped), 0);
    return () => clearTimeout(t);
  });

  // the break timer counts down between periods
  const brk = breakAfter(Math.max(1, s.period), rules);
  const inBreak = !s.periodOpen && s.period > 0 && base.breakFrom !== null;
  useEffect(() => {
    if (!inBreak) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [inBreak]);
  const breakLeft = inBreak ? Math.max(0, brk.minutes * 60 - (now - base.breakFrom!) / 1000) : null;

  return {
    game, shot: shotRaw, shotOff, running: base.running, used: base.used,
    breakLeft, breakHalftime: brk.halftime,
    toggle: () => { setNow(Date.now()); save(frozen(!base.running)); },
    setGame: (seconds) => save({ ...frozen(base.running), game: Math.max(0, seconds), used: true }),
    setShot: (seconds) => { if (shotFull !== null) save({ ...frozen(base.running), shot: Math.min(shotFull, Math.max(0, seconds)) }); },
    afterEvent: (type, payload) => {
      const next = frozen(WHISTLE.has(type) ? false : base.running);
      if (shotFull !== null) next.shot = shotClockAfter(type, payload, next.shot, rules);
      save(next);
    },
    periodStarted: (period) => save({ ...fresh(period), game: periodSeconds(period, rules), used: false }),
    periodEnded: () => save({ ...frozen(false), breakFrom: Date.now() }),
  };
}
