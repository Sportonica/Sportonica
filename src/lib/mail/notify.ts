// ================================================================
// Notifications: the "who gets told what" layer.
//
// This sits between your actions (booking, joining) and the mailer.
// Actions call these; they gather the right recipients, pick a
// template, and hand it to sendMail. Nothing here knows about SMTP.
// ================================================================

import { createClient } from "@/lib/supabase/server";
import { sendMail } from "./mailer";
import {
  playerBooked, venueNewBooking, venueAdvancePaymentApproved, hostGameLive, playerJoined, hostSomeoneJoined,
  paymentSubmitted, paymentApproved, paymentRejected,
  playTogetherGamePublished, playTogetherPlayerJoined, playTogetherHostRosterChanged,
  playTogetherGameCancelled, playTogetherJoinRequested, playTogetherJoinRejected,
  playTogetherPaymentRequired, playTogetherPaymentSubmitted, playTogetherPaymentRejected,
  playTogetherPlayerJoinedCash, playTogetherCashPaymentSelected,
} from "./templates";
import { REJECTION_REASONS, bookingLabel } from "@/lib/payments/types";
import { PLAY_TOGETHER_PAYMENT_REJECTION_REASONS } from "@/lib/playTogether/types";

// Emails live in auth.users, not profiles — so we need the admin API to
// read them. Falls back to null rather than throwing: a missing email
// should never break a booking.
async function emailFor(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  try {
    const res = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const u = await res.json();
    return u?.email ?? null;
  } catch {
    return null;
  }
}

async function nameFor(userId: string | null | undefined): Promise<string> {
  if (!userId) return "Player";
  const sb = await createClient();
  const { data } = await sb.from("profiles").select("full_name, name").eq("id", userId).maybeSingle();
  return data?.full_name ?? data?.name ?? "Player";
}

// Writes go through emit_notification() (SECURITY DEFINER) instead of a
// direct table insert — it checks that both the caller and the recipient
// have real standing on the referenced game/event/tournament before the
// row is written (see db/emit_notification.sql). This replaced a blanket
// `with check (true)` insert policy that let any signed-in user write a
// notification for any other user, claiming anything.
//
// A rejected or failed write never breaks the action that triggered it —
// the booking/payment/join it describes already succeeded, and a
// notification is best-effort. It's logged instead of thrown, matching
// every existing call site here (none of them wrap notify*() in
// try/catch further up the stack).
type NotificationInput = {
  userId: string;
  kind: string;
  title: string;
  body?: string | null;
  eventId?: string | null;
  actorId?: string | null;
  gameId?: string | null;
  tournamentId?: string | null;
};

async function writeNotification(
  sb: Awaited<ReturnType<typeof createClient>>,
  input: NotificationInput
) {
  const { error } = await sb.rpc("emit_notification", {
    p_user_id: input.userId,
    p_kind: input.kind,
    p_title: input.title,
    p_body: input.body ?? null,
    p_event_id: input.eventId ?? null,
    p_actor_id: input.actorId ?? null,
    p_game_id: input.gameId ?? null,
    p_tournament_id: input.tournamentId ?? null,
  });
  if (error) {
    console.error("[notify] emit_notification failed", { kind: input.kind, error: error.message });
  }
}

// ── A court was booked ──────────────────────────────────────────
export async function notifyCourtBooked(input: {
  playerId: string | null;
  venueId: string;
  courtName: string;
  startsAt: string;
  endsAt: string;
  price: number;
  customerName?: string | null;
}) {
  const sb = await createClient();

  const { data: venue } = await sb
    .from("venues").select("name, owner_id").eq("id", input.venueId).maybeSingle();
  if (!venue) return;

  const [playerEmail, ownerEmail, playerName] = await Promise.all([
    emailFor(input.playerId),
    emailFor(venue.owner_id),
    input.customerName ? Promise.resolve(input.customerName) : nameFor(input.playerId),
  ]);

  const mails = [];
  if (playerEmail) {
    mails.push(playerBooked({
      to: playerEmail, playerName, venue: venue.name, court: input.courtName,
      startsAt: input.startsAt, endsAt: input.endsAt, price: input.price,
    }));
  }
  if (ownerEmail) {
    mails.push(venueNewBooking({
      to: ownerEmail, venue: venue.name, court: input.courtName,
      playerName, startsAt: input.startsAt, price: input.price,
    }));
  }
  if (mails.length) await sendMail(mails);
}

