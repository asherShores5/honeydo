import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { AppSyncResolverEvent, AppSyncIdentityCognito } from "aws-lambda";
import { readAlertPrefs, type Item } from "@aubi/shared";
import {
  UserError, canSee, validateItemInput, validateProfileInput, validatePushSubscription, validateDeviceId,
  type ItemInput, type PushSubscriptionInput,
} from "./rules";
import { PK, commentKey, ifConditionFailed, pushKey } from "./table";

const TABLE = process.env.TABLE_NAME!;
const ALLOWED = (process.env.ALLOWED_USERNAMES ?? "").split(",").filter(Boolean);
const FEED_TTL_S = 365 * 24 * 3600;

type DocClient = Pick<DynamoDBDocumentClient, "send">;

let ddb: DocClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

/** Test seam: swap the document client (see src/testing/harness.ts). Production never calls this. */
export function setDocClient(client: DocClient) {
  ddb = client;
}

interface Ctx {
  userId: string;
  username: string;
}

// ---- helpers ---------------------------------------------------------------

async function queryPrefix(prefix: string, opts: { limit?: number; newestFirst?: boolean } = {}) {
  const out: Record<string, unknown>[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :p)",
        ExpressionAttributeValues: { ":pk": PK, ":p": prefix },
        ScanIndexForward: !opts.newestFirst,
        Limit: opts.limit,
        ExclusiveStartKey,
      }),
    );
    out.push(...(r.Items ?? []));
    ExclusiveStartKey = opts.limit ? undefined : r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}

const ACTIVITY_SIZE = 100;

/**
 * The newest ACTIVITY_SIZE Activity events `ctx` may see, newest first. Pages past events hidden
 * from them: Private to the partner when logged, or about an Item in `hiddenItems` (one that has
 * since gone Private, so its earlier events and Comments stop reaching the partner).
 */
async function visibleActivity(ctx: Ctx, hiddenItems: Set<unknown> = new Set()) {
  const out: Record<string, unknown>[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :p)",
        ExpressionAttributeValues: { ":pk": PK, ":p": "FEED#" },
        ScanIndexForward: false,
        Limit: ACTIVITY_SIZE,
        ExclusiveStartKey,
      }),
    );
    out.push(...(r.Items ?? []).filter((f) => canSee(f.visibility as string, ctx.userId) && !hiddenItems.has(f.itemId)));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey && out.length < ACTIVITY_SIZE);
  return out.slice(0, ACTIVITY_SIZE);
}

function strip<T>(rec: Record<string, unknown>): T {
  const { PK: _pk, SK: _sk, GSI1PK: _g, ttl: _t, ...rest } = rec;
  return rest as T;
}

// AWSJSON fields are returned as plain objects: AppSync serializes them itself, and
// returning pre-stringified JSON gets double-encoded.
function itemOut(rec: Record<string, unknown>) {
  const item = strip<Item>(rec);
  return { ...item, recurrence: item.recurrence ?? null };
}

function profileOut(rec: Record<string, unknown>) {
  const p = strip<Record<string, unknown>>(rec);
  for (const k of ["defaultView", "savedViews", "alertPrefs"]) p[k] = p[k] ?? null;
  if (p.alertPrefs) p.alertPrefs = readAlertPrefs(p.alertPrefs);
  return p;
}

/**
 * The ItemChange envelope every subscriber gets. `removedFor` lists Members who could see the item
 * before this change and can't now; the subscription filter delivers it to them as a removal.
 */
function change(rec: Record<string, unknown>, removedFor: string[] = []) {
  if (removedFor.length) return redactedChange(rec, removedFor);
  return { item: itemOut(rec), visibility: rec.visibility as string, removedFor };
}

/**
 * The envelope for a change that hides an item from someone. AppSync fans out the mutation's
 * return value to every matching subscriber, so it carries none of the item's content: only id,
 * version and visibility are real, and the schema's other required fields get placeholders.
 * Members in removedFor drop the item; anyone else who gets it refreshes to fetch the real copy.
 */
