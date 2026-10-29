# Honey Do 🐝

A shared chore & to-do app for two, built for a household with a baby. Chores reset when
they're done, stay green until they're coming due, turn yellow, then red when overdue, and
sync live between both phones.

Live at **https://honeydo.ashershores.com** (private; two accounts only). The code repo is
public by choice.

- **Repeating chores:** every N hours/days/weeks after they're done, or on fixed weekdays or
  dates.
- **One-off tasks** with due dates.
- **Tag filters:** category, time of day, locale. Optional assignee, private items, snooze,
  undo, and completion history.
- **Real-time sync** with an offline queue.
- **Sign-in:** passkey / Face ID.
- **Hosting:** fully serverless on AWS for about $0.50/month.

Design: [SPEC.md](SPEC.md) · Status: [PROGRESS.md](PROGRESS.md) · Roadmap: [TODO.md](TODO.md)

## Architecture

```
iPhone PWA (React) ── CloudFront + S3
        │ GraphQL + WebSocket
        ▼
AppSync ── Cognito (passkeys)
        │
Lambda resolver (api/) ── DynamoDB (single table)
```

| Dir | What |
|---|---|
| `shared/` | Pure TS scheduling/status/alert logic, used by web and backend |
| `api/` | AppSync Lambda resolver (validation, merge, visibility rules) |
| `schema/` | GraphQL schema |
| `web/` | React + Vite PWA |
| `infra/` | AWS CDK: `AubiHoneyCert` (us-east-1), `AubiHoney` + `AubiHoneyCi` (us-west-1) |

## Development

Requires Node 22+.

```bash
npm install
npm test                       # unit tests (shared + api)
npm run dev -w web             # local UI against the deployed API*
```

\*Local dev needs a `web/public/config.json`. Copy it from
https://honeydo.ashershores.com/config.json. Passkeys only work on the real domain, so use
password sign-in locally.

## Deploying

Pushing to **`prod`** deploys via GitHub Actions. Pushes to `main` and PRs only run tests and
a build.

```bash
git push origin main:prod      # promote main to production
```

The workflow authenticates to AWS with GitHub OIDC; no AWS keys are stored in GitHub. The
`honeydo-github-deploy` role trusts only `refs/heads/prod` of this repo and can only assume
the CDK bootstrap roles.

Manual deploy from a machine with admin credentials: `npm run deploy`.

### One-time setup (already done)

```bash
cd infra
npx cdk bootstrap aws://334772842524/us-west-1 aws://334772842524/us-east-1
npx cdk deploy AubiHoneyCi                                        # OIDC provider + deploy role
npx tsx scripts/create-users.ts us-west-1_ajihHnMAQ [--reset]     # passwords → .secrets/
npx tsx scripts/seed.ts AubiHoney-TableCD117FA1-FQX5RGDOP8BN      # starter tags/chores
```

The Web Push VAPID keys need no setup: the deploy creates them in SSM the first time and never
replaces them.

The DynamoDB table and user pool are deletion-protected with `RETAIN`; destroying the stack
leaves them in place.

## License

[MIT](LICENSE)