// ── A host opened a game to players ─────────────────────────────
export async function notifyGameHosted(input: {
  hostId: string;
  sport: string;
  venue: string;
  startsAt: string;
  spots: number;
  perHead: number;
  origin: string;
}) {
  const [to, hostName] = await Promise.all([emailFor(input.hostId), nameFor(input.hostId)]);
  if (!to) return;
  await sendMail(hostGameLive({
    to, hostName, sport: input.sport, venue: input.venue,
    startsAt: input.startsAt, spots: input.spots, perHead: input.perHead,
    link: `${input.origin}/discover`,
  }));
}

// A court booking's "host a game" flag only actually creates the public
// event once payment is approved (or immediately for a free court) —
// see maybe_publish_hosted_event() in supabase/payments.sql. This is the
// notification counterpart, called right after that RPC path succeeds so
// "your game is live" only ever goes out once the event genuinely exists.
export async function notifyHostedEventIfPublished(courtBookingId: string) {
  const sb = await createClient();
  const { data: booking } = await sb
    .from("court_bookings").select("user_id, hosted_event_id").eq("id", courtBookingId).maybeSingle();
  if (!booking?.hosted_event_id) return;

  const { data: event } = await sb
    .from("events").select("sport, venue, event_date, max_players, fee")
    .eq("id", booking.hosted_event_id).maybeSingle();
  if (!event) return;

  await notifyGameHosted({
    hostId: booking.user_id,
    sport: event.sport,
    venue: event.venue,
    startsAt: event.event_date,
    spots: Math.max((event.max_players ?? 1) - 1, 0),
    perHead: Number(event.fee) || 0,
    origin: process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
  });
}

// ── Someone joined a game ───────────────────────────────────────
export async function notifyGameJoined(input: {
  joinerId: string;
  eventId: string;
}) {
  const sb = await createClient();

  const { data: ev } = await sb
    .from("events_with_counts")
    .select("host_id, sport, venue, event_date, fee, slots_remaining")
    .eq("id", input.eventId)
    .maybeSingle();
  if (!ev) return;

  const [joinerEmail, joinerName, hostEmail, hostName] = await Promise.all([
    emailFor(input.joinerId), nameFor(input.joinerId),
    emailFor(ev.host_id), nameFor(ev.host_id),
  ]);

  const mails = [];
  if (joinerEmail) {
    mails.push(playerJoined({
      to: joinerEmail, playerName: joinerName, sport: ev.sport,
      venue: ev.venue, startsAt: ev.event_date, fee: Number(ev.fee) || 0,
    }));
  }
  // Don't email the host about their own join.
  if (hostEmail && ev.host_id !== input.joinerId) {
    mails.push(hostSomeoneJoined({
      to: hostEmail, hostName, joinerName, sport: ev.sport,
      startsAt: ev.event_date, spotsLeft: Number(ev.slots_remaining) || 0,
    }));
  }
  if (mails.length) await sendMail(mails);
}

// ── Play Together ────────────────────────────────────────────────
async function playTogetherContext(gameId: string) {
  const sb = await createClient();
  const { data: game } = await sb
    .from("games")
    .select("id, host_id, sport, starts_at, max_players, contribution_amount, venue_id")
    .eq("id", gameId)
    .maybeSingle();
  if (!game) return null;

  const [{ data: venue }, { count: joinedCount }] = await Promise.all([
    sb.from("venues").select("name").eq("id", game.venue_id).maybeSingle(),
    sb.from("game_players").select("id", { count: "exact", head: true })
      .eq("game_id", gameId).eq("status", "joined"),
  ]);

  return {
    game,
    venueName: venue?.name ?? "the venue",
    spotsLeft: Math.max(game.max_players - 1 - (joinedCount ?? 0), 0),
  };
}

