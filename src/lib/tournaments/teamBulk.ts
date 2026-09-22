// Pure helpers behind the Registrations table's alphabetical order and its
// bulk "Mark paid" / "Delete" actions. No React and no server imports, so the
// project's plain-node checks can run them directly (npm run test:bulk).

export type BulkFailure = { id: string; message: string };
export type BulkResult = {
  done: string[];
  failed: BulkFailure[];
  /** Ids never attempted because the run stopped early (see `stopOn`). */
  notAttempted: string[];
};

/** What the actions return when the session has expired. */
export const SIGNED_OUT_MESSAGE = "You're signed out. Sign in again to continue.";

// A fixed locale on purpose: this runs while rendering a client component, so
// the server and the browser must order names identically or React reports a
// hydration mismatch. Case-insensitive, and digit-aware so "Team 2" comes
// before "Team 10".
export function compareTeamNames(a: string, b: string): number {
  return a.localeCompare(b, "en", { sensitivity: "base", numeric: true });
}

/** A new array, alphabetical by name. Ties fall back to id so the order is stable. */
export function sortTeamsByName<T extends { id: string; name: string }>(teams: readonly T[]): T[] {
  return [...teams].sort(
    (a, b) => compareTeamNames(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** Only walk-in teams that are waiting on payment can be marked paid. */
export function canMarkWalkinPaid(team: { is_walkin: boolean; status: string }): boolean {
  return team.is_walkin && team.status === "payment_pending";
}

// Runs `worker` for one id at a time. Deleting a team rebuilds the unplayed
// fixtures, so running several at once could make those rebuilds race each
// other. The worker resolves to an error message, or null on success. A
// throw counts as a failure and the remaining ids still run, unless `stopOn`
// says the message is fatal (an expired session would fail every remaining id).
export async function runOneByOne(
  ids: readonly string[],
  worker: (id: string) => Promise<string | null>,
  opts: { onProgress?: (finished: number, total: number) => void; stopOn?: (message: string) => boolean } = {},
): Promise<BulkResult> {
  const result: BulkResult = { done: [], failed: [], notAttempted: [] };
  for (let i = 0; i < ids.length; i++) {
    let message: string | null;
    try {
      message = await worker(ids[i]);
    } catch {
      message = "Something went wrong.";
    }
    if (message === null) result.done.push(ids[i]);
    else result.failed.push({ id: ids[i], message });
    opts.onProgress?.(i + 1, ids.length);
    if (message !== null && opts.stopOn?.(message)) {
      result.notAttempted = ids.slice(i + 1);
      break;
    }
  }
  return result;
}

const teams = (n: number) => `${n} team${n === 1 ? "" : "s"}`;
const tidy = (s: string) => s.trim().replace(/\.+$/, "");

/**
 * Turns a finished run into one success line and/or one problem line.
 * `action` is the past-tense phrase: "deleted", "marked as paid".
 */
export function describeBulkResult(
  action: string,
  result: BulkResult,
  nameOf: (id: string) => string,
): { ok: string | null; problem: string | null } {
  const ok = result.done.length ? `${teams(result.done.length)} ${action}.` : null;
  if (!result.failed.length && !result.notAttempted.length) return { ok, problem: null };

  const parts: string[] = [];
  if (result.failed.length) {
    const shown = result.failed.slice(0, 3).map((f) => `${nameOf(f.id)} (${tidy(f.message)})`);
    const extra = result.failed.length - shown.length;
    parts.push(`${teams(result.failed.length)} couldn't be processed: ${shown.join("; ")}${extra > 0 ? `; and ${extra} more` : ""}.`);
  }
  if (result.notAttempted.length) {
    parts.push(`${teams(result.notAttempted.length)} weren't attempted, so try again.`);
  }
  return { ok, problem: parts.join(" ") };
}
