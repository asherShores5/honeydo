// Notifier Lambda (m4/04): EventBridge Scheduler invokes it at :00/:15/:30/:45. One run loads the
// household, plans pushes with the shared rules (shared/src/notify.ts), and for each push claims
// its state record, sends it to the Member's devices, and deletes subscriptions the push service
// says are gone (404/410).
//
// Dedupe is claim-before-send: a conditional write moves the state record from the value this run
// read to `now`, and only the run that wins sends. A crash after the claim loses that one push
// rather than risking a duplicate (SPEC story 26).
//
// Two job sources share claiming, sending and pruning: overdue Dings (NSTATE#<itemId>#<sub>
// records) and the daily Handoff (m4/06, HANDOFF#<sub> records).
import { createHash } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { DeleteCommand, DynamoDBDocumentClient, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import webpush from "web-push";
import {
  dingPayload, handoffPayload, planDings, planHandoffs, readAlertPrefs,
  type Completion, type DingState, type HandoffState, type Item, type NotifyMember, type PushPayload,
} from "@aubi/shared";
import { PK, handoffKey, ifConditionFailed, nstateKey } from "./table";

const TABLE = process.env.TABLE_NAME!;
const NSTATE_TTL_S = 30 * 24 * 3600;
const PUSH_TIMEOUT_MS = 5000;

// ---- seams -----------------------------------------------------------------

type DocClient = Pick<DynamoDBDocumentClient, "send">;

let ddb: DocClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

/** Test seam: swap the document client. Production never calls this. */
export function setDocClient(client: DocClient) {
  ddb = client;
}

/** One device's Web Push subscription, in the shape web-push takes. */
export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface SendOptions {
  /** Seconds the push service keeps an undelivered push (RFC 8030 §5.2). */
  TTL: number;
  urgency: "very-low" | "low" | "normal" | "high";
  /** A newer push with the same topic replaces an undelivered one (RFC 8030 §5.4). */
  topic?: string;
}

/**
 * Sends one push. Rejects on failure; a push-service answer carries `statusCode` (web-push's
 * WebPushError), and 404/410 mean the subscription is gone.
 */
export type PushSender = (sub: PushTarget, payload: string, opts: SendOptions) => Promise<void>;

let vapid: Promise<void> | undefined;

/** VAPID keys from SSM, read once per cold start. The private key never leaves this process. */
function loadVapid() {
  vapid ??= (async () => {
    const ssm = new SSMClient({});
    const get = async (name: string) =>
      (await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }))).Parameter!.Value!;
    const [publicKey, privateKey] = await Promise.all([get(process.env.VAPID_PUBLIC_PARAM!), get(process.env.VAPID_PRIVATE_PARAM!)]);
    webpush.setVapidDetails(process.env.VAPID_SUBJECT!, publicKey, privateKey);
  })().catch((e) => {
    vapid = undefined; // retry on the next run instead of caching the failure
    throw e;
  });
  return vapid;
}

const webPushSender: PushSender = async (sub, payload, opts) => {
  await loadVapid();
  await webpush.sendNotification(sub, payload, { ...opts, timeout: PUSH_TIMEOUT_MS });
};

let send: PushSender = webPushSender;

/** Test seam: swap the push sender for a fake. Production never calls this. */
export function setPushSender(sender: PushSender) {
  send = sender;
}

// ---- load ------------------------------------------------------------------

async function queryPrefix(prefix: string) {
  const out: Record<string, unknown>[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :p)",
        ExpressionAttributeValues: { ":pk": PK, ":p": prefix },
        ExclusiveStartKey,
      }),
    );
    out.push(...(r.Items ?? []));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}

interface Subscription extends PushTarget {
  SK: string;
  userId: string;
}

/** Everything one run needs, read up front. */
interface Snapshot {
  items: Item[];
  members: NotifyMember[];
  dingStates: DingState[];
  handoffStates: HandoffState[];
  subscriptions: Subscription[];
}

async function load(): Promise<Snapshot> {
  const [items, profiles, nstate, handoff, push] = await Promise.all([
    queryPrefix("ITEM#"), queryPrefix("USER#"), queryPrefix("NSTATE#"), queryPrefix("HANDOFF#"), queryPrefix("PUSH#"),
  ]);
  return {
    items: items as unknown as Item[],
    members: profiles.map((p) => ({
      userId: p.userId as string, prefs: readAlertPrefs(p.alertPrefs), name: (p.displayName ?? p.username) as string | undefined,
    })),
    dingStates: nstate.map((s) => ({ itemId: s.itemId as string, userId: s.userId as string, lastAlertedAt: s.lastAlertedAt as number })),
    handoffStates: handoff.map((s) => ({ userId: s.userId as string, lastHandoffAt: s.lastHandoffAt as number })),
    subscriptions: push.map((s) => ({
      SK: s.SK as string, userId: s.userId as string, endpoint: s.endpoint as string,
      keys: { p256dh: s.p256dh as string, auth: s.auth as string },
    })),
  };
}

// ---- jobs ------------------------------------------------------------------

/** One push to one Member: claim its state record, and if this run won the claim, send it. */
interface PushJob {
  kind: "ding" | "handoff";
  userId: string;
  /** Conditional write of the state record; false if another run already sent this push. */
  claim: () => Promise<boolean>;
  payload: PushPayload;
  options: SendOptions;
}

/**
 * Claim-before-send: move one state record's `field` from `seen` (the value this run read; absent
 * if there was none) to `now`, writing `set` alongside. True if this run won the claim; false if
 * another run already moved it, so that run sent the push.
 */
