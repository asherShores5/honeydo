# Spec: Domain model cleanup, known bugs, and the road to M4–M6

Status: ready-for-agent (2026-10-29). Published to the Notion To Do card. All design questions settled 2026-10-29.

## Problem Statement

Honey Do works day to day: chores reset when done, colors move green → yellow → red, and
both phones sync live. But:

- The words in the spec, the UI and the code have drifted. "Board" means two things, the
  daily push has three names, and "Done" means different things for a Chore and a Task.
  Every new milestone (Notifications, Fridge, Tag board) adds more terms on top of that.
- Several small bugs and edge cases in sync, undo, tags and private items haven't bitten
  yet, but they will once the app is used more.
- The biggest wishlist item, notifications, isn't built. Neither are the async-comms
  pieces (comments, Fridge, Handoff) or the extra views.
- The docs still assume the repo is private; it is public by choice.

## Solution

One pass that (1) pins down the vocabulary in a glossary and makes the code enforce it,
(2) fixes the known bugs, and (3) gives M4 Notifications, then M2 comms, M5 views and
M6 polish one shared model, so each milestone is just a set of tickets.

## User Stories

Domain model and rules

1. As a household member, I want every Chore to have a Recurrence, so that "Done" always means "reset the clock" for chores.
2. As a household member, I want a Task to leave my lists once I mark it Done, so that finished one-offs don't clutter On track.
3. As a household member, I want to find finished Tasks in History, so that I can check when something got done.
4. As a household member, I want undoing a Task's only Completion to bring the Task back, so that a mis-tap is reversible.
5. As a household member, I want a Private item to always belong to me alone, so that I can't assign something my partner can never see.
6. As a household member, I want tags with the same name in different groups (Category "Kitchen", Locale "Kitchen") to stay separate, so that filters mean what they say.
7. As a household member, I want tag chips to show their group when two names collide, so that I can tell them apart.
8. As a household member, I want one name for the daily summary (Handoff) everywhere in the app, so that I'm not confused by "digest" vs "summary".
9. As a household member, I want the fridge-style notes feature and the per-tag column screen to have different names (Fridge vs Tag board), so that the app's navigation is clear.

Bugs and edge cases

10. As a household member, I want an offline edit to stay on screen while it's waiting to send, so that my change doesn't flash back or vanish when the app refreshes.
11. As a household member, I want an item I created offline to stay in my list until it syncs, so that I don't think it was lost.
12. As a household member, I want an offline completion that's replayed after a reconnect to show up only once in Activity, so that the feed doesn't say I did the bath twice.
13. As a household member, I want undo of a Completion that's already gone to do nothing, so that Activity doesn't log a bogus "undone".
14. As a household member, I want an item that my partner just made private to disappear from my phone right away, so that my list doesn't show something stale I can't open.
15. As a household member, I want deleting a tag to remove it from every item, so that items don't carry invisible dead tags that break filters.
16. As a household member, I want Activity to always show the last 100 events I'm allowed to see, so that my partner's private activity doesn't shorten my feed.
17. As a household member, I want a completion backdated earlier than the current "last done" to still show in History and Activity without changing the chore's status, so that history stays honest.
18. As the owner of the app, I want the spec to describe how sync on app focus really works (full snapshot today, not delta), so that future work starts from the truth.

Notifications (M4)

19. As a household member, I want a one-tap "Enable notifications" step in setup and Settings, so that iOS lets the home-screen app send pushes.
20. As a household member, I want a push when a chore I'm responsible for turns red, so that I don't need to open the app to know.
21. As a household member, I want red chores to keep dinging 1, 2 or 3 times a day by severity, so that urgent chores nag more than low ones.
22. As a household member, I want dings that fall in my quiet hours moved to the end of quiet hours, not dropped, so that I still hear about them in the morning.
23. As a household member, I want chores assigned to my partner to ding only my partner, so that I'm not nagged about their chores.
24. As a household member, I want shared, unassigned chores to ding both of us, so that whoever is free can pick it up.
25. As a household member, I want my Private items to ding only me, so that nothing private leaks via push.
26. As a household member, I want never to get the same ding twice for the same slot, so that duplicate pushes don't train me to ignore them.
27. As a household member, I want a "Mark done" button on the push, so that I can complete a chore without opening the app.
28. As a household member, I want tapping a push to open that item, so that I can see details or snooze it.
29. As a household member, I want a Handoff push at my chosen time listing what got done since my last Handoff (and by whom), what's overdue, and what's due before my next one, so that we stay in sync without texting.
30. As a household member, I want a snoozed chore not to ding until the snooze ends, so that snooze means quiet.
31. As a household member, I want archived items never to ding, so that old chores don't haunt me.
32. As a household member, I want to set my quiet hours, ding slots and Handoff time in Settings, so that alerts fit my schedule.
33. As a household member, I want to turn overdue alerts off without losing my Handoff, so that I can control the noise.
34. As a household member, I want the app to open with no signal at all, so that I can see and tick chores in the nursery dead zone.

Async comms (M2)

35. As a household member, I want to leave a short Comment on an item ("used the last of the shampoo"), so that my partner gets context.
36. As a household member, I want Comments on Private items never to reach my partner, so that private stays private.
37. As a household member, I want to post a Note on the Fridge that isn't tied to an item, so that we have a shared whiteboard.
38. As a household member, I want to pin a Note and give it an expiry, so that the Fridge stays current.
39. As a household member, I want to turn a Note into a Task, so that "we're out of diapers" becomes something to do.
40. As a household member, I want an in-app Handoff card matching the push, so that I can catch up when I open the app.
41. As a household member, I want an unread marker on Activity, so that I know what changed since I last looked.

Views (M5)