function redactedChange(rec: Record<string, unknown>, removedFor: string[]) {
  const item = {
    id: rec.id, version: rec.version, visibility: rec.visibility,
    kind: "task", title: "", tags: [], archived: false, createdBy: "", createdAt: 0, updatedAt: 0, recurrence: null,
  };
  return { item, visibility: rec.visibility as string, removedFor, redacted: true };
}

async function getItemFor(ctx: Ctx, id: string) {
  const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK, SK: `ITEM#${id}` } }));
  if (!r.Item || !canSee(r.Item.visibility as string, ctx.userId)) throw new UserError("NotFound", "item not found");
  return r.Item;
}

/** One Activity event record. `eventId` defaults to a random one; pass a deterministic one when the event mirrors a record. */
function activityRecord(ctx: Ctx, type: string, item: Record<string, unknown>, detail?: string, eventId?: string) {
  const at = Date.now();
  const id = eventId ?? `${at}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    PK, SK: `FEED#${String(at).padStart(15, "0")}#${id}`, id, at, by: ctx.userId, type,
    itemId: item.id, title: item.title, detail, visibility: item.visibility,
    ttl: Math.floor(at / 1000) + FEED_TTL_S,
  };
}

async function feed(ctx: Ctx, type: string, item: Record<string, unknown>, detail?: string) {
  await ddb.send(new PutCommand({ TableName: TABLE, Item: activityRecord(ctx, type, item, detail) }));
}

async function userIds(): Promise<string[]> {
  return (await queryPrefix("USER#")).map((p) => p.userId as string);
}

function touch(rec: Record<string, unknown>) {
  // GSI1 (PK, updatedAt) is written for a future delta sync; nothing reads it yet.
  return { ...rec, GSI1PK: PK };
}

/** Sort key of one Completion; the timestamp is zero-padded so keys sort by time. */
function completionKey(itemId: string, at: number) {
  return `DONE#${itemId}#${String(at).padStart(15, "0")}`;
}

/**
 * UpdateCommand input for one Item: SET each field in `set`, bump version, REMOVE `remove`.
 * Each value's placeholder is `:<field>`, built from the same object as the expression so the two
 * can't drift apart; conditions may refer to those placeholders.
 */
function itemUpdate(itemId: string, set: Record<string, unknown>, remove: string[] = []) {
  const fields = Object.keys(set);
  return {
    TableName: TABLE,
    Key: { PK, SK: `ITEM#${itemId}` },
    UpdateExpression:
      "SET " + [...fields.map((f) => `${f} = :${f}`), "version = version + :one"].join(", ") +
      (remove.length ? ` REMOVE ${remove.join(", ")}` : ""),
    ExpressionAttributeValues: { ...Object.fromEntries(fields.map((f) => [`:${f}`, set[f]])), ":one": 1 },
    ReturnValues: "ALL_NEW" as const,
  };
}

// ---- resolvers -------------------------------------------------------------

async function me(ctx: Ctx) {
  const key = { PK, SK: `USER#${ctx.userId}` };
  const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: key }));
  if (r.Item) return profileOut(r.Item);
  const rec = { ...key, userId: ctx.userId, username: ctx.username, setupComplete: false, updatedAt: Date.now() };
  await ddb.send(new PutCommand({ TableName: TABLE, Item: rec, ConditionExpression: "attribute_not_exists(SK)" })).catch(() => {});
  return profileOut(rec);
}

async function snapshot(ctx: Ctx) {
  const itemsP = queryPrefix("ITEM#");
  const hiddenItems = (recs: Record<string, unknown>[]) =>
    new Set(recs.filter((i) => !canSee(i.visibility as string, ctx.userId)).map((i) => i.id));
  const [items, tags, profiles, feedRecs] = await Promise.all([
    itemsP,
    queryPrefix("TAG#"),
    queryPrefix("USER#"),
    itemsP.then((recs) => visibleActivity(ctx, hiddenItems(recs))),
  ]);
  return {
    items: items.filter((i) => canSee(i.visibility as string, ctx.userId)).map(itemOut),
    tags: tags.map((t) => strip(t)),
    profiles: profiles.map(profileOut),
    feed: feedRecs.map((f) => strip(f)),
    serverTime: Date.now(),
  };
}

