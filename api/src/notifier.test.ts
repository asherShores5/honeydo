// Thin handler test for the Notifier (m4/04): real records written through the API resolvers,
// a fake push sender, and the in-memory table. Which Dings fire is Seam 1 (shared/src/notify.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOUR } from "@aubi/shared";
import { harness } from "./testing/harness";
import type { PushSender, PushTarget, SendOptions } from "./notifier";

const h = harness();
const { runNotifier, setDocClient, setPushSender } = await import("./notifier");
setDocClient(h.db);

const T0 = Date.UTC(2026, 9, 5, 19, 0); // Mon 2026-10-05 12:00 Pacific, outside Quiet hours

interface Sent {
  endpoint: string;
  payload: any;
  opts: SendOptions;
}
let sent: Sent[] = [];
let failFor: Record<string, number> = {};
const fakeSender: PushSender = async (sub: PushTarget, payload: string, opts: SendOptions) => {
  const status = failFor[sub.endpoint];
  if (status) throw Object.assign(new Error(`push failed ${status}`), { statusCode: status });
  sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload), opts });
};

const endpoint = (who: string, dev = "dev-1") => `https://web.push.apple.com/${who}-${dev}`;

async function subscribe(member: typeof h.A, dev = "dev-1") {
  await h.call(member, "putPushSubscription", {
    deviceId: dev, endpoint: endpoint(member.username, dev),
    p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
    auth: "tBHItJI5svbpez7KI4CCXg",
  });
}

/** A chore that was never done, so it is due (red) from the moment it is created. */
function overdueChore(id: string, over: Record<string, unknown> = {}) {
  return {
    id, kind: "chore", title: `Chore ${id}`, notes: "secret notes", tags: [], visibility: "shared",
    recurrence: JSON.stringify({ type: "interval", every: 1, unit: "days" }), archived: false, ...over,
  };
}

const nstate = () => h.db.dump().filter((r) => String(r.SK).startsWith("NSTATE#"));
const pushSks = () => h.db.dump().filter((r) => String(r.SK).startsWith("PUSH#")).map((r) => r.SK).sort();

beforeEach(async () => {
  h.reset();
  sent = [];
  failFor = {};
  setPushSender(fakeSender);
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  await h.call(h.A, "putProfile", { input: { displayName: "A" } });
  await h.call(h.B, "putProfile", { input: { displayName: "B" } });
});

afterEach(() => vi.useRealTimers());

