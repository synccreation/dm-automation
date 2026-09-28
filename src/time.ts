export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

const OPENING_DELAY_MS = 60_000;
const OPENING_JITTER_MS = 10_000;
const PRIVATE_REPLY_MAX_AGE_MS = 7 * DAY;
const RETRY_SCHEDULE_MS = [MINUTE, 5 * MINUTE, 15 * MINUTE];

/** When the opening DM and public reply for a new trigger should go out. */
export function openingSendAt(now: number, random: () => number = Math.random): number {
  return now + OPENING_DELAY_MS + Math.floor(random() * OPENING_JITTER_MS);
}

/** Meta accepts a private reply only within 7 days of the comment. */
export function isPrivateReplyExpired(commentAt: number, now: number): boolean {
  return now - commentAt > PRIVATE_REPLY_MAX_AGE_MS;
}

/** Delay before the next try after `attemptsMade` failed attempts, or null to give up. */
export function retryDelayMs(attemptsMade: number): number | null {
  return RETRY_SCHEDULE_MS[attemptsMade - 1] ?? null;
}
