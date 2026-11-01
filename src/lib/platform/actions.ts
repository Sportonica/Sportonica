"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { actionError, type ActionError, dbActionError } from "@/lib/actionError";
import { isValidLocalPhone, normalizePhone, PHONE_ERROR } from "@/lib/validation/identity";
import { amountPaid, balanceDue, BOOKING_STATE_LABELS, nepalInstant, paymentPatch, type PaymentPatch } from "./bookingEdit";
import type { User } from "@supabase/supabase-js";

// Registering for a tournament while logged out silently creates an
// anonymous auth.users row (TournamentRegisterTab's signInAnonymously()),
// and the handle_new_user() DB trigger gives every auth.users row a
// profiles row regardless — so drive-by visitors who never actually sign
// up otherwise show up here as blank "player" accounts. Filter them out
// of platform-facing counts/lists until the trigger itself is fixed to
// skip anonymous inserts.
async function anonymousProfileIds(): Promise<Set<string>> {
  const admin = createServiceClient();
  const ids = new Set<string>();
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !data || data.users.length === 0) break;
    for (const u of data.users) if (u.is_anonymous) ids.add(u.id);
    if (data.users.length < 1000) break;
  }
  return ids;
}

type SuperAdminAuth =
  | { error: ActionError; sb?: undefined; user?: undefined }
  | { error?: undefined; sb: Awaited<ReturnType<typeof createClient>>; user: User };

// Every platform action re-checks the role in the DATABASE — the UI gate
// alone is not security. is_super_admin() runs as the definer, so it can
// read the role even under RLS.
async function requireSuperAdmin(): Promise<SuperAdminAuth> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: actionError("UNAUTHORIZED") };
  const { data } = await sb.rpc("is_super_admin");
  if (!data) return { error: actionError("FORBIDDEN") };
  return { sb, user };
}

export async function getPlatformRole(): Promise<string | null> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data } = await sb.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return data?.role ?? null;
}

// ── Overview data ───────────────────────────────────────────────
export async function platformOverview() {
  const auth = await requireSuperAdmin();
  if (auth.error) return auth.error;
  const { sb } = auth;

  const [venues, pending, profileIds, bookings, anonIds] = await Promise.all([
    sb.from("venues").select("id", { count: "exact", head: true }),
    sb.from("venues").select("id", { count: "exact", head: true }).eq("verification_status", "pending"),
    sb.from("profiles").select("id"),
    sb.from("court_bookings").select("id", { count: "exact", head: true }),
    anonymousProfileIds(),
  ]);
  const realUsers = (profileIds.data ?? []).filter((p) => !anonIds.has(p.id)).length;

  return {
    venues: venues.count ?? 0,
    pending: pending.count ?? 0,
    users: realUsers,
    bookings: bookings.count ?? 0,
  };
}

export async function allVenuesForPlatform() {
  const auth = await requireSuperAdmin();
  if (auth.error) return auth.error;
  const { sb } = auth;
  const { data } = await sb
    .from("venues")
    .select("id, name, venue_type, address, verification_status, status, created_at, owner_id")
    .order("created_at", { ascending: false })
    .limit(500);

  // attach owner names
  const ownerIds = [...new Set((data ?? []).map((v) => v.owner_id).filter(Boolean))];
  const { data: owners } = ownerIds.length
    ? await sb.from("profiles").select("id, full_name, name").in("id", ownerIds)
    : { data: [] as { id: string; full_name: string | null; name: string | null }[] };
  const ownerMap = new Map((owners ?? []).map((o) => [o.id, o.full_name ?? o.name ?? "—"]));

  return (data ?? []).map((v) => ({ ...v, owner: ownerMap.get(v.owner_id) ?? "—" }));
}