async function completions(ctx: Ctx, args: { itemId: string; limit?: number }) {
  await getItemFor(ctx, args.itemId);
  const recs = await queryPrefix(`DONE#${args.itemId}#`, { limit: Math.min(args.limit ?? 50, 500), newestFirst: true });
  return recs.map((r) => strip(r));
}

async function putItem(ctx: Ctx, args: { input: ItemInput; expectedVersion?: number | null }) {
  const users = await userIds();
  const fields = validateItemInput(args.input, ctx.userId, users);
  // A replayed offline edit must not put a deleted Tag's ID back on the item.
  const tagIds = new Set((await queryPrefix("TAG#")).map((t) => t.id));
  const unknown = fields.tags.filter((t) => !tagIds.has(t));
  if (unknown.length) throw new UserError("ValidationError", `unknown tag ${unknown.join(", ")}`);
  const key = { PK, SK: `ITEM#${fields.id}` };
  const existing = (await ddb.send(new GetCommand({ TableName: TABLE, Key: key }))).Item;
  if (existing && !canSee(existing.visibility as string, ctx.userId)) throw new UserError("NotFound", "item not found");
  if (existing && args.expectedVersion != null && existing.version !== args.expectedVersion) {
    throw new UserError("ConflictError", `item is at version ${existing.version}`);
  }
  const now = Date.now();
  const rec = touch({
    ...key,
    ...fields,
    lastDoneAt: existing?.lastDoneAt,
    lastDoneBy: existing?.lastDoneBy,
    createdBy: existing?.createdBy ?? ctx.userId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    version: ((existing?.version as number) ?? 0) + 1,
  });
  const written = await ddb
    .send(
      new PutCommand({
        TableName: TABLE,
        Item: rec,
        ConditionExpression: existing ? "version = :v" : "attribute_not_exists(SK)",
        ExpressionAttributeValues: existing ? { ":v": existing.version } : undefined,
      }),
    )
    .then(() => true, ifConditionFailed(false));
  if (!written) throw new UserError("ConflictError", "item changed, retry");
  await feed(ctx, existing ? (fields.archived && !existing.archived ? "archived" : "edited") : "created", rec);
  const lostSight = existing
    ? users.filter((u) => canSee(existing.visibility as string, u) && !canSee(fields.visibility, u))
    : [];
  return change(rec, lostSight);
}

async function completeItem(ctx: Ctx, args: { itemId: string; at?: number | null; note?: string | null }) {
  const item = await getItemFor(ctx, args.itemId);
  const now = Date.now();
  // Backdating is allowed (offline queue, "did it at 7am"), future timestamps are not.
  const at = Math.min(Math.round(args.at ?? now), now + 60_000);
  if ((args.note ?? "").length > 1000) throw new UserError("ValidationError", "note too long");
  const note = args.note || undefined;
  // The Completion and its Activity entry are written together. The deterministic key makes
  // replays from the offline outbox idempotent: if the Completion already exists the
  // transaction is cancelled and nothing is written twice.
  await ddb
    .send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: TABLE,
              Item: { PK, SK: completionKey(args.itemId, at), itemId: args.itemId, at, by: ctx.userId, note },
              ConditionExpression: "attribute_not_exists(SK)",
            },
          },
          { Put: { TableName: TABLE, Item: activityRecord(ctx, "completed", item, note, `done-${args.itemId}-${at}`) } },
        ],
      }),
    )
    .catch(ifConditionFailed(undefined));

  // Always run, replay or not, so a crash after the transaction heals on replay. The Completion
  // log is the source of truth and lastDoneAt only moves forward, which makes this idempotent; a
  // backdated Completion (older than lastDoneAt) leaves lastDoneAt, and so Status, unchanged.
  // Done finishes a Task, so it is Archived in the same write. A Chore is only Reset.
  const done = { lastDoneAt: at, lastDoneBy: ctx.userId, updatedAt: now, ...(item.kind === "task" ? { archived: true } : {}) };
  const rec = await ddb
    .send(
      new UpdateCommand({
        ...itemUpdate(args.itemId, done, ["snoozedUntil"]),
        ConditionExpression: "attribute_not_exists(lastDoneAt) OR lastDoneAt < :lastDoneAt",
      }),
    )
    .then((r) => r.Attributes!, ifConditionFailed(item));
  return change(rec);
}

