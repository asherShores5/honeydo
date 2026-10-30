# HoneyDo — Shared To-Do App Spec

Status: v0.3 (2026-10-19) — **M1 deployed** (core) + parts of M2/M3

App URL: `https://honeydo.ashershores.com` (passkey RP ID is the same domain; no separate auth subdomain)
AWS account 334772842524, region us-west-1 (certs in us-east-1), timezone America/Los_Angeles (fixed)

## 1. Goal

A shared household chore/task app for two people (you + Aubyn) that shows at a glance
what's fine, what's coming due, and what's overdue — and replaces "did you already do X?"
messages with an async record of who did what, when.

## 2. Source requirements (from iPhone Notes)

| Note | Where it lands |
|---|---|
| Chore list | §4.1 Chores (seed content still needed — see §11) |
| Async comms day in day out | §4.4 Activity feed, comments, Fridge, Handoff |
| Date last done of an async chore | §4.1 `lastDoneAt`, derived from completion log |
| Due date on tasks | §4.1 one-off tasks with `dueAt` |
| Green until task needs to be done again | §4.2 status colors |
| Baby bath every 3 days: green after reset, red when interval lapses | §4.2 interval recurrence + "Done" resets clock |
| Tag-based filters (baby care, time of day, locale) | §4.3 typed tag groups |
| Within time limit vs overdue tabs | §5 "On track" / "Overdue" tabs |

## 3. Decisions so far

| Area | Decision |
|---|---|
| Client | Installable PWA (React + TypeScript + Vite), added to iPhone home screen |
| Hosting | S3 + CloudFront (static), AWS personal account, CDK (TypeScript) |
| API / sync | AppSync GraphQL → one TypeScript Lambda resolver (validation, merge, visibility); AppSync subscriptions with server-side visibility filter for ~1s live sync |
| Data | DynamoDB on-demand, single table |
| Offline | Full offline: IndexedDB cache + outbox queue, replays on reconnect |
| Auth | Cognito user pool (Essentials), in-app sign-in via USER_AUTH: one-time password → register passkey → Face ID. Self-sign-up off, 2 users |
| Recurrence | Per chore: interval-after-last-done OR fixed calendar schedule |
| Status | Green → yellow → red |
| Ownership | Shared by default, optional assignee |
| Notifications | Web Push: overdue alerts + daily Handoff |
| Profiles | Per-user default view/filters, notification prefs, theme/layout, private items |

## 4. Functional spec

### 4.1 Items

One `Item` type covers both kinds:

- **Chore (recurring)** — has a `recurrence`; never "finished", just reset.
- **Task (one-off)** — has optional `dueAt`; marked done once, then archived.

Fields: `id, kind, title, notes, tags[], assigneeId?, visibility (shared | private:<userId>),
severity? (low | medium | high), recurrence?, dueAt?, warnWindow?, lastDoneAt?, lastDoneBy?,
snoozedUntil?, archived, createdBy, createdAt, updatedAt, version`.

**Core loop:** the main feature is a recurring chore that either person can do. "Done" resets
it to green, and it stays green until it comes due again, by calendar or by N days.

**Completions are an append-only log** (`Completion {itemId, at, by, note?}`). `lastDoneAt` is
the max `at` across completions. That means both of you marking something done offline just
gives two log entries, with no conflict. You can backdate ("did it at 7am") and undo the last
completion.

### 4.2 Recurrence & status

```
recurrence =
  | { type: "interval", every: number, unit: "hours" | "days" | "weeks" }   // baby bath: every 3 days
  | { type: "calendar", freq: "weekly", byWeekday: number[], at?: "HH:MM" }  // trash: [2] (Tue) at 20:00
  | { type: "calendar", freq: "monthly", byMonthDay: number[], at?: "HH:MM" } // 31 → last day of short months
```

Calendar times are Pacific wall-clock (default 20:00). Completing a chore inside the yellow
window of the upcoming occurrence counts for that occurrence: trash done Tue 7pm satisfies
Tue 8pm. Completing it late satisfies only the missed occurrence.

Next due:
- interval → `lastDoneAt + every·unit` (if never done: due now)
- calendar → first rrule occurrence after `lastDoneAt` (or after creation)
- task → `dueAt` (no `dueAt` = always green until done)

Status (computed, never stored; same pure TS module used by client and notifier Lambda):
- **green**: now < nextDue − warnWindow
- **yellow**: within warnWindow of nextDue. Default warnWindow = **max(1 day, 10% of
  interval)** (20-day chore → yellow 2 days out; 3-day chore → 1 day out). For intervals
  under 2 days, warnWindow is capped at 50% of the interval so short chores aren't always
  yellow. Calendar chores use the gap between the previous and next occurrence as their
  interval. One-off tasks: 1 day before `dueAt`. A per-item override is allowed.
