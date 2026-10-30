import { describe, expect, it } from "vitest";
import { DAY, HOUR } from "@aubi/shared";
import { dueLabel } from "./format";

const now = 1_800_000_000_000;

describe("dueLabel", () => {
  it("says due now within a minute either side (a never-done Chore is due at creation)", () => {
    expect(dueLabel(now, now)).toBe("due now");
    expect(dueLabel(now + 20_000, now)).toBe("due now");
    expect(dueLabel(now - 59_000, now)).toBe("due now");
  });

  it("counts down and up past that", () => {
    expect(dueLabel(now + 5 * 60_000, now)).toBe("due in 5m");
    expect(dueLabel(now + DAY, now)).toBe("due in 1d");
    expect(dueLabel(now - 2 * HOUR, now)).toBe("overdue 2h");
  });

  it("has no due date for undated items", () => {
    expect(dueLabel(null, now)).toBe("no due date");
  });
});
