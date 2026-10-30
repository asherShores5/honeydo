# Honey Do

A shared chore and to-do app for one two-person household. It shows what's fine, what's coming due and what's overdue, and keeps an async record of who did what.

## Language

### Things to do

**Item**:
Anything on the list; either a Chore or a Task.
_Avoid_: Todo, entry

**Chore**:
An Item that repeats on a Recurrence and is never finished, only Reset.
_Avoid_: Recurring task, routine

**Task**:
A one-off Item, optionally with a due date, that is finished once and then archived.
_Avoid_: To-do, one-off chore

**Recurrence**:
The rule for when a Chore is next due; either an Interval or a Calendar schedule.
_Avoid_: Repeat, frequency

**Interval**:
A Recurrence that comes due a fixed time after the last Completion ("every 3 days").
_Avoid_: Rolling schedule

**Calendar schedule**:
A Recurrence tied to fixed weekdays or month days at a Pacific wall-clock time ("Tuesdays at 8pm").
_Avoid_: Fixed schedule, cron

**Occurrence**:
One due point of a Calendar schedule.

### Doing things

**Done**:
The action of marking an Item as done; it records a Completion. It Resets a Chore and finishes a Task.
_Avoid_: Complete, check off

**Completion**:
The record that someone did an Item at a given time. Completions are never edited, only added or undone.
_Avoid_: Done event, log entry

**Reset**:
What Done does to a Chore: its clock restarts from the latest Completion.

**Snooze**:
Hiding an Item's urgency until a chosen time, after which it returns to its real Status.
_Avoid_: Defer, postpone

**Archive**:
Removing an Item from active lists without deleting its history.
_Avoid_: Delete, hide

### Urgency

**Next due**:
The moment an Item becomes overdue.
_Avoid_: Deadline

**Warn window**:
The span before Next due during which an Item shows yellow.
_Avoid_: Grace period, lead time

**Status**:
An Item's current urgency: green (fine), yellow (inside the Warn window), red (overdue), snoozed, or done (finished Task).
_Avoid_: State, color

**On track**:
The home tab holding green and yellow Items.

**Overdue**:
The home tab holding red Items; also describes an Item that is red.
_Avoid_: Late, past due

**Finished**:
The home tab listing Archived Tasks that were Done.
_Avoid_: Completed

### People and privacy

**Household**:
The two people who share one list.
_Avoid_: Team, family, account

**Member**:
One of the two people in the Household.
_Avoid_: User, partner (except when meaning "the other Member")

**Assignee**:
The one Member an Item is "for"; an Item without one belongs to both.
_Avoid_: Owner, responsible

**Visibility**:
Whether an Item is shared with the Household or private to one Member.

**Private item**:
An Item only its creator can ever see, and only its creator can be its Assignee.
_Avoid_: Hidden item, personal item

**Profile**:
One Member's own settings: name, color, theme, layout, Saved views and alert preferences.
_Avoid_: Account, preferences

### Alerts

**Severity**:
An Item's alert level (low, medium, high), which sets how many Dings a day it gets while red.
_Avoid_: Priority

**Ding**:
One overdue push notification about one red Item to one Member.
_Avoid_: Reminder, alert, nag

**Slot**:
A daily time at which a Ding may fire.

**Quiet hours**:
A Member's nightly span when no Dings fire; Slots inside it move to its end.
_Avoid_: Do not disturb

**Handoff**:
A Member's once-a-day summary: what got done since their last Handoff and by whom, what's overdue, and what's due before the next one.
_Avoid_: Digest, daily summary, recap

### Organizing

**Tag**:
A label on Items that belongs to exactly one Tag group; same-named Tags in different groups are different Tags.
_Avoid_: Label, category (as a synonym)

**Tag group**:
A family of Tags (Category, Time of day, Locale, or custom); filters OR within a group and AND across groups.

**Saved view**:
A named filter, sort and layout belonging to one Member, which can be pinned as a tab.
_Avoid_: Preset, filter

**Tag board**:
A screen with one column per Tag in a chosen Tag group.
_Avoid_: Board, kanban

**Today**:
A view of the Items due before tonight's midnight, or red or yellow now, grouped by Time-of-day Tag.

**Calendar**:
A view of upcoming due dates (Chores projected forward) and past Completions, day by day.

**History & stats**:
The Household-wide view of who did how many Completions in a period, and each Interval Chore's target vs actual interval. Not the same as an Item's History (its own Completion list).

### Talking

**Activity**:
The feed of automatic events: who did, created, edited, assigned or commented on what, or posted a Note, and when.
_Avoid_: Feed, log, history (History is the per-Item Completion list)

**Comment**:
A short note attached to one Item.

**Fridge**:
The shared whiteboard of Notes that aren't tied to an Item.
_Avoid_: Message board, board

**Note**:
One message on the Fridge, optionally pinned or expiring, which can be turned into a Task.
_Avoid_: Post, message