describe("overdue Dings", () => {
  it("a red shared item dings each Member's device once, deep-linked to the item", async () => {
    await subscribe(h.A);
    await subscribe(h.B);
    await h.call(h.A, "putItem", { input: overdueChore("c1") });

    await runNotifier(T0 + 15 * 60_000);

    expect(sent.map((s) => s.endpoint).sort()).toEqual([endpoint("member-a"), endpoint("member-b")]);
    expect(sent[0].payload).toEqual({
      title: "Chore c1", body: "Overdue", data: { kind: "ding", itemId: "c1", url: "/?item=c1" },
    });
  });

  it("two runs in the same Slot send one Ding", async () => {
    await subscribe(h.A);
    await h.call(h.A, "putItem", { input: overdueChore("c1", { assigneeId: h.A.userId }) });

    await runNotifier(T0 + 15 * 60_000);
    await runNotifier(T0 + 15 * 60_000);
    await runNotifier(T0 + 30 * 60_000);

    expect(sent).toHaveLength(1);
  });

  it("two overlapping runs (a duplicate invoke) still send one Ding", async () => {
    await subscribe(h.A);
    await h.call(h.A, "putItem", { input: overdueChore("c1", { assigneeId: h.A.userId }) });

    await Promise.all([runNotifier(T0 + 15 * 60_000), runNotifier(T0 + 15 * 60_000)]);

    expect(sent).toHaveLength(1);
  });

  it("records the last Ding per Member and item", async () => {
    await subscribe(h.A);
    await subscribe(h.B);
    await h.call(h.A, "putItem", { input: overdueChore("c1") });
    const now = T0 + 15 * 60_000;

    await runNotifier(now);

    expect(nstate().map((r) => [r.SK, r.itemId, r.userId, r.lastAlertedAt]).sort()).toEqual([
      [`NSTATE#c1#${h.A.userId}`, "c1", h.A.userId, now],
      [`NSTATE#c1#${h.B.userId}`, "c1", h.B.userId, now],
    ]);
    expect(nstate().every((r) => typeof r.ttl === "number" && (r.ttl as number) > now / 1000)).toBe(true);
  });

  it("dings again at the next Slot", async () => {
    await subscribe(h.A);
    await h.call(h.A, "putItem", { input: overdueChore("c1", { assigneeId: h.A.userId, severity: "medium" }) });

    await runNotifier(T0 + 15 * 60_000);
    await runNotifier(T0 + 5 * HOUR); // 17:00 Pacific, medium's second Slot

    expect(sent).toHaveLength(2);
  });

  it("a Member with overdue alerts off gets nothing", async () => {
    await h.call(h.A, "putProfile", { input: { alertPrefs: { overdueAlerts: false } } });
    await subscribe(h.A);
    await h.call(h.A, "putItem", { input: overdueChore("c1", { assigneeId: h.A.userId }) });

    await runNotifier(T0 + 15 * 60_000);

    expect(sent).toEqual([]);
    expect(nstate()).toEqual([]);
  });

  it("a Private item dings only its owner's devices, and the payload holds only title and link", async () => {
    await subscribe(h.A);
    await subscribe(h.B);
    await h.call(h.A, "putItem", { input: overdueChore("p1", { visibility: `private:${h.A.userId}` }) });

    await runNotifier(T0 + 15 * 60_000);

    expect(sent.map((s) => s.endpoint)).toEqual([endpoint("member-a")]);
    const json = JSON.stringify(sent[0].payload);
    for (const leak of ["secret notes", "private", h.A.userId, h.B.userId]) expect(json).not.toContain(leak);
  });

  it("every device a Member has gets the Ding", async () => {
    await subscribe(h.A, "phone");
    await subscribe(h.A, "laptop");
    await h.call(h.A, "putItem", { input: overdueChore("c1", { assigneeId: h.A.userId }) });

    await runNotifier(T0 + 15 * 60_000);

    expect(sent.map((s) => s.endpoint).sort()).toEqual([endpoint("member-a", "laptop"), endpoint("member-a", "phone")]);
  });

  it("a Member with no push subscription isn't marked as dinged", async () => {
    await subscribe(h.B);
    await h.call(h.A, "putItem", { input: overdueChore("c1") });

    await runNotifier(T0 + 15 * 60_000);

    expect(sent.map((s) => s.endpoint)).toEqual([endpoint("member-b")]);
    expect(nstate().map((r) => r.userId)).toEqual([h.B.userId]);
  });

  it("sends with a short TTL, a per-item topic, and high urgency for high Severity", async () => {
    await subscribe(h.A);
    await h.call(h.A, "putItem", { input: overdueChore("c1", { assigneeId: h.A.userId, severity: "high" }) });
    await h.call(h.A, "putItem", { input: overdueChore("c2", { assigneeId: h.A.userId }) });

    await runNotifier(T0 + 15 * 60_000);

    const byItem = Object.fromEntries(sent.map((s) => [s.payload.data.itemId, s.opts]));
    expect(byItem.c1).toMatchObject({ TTL: 6 * 3600, urgency: "high" });
    expect(byItem.c2).toMatchObject({ TTL: 6 * 3600, urgency: "normal" });
    expect(byItem.c1.topic).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
    expect(byItem.c1.topic).not.toBe(byItem.c2.topic);
  });
});

describe("expired push subscriptions", () => {
  it("a 410 or 404 removes that subscription; other devices still get the Ding", async () => {
    await subscribe(h.A, "gone");
    await subscribe(h.A, "lost");
    await subscribe(h.A, "phone");
    failFor = { [endpoint("member-a", "gone")]: 410, [endpoint("member-a", "lost")]: 404 };
    await h.call(h.A, "putItem", { input: overdueChore("c1", { assigneeId: h.A.userId }) });

    await runNotifier(T0 + 15 * 60_000);

    expect(sent.map((s) => s.endpoint)).toEqual([endpoint("member-a", "phone")]);
    expect(pushSks()).toEqual([`PUSH#${h.A.userId}#phone`]);
  });

  it("other push failures keep the subscription and don't stop the run", async () => {
    await subscribe(h.A);
    await subscribe(h.B);
    failFor = { [endpoint("member-a")]: 503 };
    await h.call(h.A, "putItem", { input: overdueChore("c1") });

    const summary = await runNotifier(T0 + 15 * 60_000);

    expect(sent.map((s) => s.endpoint)).toEqual([endpoint("member-b")]);
    expect(pushSks()).toEqual([`PUSH#${h.A.userId}#dev-1`, `PUSH#${h.B.userId}#dev-1`]);
    expect(summary).toMatchObject({ dings: 2, sent: 1, failed: 1, pruned: 0 });
  });
});