// A court booking's Play Together game only actually goes live once the
// host's venue payment is confirmed (finalize_play_together_game() in
// supabase/play_together.sql). Called right after that RPC path succeeds,
// mirroring notifyHostedEventIfPublished().
export async function notifyPlayTogetherGamePublishedIfAny(courtBookingId: string) {
  const sb = await createClient();
  const { data: game } = await sb
    .from("games")
    .select("id, host_id, sport, starts_at, max_players, contribution_amount, venue_id, status")
    .eq("court_booking_id", courtBookingId)
    .maybeSingle();
  if (!game || game.status !== "published") return;

  const { data: venue } = await sb.from("venues").select("name").eq("id", game.venue_id).maybeSingle();
  const [to, hostName] = await Promise.all([emailFor(game.host_id), nameFor(game.host_id)]);

  if (to) {
    await sendMail(playTogetherGamePublished({
      to, hostName, sport: game.sport, venue: venue?.name ?? "the venue",
      startsAt: game.starts_at, spots: Math.max(game.max_players - 1, 0),
      contribution: Number(game.contribution_amount) || 0,
      link: `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/play-together`,
    }));
  }

  await writeNotification(sb, {
    userId: game.host_id,
    kind: "game_published",
    title: "Your venue is confirmed",
    body: `Your ${game.sport} game is now live on Play Together.`,
    gameId: game.id,
  });
}

// ── A player requested to join — tell the HOST only. The player hears
// nothing until the host actually reviews it (see notifyPlayTogetherJoined
// / notifyPlayTogetherJoinRejected below, fired from approveJoinRequest()).
export async function notifyPlayTogetherJoinRequested(input: { requesterId: string; gameId: string }) {
  const ctx = await playTogetherContext(input.gameId);
  if (!ctx) return;
  const { game } = ctx;
  if (game.host_id === input.requesterId) return;

  const [hostEmail, hostName, requesterName] = await Promise.all([
    emailFor(game.host_id), nameFor(game.host_id), nameFor(input.requesterId),
  ]);
  if (hostEmail) {
    await sendMail(playTogetherJoinRequested({
      to: hostEmail, hostName, requesterName, sport: game.sport, startsAt: game.starts_at,
    }));
  }

  const sb = await createClient();
  await writeNotification(sb, {
    userId: game.host_id,
    kind: "game_join_requested",
    title: "New join request",
    body: `${requesterName} wants to join your ${game.sport} game.`,
    gameId: game.id,
    actorId: input.requesterId,
  });
}

// ── Host approved the request — the player must now pay within the
// 2-hour window. Deliberately NOT a "you're in" notification — the
// player isn't a confirmed member yet, only the host's payment
// verification (notifyPlayTogetherPaymentVerified, fired from
// verifyPlayTogetherPayment()) sends that. ────────────────────────────
export async function notifyPlayTogetherPaymentRequired(input: { playerId: string; gameId: string }) {
  const ctx = await playTogetherContext(input.gameId);
  if (!ctx) return;
  const { game, venueName } = ctx;

  const sb = await createClient();
  const { data: row } = await sb
    .from("game_players").select("payment_deadline, contribution_amount")
    .eq("game_id", input.gameId).eq("user_id", input.playerId).maybeSingle();
  if (!row?.payment_deadline) return;

  const [playerEmail, playerName] = await Promise.all([emailFor(input.playerId), nameFor(input.playerId)]);
  const link = `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/play-together/${input.gameId}`;
  if (playerEmail) {
    await sendMail(playTogetherPaymentRequired({
      to: playerEmail, playerName, sport: game.sport, venue: venueName,
      startsAt: game.starts_at, contribution: Number(row.contribution_amount) || 0,
      deadline: row.payment_deadline, link,
    }));
  }

  await writeNotification(sb, {
    userId: input.playerId,
    kind: "game_payment_required",
    title: "Payment required",
    body: `Complete your Rs ${Math.round(Number(row.contribution_amount) || 0)} payment within 2 hours to secure your spot in the ${game.sport} game.`,
    gameId: game.id,
  });
}

