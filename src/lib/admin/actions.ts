"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { notifyCourtBooked } from "@/lib/mail/notify";
import { actionError, safeActionError, type ActionError } from "@/lib/actionError";
import { friendlyBookingError } from "@/lib/bookings/types";
import { isValidLocalPhone } from "@/lib/validation/identity";
import { friendlyPaymentError } from "@/lib/payments/types";
import { VENUE_HAS_HISTORY, COURT_HAS_HISTORY } from "@/lib/admin/types";

// Columns a venue owner may set/change themselves. verification_status,
// payout_cap, owner_id, status and the like are platform-controlled —
// the DB triggers in supabase/rls_hardening.sql also block them,
// this is defence-in-depth so a stray field never reaches the update.
const VENUE_OWNER_FIELDS = new Set([
  "name", "venue_type", "address", "phone", "sports", "amenities",
  "lat", "lng", "maps_url", "description", "photos", "opening_hours",
  "advance_payment_mode", "advance_payment_percent", "advance_payment_hours",
]);
const ADVANCE_PAYMENT_MODES = new Set(["full", "percent", "hours"]);
function pickVenueFields(patch: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(patch).filter(([k]) => VENUE_OWNER_FIELDS.has(k)),
  );
}

// Same reasoning as VENUE_OWNER_FIELDS: these actions are reachable by direct
// POST, so a patch/insert object is allowlisted rather than passed through
// as-is — in particular this keeps a caller from smuggling a `venue_id` into
// updateCourt()/createPricingRule()'s patch to reassign a row across venues.
const COURT_FIELDS = new Set(["name", "sport", "surface", "capacity", "base_price"]);
function pickCourtFields(patch: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(patch).filter(([k]) => COURT_FIELDS.has(k)),
  );
}

const PRICING_RULE_FIELDS = new Set([
  "court_id", "label", "kind", "amount", "days", "start_time", "end_time", "priority",
]);
function pickPricingFields(patch: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(patch).filter(([k]) => PRICING_RULE_FIELDS.has(k)),
  );
}

const BOOKING_STATES = new Set([
  "reserved", "confirmed", "played", "no_show", "dropped", "cancelled", "refunded",
]);

// Every server action re-checks auth. Server Functions are reachable by
// direct POST, so we never trust the client (per Next.js data-security guide).
async function requireUser() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  return { sb, user };
}

// Same check addStaff() already does, and for the same reason: RLS would
// reject an unauthorized write anyway, but checking here first turns a raw
// Postgres error into a clean FORBIDDEN for a staff member/owner poking at
// a venue_id that isn't theirs.
async function requireVenueAccess(
  sb: Awaited<ReturnType<typeof createClient>>,
  venueId: string,
  minRole: "owner" | "manager" | "staff" = "manager",
) {
  const { data: canManage } = await sb.rpc("has_venue_access", { v_id: venueId, min_role: minRole });
  return !!canManage;
}

// ── VENUES ───────────────────────────────────────────────────────
export async function createVenue(input: {
  name: string;
  venue_type?: string;
  address?: string;
  phone?: string;
  sports?: string[];
  amenities?: string[];
  lat?: number | null;
  lng?: number | null;
  description?: string;
}) {
  const { sb, user } = await requireUser();
  if (!user) return actionError("UNAUTHORIZED");
  if (input.phone && !isValidLocalPhone(input.phone)) {
    return actionError("Phone number must contain exactly 10 digits.");
  }
  const { data, error } = await sb
    .from("venues")
    .insert({ ...pickVenueFields(input as Record<string, unknown>), name: input.name, owner_id: user.id })
    .select()
    .single();
  if (error) { console.error("[createVenue]", error.message); return actionError("Could not create that venue."); }
  revalidatePath("/admin/venues");
  return data;
}

