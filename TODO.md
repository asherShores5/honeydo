# TODO

Roadmap detail lives in [PROGRESS.md](PROGRESS.md) and [SPEC.md](SPEC.md) §9.

## Cleanup
- [x] Code in git (public GitHub repo, by choice), auto-deploy from `prod`
- [x] Delete launch test data (`smoke-private`, `smoke-shared` items and their feed events), done 2026-10-30
- [x] Delete stale ACM validation record `_2ac802c9bb738dbdf1373a0276b5ab22.aubi.ashershores.com`, done 2026-10-30
- [ ] Activate `app` cost-allocation tag (`aws ce update-cost-allocation-tags-status`) once it appears in billing
- [ ] Settings: list and remove passkeys (old `aubi.` passkey still counted)
- [ ] Delete `.secrets/initial-passwords.txt` once both passkeys work on `honeydo.`

## M4 Notifications (next)
- [ ] Service worker (push handler + offline app-shell cache)
- [ ] Push subscription UI in Setup/Settings (iOS: home-screen app, user tap)
- [x] VAPID keys in SSM SecureString (created by the deploy, no manual step)
- [ ] Notifier Lambda on EventBridge Scheduler (15 min) using `shared/alerts.ts` `shouldDing`
- [ ] Per-user/per-item alert state (`NSTATE#`) to dedupe dings
- [ ] Handoff push at each user's Handoff time (`digestAt`)
- [ ] Quiet hours + ding slot settings
- [ ] Notification actions: open item, "Mark done"

## M2 Async comms
- [ ] Comments on items
- [ ] Fridge notes (pin, expiry, convert to task)
- [ ] In-app Handoff card

## M5 Views
- [ ] Today timeline (by time-of-day tag)
- [ ] Calendar (projected due dates + completions)
- [ ] Tag board (by tag group)
- [ ] History & stats (who did what, target vs actual interval)
- [ ] Named saved views pinned as tabs

## M6 Polish
- [ ] Quick-add syntax (`bath every 3d #baby @aubyn`)
- [ ] Swipe to done / snooze
- [ ] "Done at…" backdate from list
- [ ] Per-item warn window override in editor
