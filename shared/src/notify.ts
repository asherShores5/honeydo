// What the Notifier sends on one run: pure, so it is tested through Seam 1 and the Lambda
// (api/src/notifier.ts) only loads records, claims, sends and prunes.
import type { AlertPrefs, Item, UserId } from "./types";
import { DEFAULT_ALERT_PREFS, alertRecipients, shouldDing } from "./alerts";
import { schedule } from "./status";
import { DAY, HOUR } from "./time";

/** A Member as the Notifier sees them: who, and their alert prefs (from their Profile). */
export interface NotifyMember {
  userId: UserId;
  prefs: AlertPrefs;
  /** Display name, for "who did it" in the partner's Handoff. */
  name?: string;
}

/** Notification state: the last Ding one Member got about one Item (an NSTATE record). */
export interface DingState {
  itemId: string;
  userId: UserId;
  lastAlertedAt: number;
}

/** One Ding to send. `seen` is the lastAlertedAt read this run, for the claim-before-send write. */
export interface PlannedDing {
  userId: UserId;
  item: Item;
  itemId: string;
  seen?: number;
}

/**
 * The Dings due now: each red Item dings each of its recipients (Assignee only; both Members if
 * shared and unassigned; the owner only if Private) whose prefs say a Slot or the turn to red is
 * due since their last Ding. Snoozed, archived and finished Items never ding.
 */
export function planDings(items: readonly Item[], members: readonly NotifyMember[], states: readonly DingState[], now: number): PlannedDing[] {
  const prefsOf = new Map(members.map((m) => [m.userId, m.prefs]));
  const last = new Map(states.map((s) => [`${s.itemId}#${s.userId}`, s.lastAlertedAt]));
  const users = members.map((m) => m.userId);
  const out: PlannedDing[] = [];
  for (const item of items) {
    for (const userId of alertRecipients(item, users)) {
      const seen = last.get(`${item.id}#${userId}`);
      if (shouldDing(item, prefsOf.get(userId) ?? DEFAULT_ALERT_PREFS, seen, now)) out.push({ userId, item, itemId: item.id, seen });
    }
  }
  return out;
}

/**
 * What a push carries, as the service worker reads it: `showNotification(title, { body, data })`.
 * `data.url` opens the app on the item (`?item=<id>`, wired up by m4/05).
 */
export interface PushPayload {
  title: string;
  body: string;
  data: { kind: "ding"; itemId: string; url: string } | { kind: "handoff"; url: string };
}

/**
 * The push for one Ding. Built from an allowlist (title, how overdue, id), never by copying the
 * Item, so notes, Tags, Assignee and Visibility never travel. That keeps a Private item's details
 * to its owner, who is its only recipient.
 */
export function dingPayload(item: Item, now: number): PushPayload {
  const { nextDue } = schedule(item);
  const late = nextDue === null ? 0 : now - nextDue;
  const days = Math.floor(late / DAY);
  const hours = Math.floor(late / HOUR);
  const body =
    days >= 1 ? `Overdue by ${days} day${days > 1 ? "s" : ""}` :
    hours >= 1 ? `Overdue by ${hours} hour${hours > 1 ? "s" : ""}` : "Overdue";
  return { title: item.title, body, data: { kind: "ding", itemId: item.id, url: `/?item=${encodeURIComponent(item.id)}` } };
}
