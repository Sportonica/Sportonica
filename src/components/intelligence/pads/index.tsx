"use client";

// Which pad scores which sport. The console knows nothing else about
// a sport: adding one means adding a pad here.

import type { ComponentType } from "react";
import type { SportKey } from "@/lib/intelligence/core/types";
import BasketballPad from "./BasketballPad";
import CricketPad from "./CricketPad";
import SwimmingPad from "./SwimmingPad";
import TennisPad from "./TennisPad";
import FootballPad from "./FootballPad";
import RallyPad, { type RallyPadConfig } from "./RallyPad";
import type { PadProps } from "./shared";

const BADMINTON: RallyPadConfig = {
  pointWord: () => "Point",
  hows: [
    { key: "ace", label: "Ace" }, { key: "service_error", label: "Service error" }, { key: "winner", label: "Winner" },
    { key: "smash_winner", label: "Smash winner" }, { key: "net_winner", label: "Net winner" },
    { key: "unforced_error", label: "Unforced error" }, { key: "defensive", label: "Defensive point" },
  ],
};

const PICKLEBALL: RallyPadConfig = {
  pointWord: (rules) => (rules.scoring === "rally" ? "Point" : "Rally"),
  hows: [
    { key: "ace", label: "Ace" }, { key: "service_fault", label: "Service fault" },
    { key: "winner", label: "Winner" }, { key: "unforced_error", label: "Unforced error" },
  ],
};

const VOLLEYBALL: RallyPadConfig = {
  pointWord: () => "Point",
  hows: [
    { key: "ace", label: "Ace" }, { key: "kill", label: "Kill" }, { key: "block", label: "Block" },
    { key: "service_error", label: "Service error" }, { key: "attack_error", label: "Attack error" }, { key: "opponent_error", label: "Opponent error" },
  ],
  court: { sizeRule: "playersOnCourt" },
};

const rally = (config: RallyPadConfig) => function Pad(props: PadProps) { return <RallyPad {...props} config={config} />; };

export const PADS: Record<SportKey, ComponentType<PadProps>> = {
  basketball: BasketballPad,
  cricket: CricketPad,
  swimming: SwimmingPad,
  tennis: TennisPad,
  football: FootballPad,
  badminton: rally(BADMINTON),
  pickleball: rally(PICKLEBALL),
  volleyball: rally(VOLLEYBALL),
};
