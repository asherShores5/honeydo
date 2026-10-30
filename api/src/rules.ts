// Pure validation + access rules, kept free of AWS calls so they can be unit-tested.
import { COMMENT_MAX, NOTE_MAX, SAVED_VIEWS_MAX, SLOTS_PER_SEVERITY, VIEW_LAYOUTS, VIEW_NAME_MAX, VIEW_SORTS, VIEW_TAGS_MAX, WHO, warnWindowProblem, type AlertPrefs, type Chore, type Item, type Recurrence, type Task } from "@aubi/shared";

export { canSee } from "@aubi/shared";

export class UserError extends Error {
  constructor(public type: "ValidationError" | "Forbidden" | "NotFound" | "ConflictError", message: string) {
    super(message);
  }
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

/** m6/04: an override is a positive ms span within the Chore's shortest gap; empty = the default. */
function validateWarnWindow(v: unknown, rec: Recurrence | undefined): number | undefined {
  if (v === null || v === undefined) return undefined;
  const problem = typeof v === "number" ? warnWindowProblem(v, rec) : "The Warn window must be a number.";
  if (problem) throw new UserError("ValidationError", problem);
  return v as number;
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
    warnWindow: validateWarnWindow(input.warnWindow, byKind.kind === "chore" ? byKind.recurrence : undefined),
    snoozedUntil: input.snoozedUntil ?? undefined,
    archived: input.archived,
  };
  return fields;
}

/**
 * Only an Item's creator may move it from shared to Private; otherwise the partner could make
 * someone else's Item vanish from their phone. New Items and edits that keep the Visibility pass.
 */
export function checkVisibilityChange(existing: { visibility?: unknown; createdBy?: unknown } | undefined, visibility: string, userId: string) {
  if (existing?.visibility === "shared" && visibility !== "shared" && existing.createdBy !== userId) {
    throw new UserError("Forbidden", "only the Member who created an item can make it private");
  }
}

const PROFILE_KEYS =["displayName", "color", "theme", "density", "alertPrefs", "setupComplete"] as const;
/** Own-only Profile fields with their own mutation (saveViews), since putProfile fans out to the partner. */
const VIEW_KEYS = ["defaultView", "savedViews"] as const;

/** AWSJSON arrives as a string (or already parsed in tests); cap its size before parsing. */
function parseJsonField(k: string, v: unknown): unknown {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  if (s.length > 20_000) throw new UserError("ValidationError", `${k} too large`);
  return JSON.parse(s);
}