42. As a household member, I want a Today view grouped by Time-of-day tag, so that I can plan the evening routine.
43. As a household member, I want a Calendar showing upcoming due dates (projected for chores) and past Completions, so that I can see the week ahead.
44. As a household member, I want a Tag board with one column per tag in a chosen group, so that I can see everything for the Nursery at once.
45. As a household member, I want History & stats showing who did what and target vs actual interval, so that we can rebalance the load fairly.
46. As a household member, I want named Saved views pinned as tabs, separate for each of us, so that my landing screen fits how I work.

Polish (M6)

47. As a household member, I want quick-add shorthand (`bath every 3d #baby @aubyn`), so that adding a chore takes one line.
48. As a household member, I want swipe right = Done and swipe left = Snooze, so that common actions are one gesture.
49. As a household member, I want "Done at…" from the list, so that I can backdate without opening the editor.
50. As a household member, I want to override the warn window per chore in the editor, so that a chore can go yellow earlier or later than the default.
51. As a household member, I want to list and remove passkeys in Settings, so that the old domain's passkey stops showing up.

Housekeeping

52. As the owner of the app, I want the docs to say the repo is public by choice, so that nobody assumes it's private.
53. As the owner of the app, I want launch test data and the stale DNS validation record removed, so that the live system is clean. (Approved 2026-10-29. Show the exact records before deleting.)

## Implementation Decisions

Domain model (shared module)
- A glossary at the repo root becomes the canonical vocabulary: Item, Chore, Task, Recurrence (Interval / Calendar), Occurrence, Next due, Warn window, Status (green / yellow / red / snoozed / done), Done (action), Completion (record), Reset, Snooze, Archive, Assignee, Visibility, Private item, Severity, Ding, Slot, Quiet hours, Handoff, Tag, Tag group, Saved view, Activity, Comment, Fridge, Note, Tag board, Household, Profile.
- Chore requires a Recurrence (the API already enforces this; the shared types should make it unrepresentable: Item becomes a union discriminated on kind).
- Task Done: the Task's status becomes `done` and it auto-archives. Undoing its only Completion un-archives it.
- Private items: the API rejects an assignee other than the owner; the editor hides the "for" picker when Private is on.
- Tags: a Tag belongs to exactly one Tag group. Filters keep OR within a group, AND across groups.
- Naming in code: new code uses Handoff, Fridge/Note and Tag board. `digestAt` is renamed in the profile's alert prefs when M4 lands, with a read-time fallback for the old key.

API resolvers
- Feed events for completions get a deterministic ID derived from the Completion key, so outbox replays don't duplicate Activity entries.
- Undo checks that the Completion existed (conditional delete) and skips the feed event if it didn't.
- Changing an item's visibility from shared to private also publishes a "removed" change to the partner. The subscription envelope gets a `removed` flag, or the client drops items whose visibility it can't see.
- Deleting a tag removes its ID from every item that carries it, in the same resolver call (one partition, small data).
- The Activity query pages until it has 100 visible events instead of filtering after the limit.
- Spec text is corrected: on focus the client re-fetches the full snapshot. Delta sync (`changesSince`) stays a future option, and only if snapshot size becomes a problem.

Client store
- `refresh()` keeps optimistic state for every pending outbox op, including putItem creates and edits, not only completions.

Notifier (M4)
- A new Notifier Lambda runs on a 15-minute EventBridge Scheduler and reuses the shared alert rules: `shouldDing`, `dingSlotsForDay`, `alertRecipients`, quiet hours.
- Per user and item, notification state records the last ding so dings dedupe. Handoff state records each user's last Handoff time.
- Web Push uses VAPID. The private key lives in SSM SecureString and only the notifier role can read it.
- A new mutation stores a user's push subscription. Payloads carry a deep link and a "Mark done" action that calls the existing completeItem.
- A service worker handles push, notification actions and the offline app-shell cache.
- Alert prefs (slots, quiet hours, Handoff time, overdue on/off) are edited in Settings and validated server-side.

M2 / M5 / M6
- Comments and Notes are append-only entities in the same single table, filtered by visibility like items, and fanned out by new subscriptions with the same visibility filter.
- Views (Today, Calendar, Tag board, History & stats) are pure client derivations over the snapshot plus completions. No new server state except Saved views on the Profile.
- Quick-add is a pure parser in the shared module that returns an item input.

## Testing Decisions

- Good tests check external behavior through the highest seam, not internals: given these items, completions and the time, what status, dings or resolver result do we get.
- **Seam 1: the shared domain module** (status, recurrence, alerts, and later the quick-add parser and Handoff content builder). Pure functions with an injected `now`. Prior art: the existing status tests (32 cases across status/alerts/rules).
- **Seam 2: the API resolver entry point.** Call the Lambda handler with AppSync-shaped events for two identities against an in-memory or local DynamoDB. This covers private-item isolation, undo, replay idempotency, tag deletion, feed paging and the visibility-change fan-out. Prior art: the rules tests cover validation only; this seam is new.
- The Notifier is tested through Seam 1 (which dings, and for whom) plus a thin test of its handler with a fake push sender. No separate seam.
- Seams confirmed 2026-10-29: these two only.

## Out of Scope

- Native iOS app, widgets, Siri, Apple Watch, attachments.
- More than two users or one household. The household key stays hard-coded.
- Delta sync, unless snapshot size becomes a measured problem.
- Changing other records in the shared DNS zone.

## Further Notes

- Decided 2026-10-29: repo stays public as is; test-data and stale DNS record cleanup approved; roadmap order unchanged.
- Any further prod data changes beyond the two approved cleanups need their own approval.
- Suggested order: housekeeping and bug fixes → M4 Notifications → M2 → M5 → M6.
