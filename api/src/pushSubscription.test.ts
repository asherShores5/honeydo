import { beforeEach, describe, expect, it } from "vitest";
import { harness } from "./testing/harness";

const h = harness();

beforeEach(() => h.reset());

const sub = (over: Record<string, unknown> = {}) => ({
  deviceId: "dev-1",
  endpoint: "https://web.push.apple.com/QGx1",
  p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
  auth: "tBHItJI5svbpez7KI4CCXg",
  ...over,
});

/** The stored push subscriptions: the records the Notifier (m4/04) reads with one PUSH# query. */
const pushRecords = () => h.db.dump().filter((r) => String(r.SK).startsWith("PUSH#"));

describe("putPushSubscription", () => {
  it("granting permission stores the subscription for that Member", async () => {
    const out = await h.call(h.A, "putPushSubscription", sub());
    expect(out).toMatchObject({ deviceId: "dev-1", enabled: true });
    expect(pushRecords()).toEqual([
      expect.objectContaining({
        PK: "HH#aubi", SK: `PUSH#${h.A.userId}#dev-1`, userId: h.A.userId, deviceId: "dev-1",
        endpoint: sub().endpoint, p256dh: sub().p256dh, auth: sub().auth,
      }),
    ]);
  });
});

describe("re-enabling", () => {
  it("on the same device replaces the old subscription rather than duplicating it", async () => {
    await h.call(h.A, "putPushSubscription", sub());
    await h.call(h.A, "putPushSubscription", sub({ endpoint: "https://web.push.apple.com/NEW", auth: "bmV3YXV0aA" }));
    expect(pushRecords()).toEqual([
      expect.objectContaining({ SK: `PUSH#${h.A.userId}#dev-1`, endpoint: "https://web.push.apple.com/NEW", auth: "bmV3YXV0aA" }),
    ]);
  });

  it("on a second device adds a second subscription", async () => {
    await h.call(h.A, "putPushSubscription", sub());
    await h.call(h.A, "putPushSubscription", sub({ deviceId: "dev-2" }));
    expect(pushRecords().map((r) => r.SK).sort()).toEqual([`PUSH#${h.A.userId}#dev-1`, `PUSH#${h.A.userId}#dev-2`]);
  });
});

describe("ownership and privacy", () => {
  it("each Member's subscription is keyed to them, even with the same device ID", async () => {
    await h.call(h.A, "putPushSubscription", sub());
    await h.call(h.B, "putPushSubscription", sub({ endpoint: "https://fcm.googleapis.com/fcm/send/b" }));
    expect(pushRecords().map((r) => [r.SK, r.userId]).sort()).toEqual([
      [`PUSH#${h.A.userId}#dev-1`, h.A.userId],
      [`PUSH#${h.B.userId}#dev-1`, h.B.userId],
    ]);
  });

  it("a userId argument can't write to the partner's subscriptions", async () => {
    await h.call(h.A, "putPushSubscription", { ...sub(), userId: h.B.userId });
    expect(pushRecords()).toEqual([expect.objectContaining({ SK: `PUSH#${h.A.userId}#dev-1`, userId: h.A.userId })]);
  });

  it("the partner never sees endpoint keys in the snapshot or on Profiles", async () => {
    await h.call(h.A, "putPushSubscription", sub());
    const text = JSON.stringify(await h.call(h.B, "snapshot"));
    expect(text).not.toContain(sub().p256dh);
    expect(text).not.toContain(sub().endpoint);
  });
});

describe("validation", () => {
  it.each([
    ["a non-https endpoint", { endpoint: "http://web.push.apple.com/x" }],
    ["an endpoint that isn't a URL", { endpoint: "not a url" }],
    ["a device ID with a #", { deviceId: "dev#B" }],
    ["an empty device ID", { deviceId: "" }],
    ["a p256dh key that isn't base64url", { p256dh: "a b" }],
    ["an empty auth secret", { auth: "" }],
    // The Notifier POSTs to the endpoint, so only real push services (no SSRF to anything else).
    ["a host that isn't a push service", { endpoint: "https://example.com/push" }],
    ["an internal host", { endpoint: "https://169.254.169.254/latest/meta-data" }],
    ["an IPv4 literal", { endpoint: "https://10.0.0.1/x" }],
    ["an IPv6 literal", { endpoint: "https://[::1]/x" }],
    ["a look-alike host", { endpoint: "https://fcm.googleapis.com.evil.example/x" }],
    ["a suffix without the dot", { endpoint: "https://evilpush.apple.com/x" }],
    ["a bare apex", { endpoint: "https://push.apple.com/x" }],
    ["userinfo", { endpoint: "https://user:pw@fcm.googleapis.com/fcm/send/x" }],
    ["userinfo naming a push host", { endpoint: "https://fcm.googleapis.com@example.com/x" }],
    ["an explicit non-443 port", { endpoint: "https://fcm.googleapis.com:8443/fcm/send/x" }],
    ["a trailing-dot host", { endpoint: "https://fcm.googleapis.com./fcm/send/x" }],
  ])("rejects %s", async (_why, over) => {
    await expect(h.call(h.A, "putPushSubscription", sub(over))).rejects.toThrow(/ValidationError/);
    expect(pushRecords()).toEqual([]);
  });

  it.each([
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/QGx1",
    "https://api.push.apple.com/3/device/abc",
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
    "https://fcm.googleapis.com:443/fcm/send/abc",
    "https://FCM.googleapis.com/fcm/send/abc",
  ])("accepts %s", async (endpoint) => {
    await expect(h.call(h.A, "putPushSubscription", sub({ endpoint }))).resolves.toMatchObject({ enabled: true });
  });
});

describe("device cap", () => {
  const fill = async (n: number) => {
    for (let i = 1; i <= n; i++) await h.call(h.A, "putPushSubscription", sub({ deviceId: `dev-${i}` }));
  };

  it("a Member can have 10 devices; an 11th new one is refused", async () => {
    await fill(10);
    await expect(h.call(h.A, "putPushSubscription", sub({ deviceId: "dev-11" }))).rejects.toThrow(/ValidationError: .*10 devices/);
    expect(pushRecords()).toHaveLength(10);
  });

  it("re-registering an existing device at the cap still works", async () => {
    await fill(10);
    await h.call(h.A, "putPushSubscription", sub({ deviceId: "dev-3", endpoint: "https://web.push.apple.com/NEW" }));
    expect(pushRecords().find((r) => r.deviceId === "dev-3")?.endpoint).toBe("https://web.push.apple.com/NEW");
  });

  it("the cap is per Member: the partner's devices don't count", async () => {
    await fill(10);
    await expect(h.call(h.B, "putPushSubscription", sub())).resolves.toMatchObject({ enabled: true });
  });
});

describe("deletePushSubscription", () => {
  it("turning notifications off removes only this device's subscription", async () => {
    await h.call(h.A, "putPushSubscription", sub());
    await h.call(h.A, "putPushSubscription", sub({ deviceId: "dev-2" }));
    await h.call(h.B, "putPushSubscription", sub());
    const out = await h.call(h.A, "deletePushSubscription", { deviceId: "dev-1" });
    expect(out).toMatchObject({ deviceId: "dev-1", enabled: false });
    expect(pushRecords().map((r) => r.SK).sort()).toEqual([`PUSH#${h.A.userId}#dev-2`, `PUSH#${h.B.userId}#dev-1`]);
  });

  it("turning off a device that was never on is fine", async () => {
    await expect(h.call(h.A, "deletePushSubscription", { deviceId: "dev-9" })).resolves.toMatchObject({ enabled: false });
  });
});
