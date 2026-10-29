import { describe, expect, it } from "vitest";
import { linksNote, taskDraft } from "./noteToTask";

describe("linksNote (which saved item marks the Note)", () => {
  it("a shared Task does", () => {
    expect(linksNote({ kind: "task", visibility: "shared" })).toBe(true);
  });

  it("a Private Task doesn't: Notes are shared, so its ID would reach the partner", () => {
    expect(linksNote({ kind: "task", visibility: "private:sub-a" })).toBe(false);
  });

  it("a Chore doesn't", () => {
    expect(linksNote({ kind: "chore", visibility: "shared" })).toBe(false);
  });
});

describe("taskDraft", () => {
  it("a short Note becomes the Task's title", () => {
    expect(taskDraft({ text: "We're out of diapers" })).toEqual({ title: "We're out of diapers" });
  });

  it("a longer Note gives its first line as the title and keeps the full text in the notes", () => {
    const text = "Call the plumber\nThe kitchen tap drips, number is on the fridge";
    expect(taskDraft({ text })).toEqual({ title: "Call the plumber", notes: text });
  });

  it("cuts a title that is too long at 200 characters", () => {
    const text = "x".repeat(250);
    const draft = taskDraft({ text });
    expect(draft.title).toHaveLength(200);
    expect(draft.notes).toBe(text);
  });
});