// ── Venue approval (the trust gate) ─────────────────────────────
// ── All bookings across every venue ─────────────────────────────
export async function allBookingsForPlatform() {
  const auth = await requireSuperAdmin();
  if (auth.error) return auth.error;
  const { sb } = auth;
  // court_bookings has no `status` column (that was the bug making this
  // page render empty — the query errored and the discarded error left
  // `data` as null). The real columns are `state` and `payment_status`.
  const { data, error } = await sb
    .from("court_bookings")
    .select("id, starts_at, ends_at, price, state, payment_status, advance_amount, source, customer_name, phone, venue_id, court_id, user_id, hosted_event_id, updated_at")
    .order("starts_at", { ascending: false })
    .limit(500);
  if (error) return dbActionError(error);

  const bookingIds = (data ?? []).map((b) => b.id);
  const venueIds = [...new Set((data ?? []).map((b) => b.venue_id).filter(Boolean))];
  const userIds = [...new Set((data ?? []).map((b) => b.user_id).filter(Boolean))];
  const [{ data: venues }, { data: courts }, { data: players }, { data: payments }] = await Promise.all([
    venueIds.length
      ? sb.from("venues").select("id, name").in("id", venueIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    venueIds.length
      ? sb.from("courts").select("id, name, venue_id").in("venue_id", venueIds).order("name")
      : Promise.resolve({ data: [] as { id: string; name: string; venue_id: string }[] }),
    userIds.length
      ? sb.from("profiles").select("id, full_name, name").in("id", userIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null; name: string | null }[] }),
    // Connect each booking to the payment that verified it — method +
    // transaction id, for the super-admin's "who approved this and how".
    bookingIds.length
      ? sb.from("payments")
          .select("court_booking_id, payment_method, transaction_id, status")
          .eq("booking_type", "court_booking")
          .in("court_booking_id", bookingIds)
          .order("submitted_at", { ascending: false })
      : Promise.resolve({ data: [] as { court_booking_id: string | null; payment_method: string; transaction_id: string; status: string }[] }),
  ]);
  const vMap = new Map((venues ?? []).map((v) => [v.id, v.name]));
  // A booking can have more than one payment attempt (rejected, then
  // resubmitted) — rows are newest-first, so the first one seen per
  // booking is the latest attempt.
  const payMap = new Map<string, { payment_method: string; transaction_id: string; status: string }>();
  for (const p of payments ?? []) {
    if (p.court_booking_id && !payMap.has(p.court_booking_id)) {
      payMap.set(p.court_booking_id, { payment_method: p.payment_method, transaction_id: p.transaction_id, status: p.status });
    }
  }

  const courtMap = new Map((courts ?? []).map((c) => [c.id, c.name]));
  const playerMap = new Map((players ?? []).map((p) => [p.id, p.full_name ?? p.name]));

  return (data ?? []).map((b) => ({
    ...b,
    venue: vMap.get(b.venue_id) ?? "—",
    court: courtMap.get(b.court_id) ?? "—",
    venue_courts: (courts ?? []).filter((c) => c.venue_id === b.venue_id).map((c) => ({ id: c.id, name: c.name })),
    customer: b.customer_name ?? (b.user_id ? playerMap.get(b.user_id) : null) ?? "Player",
    amount_paid: amountPaid(b),
    balance_due: balanceDue(b),
    state_label: BOOKING_STATE_LABELS[b.state] ?? b.state,
    payment_method: payMap.get(b.id)?.payment_method ?? null,
    transaction_id: payMap.get(b.id)?.transaction_id ?? null,
  }));
}

