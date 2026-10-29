// The in-app Handoff card (SPEC story 40, m2/04). Built with the same shared builder as the
// Handoff push (shared/src/handoff.ts), from the snapshot plus the window's Completions, so the
// card says what the push said at the Handoff time and stays current after it.
import {
  buildHandoff, fromWall, parseHHMM, readAlertPrefs, toWall,
  type Completion, type HandoffContent, type Item, type UserId,
} from "@aubi/shared";
import type { Op } from "./outbox";

/** The Profile fields the card reads. */
export interface CardProfile {
  userId: string;
  username: string;
  displayName?: string;
  alertPrefs?: unknown;
}

export interface HandoffCardInput {
  userId: UserId;
  /** The caller's snapshot items (already filtered to what they can see). */
  items: readonly Item[];
  /** Completions of the items in `itemsDoneSince`; older ones are ignored. */
  completions: readonly Completion[];
  profiles: Readonly<Record<string, CardProfile>>;
  now: number;
  /** My last Handoff push, from `me` (lastHandoffAt, lastHandoffSince); undefined if none was sent. */
  lastHandoff?: LastHandoff;
}

export interface LastHandoff {
  /** When it was sent. */
  at: number;
  /** The start of the "done" window it covered; null on records from before this was kept. */
  since?: number | null;
}

/**
 * The card's Handoff: the latest one (see cardWindow) as of `now`. It says what the push said
 * (or will say, if the push hasn't run yet); later, Done and Overdue keep up with what happened since.
 */
export function handoffCard({ userId, items, completions, profiles, now, lastHandoff }: HandoffCardInput): HandoffContent {
  const { since, until } = cardWindow(readAlertPrefs(profiles[userId]?.alertPrefs).handoffAt, now, lastHandoff);
  // Same names as the Notifier's (api/src/notifier.ts load and planHandoffs).
  const names = Object.fromEntries(Object.values(profiles).map((p) => [p.userId, p.displayName ?? p.username ?? "your partner"]));
  return buildHandoff({ userId, items, completions, names, since, until, now });
}

/**
 * The items with a Completion after `since`. lastDoneAt is always the newest Completion (the
 * server moves it forward on Done and back on Undo), so these are the only items the card has to
 * fetch Completions for, and the existing visibility-checked `completions(itemId)` read is enough.
 */
export function itemsDoneSince(items: readonly Item[], since: number): string[] {
  return items.filter((i) => i.lastDoneAt !== undefined && i.lastDoneAt > since).map((i) => i.id);
}

/** Fetched Completions with this device's queued Done and Undo ops applied, in outbox order. */
export function withPending(fetched: readonly Completion[], outbox: readonly Op[], me: UserId): Completion[] {
  let out = [...fetched];
  const same = (c: Completion, op: { itemId: string; at: number }) => c.itemId === op.itemId && c.at === op.at;
  for (const op of outbox) {
    if (op.type === "completeItem" && !out.some((c) => same(c, op))) out.push({ itemId: op.itemId, at: op.at, by: me });
    else if (op.type === "undoCompletion") out = out.filter((c) => !same(c, op));
  }
  return out;
}

export interface HandoffWindow {
  /** The latest Handoff time at or before now. */
  at: number;
  /** The Handoff before that: the card's "done" covers Completions after it. */
  since: number;
  /** The next Handoff: "due before next" runs up to it. */
  until: number;
}

export function handoffWindow(handoffAt: string, now: number): HandoffWindow {
  const { hour, minute } = parseHHMM(handoffAt);
  const w = toWall(now);
  const on = (dayOffset: number) => fromWall(w.year, w.month, w.day + dayOffset, hour, minute);
  const back = on(0) <= now ? 0 : -1;
  return { at: on(back), since: on(back - 1), until: on(back + 1) };
}

/**
 * The card's window: the scheduled one, with "done" starting where the push's does. The Notifier
 * counts Done from the previous push, which can run late, so: once the current Handoff has been
 * pushed, the window that push covered; before that, from the last push (as the coming one will).
 * With no Handoff sent yet, the scheduled window.
 */
export function cardWindow(handoffAt: string, now: number, last: LastHandoff | undefined): HandoffWindow {
  const w = handoffWindow(handoffAt, now);
  if (!last) return w;
  const since = last.at >= w.at ? last.since ?? w.since : last.at;
  return { ...w, since };
}

// ---- dismissal ---------------------------------------------------------------
// Dismissed until the next Handoff, per Member, in this device's localStorage. Not a Profile
// field: it's view state, not a preference, and a Profile write would fan out to the partner on
// onProfileChange and churn updatedAt for nothing. Each phone keeps its own.

const DISMISSED = "aubi.handoffDismissed.v1";

type KeyValue = Pick<Storage, "getItem" | "setItem">;

function readDismissed(store: KeyValue): Record<string, number> {
  try {
    const v = JSON.parse(store.getItem(DISMISSED) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/** True if `userId` dismissed the Handoff that's current at `now`. */
export function cardDismissed(store: KeyValue, userId: string, handoffAt: string, now: number): boolean {
  return readDismissed(store)[userId] === handoffWindow(handoffAt, now).at;
}

/** Hide the current Handoff's card for `userId` until the next Handoff time. */
export function dismissCard(store: KeyValue, userId: string, handoffAt: string, now: number) {
  store.setItem(DISMISSED, JSON.stringify({ ...readDismissed(store), [userId]: handoffWindow(handoffAt, now).at }));
}
