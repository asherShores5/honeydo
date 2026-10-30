import { describe, expect, it } from "vitest";
import { DAY, HOUR } from "@aubi/shared";
import { warnFromInput, warnToInput } from "./warnWindow";

const every3d = { type: "interval", every: 3, unit: "days" } as const;

describe("Warn window field (m6/04)", () => {
  it("shows a saved override in whole days, or hours when it isn't", () => {
    expect(warnToInput(2 * DAY)).toEqual({ value: "2", unit: "days" });
    expect(warnToInput(5 * HOUR)).toEqual({ value: "5", unit: "hours" });
    expect(warnToInput(undefined)).toEqual({ value: "", unit: "days" });
  });

  it("reads the field: empty means the default, otherwise ms within the cadence", () => {
    expect(warnFromInput("", "days", every3d)).toEqual({ ok: true, ms: undefined });
    expect(warnFromInput("2", "days", every3d)).toEqual({ ok: true, ms: 2 * DAY });
    expect(warnFromInput("12", "hours", every3d)).toEqual({ ok: true, ms: 12 * HOUR });
    expect(warnFromInput("4", "days", every3d).ok).toBe(false);
    expect(warnFromInput("0", "days", every3d).ok).toBe(false);
    expect(warnFromInput("-1", "hours", every3d).ok).toBe(false);
  });

});
