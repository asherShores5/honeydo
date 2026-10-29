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
import type { Item } from "@aubi/shared";
import { UserError, canSee, validateItemInput, validateProfileInput, type ItemInput } from "./rules";

const TABLE = process.env.TABLE_NAME!;
const ALLOWED = (process.env.ALLOWED_USERNAMES ?? "").split(",").filter(Boolean);
const PK = "HH#aubi";
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

const FEED_SIZE = 100;

/** The newest FEED_SIZE feed events `ctx` may see, newest first. Pages past events hidden from them. */
async function visibleFeed(ctx: Ctx) {
  const out: Record<string, unknown>[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :p)",
        ExpressionAttributeValues: { ":pk": PK, ":p": "FEED#" },
        ScanIndexForward: false,
        Limit: FEED_SIZE,
        ExclusiveStartKey,
      }),
    );
    out.push(...(r.Items ?? []).filter((f) => canSee(f.visibility as string, ctx.userId)));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey && out.length < FEED_SIZE);
  return out.slice(0, FEED_SIZE);
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
  // GSI1 (PK, updatedAt) powers delta sync.
  return { ...rec, GSI1PK: PK };
}

/** Sort key of one Completion; the timestamp is zero-padded so keys sort by time. */
function completionKey(itemId: string, at: number) {
  return `DONE#${itemId}#${String(at).padStart(15, "0")}`;
}

/**
 * Use as `.then(ok, ifConditionFailed(x))`: a failed ConditionExpression gives `x`, and so does a
 * transaction cancelled only by failed conditions. Other errors rethrow.
 */
function ifConditionFailed<T>(value: T) {
  return (e: unknown) => {
    const err = e as Error & { CancellationReasons?: { Code?: string }[] };
    if (err.name === "ConditionalCheckFailedException") return value;
    const codes = (err.CancellationReasons ?? []).map((r) => r.Code);
    if (
      err.name === "TransactionCanceledException" &&
      codes.includes("ConditionalCheckFailed") &&
      codes.every((c) => c === "None" || c === "ConditionalCheckFailed")
    ) {
      return value;
    }
    throw e;
  };
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
  const [items, tags, profiles, feedRecs] = await Promise.all([
    queryPrefix("ITEM#"),
    queryPrefix("TAG#"),
    queryPrefix("USER#"),
    visibleFeed(ctx),
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
  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: rec,
      ConditionExpression: existing ? "version = :v" : "attribute_not_exists(SK)",
      ExpressionAttributeValues: existing ? { ":v": existing.version } : undefined,
    }),
  ).catch((e) => {
    if (e.name === "ConditionalCheckFailedException") throw new UserError("ConflictError", "item changed, retry");
    throw e;
  });
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
  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: rec,
      ConditionExpression: "attribute_not_exists(SK) OR #g = :g",
      ExpressionAttributeNames: { "#g": "group" },
      ExpressionAttributeValues: { ":g": group.trim() },
    }),
  ).catch((e) => {
    if (e.name === "ConditionalCheckFailedException") throw new UserError("ValidationError", "tag ID belongs to another group");
    throw e;
  });
  return strip(rec);
}

/**
 * Strip a deleted Tag from every item that carries it (all Visibilities), bumping each item's
 * version so stale edits conflict instead of re-adding the dead ID. One partition, small data.
 * Clients refresh on the deleted-Tag event to pick up the new versions.
 */
async function removeTagFromItems(tagId: string) {
  for (const item of await queryPrefix("ITEM#")) {
    let cur: Record<string, unknown> | undefined = item;
    for (let attempt = 0; cur && (cur.tags as string[] | undefined)?.includes(tagId) && attempt < 5; attempt++) {
      try {
        await ddb.send(
          new UpdateCommand({
            TableName: TABLE,
            Key: { PK, SK: cur.SK },
            UpdateExpression: "SET tags = :tags, updatedAt = :now, version = version + :one",
            ConditionExpression: "version = :v",
            ExpressionAttributeValues: {
              ":tags": (cur.tags as string[]).filter((t) => t !== tagId),
              ":now": Date.now(), ":one": 1, ":v": cur.version,
            },
          }),
        );
        break;
      } catch (e) {
        if ((e as Error).name !== "ConditionalCheckFailedException") throw e;
        cur = (await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK, SK: cur.SK } }))).Item;
      }
    }
  }
}

async function deleteTag(_ctx: Ctx, args: { id: string }) {
  const r = await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { PK, SK: `TAG#${args.id}` }, ReturnValues: "ALL_OLD" }));
  if (!r.Attributes) throw new UserError("NotFound", "tag not found");
  await removeTagFromItems(args.id);
  return { ...strip<Record<string, unknown>>(r.Attributes), deleted: true, updatedAt: Date.now() };
}

async function putProfile(ctx: Ctx, args: { input: Record<string, unknown> }) {
  await me(ctx); // ensure the record exists
  const fields = validateProfileInput(args.input);
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

const RESOLVERS: Record<string, (ctx: Ctx, args: any) => Promise<unknown>> = {
  me, snapshot, completions, putItem, completeItem, undoCompletion, putTag, deleteTag, putProfile,
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