function claimState(sk: string, field: "lastAlertedAt" | "lastHandoffAt", seen: number | undefined, now: number, set: Record<string, unknown>) {
  const names = Object.keys(set);
  return ddb
    .send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK, SK: sk },
        UpdateExpression: "SET " + [...names.map((_, i) => `#s${i} = :s${i}`), `${field} = :now`].join(", "),
        ConditionExpression: seen === undefined ? `attribute_not_exists(${field})` : `attribute_not_exists(${field}) OR ${field} = :seen`,
        ExpressionAttributeNames: Object.fromEntries(names.map((k, i) => [`#s${i}`, k])),
        ExpressionAttributeValues: {
          ...Object.fromEntries(names.map((k, i) => [`:s${i}`, set[k]])),
          ":now": now,
          ...(seen === undefined ? {} : { ":seen": seen }),
        },
      }),
    )
    .then(() => true, ifConditionFailed(false));
}

/**
 * Same item, same topic, so an offline phone gets one Ding per item rather than a backlog. RFC 8030
 * §5.4 caps a Topic at 32 characters of the base64url alphabet and item IDs run to 64, so the
 * topic is "d" plus the first 31 characters of the ID's SHA-256.
 */
function topicFor(itemId: string) {
  return "d" + createHash("sha256").update(itemId).digest("base64url").slice(0, 31);
}

function dingJobs(snap: Snapshot, now: number): PushJob[] {
  return planDings(snap.items, snap.members, snap.dingStates, now).map((d) => ({
    kind: "ding",
    userId: d.userId,
    claim: () =>
      claimState(nstateKey(d.itemId, d.userId), "lastAlertedAt", d.seen, now, {
        itemId: d.itemId, userId: d.userId, ttl: Math.floor(now / 1000) + NSTATE_TTL_S,
      }),
    payload: dingPayload(d.item, now),
    // A Ding is stale after the next Slot; high Severity asks for immediate delivery.
    options: { TTL: 6 * 3600, urgency: d.item.severity === "high" ? "high" : "normal", topic: topicFor(d.itemId) },
  }));
}

async function handoffJobs(snap: Snapshot, now: number): Promise<PushJob[]> {
  // Only Members with a device can get a Handoff, so the rest are left out before planning.
  const subscribed = new Set(snap.subscriptions.map((s) => s.userId));
  const recipients = snap.members.filter((m) => subscribed.has(m.userId));
  // Probe step: plan once without Completions, so DONE# is only read on the few runs where a
  // Handoff is due for someone who can receive it.
  const probe = planHandoffs(snap.items, [], recipients, snap.handoffStates, now);
  if (!probe.length) return [];
  const completions = (await queryPrefix("DONE#")) as unknown as Completion[];
  // The real plan gets every Member, so the partner's name is known for "who did it".
  const planned = planHandoffs(snap.items, completions, snap.members, snap.handoffStates, now).filter((p) => subscribed.has(p.userId));
  return planned.map((p) => ({
    kind: "handoff",
    userId: p.userId,
    // lastHandoffSince keeps the window this Handoff covered, so the in-app card (via `me`) can
    // say exactly what the push said even when it ran late.
    claim: () => claimState(handoffKey(p.userId), "lastHandoffAt", p.seen, now, { userId: p.userId, lastHandoffSince: p.content.since }),
    payload: handoffPayload(p.content),
    // Stale by the next morning; a newer Handoff replaces an undelivered one.
    options: { TTL: 12 * 3600, urgency: "normal", topic: "handoff" },
  }));
}

// ---- run -------------------------------------------------------------------

export interface RunSummary {
  /** Pushes claimed and sent this run (one per Member and Ding). */
  dings: number;
  /** Handoffs claimed and sent this run (at most one per Member a day). */
  handoffs: number;
  /** Device deliveries that succeeded / failed, and subscriptions deleted as gone. */
  sent: number;
  failed: number;
  pruned: number;
}

export async function runNotifier(now = Date.now()): Promise<RunSummary> {
  const snap = await load();
  const jobs = [...dingJobs(snap, now), ...(await handoffJobs(snap, now))];
  const summary: RunSummary = { dings: 0, handoffs: 0, sent: 0, failed: 0, pruned: 0 };
  const gone = new Set<string>();

  for (const job of jobs) {
    const devices = snap.subscriptions.filter((s) => s.userId === job.userId && !gone.has(s.SK));
    if (!devices.length) continue; // nothing to deliver to: leave the state unclaimed
    if (!(await job.claim())) continue;
    if (job.kind === "ding") summary.dings++;
    else summary.handoffs++;
    const body = JSON.stringify(job.payload);
    await Promise.all(
      devices.map(async (sub) => {
        try {
          await send({ endpoint: sub.endpoint, keys: sub.keys }, body, job.options);
          summary.sent++;
        } catch (e) {
          summary.failed++;
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            gone.add(sub.SK);
            await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { PK, SK: sub.SK } }));
            summary.pruned++;
          } else {
            // 403 is a VAPID setup bug, 413 ours, 429/5xx transient: keep the subscription.
            console.error(`push failed (${status ?? "no status"}) for ${job.kind} to ${job.userId}`, (e as Error).message);
          }
        }
      }),
    );
  }
  console.log(JSON.stringify({ msg: "notifier run", now, ...summary }));
  return summary;
}

export async function handler(): Promise<RunSummary> {
  return runNotifier();
}