// ── Edit any booking: plans change at the last minute ───────────
// Service client after the role check: bk_staff_all is venue-staff only.
// The no-overlap constraint still refuses a clash between booked slots.
export async function editBookingAsPlatform(input: {
  id: string;
  loaded_updated_at: string;
  customer_name: string;
  phone: string;
  court_id: string;
  date: string;
  start_time: string;
  end_time: string;
  price: number;
  amount_paid: number;
  state: string;
}) {
  const auth = await requireSuperAdmin();
  if (auth.error) return auth.error;
  const admin = createServiceClient();

  const name = input.customer_name.trim().replace(/\s+/g, " ");
  if (name.length > 80) return actionError("Customer name is too long.");
  if (input.phone && !isValidLocalPhone(input.phone)) return actionError(PHONE_ERROR);
  if (!BOOKING_STATE_LABELS[input.state]) return actionError("Pick what happened with this booking.");
  for (const n of [input.price, input.amount_paid]) {
    if (!Number.isFinite(n) || n < 0 || n > 9_999_999) return actionError("Enter the amounts as plain numbers, like 1500.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^\d{2}:\d{2}$/.test(input.start_time) || !/^\d{2}:\d{2}$/.test(input.end_time)) {
    return actionError("Enter the date and both times.");
  }
  const startsAt = nepalInstant(input.date, input.start_time);
  const endsAt = nepalInstant(input.date, input.end_time);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return actionError("Enter a real date and time.");
  if (endsAt <= startsAt) return actionError("End time must be after start time.");

  const { data: current, error: readError } = await admin
    .from("court_bookings")
    .select("id, venue_id, court_id, starts_at, ends_at, price, state, payment_status, advance_amount, balance_collected_at, balance_collected_by, hosted_event_id, updated_at")
    .eq("id", input.id)
    .maybeSingle();
  if (readError) return dbActionError(readError);
  if (!current) return actionError("This booking no longer exists.");
  // e.g. the venue checked the player in, or a payment was approved, while the form was open
  if (current.updated_at !== input.loaded_updated_at) {
    return actionError("This booking changed while you were editing. Close this form, refresh the page and try again.");
  }

  const moved = input.court_id !== current.court_id
    || startsAt.getTime() !== new Date(current.starts_at).getTime()
    || endsAt.getTime() !== new Date(current.ends_at).getTime();
  if (moved) {
    if (current.hosted_event_id) return actionError("This slot belongs to a hosted Play Together game, so its court and time can't be changed here.");
    const { data: court } = await admin.from("courts").select("venue_id").eq("id", input.court_id).maybeSingle();
    if (court?.venue_id !== current.venue_id) return actionError("Pick a court at this venue.");
    const { count, error: blockError } = await admin
      .from("court_blocks")
      .select("id", { count: "exact", head: true })
      .eq("court_id", input.court_id)
      .lt("starts_at", endsAt.toISOString())
      .gt("ends_at", startsAt.toISOString());
    if (blockError) return dbActionError(blockError);
    if (count) return actionError("The venue has blocked this court for that time. Pick another time or remove the block first.");
  }

  const price = Math.round(input.price * 100) / 100;
  let money: PaymentPatch | null;
  try {
    money = paymentPatch(current, { price, amountPaid: Math.round(input.amount_paid * 100) / 100, state: input.state }, auth.user.id, new Date().toISOString());
  } catch (e) {
    return actionError(e instanceof Error ? e.message : "Could not update the payment.");
  }

  // Same as approving a payment: money recorded on a waiting booking confirms it.
  const nowPaying = money ? money.payment_status === "paid" || money.payment_status === "partial" : false;
  const state = input.state === "reserved" && nowPaying ? "confirmed" : input.state;

  const { error } = await admin
    .from("court_bookings")
    .update({
      customer_name: name || null,
      phone: input.phone ? normalizePhone(input.phone) : null,
      court_id: input.court_id,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      state,
      ...money,
    })
    .eq("id", input.id);
  if (error) {
    if (error.code === "23P01" || error.message === "SLOT_ALREADY_BOOKED") {
      return actionError("Another booking already has this court at that time. Move that one first or pick another time.");
    }
    return dbActionError(error, "Could not save this booking. Try again.");
  }

  // Revenue reads the ledger, so it follows the new price until the venue is paid out.
  if (money && price !== Number(current.price)) {
    const { data: rows, error: ledgerReadError } = await admin
      .from("commission_ledger")
      .select("id, commission_rate")
      .eq("booking_id", input.id)
      .eq("payout_status", "pending");
    if (ledgerReadError) console.error("[editBookingAsPlatform] ledger", ledgerReadError.message);
    for (const row of rows ?? []) {
      // commission_rate is a percentage (5, 10)
      const commission = Math.round(price * Number(row.commission_rate)) / 100;
      const { error: ledgerError } = await admin
        .from("commission_ledger")
        .update({ gross: price, commission, venue_payout: price - commission })
        .eq("id", row.id);
      if (ledgerError) console.error("[editBookingAsPlatform] ledger", ledgerError.message);
    }
  }

  revalidatePath("/platform/bookings");
  revalidatePath("/platform/revenue");
  revalidatePath("/admin/bookings");
  revalidatePath(`/admin/venues/${current.venue_id}/bookings`);
  revalidatePath(`/admin/venues/${current.venue_id}/calendar`);
  return { ok: true as const };
}

// ── All users on the platform ───────────────────────────────────
export async function allUsersForPlatform() {
  const auth = await requireSuperAdmin();
  if (auth.error) return auth.error;
  // profiles.city is column-hidden from `authenticated` (SEC-02b), so the
  // user-scoped client errors on this select. Read through the service
  // client — safe only because requireSuperAdmin() passed above.
  const admin = createServiceClient();
  const [{ data, error }, anonIds] = await Promise.all([
    admin
      .from("profiles")
      .select("id, full_name, name, username, role, trust_score, city, is_public")
      .order("trust_score", { ascending: false })
      .limit(500),
    anonymousProfileIds(),
  ]);
  if (error) return dbActionError(error);
  return (data ?? [])
    .filter((u) => !anonIds.has(u.id))
    .map((u) => ({
      ...u,
      display_name: u.full_name ?? u.name ?? u.username ?? "—",
    }));
}

// ── Change a user's role (promote to venue_owner, etc.) ─────────
export async function setUserRole(userId: string, role: "player" | "venue_owner" | "super_admin") {
  const auth = await requireSuperAdmin();
  if (auth.error) return auth.error;
  const { error } = await auth.sb.from("profiles").update({ role }).eq("id", userId);
  if (error) return dbActionError(error);
  revalidatePath("/platform/users");
}

// ── Revenue: totals + per-venue payouts (Step 4) ────────────────
export async function platformRevenue() {
  const auth = await requireSuperAdmin();
  if (auth.error) return auth.error;
  const { sb } = auth;

  const { data: totals } = await sb
    .from("commission_ledger")
    .select("gross, commission, venue_payout, payout_status");

  const rows = totals ?? [];
  const gross = rows.reduce((s, r) => s + Number(r.gross || 0), 0);
  const commission = rows.reduce((s, r) => s + Number(r.commission || 0), 0);
  const payoutPending = rows
    .filter((r) => r.payout_status === "pending")
    .reduce((s, r) => s + Number(r.venue_payout || 0), 0);

  const { data: byVenue } = await sb
    .from("venue_payouts")
    .select("*")
    .order("payout_total", { ascending: false });

  return {
    gross, commission, payoutPending,
    bookings: rows.length,
    venues: (byVenue ?? []).map((v) => ({
      ...v,
      venue_name: v.venue_name ?? "—",
    })),
  };
}

// Mark a venue's pending payouts as paid (real payment wired later).
export async function markVenuePaid(venueId: string) {
  const auth = await requireSuperAdmin();
  if (auth.error) return auth.error;
  const { error } = await auth.sb
    .from("commission_ledger")
    .update({ payout_status: "paid" })
    .eq("venue_id", venueId)
    .eq("payout_status", "pending");
  if (error) return dbActionError(error);
  revalidatePath("/platform/revenue");
}

// ── Moderation: reports queue ───────────────────────────────────
export async function allReports() {
  const auth = await requireSuperAdmin();
  if (auth.error) return auth.error;
  const { sb } = auth;
  const { data } = await sb
    .from("reports")
    .select("id, reporter_id, target_type, target_id, reason, details, status, created_at")
    .order("created_at", { ascending: false })
    .limit(300);

  const ids = [...new Set((data ?? []).map((r) => r.reporter_id))];
  const { data: profiles } = ids.length
    ? await sb.from("profiles").select("id, full_name, name, username").in("id", ids)
    : { data: [] as { id: string; full_name: string | null; name: string | null; username: string | null }[] };
  const pMap = new Map((profiles ?? []).map((p) => [p.id, p.full_name ?? p.name ?? p.username ?? "—"]));

  return (data ?? []).map((r) => ({ ...r, reporter: pMap.get(r.reporter_id) ?? "—" }));
}

export async function setReportStatus(reportId: string, status: "reviewed" | "dismissed" | "open") {
  const auth = await requireSuperAdmin();
  if (auth.error) return auth.error;
  const { error } = await auth.sb.from("reports").update({ status }).eq("id", reportId);
  if (error) return dbActionError(error);
  revalidatePath("/platform/reports");
}

export async function setVenueVerification(venueId: string, status: "verified" | "rejected" | "pending") {
  const auth = await requireSuperAdmin();
  if (auth.error) return auth.error;
  const { error } = await auth.sb
    .from("venues")
    .update({ verification_status: status })
    .eq("id", venueId);
  if (error) return dbActionError(error);
  revalidatePath("/platform");
}