// ── Player submitted payment proof — tell the HOST it needs review, and
// tell the player their proof went in. Neither means they're in yet. ──
export async function notifyPlayTogetherPaymentSubmitted(input: { gamePlayerId: string; gameId: string }) {
  const sb = await createClient();
  const { data: row } = await sb
    .from("game_players")
    .select("user_id, contribution_amount, payment_method, transaction_id")
    .eq("id", input.gamePlayerId).maybeSingle();
  if (!row) return;

  const ctx = await playTogetherContext(input.gameId);
  if (!ctx) return;
  const { game } = ctx;

  const [hostEmail, hostName, playerName] = await Promise.all([
    emailFor(game.host_id), nameFor(game.host_id), nameFor(row.user_id),
  ]);
  const link = `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/play-together/${input.gameId}/manage`;
  if (hostEmail) {
    await sendMail(playTogetherPaymentSubmitted({
      to: hostEmail, hostName, playerName, sport: game.sport,
      amount: Number(row.contribution_amount) || 0,
      method: row.payment_method ?? "host_qr", transactionId: row.transaction_id ?? "—", link,
    }));
  }

  await Promise.all([
    writeNotification(sb, {
      userId: game.host_id, kind: "game_host_payment_submitted", title: "Payment verification required",
      body: `${playerName} submitted payment proof for your ${game.sport} game. Review it.`,
      gameId: game.id, actorId: row.user_id,
    }),
    writeNotification(sb, {
      userId: row.user_id, kind: "game_payment_submitted", title: "Payment submitted",
      body: `Your payment proof for the ${game.sport} game was submitted. Waiting on the host to verify it.`,
      gameId: game.id,
    }),
  ]);
}

// ── Player chose "pay in cash at the venue" instead of paying online —
// they're confirmed immediately (see choose_play_together_cash_payment()
// in supabase/play_together_cash_payment.sql), so this is both a "you're
// in" email to the player and a heads-up to the host that there's
// nothing to verify, just cash to collect at the venue. ───────────────
export async function notifyPlayTogetherCashSelected(input: { gamePlayerId: string; gameId: string }) {
  const sb = await createClient();
  const { data: row } = await sb
    .from("game_players").select("user_id, contribution_amount")
    .eq("id", input.gamePlayerId).maybeSingle();
  if (!row) return;

  const ctx = await playTogetherContext(input.gameId);
  if (!ctx) return;
  const { game, venueName } = ctx;
  const amount = Number(row.contribution_amount) || 0;

  const [hostEmail, hostName, playerEmail, playerName] = await Promise.all([
    emailFor(game.host_id), nameFor(game.host_id), emailFor(row.user_id), nameFor(row.user_id),
  ]);
  if (hostEmail) {
    await sendMail(playTogetherCashPaymentSelected({ to: hostEmail, hostName, playerName, sport: game.sport, amount }));
  }
  if (playerEmail) {
    await sendMail(playTogetherPlayerJoinedCash({
      to: playerEmail, playerName, sport: game.sport, venue: venueName, startsAt: game.starts_at, contribution: amount,
    }));
  }

  await Promise.all([
    writeNotification(sb, {
      userId: game.host_id, kind: "game_payment_cash_selected", title: "Player will pay in cash",
      body: `${playerName} chose to pay Rs ${Math.round(amount)} in cash at the venue for your ${game.sport} game. They're confirmed. Mark it collected once they've paid.`,
      gameId: game.id, actorId: row.user_id,
    }),
    writeNotification(sb, {
      userId: row.user_id, kind: "game_joined", title: "You're in!",
      body: `You're confirmed for the ${game.sport} game. Bring Rs ${Math.round(amount)} in cash to pay the host at the venue.`,
      gameId: game.id,
    }),
  ]);
}

