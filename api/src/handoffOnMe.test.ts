// Review S3: the Handoff card needs the Member's actual last Handoff, which only `me` exposes.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DAY, HOUR } from "@aubi/shared";
import { harness } from "./testing/harness";
import type { PushSender } from "./notifier";

const h = harness();
const { runNotifier, setDocClient, setPushSender } = await import("./notifier");
setDocClient(h.db);

const T0 = Date.UTC(2026, 9, 5, 19, 0); // Mon 2026-10-05 12:00 Pacific
const EIGHT_PM = T0 + 8 * HOUR; // the default Handoff time
const noSend: PushSender = async () => {};

async function subscribe(member: typeof h.A) {
  await h.call(member, "putPushSubscription", {
    deviceId: "dev-1", endpoint: `https://web.push.apple.com/${member.username}`,
    p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
    auth: "tBHItJI5svbpez7KI4CCXg",
  });
}

beforeEach(async () => {
  h.reset();
  setPushSender(noSend);
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  await h.call(h.A, "putProfile", { input: { displayName: "Asher" } });
  await h.call(h.B, "putProfile", { input: { displayName: "Aubyn" } });
  await subscribe(h.A);
});
afterEach(() => vi.useRealTimers());

describe("the last Handoff on `me`", () => {
  it("is null before any Handoff was sent", async () => {
    expect(await h.call(h.A, "me")).toMatchObject({ lastHandoffAt: null, lastHandoffSince: null });
  });

  it("after a late push: when it was sent and the window it covered", async () => {
    vi.setSystemTime(EIGHT_PM + 40 * 60_000); // the 20:00 Handoff went out at 20:40
    await runNotifier();
    expect(await h.call(h.A, "me")).toMatchObject({ lastHandoffAt: EIGHT_PM + 40 * 60_000, lastHandoffSince: EIGHT_PM + 40 * 60_000 - DAY });
    vi.setSystemTime(EIGHT_PM + DAY + 5 * 60_000); // the next one at 20:05 covers since 20:40 yesterday
    await runNotifier();
    expect(await h.call(h.A, "me")).toMatchObject({ lastHandoffAt: EIGHT_PM + DAY + 5 * 60_000, lastHandoffSince: EIGHT_PM + 40 * 60_000 });
  });

  it("never reaches the partner: not on their `me`, their snapshot Profiles or a putProfile fan-out", async () => {
    vi.setSystemTime(EIGHT_PM + HOUR);
    await runNotifier();
    expect(await h.call(h.B, "me")).toMatchObject({ lastHandoffAt: null, lastHandoffSince: null });
    const { profiles } = await h.call(h.B, "snapshot");
    const a = profiles.find((p: any) => p.userId === h.A.userId);
    expect(a.lastHandoffAt ?? null).toBeNull();
    const fanned = await h.call(h.A, "putProfile", { input: { theme: "dark" } });
    expect(fanned.lastHandoffAt ?? null).toBeNull();
    expect(fanned.lastHandoffSince ?? null).toBeNull();
  });
});