async function undoCompletion(ctx: Ctx, args: { itemId: string; at: number }) {
  const item = await getItemFor(ctx, args.itemId);
  // The delete and its "undone" entry go together, conditional on the Completion existing: undo
  // of one that's already gone (outbox replay, or the partner undid it first) logs nothing.
  await ddb
    .send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Delete: {
              TableName: TABLE,
              Key: { PK, SK: completionKey(args.itemId, args.at) },
              ConditionExpression: "attribute_exists(SK)",
            },
          },
          { Put: { TableName: TABLE, Item: activityRecord(ctx, "undone", item) } },
        ],
      }),
    )
    .catch(ifConditionFailed(undefined));

  // Always recompute from the Completion log, so a crash after the transaction heals on replay.
  // The conditions skip the write when the item already matches the log (no version churn).
  const [latest] = await queryPrefix(`DONE#${args.itemId}#`, { limit: 1, newestFirst: true });
  const now = Date.now();
  const update = latest
    ? {
        ...itemUpdate(args.itemId, { lastDoneAt: latest.at, lastDoneBy: latest.by, updatedAt: now }),
        ConditionExpression: "attribute_not_exists(lastDoneAt) OR lastDoneAt <> :lastDoneAt",
      }
    : {
        // No Completions left: a Task is unfinished again, so it comes back off the Archive.
        ...itemUpdate(args.itemId, { updatedAt: now, ...(item.kind === "task" ? { archived: false } : {}) }, ["lastDoneAt", "lastDoneBy"]),
        ConditionExpression: "attribute_exists(lastDoneAt)",
      };
  const rec = await ddb.send(new UpdateCommand(update)).then((r) => r.Attributes!, ifConditionFailed(item));
  return change(rec);
}

async function putTag(_ctx: Ctx, args: { input: { id: string; name: string; group: string; color?: string; order?: number } }) {
  const { id, name, group, color, order } = args.input;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || !name.trim() || name.length > 40 || !group.trim() || group.length > 40) {
    throw new UserError("ValidationError", "bad tag");
  }
  const rec = touch({ PK, SK: `TAG#${id}`, id, name: name.trim(), group: group.trim(), color, order, updatedAt: Date.now() });
  // A Tag belongs to exactly one Tag group: an ID collision must not move it to another group.
  const written = await ddb
    .send(
      new PutCommand({
        TableName: TABLE,
        Item: rec,
        ConditionExpression: "attribute_not_exists(SK) OR #g = :g",
        ExpressionAttributeNames: { "#g": "group" },
        ExpressionAttributeValues: { ":g": group.trim() },
      }),
    )
    .then(() => true, ifConditionFailed(false));
  if (!written) throw new UserError("ValidationError", "tag ID belongs to another group");
  return strip(rec);
}

/**
 * Strip a deleted Tag from every item that carries it (all Visibilities), bumping each item's
 * version so stale edits conflict instead of re-adding the dead ID. One partition, small data.
 * Clients refresh on the deleted-Tag event to pick up the new versions.
 */
