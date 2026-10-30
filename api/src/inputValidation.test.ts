// Input the client should never send comes back as a ValidationError the client can show, never
// stored and never an InternalError.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { harness } from "./testing/harness";

const h = harness();
const T0 = Date.UTC(2026, 9, 29, 12);
const YEAR = 365.25 * 24 * 3600 * 1000;

beforeEach(async () => {
  h.reset();
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  await h.call(h.A, "me");
});
afterEach(() => vi.useRealTimers());

const tags = () => h.db.dump().filter((r) => String(r.SK).startsWith("TAG#"));
const items = () => h.db.dump().filter((r) => String(r.SK).startsWith("ITEM#"));

describe("putTag color and order", () => {
  const tag = (over: Record<string, unknown>) => ({ input: { id: "kitchen", name: "Kitchen", group: "Locale", ...over } });

  it.each([
    ["a CSS injection", { color: "red;background:url(x)" }],
    ["a short hex", { color: "#fff" }],
    ["a hex without #", { color: "aabbcc" }],
    ["a named colour", { color: "red" }],
    ["a non-string colour", { color: 7 }],
    ["a negative order", { order: -1 }],
    ["a fractional order", { order: 1.5 }],
    ["a huge order", { order: 10_001 }],
    ["a non-number order", { order: "1" }],
  ])("rejects %s", async (_why, over) => {
    await expect(h.call(h.A, "putTag", tag(over))).rejects.toThrow(/ValidationError/);
    expect(tags()).toEqual([]);
  });

  it.each([
    ["a 6-digit hex colour and an order", { color: "#A1b2C3", order: 10_000 }],
    ["an empty colour", { color: "" }],
    ["null colour and order", { color: null, order: null }],
    ["neither given", {}],
    ["order 0", { order: 0 }],
  ])("accepts %s", async (_why, over) => {
    await expect(h.call(h.A, "putTag", tag(over))).resolves.toMatchObject({ id: "kitchen" });
  });
});

describe("item dueAt and snoozedUntil", () => {
  const task = (over: Record<string, unknown>) => ({
    input: { id: "t1", kind: "task", title: "Call the vet", tags: [], visibility: "shared", archived: false, ...over },
  });

  it.each([
    ["dueAt NaN", { dueAt: NaN }],
    ["dueAt Infinity", { dueAt: Infinity }],
    ["dueAt negative", { dueAt: -1 }],
    ["dueAt past now + 20 years", { dueAt: T0 + 20 * YEAR + 60_000 }],
    ["dueAt a string", { dueAt: "tomorrow" }],
    ["snoozedUntil NaN", { snoozedUntil: NaN }],
    ["snoozedUntil negative", { snoozedUntil: -5 }],
    ["snoozedUntil past now + 20 years", { snoozedUntil: Number.MAX_SAFE_INTEGER }],
  ])("rejects %s", async (_why, over) => {
    await expect(h.call(h.A, "putItem", task(over))).rejects.toThrow(/ValidationError/);
    expect(items()).toEqual([]);
  });

  it("accepts real times, past or future, and null", async () => {
    await h.call(h.A, "putItem", task({ dueAt: T0 + 19 * YEAR, snoozedUntil: T0 - 1000 }));
    await h.call(h.A, "putItem", task({ dueAt: null, snoozedUntil: null }));
    expect(items()).toHaveLength(1);
  });
});

describe("bad JSON in AWSJSON fields", () => {
  it("a chore's recurrence", async () => {
    const input = { id: "c1", kind: "chore", title: "Bath", tags: [], visibility: "shared", archived: false, recurrence: "{not json" };
    await expect(h.call(h.A, "putItem", { input })).rejects.toThrow(/^ValidationError/);
  });

  it("alertPrefs", async () => {
    await expect(h.call(h.A, "putProfile", { input: { alertPrefs: "{not json" } })).rejects.toThrow(/^ValidationError/);
  });

  it("savedViews and defaultView", async () => {
    await expect(h.call(h.A, "saveViews", { savedViews: "[oops" })).rejects.toThrow(/^ValidationError/);
    await expect(h.call(h.A, "saveViews", { defaultView: "{oops" })).rejects.toThrow(/^ValidationError/);
  });
});

describe("completeItem time", () => {
  it("rejects a Completion time that isn't a real moment", async () => {
    const h2 = harness();
    await h2.call(h2.A, "putItem", { input: { id: "nanchore", kind: "chore", title: "x", tags: [], visibility: "shared", archived: false, recurrence: JSON.stringify({ type: "interval", every: 1, unit: "days" }) } });
    for (const at of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      await expect(h2.call(h2.A, "completeItem", { itemId: "nanchore", at })).rejects.toThrow(/ValidationError/);
    }
  });
});
