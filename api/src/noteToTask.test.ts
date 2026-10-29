import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { harness } from "./testing/harness";

// m2/03: a Note turned into a Task stays on the Fridge, marked with the Task it became.
const h = harness();
const NOW = 1_800_000_000_000;

beforeEach(() => {
  h.reset();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

const task = (id = "t1", extra: Record<string, unknown> = {}) => ({
  id, kind: "task", title: "Buy diapers", tags: [], visibility: "shared", ...extra,
});

async function noteAndTask(member = h.B) {
  await h.call(h.A, "postNote", { id: "n1", text: "We're out of diapers" });
  vi.setSystemTime(NOW + 1000);
  await h.call(member, "putItem", { input: task() });
  vi.setSystemTime(NOW + 2000);
}

describe("markNoteTasked", () => {
  it("marks the Note with its Task for both Members and fans the change out", async () => {
    await noteAndTask();
    const note = await h.call(h.B, "markNoteTasked", { id: "n1", taskId: "t1" });
    expect(note).toMatchObject({ id: "n1", text: "We're out of diapers", taskId: "t1", updatedAt: NOW + 2000 });
    expect(h.visibilityDeliveredTo(note, h.A)).toBe(true);
    const { notes } = await h.call(h.A, "snapshot");
    expect(notes).toEqual([note]);
  });

  it("Activity shows the new Task, and marking the Note adds no entry of its own", async () => {
    await noteAndTask();
    await h.call(h.B, "markNoteTasked", { id: "n1", taskId: "t1" });
    const { feed } = await h.call(h.A, "snapshot");
    expect(feed.map((e: any) => [e.type, e.title, e.by])).toEqual([
      ["created", "Buy diapers", h.B.userId],
      ["posted", "We're out of diapers", h.A.userId],
    ]);
    expect(feed[0].itemId).toBe("t1");
  });

  it("a replay changes nothing, and a second Task can't take over the Note", async () => {
    await noteAndTask();
    const first = await h.call(h.B, "markNoteTasked", { id: "n1", taskId: "t1" });
    vi.setSystemTime(NOW + 5000);
    expect(await h.call(h.B, "markNoteTasked", { id: "n1", taskId: "t1" })).toEqual(first);
    await h.call(h.A, "putItem", { input: task("t2") });
    expect(await h.call(h.A, "markNoteTasked", { id: "n1", taskId: "t2" })).toEqual(first);
  });

  it("needs a Note and a Task the caller can see", async () => {
    await noteAndTask();
    await expect(h.call(h.B, "markNoteTasked", { id: "nope", taskId: "t1" })).rejects.toThrow(/NotFound/);
    await expect(h.call(h.B, "markNoteTasked", { id: "n1", taskId: "nope" })).rejects.toThrow(/NotFound/);
    await h.call(h.A, "putItem", { input: task("mine", { visibility: `private:${h.A.userId}` }) });
    await expect(h.call(h.B, "markNoteTasked", { id: "n1", taskId: "mine" })).rejects.toThrow(/NotFound/);
    await expect(h.call(h.B, "markNoteTasked", { id: "n1", taskId: "bad id!" })).rejects.toThrow(/ValidationError/);
  });

  it("only a Task, not a Chore, can come from a Note", async () => {
    await noteAndTask();
    const recurrence = JSON.stringify({ type: "interval", every: 7, unit: "days" });
    await h.call(h.A, "putItem", { input: { id: "c1", kind: "chore", title: "Bins", tags: [], visibility: "shared", recurrence } });
    await expect(h.call(h.A, "markNoteTasked", { id: "n1", taskId: "c1" })).rejects.toThrow(/ValidationError/);
  });
});

describe("markNoteTasked with a Private Task", () => {
  it("leaves the Note unmarked, without an error, so a Private Task's ID never reaches the partner", async () => {
    await noteAndTask();
    await h.call(h.A, "putItem", { input: task("mine", { visibility: `private:${h.A.userId}` }) });
    const note = await h.call(h.A, "markNoteTasked", { id: "n1", taskId: "mine" });
    expect(note.taskId).toBeUndefined();
    const { notes } = await h.call(h.B, "snapshot");
    expect(notes[0].taskId).toBeUndefined();
  });

  it("a shared Task can still take the Note afterwards", async () => {
    await noteAndTask();
    await h.call(h.A, "putItem", { input: task("mine", { visibility: `private:${h.A.userId}` }) });
    await h.call(h.A, "markNoteTasked", { id: "n1", taskId: "mine" });
    expect((await h.call(h.B, "markNoteTasked", { id: "n1", taskId: "t1" })).taskId).toBe("t1");
  });
});