async function removeTagFromItems(tagId: string) {
  const carries = (rec: Record<string, unknown> | undefined) => (rec?.tags as string[] | undefined)?.includes(tagId);
  for (const item of await queryPrefix("ITEM#")) {
    let cur: Record<string, unknown> | undefined = item;
    for (let attempt = 0; carries(cur); attempt++) {
      // Throw rather than leave the dead ID behind: deleteTag then keeps the Tag and can be retried.
      if (attempt >= 5) throw new Error(`deleteTag: item ${cur!.SK} kept changing, gave up`);
      const ok = await ddb
        .send(
          new UpdateCommand({
            TableName: TABLE,
            Key: { PK, SK: cur!.SK },
            UpdateExpression: "SET tags = :tags, updatedAt = :now, version = version + :one",
            ConditionExpression: "version = :v",
            ExpressionAttributeValues: {
              ":tags": (cur!.tags as string[]).filter((t) => t !== tagId),
              ":now": Date.now(), ":one": 1, ":v": cur!.version,
            },
          }),
        )
        .then(() => true, ifConditionFailed(false));
      if (ok) break;
      cur = (await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK, SK: cur!.SK } }))).Item;
    }
  }
}

async function deleteTag(_ctx: Ctx, args: { id: string }) {
  const key = { PK, SK: `TAG#${args.id}` };
  const tag = (await ddb.send(new GetCommand({ TableName: TABLE, Key: key }))).Item;
  if (!tag) throw new UserError("NotFound", "tag not found");
  // Items first, then the Tag: if this crashes part way the Tag is still there and a retry
  // finishes the job.
  await removeTagFromItems(args.id);
  await ddb.send(new DeleteCommand({ TableName: TABLE, Key: key }));
  return { ...strip<Record<string, unknown>>(tag), deleted: true, updatedAt: Date.now() };
}

async function putProfile(ctx: Ctx, args: { input: Record<string, unknown> }) {
  const current = await me(ctx); // also ensures the record exists
  const fields = validateProfileInput(args.input);
  // Alert prefs patch the stored ones, so toggling one pref (e.g. overdue alerts off) keeps the
  // rest, the Handoff time included. Saving also rewrites a pre-M4 `digestAt` as `handoffAt`.
  if (fields.alertPrefs && current.alertPrefs) {
    fields.alertPrefs = { ...(current.alertPrefs as object), ...(fields.alertPrefs as object) };
  }
  const names = Object.keys(fields);
  const r = await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK, SK: `USER#${ctx.userId}` },
      UpdateExpression: "SET " + [...names.map((k, i) => `#k${i} = :v${i}`), "updatedAt = :now"].join(", "),
      ExpressionAttributeNames: Object.fromEntries(names.map((k, i) => [`#k${i}`, k])),
      ExpressionAttributeValues: { ...Object.fromEntries(names.map((k, i) => [`:v${i}`, fields[k]])), ":now": Date.now() },
      ReturnValues: "ALL_NEW",
    }),
  );
  return profileOut(r.Attributes!);
}

/**
 * Save this device's Web Push subscription. The key is the caller's own sub plus a device ID the
 * client keeps in localStorage, so re-enabling on the same phone overwrites the old record (new
 * endpoint, same device) and nobody can write another Member's. PUSH# records never go in the
 * snapshot or on the Profile, because the partner reads both.
 */
async function putPushSubscription(ctx: Ctx, args: PushSubscriptionInput) {
  const sub = validatePushSubscription(args);
  const now = Date.now();
  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: { PK, SK: pushKey(ctx.userId, sub.deviceId), userId: ctx.userId, ...sub, createdAt: now },
    }),
  );
  return { deviceId: sub.deviceId, enabled: true };
}

/** Turn notifications off on one of the caller's devices. Already off is fine. */
async function deletePushSubscription(ctx: Ctx, args: { deviceId: string }) {
  const deviceId = validateDeviceId(args.deviceId);
  await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { PK, SK: pushKey(ctx.userId, deviceId) } }));
  return { deviceId, enabled: false };
}