// ── Host rejected the payment proof — player may resubmit if their
// window hasn't closed. ────────────────────────────────────────────
export async function notifyPlayTogetherPaymentRejected(input: { playerId: string; gameId: string; reason: string | null }) {
  const ctx = await playTogetherContext(input.gameId);
  if (!ctx) return;
  const { game, venueName } = ctx;
  const reasonLabel = input.reason
    ? PLAY_TOGETHER_PAYMENT_REJECTION_REASONS[input.reason] ?? input.reason
    : null;

  const sb = await createClient();
  const { data: row } = await sb
    .from("game_players").select("payment_deadline")
    .eq("game_id", input.gameId).eq("user_id", input.playerId).maybeSingle();

  const [playerEmail, playerName] = await Promise.all([emailFor(input.playerId), nameFor(input.playerId)]);
  const link = `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/play-together/${input.gameId}`;
  if (playerEmail && row?.payment_deadline) {
    await sendMail(playTogetherPaymentRejected({
      to: playerEmail, playerName, sport: game.sport, venue: venueName,
      deadline: row.payment_deadline, link, reason: reasonLabel,
    }));
  }

  await writeNotification(sb, {
    userId: input.playerId,
    kind: "game_payment_rejected",
    title: "Payment couldn't be verified",
    body: reasonLabel
      ? `Your payment for the ${game.sport} game couldn't be verified: ${reasonLabel}.`
      : `Your payment for the ${game.sport} game couldn't be verified by the host.`,
    gameId: game.id,
  });
}

// ── Host verified the payment — this is the ONLY point the player is
// actually added to the group. ─────────────────────────────────────
export async function notifyPlayTogetherPaymentVerified(input: { playerId: string; gameId: string }) {
  return notifyPlayTogetherJoined(input);
}

// ── Host approved a join request — this is the ONLY point the player
// hears anything about their join, by design (per product decision: no
// notification before the host reviews it). ──────────────────────────
export async function notifyPlayTogetherJoined(input: { playerId: string; gameId: string }) {
  const ctx = await playTogetherContext(input.gameId);
  if (!ctx) return;
  const { game, venueName } = ctx;

  const [playerEmail, playerName] = await Promise.all([emailFor(input.playerId), nameFor(input.playerId)]);
  if (playerEmail) {
    await sendMail(playTogetherPlayerJoined({
      to: playerEmail, playerName, sport: game.sport, venue: venueName,
      startsAt: game.starts_at, contribution: Number(game.contribution_amount) || 0,
    }));
  }

  const sb = await createClient();
  await writeNotification(sb, {
    userId: input.playerId,
    kind: "game_joined",
    title: "You're in!",
    body: `The host approved your request to join their ${game.sport} game.`,
    gameId: game.id,
  });
}

// ── Host rejected a join request ──────────────────────────────────
export async function notifyPlayTogetherJoinRejected(input: { playerId: string; gameId: string }) {
  const ctx = await playTogetherContext(input.gameId);
  if (!ctx) return;
  const { game, venueName } = ctx;

  const [playerEmail, playerName] = await Promise.all([emailFor(input.playerId), nameFor(input.playerId)]);
  if (playerEmail) {
    await sendMail(playTogetherJoinRejected({
      to: playerEmail, playerName, sport: game.sport, venue: venueName, startsAt: game.starts_at,
    }));
  }

  const sb = await createClient();
  await writeNotification(sb, {
    userId: input.playerId,
    kind: "game_join_rejected",
    title: "Request not approved",
    body: `The host didn't approve your request to join their ${game.sport} game.`,
    gameId: game.id,
  });
}

