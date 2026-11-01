// How a court booking's money and status read in plain words, and how a
// super admin's edit maps back onto the columns. There is no amount-paid
// column: payment_status + advance_amount already say it, the same way
// review_payment() and mark_balance_collected() write them.

export const BOOKING_STATE_LABELS: Record<string, string> = {
  reserved: "Awaiting payment",
  paid: "Paid, not played yet",
  confirmed: "Booked, not played yet",
  checked_in: "Arrived",
  played: "Played",
  no_show: "Did not show up",
  cancelled: "Cancelled",
  dropped: "Dropped (never paid)",
  refunded: "Refunded",
};

// Bookings that are really happening, so any unpaid part is owed.
const OWING_STATES = new Set(["paid", "confirmed", "checked_in", "played"]);

// Money recorded on these keeps the slot blocked (court_booking_slot_state()
// treats paid or partial as booked whatever the state says).
export const CLOSED_STATES = new Set(["cancelled", "dropped", "no_show"]);

interface MoneyState {
  price: number | string | null;
  payment_status: string | null;
  advance_amount?: number | string | null;
}

export function amountPaid(b: MoneyState): number {
  if (b.payment_status === "paid") return Number(b.price) || 0;
  if (b.payment_status === "partial") return Number(b.advance_amount) || 0;
  return 0;
}

export function balanceDue(b: MoneyState & { state: string | null }): number {
  if (!OWING_STATES.has(b.state ?? "")) return 0;
  return Math.max((Number(b.price) || 0) - amountPaid(b), 0);
}

export interface PaymentPatch {
  price: number;
  payment_status: string;
  advance_amount: number | null;
  balance_collected_at: string | null;
  balance_collected_by: string | null;
}

/** The payment columns after an edit. Throws a sentence for the form when the edit can't apply. */
export function paymentPatch(
  current: MoneyState & { balance_collected_at: string | null; balance_collected_by: string | null },
  edit: { price: number; amountPaid: number; state: string },
  by: string,
  now: string,
): PaymentPatch | null {
  const paid = edit.state === "refunded" ? 0 : edit.amountPaid;
  const priceChanged = edit.price !== Number(current.price);
  const refunding = edit.state === "refunded" && current.payment_status !== "refunded";
  if (!priceChanged && !refunding && paid === amountPaid(current)) return null;

  if (current.payment_status === "pending_verification") {
    throw new Error("A payment for this booking is waiting for review. Approve or reject it on the Payments page first.");
  }
  if (paid > edit.price) {
    throw new Error("Amount paid can't be more than the booking price.");
  }

  let payment_status: string;
  if (edit.state === "refunded") payment_status = "refunded";
  else if (paid === 0) payment_status = current.payment_status === "rejected" ? "rejected" : "unpaid";
  else payment_status = paid >= edit.price ? "paid" : "partial";

  const balanceJustCollected = payment_status === "paid" && current.payment_status === "partial";
  const stillCollected = payment_status === "paid" && current.balance_collected_at !== null;
  return {
    price: edit.price,
    payment_status,
    advance_amount: payment_status === "partial" ? paid : null,
    balance_collected_at: balanceJustCollected ? now : stillCollected ? current.balance_collected_at : null,
    balance_collected_by: balanceJustCollected ? by : stillCollected ? current.balance_collected_by : null,
  };
}

/** Nepal has no daylight saving, so its offset is always +05:45. */
export const nepalInstant = (date: string, time: string) => new Date(`${date}T${time}:00+05:45`);

export function nepalParts(iso: string): { date: string; time: string } {
  const at = new Date(new Date(iso).getTime() + 345 * 60_000).toISOString();
  return { date: at.slice(0, 10), time: at.slice(11, 16) };
}
