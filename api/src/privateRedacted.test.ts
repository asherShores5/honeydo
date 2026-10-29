import { beforeEach, describe, expect, it } from "vitest";
import { harness } from "./testing/harness";

const h = harness();

beforeEach(async () => {
  h.reset();
  await h.call(h.A, "me");
  await h.call(h.B, "me");
});

const gift = (visibility: string) => ({
  id: "t1", kind: "task", title: "Ring for B", notes: "size 6, from the shop on 5th", tags: [], visibility, archived: false,
});

describe("the change that makes an item Private carries none of its content", () => {
  it("the partner's delivered payload has no title or notes", async () => {
    await h.call(h.A, "putItem", { input: gift("shared") });
    const c = await h.call(h.A, "putItem", { input: gift(`private:${h.A.userId}`) });

    expect(h.deliveredTo(c, h.B)).toBe(true);
    expect(c.removedFor).toEqual([h.B.userId]);
    expect(c.redacted).toBe(true);
    const payload = JSON.stringify(c);
    expect(payload).not.toContain("Ring for B");
    expect(payload).not.toContain("size 6");
    expect(c.item).toMatchObject({ id: "t1", version: 2, visibility: `private:${h.A.userId}` });
  });

  it("the server copy keeps the content for the owner", async () => {
    await h.call(h.A, "putItem", { input: gift("shared") });
    await h.call(h.A, "putItem", { input: gift(`private:${h.A.userId}`) });

    expect((await h.call(h.A, "snapshot")).items).toMatchObject([{ id: "t1", title: "Ring for B", notes: gift("").notes }]);
    expect((await h.call(h.B, "snapshot")).items).toEqual([]);
  });

  it("other changes are not redacted", async () => {
    const c = await h.call(h.A, "putItem", { input: gift("shared") });
    expect(c.redacted).toBeFalsy();
    expect(c.item.title).toBe("Ring for B");
  });
});