// ── Someone withdrew a request or left after being approved ──────
export async function notifyPlayTogetherLeft(input: { leaverId: string; gameId: string }) {
  const ctx = await playTogetherContext(input.gameId);
  if (!ctx) return;
  const { game, spotsLeft } = ctx;
  if (game.host_id === input.leaverId) return;

  const [hostEmail, hostName, leaverName] = await Promise.all([
    emailFor(game.host_id), nameFor(game.host_id), nameFor(input.leaverId),
  ]);
  if (hostEmail) {
    await sendMail(playTogetherHostRosterChanged({
      to: hostEmail, hostName, playerName: leaverName, sport: game.sport,
      startsAt: game.starts_at, joined: false, spotsLeft,
    }));
  }

  const sb = await createClient();
  await writeNotification(sb, {
    userId: game.host_id,
    kind: "game_left",
    title: "Player left",
    body: `${leaverName} left your ${game.sport} game.`,
    gameId: game.id,
    actorId: input.leaverId,
  });
}

// ── Host cancelled a Play Together game — tell every joined/pending player ──
export async function notifyPlayTogetherCancelled(input: { hostId: string; gameId: string }) {
  const sb = await createClient();
  const { data: game } = await sb
    .from("games").select("id, sport, starts_at, venue_id").eq("id", input.gameId).maybeSingle();
  if (!game) return;
  const { data: venue } = await sb.from("venues").select("name").eq("id", game.venue_id).maybeSingle();
  const venueName = venue?.name ?? "the venue";

  const { data: players } = await sb
    .from("game_players").select("user_id").eq("game_id", input.gameId)
    .in("status", ["joined", "requested", "payment_pending", "payment_verification_pending"]);
  if (!players?.length) return;

  const details = await Promise.all(
    players.map(async (p) => ({
      userId: p.user_id,
      email: await emailFor(p.user_id),
      name: await nameFor(p.user_id),
    }))
  );

  const mails = details
    .filter((d): d is typeof d & { email: string } => !!d.email)
    .map((d) => playTogetherGameCancelled({
      to: d.email, playerName: d.name, sport: game.sport, venue: venueName, startsAt: game.starts_at,
    }));
  if (mails.length) await sendMail(mails);

  await Promise.all(details.map((d) => writeNotification(sb, {
    userId: d.userId,
    kind: "game_cancelled",
    title: "Game cancelled",
    body: `The host cancelled your ${game.sport} game.`,
    gameId: game.id,
  })));
}

