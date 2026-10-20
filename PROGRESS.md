# Aubi Honey: Progress & Next Steps

_Updated 2026-10-20_ · Live at **https://honeydo.ashershores.com** · Full design: [SPEC.md](SPEC.md)

## Where things stand

The first version is live and in use on both phones. It does the core job: chores that reset
when done, show green → yellow → red as they come due, and sync live between the two of us.

### Working today

**Chores & tasks**
- Repeating chores: "every N hours/days/weeks after it's done", or on fixed days (weekly on
  chosen weekdays, or monthly on chosen dates) at a set time.
- One-off tasks with an optional due date.
- Status colors:
  - Green until it's close.
  - Yellow starting at the larger of 1 day or 10% of the interval before it's due (a 20-day
    chore goes yellow 2 days out).
  - Red once it's overdue.
- "Done" resets the chore. Undo appears right after, and any past completion can be removed
  from the chore's history.
- Snooze for 3 hours or 1 day. Archive chores you no longer need.
- Optional "for" (assign to one of us), private items only you can see, notes, and an alert
  severity (low/medium/high) saved for the notification feature.

**Views & filters**
- On track / Overdue / Activity tabs.
- Tag filters grouped by Category, Time of day, and Locale, plus a Who filter (mine, partner,
  unassigned). Each person's last filter is remembered.
- Activity feed of who did what and when.

**Profiles**
- Separate name, color, light/dark theme, and card/compact layout for each person.
- Daily summary time is set during first-run setup. It will be used once notifications ship.

**Sync & reliability**
- Changes show up on the other phone in about a second.
- Works with a spotty connection: taps are queued and sent when back online, and edits made by
  both of us at once are merged.

**Sign-in & security**
- Face ID (passkeys) after a one-time password. Only the two accounts exist, and sign-up is off.
- Private items are blocked on the server, not just hidden in the app (tested).

**Hosting**
- Runs on AWS, fully serverless.
- Expected cost is about $0.25–0.50/month.
- A $5/month budget alert is in place.

### Fixed since launch

- **Blank page after setup:** the server was double-encoding chore schedules and the app
  crashed reading them. Fixed on both ends, and the app now shows an error screen with Reload
  instead of going blank.
- **New address and icon:** moved from `aubi.` to `honeydo.ashershores.com` with the bee icon.
  Passkeys had to be re-registered because they're tied to the domain.

### Testing so far

- 32 automated tests cover the scheduling, color, and alert-timing rules, plus input checks.
- Live end-to-end checks have passed against the real system:
  - sign-in and session refresh
  - private-item isolation, including live sync
  - backdated completions
  - undo
  - conflicting edits

## Proposed next steps

Recommended order. Each step is roughly one working session.

### 0. Cleanup (small)

| Item | Why | Needs approval? |
|---|---|---|
| Put the code in a private git repo (GitHub or other) | Nothing is backed up or version-controlled yet | Pick a host |
| Delete test items and test Activity entries | Leftovers from launch testing | Yes |
| Delete the old `aubi` certificate DNS record | Harmless leftover from the domain move | Yes |
| Turn on cost tracking for the `app` tag | The budget alert can only track app costs once AWS recognizes the tag (~24h after deploy) | No |
| "Remove passkey" button in Settings | The old `aubi` passkey still shows in the count | No |

### 1. Notifications (M4): next priority

The biggest piece of the original wishlist that's still missing.
- **Overdue dings:** while a chore is red, 1×/day by default, or 1/2/3× for low/medium/high
  severity. Quiet hours (default 9pm–7am) push dings to the morning. Assigned chores only ping
  the assignee.
- **Daily summary** at each person's chosen time: what got done, what's overdue, what's coming
  up.
- **Setup:** one-tap "Enable notifications" (iOS requires the home-screen app and a tap).
- **Actions:** tap a notification to open the chore, with a "Mark done" button.
- **Offline launch:** the app also opens with no signal at all.
- Cost impact: about $0.

### 2. Async comms, the rest (M2)

- Comments on chores ("used the last of the shampoo").
- Message board for notes not tied to a chore (fridge whiteboard), with pins and expiry.
- Daily handoff card inside the app.

### 3. More views (M5)

- **Today:** chores grouped by morning / afternoon / evening / night.
- **Calendar:** upcoming due dates and past completions.
- **Board by tag:** e.g. columns for Nursery | Kitchen | Car.
- **History & stats:** who did what, and target vs. actual interval ("bath: every 3d target,
  3.4d actual").
- Named saved views pinned as tabs, separate for each person.

### 4. Polish (M6)

- Quick-add shorthand: `bath every 3d #baby @aubyn`.
- Swipe right = done, swipe left = snooze.
- "Done at…" backdating straight from the list.
- Custom yellow-warning window per chore.

## Decisions needed

1. Where to host the code backup (GitHub private repo recommended).
2. OK to delete the test data and the old DNS record?
3. Any rough edges from real use that should jump the queue ahead of notifications?

---

<details>
<summary>Technical reference</summary>

| | |
|---|---|
| AWS account | 334772842524 (personal), region us-west-1, certificate in us-east-1 |
| Stacks | `AubiHoneyCert` (us-east-1), `AubiHoney` (us-west-1) |
| Frontend | React PWA on S3 + CloudFront, `honeydo.ashershores.com` |
| API | AppSync GraphQL → one Node 22 Lambda resolver; subscriptions filtered by visibility |
| Data | DynamoDB single table, on-demand, point-in-time backups, deletion protection |
| Auth | Cognito Essentials, `USER_AUTH` flow, passkey RP ID `honeydo.ashershores.com` |
| Users | `asher`, `aubyn`; one-time passwords in `.secrets/initial-passwords.txt` (delete once both passkeys work) |
| Deploy | `npm run deploy` from repo root; see [README.md](README.md) |

</details>
