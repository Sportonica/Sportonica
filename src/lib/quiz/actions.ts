"use server";

import { randomInt } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { clientIp, underRateLimit } from "@/lib/security/abuse";
import { isValidLocalPhone, normalizePhone, PHONE_ERROR } from "@/lib/validation/identity";
import { MAX_SCORE, NO_ANSWER, QUIZ, type HostQuestion, type PlayerQuestion } from "./quiz";
import { hostDetails, isCorrect, pickQuestions } from "./bank";
import { todayStartsAt } from "./leaderboard";

// The quiz at /quiz (players on their own phones) and /platform/quiz/host
// (a host reads the questions out and taps what the player says). Entries
// live in public.quiz_entries, which has RLS on and no policies: only
// these actions (service role) read or write it.

export type QuizResult =
  | { ok: true; name: string; score: number; max: number; seconds: number; rankToday: number; winnerCode: string | null }
  | { ok: false; message: string };

// a stall runs on one Wi-Fi, so many people share an IP: generous, but not open
const IP_LIMIT = { max: 120, windowSeconds: 600 };
const ALREADY = "This phone number has already taken the quiz.";
const NOT_SAVED = "Your answers could not be saved. Try again.";
// no 0/O/1/I: read out at a busy stall
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const winnerCode = () => `W-${Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("")}`;

function cleanName(raw: unknown): string | null {
  const name = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  return name.length >= 2 && name.length <= 80 ? name : null;
}

const limited = async () => !(await underRateLimit("quiz", await clientIp(), IP_LIMIT.max, IP_LIMIT.windowSeconds));

/**
 * Before the questions: the details are checked, the phone must not have
 * finished the quiz (nobody answers all four to be told no), and the
 * entry is created, which starts the clock. Starting again after a reload
 * carries on the same clock, so a second look at the questions is never
 * a faster time. Only this player's four questions are sent.
 */
export async function startQuiz(input: { name: string; phone: string; consent: boolean }): Promise<{ questions: PlayerQuestion[] } | { message: string }> {
  const begun = await beginEntry(input, "Tick the box to agree before you start.");
  return "message" in begun ? begun : { questions: pickQuestions(begun.phone) };
}

/**
 * Host mode: the same entry, clock and rules, started by a signed-in
 * platform admin for the player in front of them. The host's screen also
 * gets each question's level and right answer, to call it out as soon as
 * the player has answered.
 */
export async function hostStartQuiz(input: { name: string; phone: string; consent: boolean }): Promise<{ questions: HostQuestion[] } | { message: string }> {
  if (!(await isSuperAdmin())) return { message: "Only platform admins can host the quiz. Sign in again." };
  const begun = await beginEntry(input, "Read the consent line to the player and tick that they agreed.");
  if ("message" in begun) return begun;
  return { questions: pickQuestions(begun.phone).map((q) => ({ ...q, ...hostDetails(q.id)! })) };
}

async function beginEntry(input: { name: string; phone: string; consent: boolean }, noConsent: string): Promise<{ phone: string } | { message: string }> {
  const name = cleanName(input.name);
  if (!name) return { message: "Enter the full name." };
  if (!isValidLocalPhone(input.phone)) return { message: PHONE_ERROR };
  if (input.consent !== true) return { message: noConsent };
  if (await limited()) return { message: "Too many tries. Wait a few minutes." };
  const phone = normalizePhone(input.phone);
  const sb = createServiceClient();
  const { data: row, error } = await sb.from("quiz_entries").select("finished_at").eq("quiz_id", QUIZ.id).eq("phone", phone).maybeSingle();
  if (error) return { message: "Could not check the number. Try again." };
  if (row?.finished_at) return { message: ALREADY };
  if (!row) {
    const { error: insertError } = await sb.from("quiz_entries").insert({ quiz_id: QUIZ.id, full_name: name, phone, max_score: MAX_SCORE });
    // 23505: the same phone started a moment ago on another device; that clock stands
    if (insertError && insertError.code !== "23505") return { message: "Could not start the quiz. Try again." };
  }
  return { phone };
}

