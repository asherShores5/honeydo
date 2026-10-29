import { describe, expect, it } from "vitest";
import { assigneeWhenPrivate } from "./privateAssignee";

describe("assigneeWhenPrivate (Editor's Private toggle)", () => {
  it("clears a partner Assignee", () => {
    expect(assigneeWhenPrivate("sub-b", "sub-a")).toBe("");
  });

  it("keeps self as Assignee", () => {
    expect(assigneeWhenPrivate("sub-a", "sub-a")).toBe("sub-a");
  });

  it("keeps Either (no Assignee)", () => {
    expect(assigneeWhenPrivate("", "sub-a")).toBe("");
  });
});
