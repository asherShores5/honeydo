# HoneyDo: Progress & Next Steps

_Updated 2026-11-03_ · Live at **https://honeydo.ashershores.com** · Full design: [SPEC.md](SPEC.md)

## Where things stand

All six planned milestones are live and in use on both phones. Since then: quick sort buttons,
a Tasks tab, a security hardening pass, and a guest demo.

### Working today

**Chores & tasks**
- Repeating chores: "every N hours/days/weeks after it's done", or on fixed days (weekly on
  chosen weekdays, or monthly on chosen dates) at a set time.
- One-off tasks with an optional due date. Done moves them to Finished; Undo brings them back.
- Status colors: green, yellow when it's close (default: the larger of 1 day or 10% of the
  interval, or a per-chore Warn window), red once overdue. A new chore reads "due now".
- Snooze, archive, assign ("for"), private items only you can see, notes, and a severity that
  sets how often overdue Dings repeat.
- Quick add: `bath every 3d #baby @aubyn`.
- Swipe right = Done; swipe left or ⋯ = Snooze choices and "Done at…" to backdate.

**Views**
- Home tabs: On track, Overdue, Tasks, Finished, Activity (with an unread count), Fridge, Views,
  plus any pinned Saved views.
- Filters by tag group and by who, and sort buttons: Due date, Priority, A–Z. Both are
  remembered per person.
- Views: Today (by time of day), Calendar (upcoming and done), Tag board, History & stats.
- Saved views pinned as tabs, separate for each of us.

**Together**
- Live sync between phones in about a second; offline taps queue and send later.
- Comments on items, the Fridge (notes with pin, expiry, and Make Task), Activity feed.
- Notifications: overdue Dings (1–3×/day by severity, quiet hours respected, only to whoever is
  responsible), a daily Handoff at each person's time, "Mark done" from the notification.

**Sign-in & security**
- Face ID (passkeys), with password sign-in kept as a permanent backup. Only the two accounts
  exist; sign-up and account recovery are off.
- Private items, their comments, history, and completions never reach the partner (enforced on
  the server, tested).
- Hardened 2026-11-02; details in [SPEC.md](SPEC.md) §8. Every prod deploy now waits for
  Asher's approval in GitHub.

**Guest demo** (`/demo`)
- A made-up household (Sam and Alex) with seeded Chores, Tasks, a Private item, Fridge Notes,
  a Comment and Activity. Visitors land signed in as Sam and can switch to Alex or Reset.
- Runs entirely in the browser tab: the real API handler on the in-memory table, with every
  network call answered locally and anything off-origin refused. No push, passkeys or AWS calls.
- Demo storage is prefixed (`demo:`), so a Member who opens it keeps their own sign-in and cache.
  State lasts for the tab (sessionStorage); Exit removes every demo key.

**Hosting & cost**
- Fully serverless on AWS. Actual cost is a few cents a month, plus the shared domain and DNS.
- Budgets: `honeydo-monthly` at $1, and an account-wide `account-global-monthly` at $20.

### Testing

- 527 unit tests (shared rules, API with an in-memory table, web helpers, guest demo).
- 54 browser checks in `e2e/` (8 of them for the guest demo, with no fake backend at all). They run headless Chromium against the real API code with a
  fake backend: M6, privacy and sync flows, Calendar layout, sort, and the Tasks tab. A
  screenshot tour (phone, desktop, dark) is checked by eye.
- Not covered by automation: real passkeys, real push notifications, iOS touch gestures.

## Next steps

Nothing is planned. Open items:

| Item | Who |
|---|---|
| Sign out and in with Face ID once (checks the new passkey library on a real phone) | Asher |
| Check a real 8pm Handoff push arrives | Asher |
| Re-add the home-screen icon to show the "HoneyDo" name (then turn notifications back on) | Asher, optional |
| The two $1 project budgets start tracking once the `app` cost tag (activated 2026-10-30) shows up in billing | Waits on AWS |

Known small gaps:
- After a Private item is shared, its last-done time and who did it are visible (not the note).
- A refresh-token expiry doesn't release the device's push record. The Notifier prunes it once
  the push service rejects it.

---

<details>
<summary>Technical reference</summary>

| | |
|---|---|
| AWS account | 334772842524 (personal), region us-west-1, certificate in us-east-1 |
| Stacks | `AubiHoneyCert` (us-east-1), `AubiHoney` + `AubiHoneyCi` (us-west-1) |
| Frontend | React 19 PWA on S3 + CloudFront, `honeydo.ashershores.com` |
| API | AppSync GraphQL → one Node 22 Lambda resolver; subscriptions filtered by visibility and gated to Members |
| Data | DynamoDB single table, on-demand, point-in-time backups, deletion protection |
| Auth | Cognito Essentials, `USER_AUTH` flow, passkey RP ID `honeydo.ashershores.com`, refresh 7 days |
| Users | `asher`, `aubyn` |
| Deploy | PR → `main` → PR → `prod`; CI deploys after approval in the `production` Environment. See [README.md](README.md) |

Internal names (`AubiHoney*` stacks, `/aubi-honey/` SSM paths, `@aubi/*` packages, `aubi.*`
storage keys) keep the old name on purpose: renaming them would replace live resources or sign
everyone out.

</details>
