import { describe, expect, it } from "vitest";
import { applyCommentChange, dropItemActivity, type Comment, type CommentsState } from "./comments";

const c = (id: string, at: number, over: Partial<Comment> = {}): Comment => ({ id, itemId: "t1", at, by: "sub-a", text: id, ...over });
const empty: CommentsState = { comments: {}, feed: [] };

describe("applyCommentChange (onCommentChange and addComment results)", () => {
  it("adds a partner's new Comment to the open item's list, in time order", () => {
    const s = applyCommentChange({ comments: { t1: [c("a", 1), c("c", 3)] }, feed: [] }, { comment: c("b", 2) }, "shampoo");
    expect(s.comments.t1.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("puts the Comment at the top of Activity, with the item's title and the text", () => {
    const s = applyCommentChange(
      { comments: {}, feed: [{ id: "e0", at: 1, by: "sub-b", type: "created", itemId: "t1", title: "shampoo" }] },
      { comment: c("b", 2, { text: "used it up" }) },
      "shampoo",
    );
    expect(s.feed[0]).toEqual({ id: "comment-b", at: 2, by: "sub-a", type: "commented", itemId: "t1", title: "shampoo", detail: "used it up" });
    expect(s.feed).toHaveLength(2);
  });

  it("the same Comment twice (own result, then its live echo) shows once in both places", () => {
    const once = applyCommentChange(empty, { comment: c("b", 2) }, "shampoo");
    const twice = applyCommentChange(once, { comment: c("b", 2) }, "shampoo");
    expect(twice).toBe(once);
    expect(twice.comments.t1).toHaveLength(1);
    expect(twice.feed).toHaveLength(1);
  });
});

describe("dropItemActivity (an item went Private on me)", () => {
  it("drops its Comments and Activity entries, keeps everything else", () => {
    const s = dropItemActivity(
      {
        comments: { t1: [c("a", 1)], t2: [c("x", 1, { itemId: "t2" })] },
        feed: [
          { id: "comment-a", at: 1, by: "sub-a", type: "commented", itemId: "t1", detail: "a" },
          { id: "e2", at: 1, by: "sub-a", type: "created", itemId: "t2" },
        ],
      },
      "t1",
    );
    expect(Object.keys(s.comments)).toEqual(["t2"]);
    expect(s.feed.map((f) => f.id)).toEqual(["e2"]);
  });
});
