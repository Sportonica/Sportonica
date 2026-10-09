import "server-only";
import { scrypt } from "node:crypto";
import { promisify } from "node:util";
import { COUPON_HASHES } from "./hashes";

// A partner offer behind a one-off code at sportonica.com/<CODE>.
// scrypt (not a plain hash) because the codes are short: with SHA-256 the
// whole 8-character space could be tried in minutes from the public repo.

export interface CouponOffer {
  discount: string;
  what: string;
  partner: string;
  place: string;
}

export const OFFERS: Record<"imperial" | "sportsworld", CouponOffer> = {
  imperial: { discount: "15% off", what: "all food items", partner: "Hotel Imperial Kathmandu", place: "Battisputali, Kathmandu" },
  sportsworld: { discount: "10% off", what: "futsal boots", partner: "Sports World Trade", place: "Thamel, Kathmandu" },
};

// the alphabet the codes were made from: anything else is not a code, and costs no hashing
const SHAPE = /^[A-HJ-NP-Z2-9]{8}$/;
const scryptAsync = promisify(scrypt) as (pw: string, salt: string, len: number, opts: { N: number; r: number; p: number }) => Promise<Buffer>;

/** The offer behind a code (any letter case), or null. */
export async function findCoupon(raw: string): Promise<{ code: string; offer: CouponOffer } | null> {
  const code = raw.toUpperCase();
  if (!SHAPE.test(code)) return null;
  const hash = (await scryptAsync(code, "sportonica-coupons-v1", 32, { N: 16384, r: 8, p: 1 })).toString("base64url");
  const key = COUPON_HASHES[hash];
  return key ? { code, offer: OFFERS[key] } : null;
}