// ── Payment notifications ───────────────────────────────────────
async function paymentContext(paymentId: string) {
  const sb = await createClient();
  const { data: payment } = await sb.from("payments").select("*").eq("id", paymentId).maybeSingle();
  if (!payment) return null;

  const label = bookingLabel(payment.booking_type, payment.court_booking_id ?? payment.event_booking_id ?? payment.tournament_registration_id);
  const customerName = await nameFor(payment.user_id);

  if (payment.booking_type === "tournament_registration") {
    const { data: team } = await sb
      .from("tournament_teams")
      .select("tournament_id")
      .eq("id", payment.tournament_registration_id)
      .maybeSingle();
    const { data: t } = team?.tournament_id
      ? await sb.from("tournaments").select("id, name, owner_id, starts_at, ends_at, venues(name)").eq("id", team.tournament_id).maybeSingle()
      : { data: null };
    const venueName = (t as unknown as { venues: { name: string } | null } | null)?.venues?.name;
    return {
      payment, label, customerName,
      venueName: venueName ?? "the venue",
      // null = the tournament's dates are still TBD — the email
      // template shows "TBD" rather than a misleading fallback date.
      startsAt: t?.starts_at ?? null,
      endsAt: t?.ends_at ?? null,
      tournamentId: t?.id ?? null,
      tournamentOwnerId: t?.owner_id ?? null,
      venueOwnerId: null as string | null,
      courtName: null as string | null,
      fullPrice: null as number | null,
    };
  }

  if (payment.booking_type === "court_booking") {
    const { data: booking } = await sb
      .from("court_bookings")
      .select("starts_at, ends_at, venue_id, price, court_id")
      .eq("id", payment.court_booking_id)
      .maybeSingle();
    const { data: venue } = booking?.venue_id
      ? await sb.from("venues").select("name, owner_id").eq("id", booking.venue_id).maybeSingle()
      : { data: null };
    const { data: court } = booking?.court_id
      ? await sb.from("courts").select("name").eq("id", booking.court_id).maybeSingle()
      : { data: null };
    return {
      payment, label, customerName,
      venueName: venue?.name ?? "the venue",
      startsAt: booking?.starts_at ?? new Date().toISOString(),
      endsAt: booking?.ends_at ?? new Date().toISOString(),
      tournamentId: null as string | null,
      tournamentOwnerId: null as string | null,
      // advance-payment additions
      venueOwnerId: venue?.owner_id ?? null,
      courtName: court?.name ?? "Court",
      fullPrice: booking?.price != null ? Number(booking.price) : null,
    };
  }

  const { data: booking } = await sb
    .from("bookings")
    .select("event_id")
    .eq("id", payment.event_booking_id)
    .maybeSingle();
  const { data: event } = booking?.event_id
    ? await sb.from("events").select("venue, event_date, duration_mins").eq("id", booking.event_id).maybeSingle()
    : { data: null };
  const startsAt = event?.event_date ?? new Date().toISOString();
  const endsAt = new Date(new Date(startsAt).getTime() + (event?.duration_mins ?? 60) * 60000).toISOString();
  return {
    payment, label, customerName,
    venueName: event?.venue ?? "the venue",
    startsAt, endsAt,
    tournamentId: null as string | null,
    tournamentOwnerId: null as string | null,
    venueOwnerId: null as string | null,
    courtName: null as string | null,
    fullPrice: null as number | null,
  };
}

// A customer submitted proof of payment — tell every super-admin, both by
// email and via the in-app notifications table (NotificationBell renders
// it whenever they're not already on /platform, which hides its own bell).
// For a tournament registration specifically, the tournament's own
// organizer/access people (owner_id + tournament_managers — see
// tournament_owner_access.sql) get told too, since they're the ones who'll
// actually verify a host-QR payment via verify_tournament_payment().
export async function notifyPaymentSubmitted(paymentId: string) {
  const sb = await createClient();
  const ctx = await paymentContext(paymentId);
  if (!ctx) return;

  const { data: admins } = await sb.from("profiles").select("id").eq("role", "super_admin");
  const adminIds = new Set((admins ?? []).map((a) => a.id));

  const organizerIds = new Set<string>();
  if (ctx.tournamentId) {
    if (ctx.tournamentOwnerId) organizerIds.add(ctx.tournamentOwnerId);
    const { data: managers } = await sb
      .from("tournament_managers").select("user_id").eq("tournament_id", ctx.tournamentId);
    for (const m of managers ?? []) organizerIds.add(m.user_id);
  }
  // Don't double-email/notify someone who's both an organizer and a super-admin.
  for (const id of adminIds) organizerIds.delete(id);

  const recipientIds = [...adminIds, ...organizerIds];
  if (!recipientIds.length) return;

  const emails = await Promise.all(recipientIds.map((id) => emailFor(id)));
  const mails = emails
    .filter((e): e is string => !!e)
    .map((to) => paymentSubmitted({
      to, bookingLabel: ctx.label, customerName: ctx.customerName,
      amount: ctx.payment.expected_amount, method: ctx.payment.payment_method,
      transactionId: ctx.payment.transaction_id,
    }));
  if (mails.length) await sendMail(mails);

  const isTournament = ctx.payment.booking_type === "tournament_registration";
  await Promise.all([
    ...[...adminIds].map((id) => writeNotification(sb, {
      userId: id,
      kind: "payment_submitted",
      title: `New payment to verify: ${ctx.label}`,
      body: `${ctx.customerName} · ${ctx.payment.payment_method} · Rs ${Math.round(ctx.payment.expected_amount)}`,
      tournamentId: ctx.tournamentId,
    })),
    ...[...organizerIds].map((id) => writeNotification(sb, {
      userId: id,
      kind: isTournament ? "tournament_registration_submitted" : "payment_submitted",
      title: `New team registration payment: ${ctx.label}`,
      body: `${ctx.customerName} · ${ctx.payment.payment_method} · Rs ${Math.round(ctx.payment.expected_amount)}`,
      tournamentId: ctx.tournamentId,
    })),
  ]);
}

