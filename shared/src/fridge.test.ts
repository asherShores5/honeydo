import { describe, expect, it } from "vitest";
import { fridgeNotes, type Note } from "./fridge";

const NOW = 1_800_000_000_000;

function note(id: string, over: Partial<Note> = {}): Note {
  return { id, text: id, by: "a", at: NOW - 1000, pinned: false, visibility: "shared", updatedAt: NOW - 1000, ...over };
}

const ids = (ns: Note[]) => ns.map((n) => n.id);

describe("the Fridge shows Notes", () => {
  it("newest first", () => {
    const notes = [note("old", { at: NOW - 3000 }), note("new", { at: NOW - 1000 }), note("mid", { at: NOW - 2000 })];
    expect(ids(fridgeNotes(notes, NOW))).toEqual(["new", "mid", "old"]);
  });

  it("pinned Notes on top, each group newest first", () => {
    const notes = [
      note("pin-old", { at: NOW - 4000, pinned: true }),
      note("new", { at: NOW - 1000 }),
      note("pin-new", { at: NOW - 2000, pinned: true }),
      note("old", { at: NOW - 3000 }),
    ];
    expect(ids(fridgeNotes(notes, NOW))).toEqual(["pin-new", "pin-old", "new", "old"]);
  });

  it("hides a Note once its expiry has passed, and from the moment it is reached", () => {
    const notes = [
      note("forever"),
      note("later", { expiresAt: NOW + 1 }),
      note("now", { expiresAt: NOW }),
      note("gone", { expiresAt: NOW - 60_000, pinned: true }),
    ];
    expect(ids(fridgeNotes(notes, NOW))).toEqual(["forever", "later"]);
    expect(ids(fridgeNotes(notes, NOW + 1))).toEqual(["forever"]);
  });

  it("accepts a map of Notes as the client store holds them", () => {
    expect(ids(fridgeNotes({ x: note("x"), y: note("y", { at: NOW }) }, NOW))).toEqual(["y", "x"]);
  });
});
