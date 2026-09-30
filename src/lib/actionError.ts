// Next.js redacts a thrown Error's `message` to a generic
// "An error occurred in the Server Components render..." string once it
// crosses a Server Action boundary in production — even when the client
// catches it with try/catch (dev mode preserves the real message, which is
// why this wasn't caught in testing). See node_modules/next/dist/docs/
// 01-app/01-getting-started/10-error-handling.md: "avoid using try/catch
// blocks and throw errors [for expected errors]. Instead, model expected
// errors as return values."
//
// Every "use server" action that needs to surface a business/validation
// message to the client must therefore return an ActionError instead of
// throwing. Truly unexpected errors (programmer bugs) can still throw —
// there's no client-side message to preserve for those anyway.
const ACTION_ERROR_TAG = "__sportonicaActionError" as const;

export type ActionError = { [ACTION_ERROR_TAG]: true; message: string };

export function actionError(message: string): ActionError {
  return { [ACTION_ERROR_TAG]: true, message };
}

export function isActionError(value: unknown): value is ActionError {
  return typeof value === "object" && value !== null && ACTION_ERROR_TAG in value;
}

// Raw Supabase/Postgres/Storage error text leaks table and column names,
// constraint names and RLS-policy wording to the browser. Use this for
// the "unexpected DB error" fall-through in an action: it logs the real
// message server-side and hands the client a generic sentence, unless
// the caller recognised a known business code and passed it as `known`.
export function safeActionError(
  error: unknown,
  fallback = "Something went wrong. Please try again.",
  known?: string,
): ActionError {
  if (known) return actionError(known);
  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : (error as { message?: string } | null)?.message ?? String(error);
  console.error("[action]", message);
  return actionError(fallback);
}

// For a Supabase/Postgres error returned straight from a query or RPC.
// Our own database functions raise UPPER_CASE business codes
// (ROSTER_LOCKED, FORBIDDEN, …) that the UI maps to friendly text — those
// pass through. Anything else is raw Postgres/PostgREST text that names
// tables, columns, policies and functions, so it's logged server-side and
// the client gets a generic sentence (security audit, ERROR_HANDLING).
const RAISED_SENTENCES = new Set([
  "Cannot start a conversation with yourself",
  "Court not found",
  "End time must be after start time",
]);

export function isBusinessErrorMessage(message: string): boolean {
  return /^[A-Z][A-Z0-9_]{2,}$/.test(message) || RAISED_SENTENCES.has(message);
}

export function dbActionError(
  error: unknown,
  fallback = "Something went wrong. Please try again.",
): ActionError {
  const message = (error as { message?: string } | null)?.message ?? String(error);
  if (isBusinessErrorMessage(message)) return actionError(message);
  console.error("[action:db]", message);
  return actionError(fallback);
}
