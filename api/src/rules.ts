// Pure validation + access rules, kept free of AWS calls so they can be unit-tested.
import type { Chore, Item, Recurrence, Task } from "@aubi/shared";

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
  const prefs = out.alertPrefs as Record<string, unknown> | undefined;
  if (prefs?.digestAt !== undefined && !HHMM_RE.test(String(prefs.digestAt))) {
    throw new UserError("ValidationError", "digest time must be HH:MM");
  }
  if (out.setupComplete && !prefs?.digestAt && input.setupComplete) {
    // SPEC §4.6: daily summary time is required during setup.
    throw new UserError("ValidationError", "set a daily summary time to finish setup");
  }
  return out;
}
