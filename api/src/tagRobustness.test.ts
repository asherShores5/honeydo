import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConditionalCheckFailedException } from "./testing/fakeDynamo";
import { harness } from "./testing/harness";

const h = harness();

beforeEach(() => h.reset());
afterEach(() => vi.restoreAllMocks());

const task = (id: string, tags: string[]) => ({ id, kind: "task", title: id, tags, visibility: "shared", archived: false });
const kitchen = { input: { id: "locale-kitchen", name: "Kitchen", group: "Locale" } };

const snap = () => h.call(h.A, "snapshot");

/** Item updates fail with `err` (once, or every time). Other commands go through. */
function failItemUpdates(err: () => Error, times = Infinity) {
  const send = h.db.send.bind(h.db);
  let left = times;
  vi.spyOn(h.db, "send").mockImplementation(async (cmd: unknown) => {
    if (cmd instanceof UpdateCommand && left > 0) {
      left--;
      throw err();
    }
    return send(cmd);
  });
}

describe("deleteTag survives a crash", () => {
  it("a crash while stripping items leaves the Tag, and a retry finishes the job", async () => {
    await h.call(h.A, "putTag", kitchen);
    await h.call(h.A, "putItem", { input: task("dishes", ["locale-kitchen"]) });

    failItemUpdates(() => new Error("Lambda timed out"), 1);
    await expect(h.call(h.A, "deleteTag", { id: "locale-kitchen" })).rejects.toThrow("InternalError");
    expect((await snap()).tags.map((t: any) => t.id)).toEqual(["locale-kitchen"]);

    await h.call(h.A, "deleteTag", { id: "locale-kitchen" });
    const s = await snap();
    expect(s.tags).toEqual([]);
    expect(s.items[0].tags).toEqual([]);
  });

  it("gives up loudly when an item keeps changing under it, and keeps the Tag", async () => {
    await h.call(h.A, "putTag", kitchen);
    await h.call(h.A, "putItem", { input: task("dishes", ["locale-kitchen"]) });

    failItemUpdates(() => new ConditionalCheckFailedException("update condition failed"));
    await expect(h.call(h.A, "deleteTag", { id: "locale-kitchen" })).rejects.toThrow("InternalError");
    vi.restoreAllMocks();

    expect((await snap()).tags.map((t: any) => t.id)).toEqual(["locale-kitchen"]);
  });
});

describe("putItem and Tag IDs", () => {
  it("rejects a Tag ID that doesn't exist, so a replayed edit can't bring a deleted Tag back", async () => {
    await h.call(h.A, "putTag", kitchen);
    await h.call(h.A, "putItem", { input: task("dishes", ["locale-kitchen"]) });
    await h.call(h.A, "deleteTag", { id: "locale-kitchen" });

    await expect(h.call(h.B, "putItem", { input: task("dishes", ["locale-kitchen"]) })).rejects.toThrow("ValidationError");
    expect((await snap()).items[0].tags).toEqual([]);
  });

  it("accepts Tag IDs that exist", async () => {
    await h.call(h.A, "putTag", kitchen);
    const c = await h.call(h.A, "putItem", { input: task("dishes", ["locale-kitchen"]) });
    expect(c.item.tags).toEqual(["locale-kitchen"]);
  });
});