export async function updateVenue(id: string, patch: Record<string, unknown>) {
  const { sb, user } = await requireUser();
  if (!user) return actionError("UNAUTHORIZED");
  if (!(await requireVenueAccess(sb, id))) return actionError("FORBIDDEN");
  const safe = pickVenueFields(patch);
  if (typeof safe.phone === "string" && !isValidLocalPhone(safe.phone)) {
    return actionError("Phone number must contain exactly 10 digits.");
  }
  // Mirrors the DB's venues_advance_payment_shape_check constraint — catch
  // a bad payload here with a friendly message instead of a raw Postgres
  // constraint-violation error.
  if ("advance_payment_mode" in safe) {
    const mode = safe.advance_payment_mode;
    if (typeof mode !== "string" || !ADVANCE_PAYMENT_MODES.has(mode)) {
      return actionError("That isn't a valid advance-payment option.");
    }
    const percent = safe.advance_payment_percent;
    const hours = safe.advance_payment_hours;
    if (mode === "percent" && !(typeof percent === "number" && percent > 0 && percent < 100)) {
      return actionError("Enter a percentage between 1 and 99.");
    }
    if (mode === "hours" && !(typeof hours === "number" && hours > 0)) {
      return actionError("Enter how many hours' worth of the price to charge upfront.");
    }
    if (mode === "full") { safe.advance_payment_percent = null; safe.advance_payment_hours = null; }
    if (mode === "percent") safe.advance_payment_hours = null;
    if (mode === "hours") safe.advance_payment_percent = null;
  }
  if (Object.keys(safe).length === 0) return actionError("Nothing to update.");
  const { data, error } = await sb.from("venues").update(safe).eq("id", id).select().single();
  if (error) { console.error("[updateVenue]", error.message); return actionError("Could not update that venue."); }
  revalidatePath(`/admin/venues/${id}`);
  revalidatePath("/admin/venues");
  return data;
}

// Delete is for venues that never got going (a test venue, a duplicate).
// Anything with history gets closed instead: court_bookings and payouts
// cascade on delete, so they're counted up front — a silent cascade would
// wipe revenue records. games/events/tournaments/payments reference the
// venue without a cascade, so Postgres refuses (23503) and that maps to
// the same message.
export async function deleteVenue(id: string) {
  const { sb, user } = await requireUser();
  if (!user) return actionError("UNAUTHORIZED");
  // venues_owner_del (admin_schema.sql) is owner-only.
  if (!(await requireVenueAccess(sb, id, "owner"))) return actionError("FORBIDDEN");
  const [bookings, payouts] = await Promise.all([
    sb.from("court_bookings").select("id", { count: "exact", head: true }).eq("venue_id", id),
    sb.from("payouts").select("id", { count: "exact", head: true }).eq("venue_id", id),
  ]);
  if (bookings.error || payouts.error) {
    return safeActionError(bookings.error ?? payouts.error, "Could not delete that venue.");
  }
  if ((bookings.count ?? 0) > 0 || (payouts.count ?? 0) > 0) return actionError(VENUE_HAS_HISTORY);
  const { data: deleted, error } = await sb.from("venues").delete().eq("id", id).select("id");
  if (error) {
    if (error.code === "23503") return actionError(VENUE_HAS_HISTORY);
    return safeActionError(error, "Could not delete that venue.");
  }
  // RLS filters rather than errors — zero rows back means it wasn't ours to delete.
  if (!deleted?.length) return actionError("Could not delete that venue.");
  revalidatePath("/admin/venues");
  revalidatePath("/admin");
}

// Closing hides the venue from players (discovery filters status='open')
// while keeping every record. Owner-only, like delete.
export async function setVenueOpen(id: string, open: boolean) {
  const { sb, user } = await requireUser();
  if (!user) return actionError("UNAUTHORIZED");
  if (!(await requireVenueAccess(sb, id, "owner"))) return actionError("FORBIDDEN");
  const { error } = await sb.from("venues").update({ status: open ? "open" : "closed" }).eq("id", id);
  if (error) return safeActionError(error, "Could not update that venue.");
  revalidatePath(`/admin/venues/${id}`);
  revalidatePath("/admin/venues");
}

