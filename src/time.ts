export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

const OPENING_DELAY_MS = 60_000;
const OPENING_JITTER_MS = 10_000;
const PRIVATE_REPLY_MAX_AGE_MS = 7 * DAY;
const RETRY_SCHEDULE_MS = [MINUTE, 5 * MINUTE, 15 * MINUTE];

/** How long after the comment a commenter can still get their link. */
export const LINK_WINDOW_MS = 7 * DAY;
/** First direct try at the link, counted from when the opening DM went out. */
export const LINK_FOLLOW_UP_DELAY_MS = 2 * MINUTE;
// Most people reply within minutes, so try often at first, then every 12 h:
// a reply opens a 24 h window, so a 12 h gap never misses it.
const LINK_FOLLOW_UP_SCHEDULE_MS = [
  5 * MINUTE, 10 * MINUTE, 20 * MINUTE, 40 * MINUTE, HOUR, 2 * HOUR, 4 * HOUR, 8 * HOUR, 12 * HOUR,
];

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

/** Delay before the next direct try at a link after `attemptsMade` refused tries. */
export function linkFollowUpDelayMs(attemptsMade: number): number {
  return LINK_FOLLOW_UP_SCHEDULE_MS[attemptsMade - 1] ?? 12 * HOUR;
}
