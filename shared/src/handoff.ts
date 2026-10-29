// The Handoff (SPEC story 29): a Member's once-a-day summary. Pure, so the Notifier's push
// (api/src/notifier.ts) and the in-app Handoff card (m2/04) say the same thing.
import type { Completion, Item, UserId } from "./types";
import { schedule, status } from "./status";
import type { NotifyMember, PushPayload } from "./notify";
import { DAY, fromWall, parseHHMM, toWall } from "./time";

export interface HandoffDone {
  itemId: string;
  title: string;
  by: UserId;
  /** The doer's display name, or "you" when the recipient did it. */
  byName: string;
  at: number;
}

export interface HandoffDue {
  itemId: string;
  title: string;
  nextDue: number;
}

/** One Member's Handoff. The shape is stable: m2/04's in-app card renders it too. */
export interface HandoffContent {
  /** Window for "done": Completions after `since`, up to `now`. */
  since: number;
  /** The next Handoff: "due before next" covers `now` to `until`. */
  until: number;
  counts: { done: number; overdue: number; dueBeforeNext: number };
  done: HandoffDone[];
  overdue: HandoffDue[];
  dueBeforeNext: HandoffDue[];
  /** Plain-text summary, one line per non-empty section, e.g. "Done: Baby bath (Aubyn), Trash (you)". */
  lines: string[];
}

export interface HandoffInput {
  /** The recipient. */
  userId: UserId;
  items: readonly Item[];
  completions: readonly Completion[];
  /** Display names by Member. */
  names: Readonly<Record<UserId, string>>;
  since: number;
  until: number;
  now: number;
}

export function buildHandoff({ userId, items, completions, names, since, until, now }: HandoffInput): HandoffContent {
  // The partner's Private items are dropped before anything else, so they're never counted or named.
  items = items.filter((i) => i.visibility === "shared" || i.visibility === `private:${userId}`);
  const byId = new Map(items.map((i) => [i.id, i]));
  const done: HandoffDone[] = [];
  for (const c of completions) {
    const item = byId.get(c.itemId);
    if (!item || c.at <= since || c.at > now) continue;
    done.push({ itemId: item.id, title: item.title, by: c.by, byName: c.by === userId ? "you" : names[c.by] ?? "someone", at: c.at });
  }
  done.sort((a, b) => a.at - b.at);

  const overdue: HandoffDue[] = [];
  const dueBeforeNext: HandoffDue[] = [];
  for (const item of items) {
    if (item.archived) continue;
    const st = status(item, now);
    const { nextDue } = schedule(item);
    if (st === "done" || nextDue === null) continue;
    const line = { itemId: item.id, title: item.title, nextDue };
    if (st === "red") overdue.push(line);
    // Snoozed through the next Handoff: it isn't today's business.
    else if (nextDue > now && nextDue <= until && !(item.snoozedUntil !== undefined && item.snoozedUntil > until)) dueBeforeNext.push(line);
  }
  overdue.sort((a, b) => a.nextDue - b.nextDue);
  dueBeforeNext.sort((a, b) => a.nextDue - b.nextDue);

  const sections = { done, overdue, dueBeforeNext };
  return {
    since, until,
    counts: { done: done.length, overdue: overdue.length, dueBeforeNext: dueBeforeNext.length },
    ...sections,
    lines: summaryLines(sectionTexts(sections)),
  };
}

/** Handoff state: when one Member's last Handoff was sent (a HANDOFF record). */
export interface HandoffState {
  userId: UserId;
  lastHandoffAt: number;
}

/** One Handoff to send. `seen` is the lastHandoffAt read this run, for the claim-before-send write. */
export interface PlannedHandoff {
  userId: UserId;
  seen?: number;
  content: HandoffContent;
}

/**
 * The Handoffs due now: each Member whose Handoff time has passed today (Pacific) and who hasn't
 * had one since today began. The first run at or after the time sends it, so a Handoff missed by
 * an outage still goes out later that day, but never the next day. Independent of overdue alerts.
 */
export function planHandoffs(
  items: readonly Item[], completions: readonly Completion[], members: readonly NotifyMember[], states: readonly HandoffState[], now: number,
): PlannedHandoff[] {
  const last = new Map(states.map((s) => [s.userId, s.lastHandoffAt]));
  const names = Object.fromEntries(members.map((m) => [m.userId, m.name ?? "your partner"]));
  const today = toWall(now);
  const out: PlannedHandoff[] = [];
  for (const m of members) {
    const { hour, minute } = parseHHMM(m.prefs.handoffAt);
    const due = fromWall(today.year, today.month, today.day, hour, minute);
    const seen = last.get(m.userId);
    if (now < due || (seen !== undefined && seen >= fromWall(today.year, today.month, today.day))) continue;
    const until = fromWall(today.year, today.month, today.day + 1, hour, minute);
    const content = buildHandoff({ userId: m.userId, items, completions, names, since: seen ?? now - DAY, until, now });
    out.push({ userId: m.userId, seen, content });
  }
  return out;
}

/**
 * Most bytes of JSON one Handoff push may carry. Push services accept 4096 bytes of encrypted body
 * (RFC 8030 §7.2) and aes128gcm adds about 100, so 3 KB leaves plenty of room.
 */
export const HANDOFF_PAYLOAD_MAX_BYTES = 3000;

const utf8 = new TextEncoder();

/**
 * The push for one Handoff: its summary lines, cut to fit HANDOFF_PAYLOAD_MAX_BYTES by showing
 * fewer entries from the longest section first, each cut section ending "+N more".
 */
export function handoffPayload(c: HandoffContent): PushPayload {
  const texts = sectionTexts(c);
  const shown = { ...c.counts };
  const build = (): PushPayload => ({
    title: "Handoff",
    body: summaryLines(texts, shown).join("\n"),
    data: { kind: "handoff", url: "/" },
  });
  let p = build();
  while (utf8.encode(JSON.stringify(p)).length > HANDOFF_PAYLOAD_MAX_BYTES) {
    const key = KEYS.reduce((a, b) => (shown[b] > shown[a] ? b : a));
    if (shown[key] === 0) break; // only "+N more" left; titles are capped, so this can't happen
    shown[key]--;
    p = build();
  }
  return p;
}

type Sections = Pick<HandoffContent, "done" | "overdue" | "dueBeforeNext">;
type Key = keyof Sections;
const KEYS: readonly Key[] = ["done", "overdue", "dueBeforeNext"];
const LABELS: Record<Key, string> = { done: "Done", overdue: "Overdue", dueBeforeNext: "Due before next Handoff" };

/** Each section's entries as text, in order. */
function sectionTexts(c: Sections): Record<Key, string[]> {
  return {
    done: c.done.map((d) => `${d.title} (${d.byName})`),
    overdue: c.overdue.map((d) => d.title),
    dueBeforeNext: c.dueBeforeNext.map((d) => d.title),
  };
}

/** One line per non-empty section, showing its first `shown[key]` entries and then "+N more". */
function summaryLines(texts: Record<Key, string[]>, shown?: Record<Key, number>): string[] {
  const lines: string[] = [];
  for (const key of KEYS) {
    const all = texts[key];
    if (!all.length) continue;
    const n = Math.min(shown?.[key] ?? all.length, all.length);
    const parts = all.slice(0, n);
    if (n < all.length) parts.push(`+${all.length - n} more`);
    lines.push(`${LABELS[key]}: ${parts.join(", ")}`);
  }
  return lines.length ? lines : ["Nothing done, overdue or due."];
}
