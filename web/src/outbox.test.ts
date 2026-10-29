import { describe, expect, it } from "vitest";
import { keepPending, type ItemInput, type Op } from "./outbox";

type I = { id: string; title: string; version: number };
const item = (id: string, title: string, version: number): I => ({ id, title, version });

const put = (opId: string, itemId: string): Op => ({
  id: opId,
  type: "putItem",
  changed: ["title"],
  input: { id: itemId, kind: "task", title: "x" } as unknown as ItemInput, // only the id matters here
});

describe("keepPending", () => {
  it("keeps the optimistic edit while its putItem op is pending", () => {
    const merged = keepPending({ a: item("a", "old", 3) }, { a: item("a", "new", 3) }, [put("o1", "a")]);
    expect(merged.a.title).toBe("new");
  });

  it("keeps an item created offline that the server doesn't know yet", () => {
    const merged = keepPending({}, { n: item("n", "made offline", 0) }, [put("o1", "n")]);
    expect(merged.n).toEqual(item("n", "made offline", 0));
  });

  it("keeps optimistic completions too", () => {
    const op: Op = { id: "o1", type: "completeItem", itemId: "a", at: 5 };
    const merged = keepPending({ a: item("a", "srv", 3) }, { a: item("a", "local", 3) }, [op]);
    expect(merged.a.title).toBe("local");
  });

  it("takes the server version once nothing is pending", () => {
    const merged = keepPending({ a: item("a", "srv", 4) }, { a: item("a", "local", 3) }, []);
    expect(merged.a.title).toBe("srv");
  });

  it("takes the excepted item from the server so a conflict replay sees the server copy", () => {
    const merged = keepPending({ a: item("a", "srv", 4) }, { a: item("a", "local", 3) }, [put("o1", "a"), put("o2", "a")], "a");
    expect(merged.a.title).toBe("srv");
  });
});
