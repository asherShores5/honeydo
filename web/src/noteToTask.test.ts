import { describe, expect, it } from "vitest";
import { taskDraft } from "./noteToTask";

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
