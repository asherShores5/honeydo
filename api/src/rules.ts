// Pure validation + access rules, kept free of AWS calls so they can be unit-tested.
import type { AlertPrefs, Chore, Item, Recurrence, Severity, Task } from "@aubi/shared";

export class UserError extends Error {
  constructor(public type: "ValidationError" | "Forbidden" | "NotFound" | "ConflictError", message: string) {
    super(message);
  }
}

export function canSee(visibility: string, userId: string): boolean {
  return visibility === "shared" || visibility === `private:${userId}`;
}

export interface ItemInput {
  id: string;
  kind: string;
  title: string;
  notes?: string | null;
  tags: string[];
  assigneeId?: string | null;
  visibility: string;
  severity?: string | null;
  recurrence?: string | null; // AWSJSON arrives as a string
  dueAt?: number | null;
  warnWindow?: number | null;
  snoozedUntil?: number | null;
  archived: boolean;
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function intIn(n: unknown, lo: number, hi: number): boolean {
  return Number.isInteger(n) && (n as number) >= lo && (n as number) <= hi;
}

export function parseRecurrence(raw: unknown): Recurrence {
  const r = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, unknown>;
  if (r?.type === "interval") {
    if (!["hours", "days", "weeks"].includes(r.unit as string)) throw new UserError("ValidationError", "bad interval unit");
    if (!intIn(r.every, 1, 1000)) throw new UserError("ValidationError", "interval must be 1-1000");
    return { type: "interval", every: r.every as number, unit: r.unit as "hours" | "days" | "weeks" };
  }
  if (r?.type === "calendar") {
    const at = r.at === undefined ? undefined : String(r.at);
    if (at !== undefined && !HHMM_RE.test(at)) throw new UserError("ValidationError", "calendar time must be HH:MM");
    const list = (r.freq === "weekly" ? r.byWeekday : r.byMonthDay) as unknown;
    const [lo, hi] = r.freq === "weekly" ? [0, 6] : [1, 31];
    if (!Array.isArray(list) || list.length === 0 || list.length > 31 || !list.every((d) => intIn(d, lo, hi))) {
      throw new UserError("ValidationError", "calendar days invalid");
    }
    const days = [...new Set(list as number[])].sort((a, b) => a - b);
    if (r.freq === "weekly") return { type: "calendar", freq: "weekly", byWeekday: days, at };
    if (r.freq === "monthly") return { type: "calendar", freq: "monthly", byMonthDay: days, at };
  }
  throw new UserError("ValidationError", "unknown recurrence");
}

/** Validates client input and returns the user-editable fields of an Item. */
export function validateItemInput(input: ItemInput, userId: string, users: string[]) {
  if (!ID_RE.test(input.id)) throw new UserError("ValidationError", "bad id");
  if (input.kind !== "chore" && input.kind !== "task") throw new UserError("ValidationError", "bad kind");
  const title = input.title.trim();
  if (!title || title.length > 200) throw new UserError("ValidationError", "title must be 1-200 chars");
  if ((input.notes ?? "").length > 5000) throw new UserError("ValidationError", "notes too long");
  if (input.tags.length > 30 || !input.tags.every((t) => ID_RE.test(t))) throw new UserError("ValidationError", "bad tags");
  if (input.visibility !== "shared" && input.visibility !== `private:${userId}`) {
    throw new UserError("Forbidden", "items can only be shared or private to yourself");
  }
  if (input.assigneeId && !users.includes(input.assigneeId)) throw new UserError("ValidationError", "unknown assignee");
  // Story 5: the partner can't see a Private item, so they can't be its Assignee.
  if (input.visibility !== "shared" && input.assigneeId && input.assigneeId !== userId) {
    throw new UserError("ValidationError", "a private item can only be assigned to you");
  }
  if (input.severity && !["low", "medium", "high"].includes(input.severity)) throw new UserError("ValidationError", "bad severity");
  let byKind: Pick<Chore, "kind" | "recurrence" | "dueAt"> | Pick<Task, "kind" | "recurrence" | "dueAt">;
  if (input.kind === "chore") {
    if (!input.recurrence) throw new UserError("ValidationError", "chores need a recurrence");
    byKind = { kind: "chore", recurrence: parseRecurrence(input.recurrence) };
  } else {
    byKind = { kind: "task", recurrence: undefined, dueAt: input.dueAt ?? undefined };
  }

  const fields = {
    id: input.id,
    ...byKind,
    title,
    notes: input.notes || undefined,
    tags: [...new Set(input.tags)],
    assigneeId: input.assigneeId || undefined,
    visibility: input.visibility as Item["visibility"],
    severity: (input.severity || undefined) as Item["severity"],
    warnWindow: input.warnWindow ?? undefined,
    snoozedUntil: input.snoozedUntil ?? undefined,
    archived: input.archived,
  };
  return fields;
}

const PROFILE_KEYS = ["displayName", "color", "theme", "density", "defaultView", "savedViews", "alertPrefs", "setupComplete"] as const;

export function validateProfileInput(input: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of PROFILE_KEYS) {
    if (input[k] === undefined) continue;
    const v = input[k];
    if (["defaultView", "savedViews", "alertPrefs"].includes(k)) {
      const s = typeof v === "string" ? v : JSON.stringify(v);
      if (s.length > 20_000) throw new UserError("ValidationError", `${k} too large`);
      out[k] = JSON.parse(s);
    } else if (k === "setupComplete") {
      out[k] = Boolean(v);
    } else {
      if (typeof v !== "string" || v.length > 100) throw new UserError("ValidationError", `bad ${k}`);
      out[k] = v;
    }
  }
  if (out.alertPrefs !== undefined) validateAlertPrefs(out.alertPrefs);
  const prefs = out.alertPrefs as Partial<AlertPrefs> | undefined;
  if (out.setupComplete && !prefs?.handoffAt && input.setupComplete) {
    // SPEC §4.6: the Handoff time is required during setup.
    throw new UserError("ValidationError", "set a Handoff time to finish setup");
  }
  return out;
}

