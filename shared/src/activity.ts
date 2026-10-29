import type { UserId } from "./types";

/** The parts of an Activity entry the unread count needs. */
export interface ActivityEvent { at: number; by: UserId }

/**
 * How many Activity entries `me` hasn't seen: those newer than `seenAt` (the Profile's
 * activitySeenAt), not counting my own actions. Never opened (null) means all of the partner's.
 */
export function unreadActivity(feed: readonly ActivityEvent[], me: UserId, seenAt: number | null | undefined): number {
  const since = seenAt ?? -Infinity;
  return feed.filter((e) => e.by !== me && e.at > since).length;
}
