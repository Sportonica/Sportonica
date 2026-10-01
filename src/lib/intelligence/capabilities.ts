// What the generic Sports Intelligence screens may offer per sport,
// without importing the engines into the browser bundle. Kept in step
// with the engines by scripts/intelligence/core.test.mjs.

import type { SportKey } from "./core/types";

/** Sports whose engine answers questions about a match (answerQuestion). */
export const SPORTS_WITH_QUESTIONS: readonly SportKey[] = ["basketball", "cricket", "volleyball", "badminton", "pickleball", "swimming", "tennis"];
