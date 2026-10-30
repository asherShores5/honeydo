import { describe, expect, it } from "vitest";
import { quickAddMembers } from "./quickAdd";

describe("quick-add @names", () => {
  it("uses the first word of the display name, and the username", () => {
    expect(quickAddMembers([
      { userId: "a", displayName: "Asher Shores", username: "asher" },
      { userId: "b", displayName: "  ", username: "aubyn" },
      { userId: "c", username: "sam" },
    ])).toEqual([
      { userId: "a", names: ["Asher", "asher"] },
      { userId: "b", names: ["aubyn"] },
      { userId: "c", names: ["sam"] },
    ]);
  });
});