- **red**: now ≥ nextDue
- **snoozed**: shown grey with a "snoozed until" note, then goes back to its normal status

Each card shows "last done 2d ago by Aubyn" and "due in 18h" / "overdue 5h".

### 4.3 Tags & filtering

Tags belong to a **group**, so filters stay organized:

| Group | Examples |
|---|---|
| Category | Baby care, Kitchen, Laundry, Pets, Admin, Errands |
| Time of day | Morning, Afternoon, Evening, Night, Anytime |
| Locale | Nursery, Kitchen, Bathroom, Garage, Car, Outside, Store |
| Custom | user-defined groups |

Filter semantics: **OR within a group, AND across groups** (e.g. (Baby care) AND (Morning OR
Evening)). Extra filters: status, assignee (mine / partner / unassigned / anyone), kind,
text search. Sort: urgency (default), next due, last done, title.

**Saved views** = filter + layout + sort, named, stored per profile, can be pinned as tabs.

### 4.4 Async comms

- **Activity feed** — auto events: completed, created, edited, assigned, commented, note posted.
  "Aubyn did Baby bath · 2:14pm". Each user has an unread marker.
- **Comments on items** — short threaded notes ("used last of the shampoo").
- **Fridge** — a shared whiteboard of Notes not tied to an item, optional pin, optional
  expiry, can be converted into a task.
- **Handoff** — once a day at each user's chosen time: what got done since the last Handoff
  (by whom), what's overdue, what's due before the next one, and new Fridge notes. Shown as an in-app card and sent as a push.

### 4.5 Profiles (2)

Per user: display name, color/avatar, default landing view, saved views, theme (light/dark/
system + accent), density (list / cards / compact), notification prefs (overdue alerts on/off,
which tags/assignees trigger them, quiet hours, Handoff time), timezone.

**Private items**: visibility `private:<userId>` items and their completions/comments never
reach the partner, not in queries, subscriptions, the feed, or the Handoff. This is enforced
server-side in the resolvers, not only hidden in the UI.

### 4.6 Notifications (Web Push)

- iOS supports Web Push only for home-screen PWAs (iOS 16.4+), and asks permission after a tap
  in onboarding.
- **Overdue alerts**: while an item is red, it dings at a set number of daily slots (Pacific
  time) based on its optional severity:

  | Severity | Dings/day | Default slots |
  |---|---|---|
  | none (default) / low | 1 | 9:00 |
  | medium | 2 | 9:00, 17:00 |
  | high | 3 | 9:00, 13:00, 19:00 |

  The first ding also fires when an item turns red, if that's during waking hours. Quiet hours
  (default 21:00–7:00) shift a slot later rather than dropping it. Assigned items alert only
  the assignee; shared items alert both. Slots are per-user settings.
- **Handoff**: daily at each user's time (§4.4). The time is **required during first-run
  setup** and can be changed in the profile later.
- Push payload includes a deep link and a "Mark done" action button.

## 5. Screens

1. **On track / Overdue** (home): two tabs, as in the original note. Yellow items sit at the top
   of On track. Swipe right = done, swipe left = snooze.
2. **Today timeline**: items grouped by Time-of-day tag, plus anything due today.
3. **Calendar**: week/month showing upcoming due dates (projected for recurring) and past
   completions as dots.
4. **Tag board**: one column per tag in a chosen group (e.g. Locale → Nursery | Kitchen | Car).
5. **History & stats**: completion log, who did what, streaks, actual vs target interval
   ("baby bath: target 3d, actual avg 3.4d").
6. **Activity & Fridge**: activity feed + Fridge + today's Handoff card.
7. **Item detail / edit**: recurrence picker, tags, assignee, visibility, comments, completion
   history, backdate/undo.
8. **Settings / Profile**: theme, views, notifications, tag management, passkey management.

Global: filter bar (tag chips by group) on every list view; quick-add with natural shortcuts
("bath every 3d #baby #nursery @aubyn").

## 6. Architecture

```
iPhone PWA (React, IndexedDB, Service Worker)
   │  HTTPS (GraphQL) + WebSocket (subscriptions)
   ▼
CloudFront ── S3 (static app)
AppSync GraphQL ── Cognito user pool auth (passkeys)
   │  JS resolvers
   ▼
DynamoDB (single table, on-demand, PITR on)
   ▲
Lambda "notifier" ← EventBridge Scheduler (every 15 min): computes newly-red items,
                    due Handoffs → Web Push (VAPID keys in SSM SecureString)
```