// ---- Comments (M2) ---------------------------------------------------------
// A Comment is append-only and belongs to one Item. It has no Visibility of its own: it is read
// through its Item (getItemFor), so it follows the Item's current Visibility. An Item that goes
// Private takes its old Comments with it, and they come back if it is shared again.

const COMMENT_MAX = 1000;

function commentOut(rec: Record<string, unknown>) {
  const { id, itemId, at, by, text } = rec;
  return { id, itemId, at, by, text };
}

/** The Comments on one Item the caller can see, oldest first. */
async function comments(ctx: Ctx, args: { itemId: string }) {
  await getItemFor(ctx, args.itemId);
  const recs = await queryPrefix(commentKey(args.itemId, ""));
  return recs.sort((a, b) => (a.at as number) - (b.at as number)).map(commentOut);
}

/**
 * Add a Comment and its Activity entry. The client picks the ID, so a retry after a lost response
 * writes nothing twice and returns the stored Comment. The CommentChange envelope carries the
 * Item's Visibility for the onCommentChange filter; the write is conditional on the Item still
 * having that Visibility, so a Comment can't be published as shared after the Item went Private.
 */
async function addComment(ctx: Ctx, args: { itemId: string; id: string; text: string }) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(args.id ?? "")) throw new UserError("ValidationError", "bad comment id");
  const text = (args.text ?? "").trim();
  if (!text || text.length > COMMENT_MAX) throw new UserError("ValidationError", "comment must be 1-1000 characters");
  const item = await getItemFor(ctx, args.itemId);
  const key = { PK, SK: commentKey(args.itemId, args.id) };
  const rec = { ...key, id: args.id, itemId: args.itemId, at: Date.now(), by: ctx.userId, text };
  const written = await ddb
    .send(
      new TransactWriteCommand({
        TransactItems: [
          {
            ConditionCheck: {
              TableName: TABLE,
              Key: { PK, SK: `ITEM#${args.itemId}` },
              ConditionExpression: "visibility = :vis",
              ExpressionAttributeValues: { ":vis": item.visibility },
            },
          },
          { Put: { TableName: TABLE, Item: rec, ConditionExpression: "attribute_not_exists(SK)" } },
          { Put: { TableName: TABLE, Item: activityRecord(ctx, "commented", item, text, `comment-${args.id}`) } },
        ],
      }),
    )
    .then(() => true, ifConditionFailed(false));
  if (written) return { comment: commentOut(rec), visibility: item.visibility as string };
  // Either a replay (the Comment is there) or the Item's Visibility just changed: re-read both.
  const stored = (await ddb.send(new GetCommand({ TableName: TABLE, Key: key }))).Item;
  const now = await getItemFor(ctx, args.itemId);
  if (!stored) throw new UserError("ConflictError", "item changed, retry");
  if (stored.by !== ctx.userId) throw new UserError("ConflictError", "comment id taken");
  return { comment: commentOut(stored), visibility: now.visibility as string };
}

const RESOLVERS: Record<string, (ctx: Ctx, args: any) => Promise<unknown>> = {
  me, snapshot, completions, putItem, completeItem, undoCompletion, putTag, deleteTag, putProfile,
  putPushSubscription, deletePushSubscription,
  comments, addComment,
};

export async function handler(event: AppSyncResolverEvent<Record<string, unknown>>) {
  const id = event.identity as AppSyncIdentityCognito;
  const username = (id?.claims?.["cognito:username"] ?? id?.username) as string;
  if (!id?.sub || !ALLOWED.includes(username)) throw new Error("Forbidden");
  const fn = RESOLVERS[event.info.fieldName];
  if (!fn) throw new Error(`no resolver for ${event.info.fieldName}`);
  try {
    return await fn({ userId: id.sub, username }, event.arguments);
  } catch (e) {
    if (e instanceof UserError) throw new Error(`${e.type}: ${e.message}`);
    console.error(e);
    throw new Error("InternalError");
  }
}