export async function submitQuiz(input: { phone: string; answers: Record<string, string> }): Promise<QuizResult> {
  if (!isValidLocalPhone(input.phone)) return { ok: false, message: PHONE_ERROR };
  if (await limited()) return { ok: false, message: "Too many tries. Wait a few minutes." };
  const phone = normalizePhone(input.phone);

  // the questions this phone was given (worked out again, never taken from the request)
  const questions = pickQuestions(phone);
  const answers: Record<string, string> = {};
  for (const q of questions) {
    const pick = input.answers?.[q.id];
    // NO_ANSWER: the player told the host they did not know (scored as wrong)
    if (typeof pick !== "string" || (pick !== NO_ANSWER && !q.options.some((o) => o.id === pick))) return { ok: false, message: "Answer all four questions." };
    answers[q.id] = pick;
  }
  const score = questions.filter((q) => isCorrect(q.id, answers[q.id])).length * QUIZ.pointsPerQuestion;

  const sb = createServiceClient();
  const { data: row, error } = await sb.from("quiz_entries").select("id, full_name, started_at, finished_at").eq("quiz_id", QUIZ.id).eq("phone", phone).maybeSingle();
  if (error) return { ok: false, message: NOT_SAVED };
  if (!row) return { ok: false, message: "Start the quiz first." };
  if (row.finished_at) return { ok: false, message: ALREADY };
  const finishedAt = new Date();
  const durationMs = Math.max(0, finishedAt.getTime() - new Date(row.started_at).getTime());

  for (let attempt = 0; attempt < 3; attempt++) {
    const code = score === MAX_SCORE ? winnerCode() : null;
    // finished once only: a second send of the same answers changes nothing
    const { data: done, error: updateError } = await sb.from("quiz_entries")
      .update({ answers, score, winner_code: code, finished_at: finishedAt.toISOString(), duration_ms: durationMs })
      .eq("id", row.id).is("finished_at", null).select("id");
    if (updateError?.code === "23505") continue; // a winner code already given out: draw another
    if (updateError) { console.error("[quiz] finish failed:", updateError.message); return { ok: false, message: NOT_SAVED }; }
    if (!done?.length) return { ok: false, message: ALREADY };

    // today's place: finished today with a higher score, or the same score faster
    const { count } = await sb.from("quiz_entries").select("id", { count: "exact", head: true })
      .eq("quiz_id", QUIZ.id).gte("finished_at", todayStartsAt())
      .or(`score.gt.${score},and(score.eq.${score},duration_ms.lt.${durationMs})`);
    return { ok: true, name: row.full_name, score, max: MAX_SCORE, seconds: durationMs / 1000, rankToday: (count ?? 0) + 1, winnerCode: code };
  }
  return { ok: false, message: NOT_SAVED };
}

// ── the organiser's side (/platform/quiz) ───────────────────────

export interface QuizEntry {
  id: string; full_name: string; phone: string; score: number | null; max_score: number; duration_ms: number | null;
  winner_code: string | null; prize_given_at: string | null; prize_note: string | null; created_at: string; finished_at: string | null;
}

async function isSuperAdmin(): Promise<boolean> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return false;
  const { data } = await sb.rpc("is_super_admin");
  return data === true;
}

export async function listQuizEntries(): Promise<QuizEntry[] | { message: string }> {
  if (!(await isSuperAdmin())) return { message: "Only platform admins can see quiz entries." };
  const all: QuizEntry[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await createServiceClient().from("quiz_entries")
      .select("id, full_name, phone, score, max_score, duration_ms, winner_code, prize_given_at, prize_note, created_at, finished_at")
      .eq("quiz_id", QUIZ.id).order("created_at", { ascending: false }).range(from, from + 999);
    if (error) return { message: error.message.includes("quiz_entries") ? "The quiz table is not set up yet (run the quiz SQL in Supabase)." : "Could not load entries." };
    all.push(...((data ?? []) as QuizEntry[]));
    if (!data || data.length < 1000) break;
  }
  return all;
}

/** The winner picked from the bowl: record what they took. Null takes it back. */
export async function setPrizeGiven(entryId: string, note: string | null): Promise<{ ok: true } | { message: string }> {
  if (!(await isSuperAdmin())) return { message: "Only platform admins can do that." };
  const { error } = await createServiceClient().from("quiz_entries")
    .update(note === null ? { prize_given_at: null, prize_note: null } : { prize_given_at: new Date().toISOString(), prize_note: note.trim().slice(0, 120) || null })
    .eq("id", entryId).not("winner_code", "is", null);
  return error ? { message: "Could not save. Try again." } : { ok: true };
}