- All resolvers run in one Lambda (`api/src/handler.ts`), which keeps merge, undo and private-item rules in tested TypeScript. It still costs $0 on the free tier.
- Also enforced in the Lambda: an allowlist of the two usernames.
- Subscriptions use AppSync enhanced filtering by `householdId` plus a visibility check, so
  private items never fan out to the partner.
- **Offline**: every mutation is written to IndexedDB first, then queued in an outbox with a
  client-generated ID. It replays in order on reconnect. Item edits use optimistic concurrency
  (`version`). On conflict, fields merge last-write-wins and the feed notes "edited while
  offline". Completions/comments/notes are append-only, so they never conflict.
- When the app comes back to the foreground, goes back online, or the WebSocket reconnects,
  the client re-fetches the full snapshot (items, tags, profiles, feed) and then flushes the
  outbox. This catches anything missed while the WebSocket was closed (iOS kills it in the
  background). A delta sync (`changesSince(updatedAt)`) is a possible later optimization; it
  doesn't exist yet.

### 6.1 DynamoDB single table

PK = `HH#<householdId>` for everything (one household → one partition, fine at this scale).

| Entity | SK |
|---|---|
| Item | `ITEM#<id>` |
| Completion | `DONE#<itemId>#<isoTs>` |
| Comment | `CMT#<itemId>#<id>`: `id`, `itemId`, `at`, `by`, `text` (1-1000 chars). Append-only. The client picks `id`, so a retried `addComment` writes nothing twice. `visibility` is a stamp of the Item's Visibility when written: a Member sees the Comment only if both the stamp and the Item's current Visibility allow (`comments` checks both), so Comments go Private with their Item and one written while Private stays Private even if the Item is shared again (story 36). `addComment` publishes under the stamp on `onCommentChange` (a replay: under the narrower of the stamp and the Item's Visibility now) and logs a `commented` Activity event with the text |
| Fridge note | `NOTE#<id>` |
| Feed event | `FEED#<isoTs>#<id>` (TTL 1 year). Left out of a Member's snapshot if it was Private to the partner when logged, or if its Item is now Private to the partner |
| Tag / tag group | `TAG#<id>`, `TGRP#<id>` |
| Profile | `USER#<userId>` |
| Saved view | `VIEW#<userId>#<id>` |
| Push subscription | `PUSH#<userId>#<deviceId>`: `endpoint`, `p256dh`, `auth`, `createdAt`. `deviceId` is a random ID the app keeps in localStorage, so re-enabling on the same device overwrites the record and a second device adds one. Written by `putPushSubscription` (userId always from the caller's token), removed by `deletePushSubscription` or when the push service answers 404/410. Never in the snapshot or on the Profile, which the partner can read |
| Notification state | `NSTATE#<itemId>#<userId>`: `itemId`, `userId`, `lastAlertedAt` (epoch ms of the last Ding), `ttl` (+30 days, so deleted items clean up). The Notifier claims it with a conditional write (`lastAlertedAt` still equals what it read) before sending, so a duplicate run never sends the same Ding twice |

GSI1 (`PK`, `updatedAt`) is written for a future delta sync; nothing queries it yet. Private items carry `visibility` and are
filtered in resolvers.

### 6.2 Auth

- Cognito user pool, Essentials tier (free at 2 MAU). Self-sign-up, account recovery and email
  are off.
- Two users, `asher` and `aubyn`, created by `infra/scripts/create-users.ts`. Each has a 24-char
  random password stored only in `.secrets/initial-passwords.txt` (chmod 600, gitignored).
- Sign-in happens inside the PWA using Cognito's `USER_AUTH` flow. There's no hosted UI, which
  avoids iOS standalone-PWA OAuth redirect issues. The first sign-in uses the password, then
  setup asks for a passkey (`StartWebAuthnRegistration`), and after that it's Face ID.
- The passkey relying party ID is `honeydo.ashershores.com`, with user verification required.
- Tokens: id/access 1h, refresh 30d.
- Why passwords instead of email OTP: SES is in sandbox mode, so Cognito can't email
  unverified addresses.

### 6.3 Repo layout

The repo is public on GitHub by choice. Secrets stay out of it (`.secrets/` is gitignored).

```
honeydo/
  infra/        CDK app (stacks: Auth, Data, Api, Web, Notifier)
  schema/       schema.graphql
  shared/       status/recurrence logic, types (used by web + lambda)
  web/          React PWA
  notifier/     Lambda
```

## 7. Cost estimate (2 users)

Assumes ~2k API calls/day, ~1 hr/day of open app per person, notifier every 15 min.
These are incremental costs: the hosted zone and domain already exist and are already paid for.

| Service | ~Monthly |
|---|---|
| AppSync (~60k ops + live-sync messages/connection-minutes) | ~$0.25 |
| DynamoDB on-demand (<10 MB data) + PITR | < $0.05 |
| CloudWatch Logs (14-day retention) | < $0.05 |
| S3 (app + CDK assets) | < $0.05 |
| Cognito Essentials (2 MAU, under 10k free) | $0 |
| Lambda (~3k runs) + EventBridge Scheduler | $0 (always-free tier) |
| CloudFront (well under 1 TB / 10M requests) | $0 (always-free tier) |
| ACM certs, SSM SecureString, Web Push delivery, Budgets | $0 |
| Route 53 (new records in existing zone; alias queries free) | ~$0 |
| **Total** | **≈ $0.25–0.50/month** (heavy use 10× → still < $3) |

Avoided on purpose: VPC/NAT gateway (~$32/mo), WAF ($5+), KMS customer keys ($1 each),
Secrets Manager ($0.40/secret), and Cognito Plus tier. Set an AWS Budget alarm at $5.

## 8. Security

- No public sign-up; only the 2 Cognito users can get tokens.
- All data access goes through AppSync with Cognito auth; private visibility is enforced
  server-side.
- S3 is private behind CloudFront OAC, TLS only, strict CSP.
- DynamoDB PITR for point-in-time restore; the table has `RemovalPolicy.RETAIN` and deletion
  protection.
- VAPID private key is stored in SSM SecureString. Only two roles can read it: the notifier
  role, and the key-provisioning function (VapidKeysFn), which reads it only to rebuild a
  missing public key after a crash between its two writes. The
  deploy creates the pair itself (custom resource `VapidKeys` in AppStack, logic in
  `api/src/vapid.ts`): only if `/aubi-honey/vapid/private` is missing, never overwriting, and
  keeping both parameters if the stack is deleted. It returns only the public key, which
  config.json takes from it. No manual step is needed. A new pair would invalidate every push
  subscription, so rotating means deleting both parameters by hand, redeploying, and turning
  notifications on again on both phones.

## 9. Milestones

1. ✅ **M1 Core** (deployed 2026-10-19; also includes M2 history/undo/activity feed and M3 offline outbox): CDK infra, auth, items CRUD, recurrence/status, On track/Overdue tabs, tags
   + filters, live sync.
2. **M2 Comms**: completion history, comments, activity feed, Fridge.
3. **M3 Offline + PWA**: IndexedDB, outbox, installable app (delta sync is optional, later).
4. **M4 Notifications**: Web Push, overdue alerts, daily Handoff, quiet hours.
5. **M5 Views**: Today timeline, calendar, Tag board, history/stats, saved views, themes,
   private items.
6. **M6 Seed & polish**: import your chore list, quick-add syntax, snooze/backdate/undo.

## 10. Out of scope (v1)

Native iOS app, more than 2 users or households, Siri/widgets, file/photo attachments,
Apple Watch. (Siri Shortcuts calling the API could come later.)

## 11. Resolved decisions (2026-10-19)

1. **Chores**: no existing list. Seed a few starter chores and tag groups (below); real chores
   get built up through use.
2. **Domain**: `ashershores.com` (Route 53, same account) → app at `honeydo.ashershores.com`.
   Other subdomains in this zone are live; only add records, never modify them.
3. **Core loop confirmed**: "Done" resets to green until the next due point (calendar or N days).
4. **Yellow**: max(1 day, 10% of interval). **Overdue dings**: 1/2/3 per day by severity.
   **Handoff time**: per user, required at setup. **Timezone**: Pacific, fixed.
5. Defaults taken: completions kept forever; feed events have a 1-year TTL.

### Seed content

- Tag groups: Category (Baby care, Kitchen, Laundry, Cleaning, Errands, Admin), Time of day
  (Morning, Afternoon, Evening, Night, Anytime), Locale (Nursery, Kitchen, Bathroom, Bedroom,
  Living room, Outside, Car, Store).
- Chores: Baby bath (every 3 days · Baby care, Evening, Bathroom), Change crib sheets (every
  7 days · Baby care, Nursery), Take out trash (weekly Tue · Cleaning, Evening, Outside), Clean
  bottles & pump parts (every 1 day · Baby care, Kitchen), Water plants (every 4 days ·
  Anytime, Outside), Wipe down kitchen (every 2 days · Kitchen, Evening).
