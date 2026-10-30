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

Screenshots go to /tmp/e2e/. Not covered: real passkeys (WebAuthn), Web Push, iOS touch quirks.