export function validateProfileInput(input: Record<string, unknown>) {
  for (const k of VIEW_KEYS) {
    if (input[k] !== undefined) throw new UserError("ValidationError", `${k} is saved with saveViews`);
  }
  const out: Record<string, unknown> = {};
  for (const k of PROFILE_KEYS) {
    if (input[k] === undefined) continue;
    const v = input[k];
    if (k === "alertPrefs") {
      out[k] = parseJsonField(k, v);
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

/** saveViews input: either or both of my Saved views and my default view. */
export function validateViewsInput(input: { savedViews?: unknown; defaultView?: unknown }) {
  const out: { savedViews?: unknown; defaultView?: unknown } = {};
  if (input.savedViews != null) validateSavedViews((out.savedViews = parseJsonField("savedViews", input.savedViews)));
  if (input.defaultView != null) validateSavedView((out.defaultView = parseJsonField("defaultView", input.defaultView)));
  if (!Object.keys(out).length) throw new UserError("ValidationError", "nothing to save");
  return out;
}

/** Same cap as a Tag group name in putTag. */
const TAG_GROUP_MAX = 40;
const SAVED_VIEW_KEYS = ["id", "name", "tags", "who", "sort", "layout", "boardGroup", "pinned"];

/** One Saved view (or the default view): known keys only, each in range. */
function validateSavedView(v: unknown): void {
  const bad = (msg: string): never => {
    throw new UserError("ValidationError", msg);
  };
  if (!v || typeof v !== "object" || Array.isArray(v)) bad("a Saved view must be an object");
  const sv = v as Record<string, unknown>;
  for (const k of Object.keys(sv)) if (!SAVED_VIEW_KEYS.includes(k)) bad(`unknown Saved view field ${k}`);
  if (typeof sv.id !== "string" || !ID_RE.test(sv.id)) bad("bad Saved view id");
  if (typeof sv.name !== "string" || !sv.name.trim() || sv.name.length > VIEW_NAME_MAX) bad(`a Saved view needs a name of 1-${VIEW_NAME_MAX} characters`);
  if (!Array.isArray(sv.tags) || sv.tags.length > VIEW_TAGS_MAX || !sv.tags.every((t) => typeof t === "string" && ID_RE.test(t))) bad("bad Saved view tags");
  if (!(WHO as readonly unknown[]).includes(sv.who)) bad("bad Saved view who");
  if (sv.sort !== undefined && !(VIEW_SORTS as readonly unknown[]).includes(sv.sort)) bad("bad Saved view sort");
  if (sv.layout !== undefined && !(VIEW_LAYOUTS as readonly unknown[]).includes(sv.layout)) bad("bad Saved view layout");
  if (sv.boardGroup !== undefined && (typeof sv.boardGroup !== "string" || sv.boardGroup.length > TAG_GROUP_MAX)) bad("bad Saved view Tag group");
  if (sv.layout === "board" && !sv.boardGroup) bad("a board Saved view needs a Tag group");
  if (sv.pinned !== undefined && typeof sv.pinned !== "boolean") bad("bad Saved view pinned");
}

function validateSavedViews(v: unknown): void {
  if (!Array.isArray(v)) throw new UserError("ValidationError", "Saved views must be a list");
  if (v.length > SAVED_VIEWS_MAX) throw new UserError("ValidationError", `at most ${SAVED_VIEWS_MAX} Saved views`);
  v.forEach(validateSavedView);
  if (new Set(v.map((sv) => sv.id)).size !== v.length) throw new UserError("ValidationError", "Saved view ids must be unique");
}

const ALERT_PREF_KEYS = ["slots", "quietStart", "quietEnd", "handoffAt", "overdueAlerts"];

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

/** When the Member last opened Activity, in ms. markActivitySeen caps it and keeps the later one. */
export function validateActivitySeenAt(at: unknown): number {
  if (typeof at !== "number" || !Number.isFinite(at) || at < 0) throw new UserError("ValidationError", "bad activitySeenAt");
  return at;
}

/**
 * A client-picked record ID (Note, Comment) or a reference to an Item, shaped like an Item's ID.
 * Client-picked IDs make an outbox replay or retry idempotent. `label` names it in the error.
 */
export function validateId(id: unknown, label: string): string {
  if (typeof id !== "string" || !ID_RE.test(id)) throw new UserError("ValidationError", `bad ${label} id`);
  return id;
}

// ---- Comments (M2) ----

export function validateCommentInput(input: { itemId: unknown; id: unknown; text: unknown }) {
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!text || text.length > COMMENT_MAX) throw new UserError("ValidationError", `comment must be 1-${COMMENT_MAX} characters`);
  return { itemId: validateId(input.itemId, "item"), id: validateId(input.id, "comment"), text };
}

// ---- Fridge Notes (m2/02) ----

export interface NoteInput {
  id: string;
  text: string;
  pinned?: boolean | null;
  expiresAt?: number | null;
}

/** Epoch ms, or null for never. A past expiry is allowed: it takes the Note off the Fridge. */
export function validateNoteExpiry(expiresAt: unknown): number | undefined {
  if (expiresAt == null) return undefined;
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt) || expiresAt <= 0) {
    throw new UserError("ValidationError", "bad expiresAt");
  }
  return Math.round(expiresAt);
}

export function validateNoteInput(input: NoteInput) {
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!text || text.length > NOTE_MAX) throw new UserError("ValidationError", `note must be 1-${NOTE_MAX} characters`);
  return {
    id: validateId(input.id, "note"),
    text,
    pinned: input.pinned === true,
    expiresAt: validateNoteExpiry(input.expiresAt),
  };
}