// Upload a venue photo to Supabase Storage and append its public URL to the
// venue's photos array. Expects a 'venue-photos' storage bucket (public).
export async function uploadVenuePhoto(venueId: string, file: File): Promise<string | ActionError> {
  const { sb, user } = await requireUser();
  if (!user) return actionError("UNAUTHORIZED");
  if (!(await requireVenueAccess(sb, venueId))) return actionError("FORBIDDEN");
  const ext = file.name.split(".").pop() ?? "jpg";
  const path = `${venueId}/${Date.now()}.${ext}`;

  const { error: upErr } = await sb.storage.from("venue-photos").upload(path, file, {
    cacheControl: "3600",
    upsert: false,
  });
  if (upErr) return actionError(upErr.message);

  const { data: pub } = sb.storage.from("venue-photos").getPublicUrl(path);
  const url = pub.publicUrl;

  // Append to the venue's photos array
  const { data: venue } = await sb.from("venues").select("photos").eq("id", venueId).single();
  const photos = [...(venue?.photos ?? []), url];
  const { error } = await sb.from("venues").update({ photos }).eq("id", venueId);
  if (error) return actionError(error.message);

  revalidatePath(`/admin/venues/${venueId}`);
  return url;
}

// Add a photo by URL (fallback when not uploading a file).
export async function addVenuePhotoUrl(venueId: string, url: string) {
  const { sb, user } = await requireUser();
  if (!user) return actionError("UNAUTHORIZED");
  if (!(await requireVenueAccess(sb, venueId))) return actionError("FORBIDDEN");
  const { data: venue } = await sb.from("venues").select("photos").eq("id", venueId).single();
  const photos = [...(venue?.photos ?? []), url];
  const { error } = await sb.from("venues").update({ photos }).eq("id", venueId);
  if (error) return actionError(error.message);
  revalidatePath(`/admin/venues/${venueId}`);
}

// Remove a photo from the venue's array.
export async function removeVenuePhoto(venueId: string, url: string) {
  const { sb, user } = await requireUser();
  if (!user) return actionError("UNAUTHORIZED");
  if (!(await requireVenueAccess(sb, venueId))) return actionError("FORBIDDEN");
  const { data: venue } = await sb.from("venues").select("photos").eq("id", venueId).single();
  const photos = (venue?.photos ?? []).filter((p: string) => p !== url);
  const { error } = await sb.from("venues").update({ photos }).eq("id", venueId);
  if (error) return actionError(error.message);
  revalidatePath(`/admin/venues/${venueId}`);
}

// ── COURTS ───────────────────────────────────────────────────────
export async function createCourt(input: {
  venue_id: string;
  name: string;
  sport: string;
  surface?: string;
  capacity?: number;
  base_price?: number;
}) {
  const { sb, user } = await requireUser();
  if (!user) return actionError("UNAUTHORIZED");
  if (!(await requireVenueAccess(sb, input.venue_id))) return actionError("FORBIDDEN");
  const { data, error } = await sb
    .from("courts")
    .insert({ ...pickCourtFields(input as Record<string, unknown>), venue_id: input.venue_id })
    .select()
    .single();
  if (error) return actionError(error.message);
  revalidatePath(`/admin/venues/${input.venue_id}`);
  return data;
}

export async function updateCourt(id: string, venue_id: string, patch: Record<string, unknown>) {
  const { sb, user } = await requireUser();
  if (!user) return actionError("UNAUTHORIZED");
  if (!(await requireVenueAccess(sb, venue_id))) return actionError("FORBIDDEN");
  const safe = pickCourtFields(patch);
  if (Object.keys(safe).length === 0) return actionError("Nothing to update.");
  const { error } = await sb.from("courts").update(safe).eq("id", id).eq("venue_id", venue_id);
  if (error) return actionError(error.message);
  revalidatePath(`/admin/venues/${venue_id}`);
}

