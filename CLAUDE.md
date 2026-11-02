## Agent skills (this repo overrides /workplace/shoresaj/CLAUDE.md)

Personal project in a public repo. Don't use Taskei, builder-mcp or any Amazon tool here,
and never put Amazon-internal content in files or commits.

### Issue tracker

Local files. One ticket per file in `.scratch/<milestone>/issues/NN-<slug>.md` (gitignored),
numbered in dependency order. Blocking edges go in each file's "Blocked by" line. Close a ticket
by setting its `Status:` line to `done`.

### Triage labels

The five default roles (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`,
`wontfix`) go in each ticket's `Status:` line.

### Domain docs

Single context: `GLOSSARY.md` and `docs/adr/` at the repo root. Specs live in `docs/specs/`,
mirrored on the Notion To Do card "Create aubi honey to do app".

## Working rules

- Commit locally; push and open PRs only when Asher says. `main` and `prod` are protected
  (PR + passing `test` check, no force-push), so work lands by branch → PR → `main`, and a
  release is a PR `main` → `prod`.
- A `prod` deploy waits in the GitHub `production` Environment for Asher's approval. Never
  approve it on his behalf; give him the run link.
- Commit as `asher.shores5@gmail.com` (set in this repo's git config).
- Live AWS changes (deploys, deleting data or DNS records) need Asher's explicit go each time.
- Tests: `npm test` (shared + api + web, vitest). Typecheck: `npm run typecheck --workspaces --if-present`.
  Browser checks: `e2e/` (see its README); run them after UI changes, and look at screenshots.