const ALERT_PREF_KEYS = ["slots", "quietStart", "quietEnd", "handoffAt", "overdueAlerts"];
/** Dings per day for each Severity (SPEC §4.6). */
const SLOTS_PER_SEVERITY: Record<Severity, number> = { low: 1, medium: 2, high: 3 };

/**
 * Alert prefs as a Member saves them. Any key may be left out (stored defaults fill it on read),
 * but every key given must be valid, and `slots` must list every Severity with its exact count.
 * The pre-M4 `digestAt` key counts as unknown: clients send `handoffAt`.
 */
function validateAlertPrefs(v: unknown): asserts v is Partial<AlertPrefs> {
  const bad = (msg: string): never => {
    throw new UserError("ValidationError", msg);
  };
  if (!v || typeof v !== "object" || Array.isArray(v)) bad("alert prefs must be an object");
  const p = v as Record<string, unknown>;
  for (const k of Object.keys(p)) if (!ALERT_PREF_KEYS.includes(k)) bad(`unknown alert pref ${k}`);
  const hhmm = (x: unknown, what: string) => (typeof x === "string" && HHMM_RE.test(x)) || bad(`${what} must be HH:MM`);
  if (p.handoffAt !== undefined) hhmm(p.handoffAt, "Handoff time");
  if (p.quietStart !== undefined) hhmm(p.quietStart, "quiet hours start");
  if (p.quietEnd !== undefined) hhmm(p.quietEnd, "quiet hours end");
  if (p.overdueAlerts !== undefined && typeof p.overdueAlerts !== "boolean") bad("overdue alerts must be on or off");
  if (p.slots !== undefined) {
    if (!p.slots || typeof p.slots !== "object" || Array.isArray(p.slots)) bad("slots must be an object");
    const slots = p.slots as Record<string, unknown>;
    const severities = Object.keys(SLOTS_PER_SEVERITY);
    for (const k of Object.keys(slots)) if (!severities.includes(k)) bad(`unknown Severity ${k}`);
    for (const [sev, n] of Object.entries(SLOTS_PER_SEVERITY)) {
      const list = slots[sev];
      if (!Array.isArray(list) || list.length !== n) bad(`${sev} needs ${n} slot${n === 1 ? "" : "s"}`);
      for (const s of list as unknown[]) hhmm(s, "slot");
    }
  }
}

export interface PushSubscriptionInput {
  deviceId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

const B64URL_RE = /^[A-Za-z0-9_-]+={0,2}$/;

export function validateDeviceId(deviceId: unknown): string {
  if (typeof deviceId !== "string" || !ID_RE.test(deviceId)) throw new UserError("ValidationError", "bad device id");
  return deviceId;
}

/** A browser PushSubscription as sent by the Enable step. The Notifier POSTs to `endpoint`, so it must be https. */
export function validatePushSubscription(input: PushSubscriptionInput): PushSubscriptionInput {
  const deviceId = validateDeviceId(input.deviceId);
  const { endpoint, p256dh, auth } = input;
  let url: URL | undefined;
  try {
    url = new URL(endpoint);
  } catch {
    // falls through to the check below
  }
  if (url?.protocol !== "https:" || endpoint.length > 2048) throw new UserError("ValidationError", "bad push endpoint");
  for (const [k, max] of [[p256dh, 200], [auth, 100]] as const) {
    if (typeof k !== "string" || !B64URL_RE.test(k) || k.length > max) throw new UserError("ValidationError", "bad push key");
  }
  return { deviceId, endpoint, p256dh, auth };
}