// Same rule as deleteVenue(): court_bookings cascade, so check first;
// games reference the court without a cascade (23503).
export async function deleteCourt(id: string, venue_id: string) {
  const { sb, user } = await requireUser();
  if (!user) return actionError("UNAUTHORIZED");
  if (!(await requireVenueAccess(sb, venue_id))) return actionError("FORBIDDEN");
  const { count, error: countError } = await sb
    .from("court_bookings").select("id", { count: "exact", head: true }).eq("court_id", id);
  if (countError) return safeActionError(countError, "Could not delete that court.");
  if ((count ?? 0) > 0) return actionError(COURT_HAS_HISTORY);
  const { data: deleted, error } = await sb.from("courts").delete().eq("id", id).eq("venue_id", venue_id).select("id");
  if (error) {
    if (error.code === "23503") return actionError(COURT_HAS_HISTORY);
    return safeActionError(error, "Could not delete that court.");
  }
  if (!deleted?.length) return actionError("Could not delete that court.");
  revalidatePath(`/admin/venues/${venue_id}`);
}

// Inactive courts drop out of player discovery (status='active' filter)
// but keep their bookings and hours.
export async function setCourtActive(id: string, venue_id: string, active: boolean) {
  const { sb, user } = await requireUser();
  if (!user) return actionError("UNAUTHORIZED");
  if (!(await requireVenueAccess(sb, venue_id))) return actionError("FORBIDDEN");
  const { error } = await sb
    .from("courts").update({ status: active ? "active" : "inactive" }).eq("id", id).eq("venue_id", venue_id);
  if (error) return safeActionError(error, "Could not update that court.");
  revalidatePath(`/admin/venues/${venue_id}`);
}

// ── OPENING HOURS ────────────────────────────────────────────────
// Replace the whole weekly template for a court in one shot.
export async function setCourtHours(
  court_id: string,
  venue_id: string,
  rows: { dow: number; open_time: string; close_time: string }[]
) {
  const { sb, user } = await requireUser();
  if (!user) return actionError("UNAUTHORIZED");
  if (!(await requireVenueAccess(sb, venue_id))) return actionError("FORBIDDEN");
  // No way to represent hours crossing midnight in this schema (one
  // open/close pair per day) — DayCalendar's hourly rail silently renders
  // zero rows for a day where close <= open, so reject it here rather than
  // saving a contradiction nothing else surfaces.
  if (rows.some((r) => r.close_time <= r.open_time)) {
    return actionError("Close time must be after open time (overnight hours aren't supported yet).");
  }
  await sb.from("court_hours").delete().eq("court_id", court_id);
  if (rows.length) {
    const { error } = await sb.from("court_hours").insert(rows.map((r) => ({ ...r, court_id })));
    if (error) return actionError(error.message);
  }
  revalidatePath(`/admin/venues/${venue_id}/courts/${court_id}`);
}

// ── BLOCKS (the one-tap "block slot" for walk-ins/maintenance) ───
export async function createBlock(input: {
  court_id: string;
  venue_id: string;
  starts_at: string;
  ends_at: string;
  reason?: string;
  note?: string;
}) {
  const { sb, user } = await requireUser();
  if (!user) return actionError("UNAUTHORIZED");
  // blocks_staff (admin_schema.sql) only requires 'staff', not 'manager'.
  if (!(await requireVenueAccess(sb, input.venue_id, "staff"))) return actionError("FORBIDDEN");
  const { court_id, starts_at, ends_at, reason = "manual", note } = input;
  const { data, error } = await sb
    .from("court_blocks")
    .insert({ court_id, starts_at, ends_at, reason, note, created_by: user.id })
    .select()
    .single();
  if (error) return actionError(error.message);
  revalidatePath(`/admin/venues/${input.venue_id}/calendar`);
  return data;
}

