import type { AdvancePaymentMode } from "@/lib/admin/types";

export type AdvanceConfig = {
  mode: AdvancePaymentMode;
  percent: number | null;
  hours: number | null;
};

/**
 * Mirrors submit_payment()'s advance-amount math in RUN_ME_advance_payment.sql
 * so the checkout screen can show the right numbers before submitting. The
 * database stays authoritative at the moment of payment — this is for display.
 * Returns null when the venue offers no alternative to full payment.
 */
export function computeAdvanceOption(
  price: number,
  durationHours: number,
  cfg: AdvanceConfig
): { label: string; amount: number } | null {
  if (cfg.mode === "full" || !cfg.percent && !cfg.hours) return null;

  if (cfg.mode === "percent" && cfg.percent) {
    return { label: `Pay ${cfg.percent}% now`, amount: Math.round(price * (cfg.percent / 100)) };
  }
  if (cfg.mode === "hours" && cfg.hours) {
    const hrs = Math.min(cfg.hours, durationHours);
    const label = `Pay for ${cfg.hours} hour${cfg.hours === 1 ? "" : "s"} now`;
    return { label, amount: Math.round((price / durationHours) * hrs) };
  }
  return null;
}
