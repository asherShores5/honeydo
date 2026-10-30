// Note to Task (m2/03): what the Editor opens with when a Member taps "Make Task" on a Note. Pure.
import type { Item, Note } from "@aubi/shared";

/** The Editor's title box takes this many characters. */
export const TITLE_MAX = 200;

export interface TaskDraft {
  title: string;
  /** The full Note text, when the title couldn't hold all of it. */
  notes?: string;
}

/** The Note's first line is the Task's title; if that drops anything, the whole Note goes in its notes. */
export function taskDraft(note: Pick<Note, "text">): TaskDraft {
  const text = note.text.trim();
  const title = text.split("\n")[0].trim().slice(0, TITLE_MAX);
  return title === text ? { title } : { title, notes: text };
}

/**
 * Whether the item saved from "Make Task" marks its Note. Only a shared Task: Notes are shared, so
 * a Private Task's ID on one would reach the partner (the server skips it too). The Editor opens
 * from a Note as shared; a Member who ticks Private gets the Task without the link.
 */
export function linksNote(saved: Pick<Item, "kind" | "visibility">): boolean {
  return saved.kind === "task" && saved.visibility === "shared";
}