export async function deleteBlock(id: string, venue_id: string) {
  const { sb, user } = await requireUser();
  if (!user) return actionError("UNAUTHORIZED");
  // blocks_staff (admin_schema.sql) only requires 'staff', not 'manager'.
  if (!(await requireVenueAccess(sb, venue_id, "staff"))) return actionError("FORBIDDEN");
  const { error } = await sb.from("court_blocks").delete().eq("id", id);
  if (error) return actionError(error.message);
  revalidatePath(`/admin/venues/${venue_id}/calendar`);
}

// ── BOOKINGS via the atomic RPC (never read-check-write) ─────────
export async function bookCourt(input: {
  court_id: string;
  venue_id: string;
  starts_at: string;
  ends_at: string;
  customer_name?: string;
  phone?: string;
  source?: "platform" | "walk_in" | "phone";
  // "Open this slot to other players" — captured here, not acted on
  // until payment is approved (see book_court()/maybe_publish_hosted_event()
  // in supabase/payments.sql). Only meaningful for source:"platform".
  need_players?: boolean;
  spots_needed?: number;
  skill_level?: string;
  bring_own_gear?: boolean;
  notes?: string;
}) {
  const { sb, user } = await requireUser();
  if (!user) return actionError("UNAUTHORIZED");
  // Unknown/missing source is treated as a normal player booking, never
  // a staff walk-in (which lands 'confirmed' with no payment). Staff
  // access for walk_in/phone is enforced in book_court() itself
  // (supabase/booking_payment_gated.sql).
  const source = input.source ?? "platform";
  const phone = input.phone?.trim() || null;
  if (phone && !isValidLocalPhone(phone)) {
    return actionError("Phone number must contain exactly 10 digits.");
  }
  const { data, error } = await sb.rpc("book_court", {
    p_court_id: input.court_id,
    p_starts_at: input.starts_at,
    p_ends_at: input.ends_at,
    p_user_id: source !== "platform" ? null : user.id,
    p_customer: input.customer_name ?? null,
    p_source: source,
    p_host_spots_needed: input.need_players ? input.spots_needed ?? null : null,
    p_host_skill_level: input.need_players ? input.skill_level ?? null : null,
    p_host_bring_gear: input.need_players ? input.bring_own_gear ?? null : null,
    p_host_notes: input.need_players ? input.notes ?? null : null,
    p_phone: phone,
  });
  if (error) {
    const friendly = friendlyBookingError(error.message);
    if (friendly !== error.message) return actionError(friendly);
    console.error("[bookCourt]", error.message);
    return actionError("Could not book this slot. Please try again.");
  }
  revalidatePath(`/admin/venues/${input.venue_id}/calendar`);

  const price = Number(data?.price) || 0;
  const isPendingPlatformPayment = source === "platform" && price > 0;

  // Walk-in/phone bookings (staff-entered, already 'confirmed', no
  // payment flow applies) and free platform bookings still get the
  // immediate "booked" email. A paid platform booking isn't real until
  // admin approves the payment — notifyPaymentReviewed() sends the
  // "confirmed" email then; sending this one too would tell the
  // customer it's already paid when it isn't. Never let email failure
  // undo a successful booking — notify() swallows its own errors.
  if (!isPendingPlatformPayment) {
    const { data: court } = await sb.from("courts").select("name").eq("id", input.court_id).maybeSingle();
    await notifyCourtBooked({
      playerId: source === "platform" ? user.id : null,
      venueId: input.venue_id,
      courtName: court?.name ?? "Court",
      startsAt: input.starts_at,
      endsAt: input.ends_at,
      price,
      customerName: input.customer_name ?? null,
    });
  }

  return data;
}

export async function setBookingState(id: string, venue_id: string, state: string) {
  const { sb, user } = await requireUser();
  if (!user) return actionError("UNAUTHORIZED");
  // bk_staff_all (admin_schema.sql) only requires 'staff', not 'manager'.
  if (!(await requireVenueAccess(sb, venue_id, "staff"))) return actionError("FORBIDDEN");
  if (!BOOKING_STATES.has(state)) return actionError("That isn't a valid booking status.");
  const { error } = await sb.from("court_bookings").update({ state }).eq("id", id);
  if (error) { console.error("[setBookingState]", error.message); return actionError("Could not update that booking."); }
  revalidatePath(`/admin/venues/${venue_id}/bookings`);
  revalidatePath(`/admin/venues/${venue_id}/calendar`);
}

