// Review fix S6: the Notifier only reads Completions (DONE#) when a Handoff is due for a Member it
// can actually deliver to. A Member with no device would otherwise cost a DONE# read every run.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { HOUR } from "@aubi/shared";
import { harness } from "./testing/harness";

const h = harness();
const { runNotifier, setDocClient, setPushSender } = await import("./notifier");

const T0 = Date.UTC(2026, 9, 5, 19, 0); // Mon 2026-10-05 12:00 Pacific
const EIGHT_PM = T0 + 8 * HOUR; // the default Handoff time

let prefixesRead: string[] = [];
let sent: string[] = [];
let bodies: string[] = [];

beforeEach(async () => {
  h.reset();
  prefixesRead = [];
  sent = [];
  bodies = [];
  setDocClient({
    send: (cmd: any) => {
      if (cmd instanceof QueryCommand) prefixesRead.push(String(cmd.input.ExpressionAttributeValues?.[":p"]));
      return h.db.send(cmd);
    },
  } as any);
  setPushSender(async (sub, payload) => {
    sent.push(sub.endpoint);
    bodies.push(JSON.parse(payload).body);
  });
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  await h.call(h.A, "putProfile", { input: { displayName: "Asher" } });
  await h.call(h.B, "putProfile", { input: { displayName: "Aubyn" } });
});

afterEach(() => vi.useRealTimers());

async function subscribe(member: typeof h.A) {
  await h.call(member, "putPushSubscription", {
    deviceId: "dev-1", endpoint: `https://web.push.apple.com/${member.username}`,
    p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
    auth: "tBHItJI5svbpez7KI4CCXg",
  });
}

describe("Handoff reads", () => {
  it("doesn't read Completions when no Member with a due Handoff has a device", async () => {
    await runNotifier(EIGHT_PM);
    expect(prefixesRead).not.toContain("DONE#");
    expect(sent).toEqual([]);
  });

  it("still reads them, and names the partner, when a subscribed Member's Handoff is due", async () => {
    await subscribe(h.A);
    await h.call(h.B, "putItem", {
      input: {
        id: "c1", kind: "chore", title: "Trash", tags: [], visibility: "shared", archived: false,
        recurrence: JSON.stringify({ type: "interval", every: 1, unit: "days" }),
      },
    });
    await h.call(h.B, "completeItem", { itemId: "c1", at: T0 + HOUR });

    const s = await runNotifier(EIGHT_PM);

    expect(prefixesRead).toContain("DONE#");
    expect(s.handoffs).toBe(1);
    expect(sent).toEqual(["https://web.push.apple.com/member-a"]);
    expect(bodies[0]).toContain("Trash (Aubyn)");
  });
});
