import type { UserId } from "./types";

/**
 * One message on the Fridge. Append-only: after it is posted only `pinned` and `expiresAt`
 * change. Every Note is shared; `visibility` exists so Notes travel through the same Visibility
 * filter as Items.
 */
export interface Note {
  id: string;
  text: string;
  by: UserId;
  /** Epoch ms it was posted. */
  at: number;
  pinned: boolean;
  /** Epoch ms; from this moment on the Note is hidden. Absent = never expires. */
  expiresAt?: number;
  visibility: "shared";
  updatedAt: number;
  /** The Task this Note was turned into (m2/03). Absent = not turned into a Task. */
  taskId?: string;
}

/** Longest Note text, after trimming. */
export const NOTE_MAX = 500;

/** Longest Comment text (on an Item), after trimming. Kept beside NOTE_MAX, the other message limit. */
export const COMMENT_MAX = 1000;

export function isExpired(note: Pick<Note, "expiresAt">, now: number): boolean {
  return note.expiresAt != null && note.expiresAt <= now;
}

/** The Notes the Fridge shows at `now`: expired ones dropped, pinned first, then newest first. */
export function fridgeNotes<N extends Note>(notes: readonly N[] | Record<string, N>, now: number): N[] {
  const list = Array.isArray(notes) ? notes : Object.values(notes as Record<string, N>);
  return list
    .filter((n) => !isExpired(n, now))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.at - a.at || (a.id < b.id ? -1 : 1));
}
