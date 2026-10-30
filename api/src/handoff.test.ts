// Thin handler test for the Handoff push (m4/06): real records written through the API resolvers,
// a fake push sender, and the in-memory table. What a Handoff says and when it is due is Seam 1
// (shared/src/handoff.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DAY, HOUR } from "@aubi/shared";
import { harness } from "./testing/harness";
import type { PushSender, PushTarget, SendOptions } from "./notifier";

const h = harness();
const { runNotifier, setDocClient, setPushSender } = await import("./notifier");
setDocClient(h.db);

const T0 = Date.UTC(2026, 9, 5, 19, 0); // Mon 2026-10-05 12:00 Pacific
const EIGHT_PM = T0 + 8 * HOUR; // the default Handoff time

interface Sent {
  endpoint: string;
  payload: any;
  opts: SendOptions;
}
let sent: Sent[] = [];
const fakeSender: PushSender = async (sub: PushTarget, payload: string, opts: SendOptions) => {
  sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload), opts });
};
const handoffs = () => sent.filter((s) => s.payload.data.kind === "handoff");

const endpoint = (who: string) => `https://web.push.apple.com/${who}`;

async function subscribe(member: typeof h.A) {
  await h.call(member, "putPushSubscription", {
    deviceId: "dev-1", endpoint: endpoint(member.username),
    p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
    auth: "tBHItJI5svbpez7KI4CCXg",
  });
}

function chore(id: string, title: string, over: Record<string, unknown> = {}) {
  return {
    id, kind: "chore", title, notes: "secret notes", tags: [], visibility: "shared",
    recurrence: JSON.stringify({ type: "interval", every: 1, unit: "days" }), archived: false, ...over,
  };
}

const handoffState = () => h.db.dump().filter((r) => String(r.SK).startsWith("HANDOFF#"));

beforeEach(async () => {
  h.reset();
  sent = [];
  setPushSender(fakeSender);
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  await h.call(h.A, "putProfile", { input: { displayName: "Asher" } });
  await h.call(h.B, "putProfile", { input: { displayName: "Aubyn" } });
  await subscribe(h.A);
  await subscribe(h.B);
});

afterEach(() => vi.useRealTimers());

describe("Handoff push", () => {
  it("each Member gets one Handoff a day, however many runs land after their time", async () => {
    for (const t of [EIGHT_PM - 15 * 60_000, EIGHT_PM, EIGHT_PM + 15 * 60_000, EIGHT_PM + 3.75 * HOUR]) await runNotifier(t);
    expect(handoffs().map((s) => s.endpoint).sort()).toEqual([endpoint("member-a"), endpoint("member-b")]);

    await runNotifier(EIGHT_PM + DAY);
    expect(handoffs()).toHaveLength(4);
  });

  it("two overlapping runs (a duplicate invoke) still send one Handoff each", async () => {
    await Promise.all([runNotifier(EIGHT_PM), runNotifier(EIGHT_PM)]);
    expect(handoffs()).toHaveLength(2);
  });

  it("still sends when overdue alerts are off", async () => {
    await h.call(h.A, "putProfile", { input: { alertPrefs: { overdueAlerts: false } } });
    await h.call(h.A, "putItem", { input: chore("c1", "Dishes") }); // never done, so overdue

    await runNotifier(EIGHT_PM);

    const toA = sent.filter((s) => s.endpoint === endpoint("member-a"));
    expect(toA.map((s) => s.payload)).toEqual([
      { title: "Handoff", body: "Overdue: Dishes", data: { kind: "handoff", url: "/" } },
    ]);
  });

  it("records the last Handoff time per Member after a send", async () => {
    await runNotifier(EIGHT_PM + 15 * 60_000);
    expect(handoffState().map((r) => [r.SK, r.userId, r.lastHandoffAt]).sort()).toEqual([
      [`HANDOFF#${h.A.userId}`, h.A.userId, EIGHT_PM + 15 * 60_000],
      [`HANDOFF#${h.B.userId}`, h.B.userId, EIGHT_PM + 15 * 60_000],
    ]);

    await runNotifier(EIGHT_PM + DAY);
    expect(handoffState().map((r) => r.lastHandoffAt)).toEqual([EIGHT_PM + DAY, EIGHT_PM + DAY]);
  });

  it("each Member fires at their own Handoff time", async () => {
    await h.call(h.B, "putProfile", { input: { alertPrefs: { handoffAt: "21:30" } } });
    await runNotifier(EIGHT_PM);
    expect(handoffs().map((s) => s.endpoint)).toEqual([endpoint("member-a")]);
    await runNotifier(EIGHT_PM + 1.5 * HOUR);
    expect(handoffs().map((s) => s.endpoint)).toEqual([endpoint("member-a"), endpoint("member-b")]);
  });

  it("says what got done since the last Handoff and by whom; the partner's Private items stay out", async () => {
    const every3Days = JSON.stringify({ type: "interval", every: 3, unit: "days" });
    await h.call(h.A, "putItem", { input: chore("bath", "Baby bath", { recurrence: every3Days }) });
    await h.call(h.B, "putItem", { input: chore("gift", "Buy Asher's gift", { recurrence: every3Days, visibility: `private:${h.B.userId}` }) });
    vi.setSystemTime(T0 + HOUR);
    await h.call(h.B, "completeItem", { itemId: "bath" });
    await h.call(h.B, "completeItem", { itemId: "gift" });

    await runNotifier(EIGHT_PM);

    const toA = handoffs().find((s) => s.endpoint === endpoint("member-a"))!;
    expect(toA.payload.body).toBe("Done: Baby bath (Aubyn)");
    expect(JSON.stringify(toA.payload)).not.toContain("gift");
    const toB = handoffs().find((s) => s.endpoint === endpoint("member-b"))!;
    expect(toB.payload.body).toBe("Done: Baby bath (you), Buy Asher's gift (you)");
  });

  it("a Completion logged while the Item was Private stays out of the partner's Handoff after it is shared", async () => {
    const every3Days = JSON.stringify({ type: "interval", every: 3, unit: "days" });
    const gift = chore("gift", "Wrap the gift", { recurrence: every3Days, visibility: `private:${h.B.userId}` });
    await h.call(h.B, "putItem", { input: gift });
    vi.setSystemTime(T0 + HOUR);
    await h.call(h.B, "completeItem", { itemId: "gift" });
    await h.call(h.B, "putItem", { input: { ...gift, visibility: "shared" } });

    await runNotifier(EIGHT_PM);

    const toA = handoffs().find((s) => s.endpoint === endpoint("member-a"))!;
    expect(toA.payload.body).not.toContain("Done");
    const toB = handoffs().find((s) => s.endpoint === endpoint("member-b"))!;
    expect(toB.payload.body).toContain("Done: Wrap the gift (you)");
  });

  it("sends with a 12-hour TTL and a topic, so a backlog collapses to the latest", async () => {
    await runNotifier(EIGHT_PM);
    expect(handoffs()[0].opts).toMatchObject({ TTL: 12 * 3600, urgency: "normal", topic: "handoff" });
  });

  it("a Member with no push subscription isn't marked as sent", async () => {
    await h.call(h.A, "deletePushSubscription", { deviceId: "dev-1" });
    await runNotifier(EIGHT_PM);
    expect(handoffState().map((r) => r.userId)).toEqual([h.B.userId]);
  });
});
