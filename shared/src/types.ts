export type UserId = string;

export type Recurrence =
  /** Due `every` units after it was last done (baby bath: every 3 days). */
  | { type: "interval"; every: number; unit: "hours" | "days" | "weeks" }
  /** Due on fixed calendar slots in Pacific time (trash: weekly on Tue at 20:00). */
  | { type: "calendar"; freq: "weekly"; byWeekday: readonly number[]; at?: string }
  | { type: "calendar"; freq: "monthly"; byMonthDay: readonly number[]; at?: string };

export type Severity = "low" | "medium" | "high";

export type Status = "green" | "yellow" | "red" | "snoozed" | "done";

export interface Item {
  id: string;
  kind: "chore" | "task";
  title: string;
  notes?: string;
  tags: string[];
  assigneeId?: UserId;
  visibility: "shared" | `private:${UserId}`;
  severity?: Severity;
  recurrence?: Recurrence;
  /** One-off tasks only, epoch ms. */
  dueAt?: number;
  /** Override for the yellow window, ms. */
  warnWindow?: number;
  lastDoneAt?: number;
  lastDoneBy?: UserId;
  snoozedUntil?: number;
  archived: boolean;
  createdBy: UserId;
  createdAt: number;
  updatedAt: number;
  version: number;
}

export interface Completion {
  itemId: string;
  at: number;
  by: UserId;
  note?: string;
}

export interface AlertPrefs {
  /** "HH:MM" Pacific; slots used per severity (1, 2 or 3 of them). */
  slots: { low: string[]; medium: string[]; high: string[] };
  quietStart: string;
  quietEnd: string;
  digestAt: string;
  overdueAlerts: boolean;
}
