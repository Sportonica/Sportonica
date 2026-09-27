"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { friendlyPaymentError, bookingLabel } from "./types";
import type { BookingType, Payment, PaymentMethod, PaymentMethodConfig } from "./types";
import { notifyPaymentSubmitted, notifyHostedEventIfPublished, notifyPlayTogetherGamePublishedIfAny } from "@/lib/mail/notify";
import { sendMail } from "@/lib/mail/mailer";
import { bookingReceipt } from "@/lib/mail/templates";
import { STATUS_LABEL } from "./statement";
import { actionError, safeActionError, type ActionError } from "@/lib/actionError";

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  esewa: "eSewa", khalti: "Khalti", fonepay: "FonePay", bank_transfer: "Bank transfer",
};

async function requireUser() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  return { sb, user };
}

// Public: checkout needs to know which methods are enabled and show their
// QR/account details. RLS on payment_methods allows select to everyone.
export async function getPaymentMethods(): Promise<PaymentMethodConfig[] | ActionError> {
  const sb = await createClient();
  const { data, error } = await sb.from("payment_methods").select("*").order("method");
  if (error) return actionError(error.message);
  return (data ?? []) as PaymentMethodConfig[];
}

// Upload a payment screenshot. Only PNG/JPG/WebP, 5MB cap — same shape as
// uploadAvatar()/uploadVenuePhoto() elsewhere in the codebase. Path is
// prefixed with the uploader's own uid so storage RLS can scope reads to
// "owner or admin" via (storage.foldername(name))[1].
export async function uploadPaymentProof(
  bookingType: BookingType,
  bookingId: string,
  file: File
): Promise<string | ActionError> {
  const { sb, user } = await requireUser();
  if (!user) return actionError("UNAUTHORIZED");

  const okTypes = ["image/jpeg", "image/png", "image/webp"];
  if (!okTypes.includes(file.type)) {
    return actionError("Upload a JPG, PNG or WebP screenshot.");
  }
  if (file.size > 5 * 1024 * 1024) {
    return actionError("Screenshot must be under 5 MB.");
  }
  const extMap: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  const ext = extMap[file.type];
  const path = `${user.id}/${bookingType}-${bookingId}-${Date.now()}.${ext}`;

  const { error } = await sb.storage.from("payment-proofs").upload(path, file, { upsert: false });
  if (error) return actionError(error.message);

  return path;
}

// The only write path for a payments row — everything else (amount,
// ownership, method availability, duplicate checks) is enforced inside the
// submit_payment() security-definer function, not here.
export async function submitPayment(
  bookingType: BookingType,
  bookingId: string,
  method: PaymentMethod,
  transactionId: string,
  screenshotPath: string,
  // false = pay the venue's configured advance instead of the full price.
  // Only meaningful for booking_type "court_booking" — see submit_payment()
  // in RUN_ME_advance_payment.sql.
  payFull: boolean = true
): Promise<Payment | ActionError> {
  const { sb, user } = await requireUser();
  if (!user) return actionError("UNAUTHORIZED");

  const { data, error } = await sb.rpc("submit_payment", {
    p_booking_type: bookingType,
    p_booking_id: bookingId,
    p_payment_method: method,
    p_transaction_id: transactionId,
    p_screenshot_path: screenshotPath,
    p_pay_full: payFull,
  });
  if (error) return actionError(friendlyPaymentError(error.message));

  const payment = data as Payment;

  revalidatePath("/my-games");

  // Notify admins after the write succeeds. notifyPaymentSubmitted()
  // swallows its own errors — a submitted payment must stay submitted
  // even if the email/notification side fails.
  await notifyPaymentSubmitted(payment.id);

  return payment;
}

// Zero-amount bookings (free hosted games) skip the QR step entirely, but
// "it's free" is still re-verified server-side inside the RPC.
export async function confirmFreeBooking(bookingType: BookingType, bookingId: string): Promise<void | ActionError> {
  const { sb, user } = await requireUser();
  if (!user) return actionError("UNAUTHORIZED");
  const { error } = await sb.rpc("confirm_free_booking", {
    p_booking_type: bookingType,
    p_booking_id: bookingId,
  });
  if (error) return actionError(friendlyPaymentError(error.message));
  revalidatePath("/my-games");

  // Free court, hosting requested: the RPC just published the event for
  // the first time (maybe_publish_hosted_event() in supabase/payments.sql).
  // A Play Together game is a separate, mutually-exclusive path — one of
  // these two is always a no-op.
  if (bookingType === "court_booking") {
    await notifyHostedEventIfPublished(bookingId);
    await notifyPlayTogetherGamePublishedIfAny(bookingId);
  }
}

// Used by /my-games and by a checkout page revisited mid-flow to know
// whether to show "awaiting verification", "rejected — resubmit", or
// nothing. RLS already scopes this to the caller's own payments.
export async function getMyPaymentStatus(bookingType: BookingType, bookingId: string): Promise<Payment | null | ActionError> {
  const { sb, user } = await requireUser();
  if (!user) return actionError("UNAUTHORIZED");
  const column =
    bookingType === "court_booking" ? "court_booking_id" :
    bookingType === "tournament_registration" ? "tournament_registration_id" :
    "event_booking_id";
  const { data, error } = await sb
    .from("payments")
    .select("*")
    .eq(column, bookingId)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return actionError(error.message);
  return data as Payment | null;
}

// Self-service "email me a copy" from /profile/payments — separate from
// the automatic paymentApproved notification (src/lib/mail/notify.ts),
// which fires once on approval. Court bookings only: a Play Together
// contribution is paid host-to-player and never gets a payments row.
export async function emailMyReceipt(courtBookingId: string): Promise<{ ok: true } | ActionError> {
  const { sb, user } = await requireUser();
  if (!user) return actionError("Sign in to email a receipt.");
  if (!user.email) return actionError("Your account has no email on file.");

  const { data: booking, error: bookingErr } = await sb
    .from("court_bookings")
    .select("id, user_id, starts_at, ends_at, price, payment_status, courts(name, sport), venues(name)")
    .eq("id", courtBookingId)
    .maybeSingle();
  if (bookingErr) return safeActionError(bookingErr);
  const b = booking as unknown as {
    id: string; user_id: string | null; starts_at: string; ends_at: string; price: number; payment_status: string;
    courts: { name: string; sport: string } | null; venues: { name: string } | null;
  } | null;
  if (!b || b.user_id !== user.id) return actionError("Booking not found.");

  const [{ data: payment }, { data: profile }] = await Promise.all([
    sb.from("payments")
      .select("payment_method, transaction_id")
      .eq("court_booking_id", courtBookingId)
      .order("submitted_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb.from("profiles").select("full_name, name").eq("id", user.id).maybeSingle(),
  ]);

  try {
    await sendMail(bookingReceipt({
      to: user.email,
      playerName: profile?.full_name ?? profile?.name ?? "Player",
      bookingLabel: bookingLabel("court_booking", b.id),
      venue: b.venues?.name ?? "Venue",
      court: b.courts?.name ?? "Court",
      sport: b.courts?.sport ?? "",
      startsAt: b.starts_at,
      endsAt: b.ends_at,
      amount: Number(b.price) || 0,
      paymentMethod: payment ? (PAYMENT_METHOD_LABEL[payment.payment_method] ?? payment.payment_method) : null,
      transactionId: payment?.transaction_id ?? null,
      status: STATUS_LABEL[b.payment_status] ?? b.payment_status,
    }));
  } catch (e) {
    return safeActionError(e, "Couldn't send the receipt. Try again in a moment.");
  }

  return { ok: true };
}