// Marks a partially-paid booking's remaining balance as collected in
// person (cash etc. at the venue) — the advance-payment counterpart to
// setBookingState() above, same staff gate. See RUN_ME_advance_payment.sql
// / mark_balance_collected().
export async function markBalanceCollected(id: string, venue_id: string) {
  const { sb, user } = await requireUser();
  if (!user) return actionError("UNAUTHORIZED");
  if (!(await requireVenueAccess(sb, venue_id, "staff"))) return actionError("FORBIDDEN");
  const { data, error } = await sb.rpc("mark_balance_collected", { p_booking_id: id });
  if (error) return actionError(friendlyPaymentError(error.message));
  revalidatePath("/admin/bookings");
  revalidatePath(`/admin/venues/${venue_id}/bookings`);
  revalidatePath(`/admin/venues/${venue_id}/calendar`);
  return data;
}

// ── PRICING RULES ────────────────────────────────────────────────
export async function createPricingRule(input: {
  court_id: string;
  venue_id: string;
  label: string;
  kind: string;
  amount: number;
  days: number[];
  start_time?: string | null;
  end_time?: string | null;
  priority?: number;
}) {
  const { sb, user } = await requireUser();
  if (!user) return actionError("UNAUTHORIZED");
  const { venue_id, ...row } = input;
  if (!(await requireVenueAccess(sb, venue_id))) return actionError("FORBIDDEN");
  const { data, error } = await sb.from("pricing_rules").insert(pickPricingFields(row)).select().single();
  if (error) return actionError(error.message);
  revalidatePath(`/admin/venues/${venue_id}/pricing`);
  return data;
}

export async function togglePricingRule(id: string, venue_id: string, active: boolean) {
  const { sb, user } = await requireUser();
  if (!user) return actionError("UNAUTHORIZED");
  if (!(await requireVenueAccess(sb, venue_id))) return actionError("FORBIDDEN");
  const { error } = await sb.from("pricing_rules").update({ active }).eq("id", id);
  if (error) return actionError(error.message);
  revalidatePath(`/admin/venues/${venue_id}/pricing`);
}

// ── STAFF ────────────────────────────────────────────────────────
// Turns an email into the user_id addStaff() needs — the invite form only
// ever has the email an owner types in. Distinct from tournaments'
// findUserByEmail() (super_admin-only, for granting tournament managers);
// this one is gated to "owns at least one venue" (see
// find_user_for_staff_invite() in RUN_ME_staff_invite_lookup.sql).
export async function findUserForStaffInvite(email: string): Promise<{ id: string; full_name: string | null; email: string } | ActionError> {
  const { sb, user } = await requireUser();
  if (!user) return actionError("UNAUTHORIZED");
  const { data, error } = await sb.rpc("find_user_for_staff_invite", { p_email: email }).maybeSingle();
  if (error) return actionError(error.message);
  if (!data) return actionError("USER_NOT_FOUND");
  return data as { id: string; full_name: string | null; email: string };
}

export async function addStaff(input: { venue_id: string; user_id: string; role: string }) {
  const { sb, user } = await requireUser();
  if (!user) return actionError("UNAUTHORIZED");
  // RLS (staff_owner_all in admin_schema.sql) would reject this insert
  // anyway, but that surfaces as a raw Postgres error — check here too so
  // a non-owner gets a clean message instead of a database internals leak.
  const { data: canManage } = await sb.rpc("has_venue_access", { v_id: input.venue_id, min_role: "owner" });
  if (!canManage) return actionError("FORBIDDEN");
  const { error } = await sb.from("venue_staff").insert(input);
  if (error) return actionError(error.code === "23505" ? "That person is already on the team." : error.message);
  revalidatePath("/admin/staff");
}