// Admin approved or rejected — tell the customer both ways, never silently.
export async function notifyPaymentReviewed(paymentId: string) {
  const sb = await createClient();
  const ctx = await paymentContext(paymentId);
  if (!ctx) return;

  const [to, playerName] = await Promise.all([emailFor(ctx.payment.user_id), Promise.resolve(ctx.customerName)]);

  if (ctx.payment.status === "APPROVED") {
    if (to) {
      await sendMail(paymentApproved({
        to, playerName, bookingLabel: ctx.label, amount: ctx.payment.expected_amount,
        venue: ctx.venueName, startsAt: ctx.startsAt, endsAt: ctx.endsAt,
      }));
    }
    const isTournament = ctx.payment.booking_type === "tournament_registration";
    await writeNotification(sb, {
      userId: ctx.payment.user_id,
      kind: isTournament ? "tournament_payment_verified" : "payment_approved",
      title: isTournament ? "Team registration confirmed" : "Booking confirmed",
      body: isTournament
        ? `Payment verified. Your team's spot is confirmed. Rs ${Math.round(ctx.payment.expected_amount)} · ${ctx.label}`
        : `Payment verified. Your booking is confirmed. Rs ${Math.round(ctx.payment.expected_amount)} · ${ctx.label}`,
      tournamentId: ctx.tournamentId,
    });

    // Advance payment (not full price) on a court booking — tell the
    // venue owner how much came in and what's still owed, since
    // otherwise they'd only see "confirmed" with no hint it's partial.
    if (
      ctx.payment.booking_type === "court_booking"
      && ctx.payment.advance_choice && ctx.payment.advance_choice !== "full"
      && ctx.venueOwnerId && ctx.fullPrice != null
    ) {
      const balanceDue = ctx.fullPrice - ctx.payment.expected_amount;
      const plan = ctx.payment.advance_choice === "percent"
        ? `${ctx.payment.advance_choice_value}% advance`
        : `${ctx.payment.advance_choice_value}-hour advance`;
      const ownerEmail = await emailFor(ctx.venueOwnerId);
      if (ownerEmail) {
        await sendMail(venueAdvancePaymentApproved({
          to: ownerEmail, venue: ctx.venueName, court: ctx.courtName ?? "Court",
          playerName: ctx.customerName, startsAt: ctx.startsAt,
          amountPaid: ctx.payment.expected_amount, balanceDue, plan,
        }));
      }
      await writeNotification(sb, {
        userId: ctx.venueOwnerId,
        kind: "advance_payment_received",
        title: "Advance payment received",
        body: `${ctx.customerName} paid the ${plan} — Rs ${Math.round(ctx.payment.expected_amount)} now, Rs ${Math.round(balanceDue)} due at the venue. ${ctx.label}`,
      });
    }
  } else if (ctx.payment.status === "REJECTED") {
    const isTournament = ctx.payment.booking_type === "tournament_registration";
    const reason = REJECTION_REASONS[ctx.payment.rejection_reason ?? "other"] ?? "Payment could not be verified";
    if (to) {
      await sendMail(paymentRejected({ to, playerName, bookingLabel: ctx.label, reason }));
    }
    await writeNotification(sb, {
      userId: ctx.payment.user_id,
      kind: isTournament ? "tournament_payment_rejected" : "payment_rejected",
      title: "Payment verification failed",
      body: `Payment could not be verified. ${ctx.label} · Reason: ${reason}`,
      tournamentId: ctx.tournamentId,
    });
  }
}
