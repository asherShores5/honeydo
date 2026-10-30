// Seam 2 for m6/04: a per-Chore Warn window override is validated by the server.
import { beforeEach, describe, expect, it } from "vitest";
import { harness } from "./testing/harness";

const h = harness();
beforeEach(() => h.reset());

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const bath = {
  id: "bath", kind: "chore", title: "Bath", tags: [], visibility: "shared", archived: false,
  recurrence: JSON.stringify({ type: "interval", every: 3, unit: "days" }),
};
const trash = { ...bath, id: "trash", recurrence: JSON.stringify({ type: "calendar", freq: "weekly", byWeekday: [2], at: "20:00" }) };
const put = (input: Record<string, unknown>) => h.call(h.A, "putItem", { input });

describe("Warn window override", () => {
  it("saves an override within the Chore's interval and reads it back", async () => {
    expect((await put({ ...bath, warnWindow: 2 * DAY })).item.warnWindow).toBe(2 * DAY);
  });

  it("clears back to the default when left empty", async () => {
    await put({ ...bath, warnWindow: 2 * DAY });
    expect((await put({ ...bath, warnWindow: null })).item.warnWindow ?? null).toBeNull();
  });

  it.each([
    ["negative", -HOUR],
    ["zero", 0],
    ["longer than the interval", 3 * DAY + 1],
    ["not a number", "1d"],
  ])("rejects a %s Warn window", async (_what, warnWindow) => {
    await expect(put({ ...bath, warnWindow })).rejects.toThrow(/ValidationError/);
  });

  it("caps a two-day-a-week schedule at its shortest gap", async () => {
    const binDays = { ...bath, id: "bins", recurrence: JSON.stringify({ type: "calendar", freq: "weekly", byWeekday: [1, 4] }) };
    expect((await put({ ...binDays, warnWindow: 3 * DAY })).item.warnWindow).toBe(3 * DAY);
    await expect(put({ ...binDays, warnWindow: 4 * DAY })).rejects.toThrow(/ValidationError/);
  });

  it("caps a weekly Calendar schedule at a week", async () => {
    expect((await put({ ...trash, warnWindow: 7 * DAY })).item.warnWindow).toBe(7 * DAY);
    await expect(put({ ...trash, warnWindow: 8 * DAY })).rejects.toThrow(/ValidationError/);
  });
});
