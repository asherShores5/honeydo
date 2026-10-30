# Browser checks (fake backend)

Headless Chromium (iPhone 13 profile, Pacific time) runs the built app with every network call
routed in-process: the real API handler on the in-memory table (`api/src/testing/fakeDynamo.ts`),
a fake Cognito, and a fake AppSync realtime socket that applies the same subscription filters as
`infra/lib/stacks.ts`. Members are `asher` and `aubyn`, already signed in. Nothing touches AWS.

Not a workspace, so CI never installs it.

    npm run build:web          # repo root
    cd e2e && npm install && npx playwright install chromium
    npx tsx smoke.ts           # seed + screenshot of Home
    npx tsx m6.ts              # M6 Polish checks
    npx tsx flows.ts           # privacy, Tasks, Comments, Fridge, Activity, offline, Views, Settings
    npx tsx calendar.ts        # Calendar layout, phone + desktop
    npx tsx sort.ts            # Home quick sort, Tag board, Warn window hint, desktop sheet header
    npx tsx tour.ts            # screenshots of every screen: phone, desktop, dark
    npx tsx sheet.ts phone 6 260   # one contact sheet per mode, to review by eye

Screenshots go to /tmp/e2e/. Not covered: real passkeys (WebAuthn), Web Push, iOS touch quirks, offline launch (service
workers are blocked so routes see every request). The dev desktop has no emoji font, so 💤 buttons
show blank in screenshots.
