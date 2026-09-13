# Release readiness

Target: **v1.0.0**, ReEntry's first feature-complete portfolio release. V1-V3 are
development milestones, not a promise of further product versions. This polish
pass does not create a commit, push, tag, or GitHub Release.

The npm packages and Chrome manifest retain their existing `3.0.0` build version.
The proposed Git tag `v1.0.0` names the first portfolio release. Keeping the
manifest version avoids rolling an installed extension back to a lower version;
there is no npm publication. Release naming does not change the feature set.

## Readiness record

Fresh validation completed on 2026-09-13; results below were rerun for this polish pass.
See [historical V2.1](history/v2.1-verification.md) and
[V3](history/v3-verification.md) for earlier acceptance records.

| Check                       | Result                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend tests              | 14 passed; zero failures/skips                                                                                                        |
| PostgreSQL API integration  | 11 scenarios passed inside one parent suite against isolated PostgreSQL                                                               |
| Frontend/backend TypeScript | Passed, including backend tests                                                                                                       |
| Formatting and builds       | Passed: Prettier, local and hosted frontend production builds, backend production build                                               |
| Dependency audit            | Both package lockfiles: zero known vulnerabilities on 2026-09-13                                                                      |
| Source security review      | No release-blocking issue found; configured-secret checks passed for current files and five reachable commits. Not a penetration test |
| Real Chrome V3 acceptance   | Owner reported all acceptance tests complete before publication of `d3e490a`                                                          |
| Screenshots                 | Three owner-approved screenshots added and linked in the README                                                                       |

## Scope of the release review

- Confirm tracked files exclude private environment configuration, runtime
  databases, backups, and generated bundles.
- Inspect authentication, server-side ownership, validation, CORS, Chrome
  permissions, URL handling, and logging. Test fixtures and safe placeholders
  are distinguished from real credentials.
- Keep V1 migration compatibility, idempotency receipts, and operational
  diagnostics used by error recovery. Startup and migration logs are intentional.
- Preserve the working architecture and UI; no product features are introduced.

Known limits: URL-only tab restoration; up to 50 selected tabs per operation;
open-form draft retention rather than offline writes; last-write-wins edits to
the same context field. Render's free demo has cold starts and database expiry,
as described in [deployment](../DEPLOYMENT.md). These are documented project
constraints, not an availability guarantee.

## Final presentation steps

1. Completed: added `docs/images/img1.png`, `img2.png`, and `img3.png` and enabled
   their README image blocks. The owner approved the screenshots as supplied.
2. Review the rendered README layout on GitHub.
3. Review and authorize committing/pushing this polish.
4. Authorize creating `v1.0.0` and publishing the release notes below.

No tags, GitHub settings, external resources, or releases are created by this guide.

## Suggested GitHub presentation

**Description:** Full-stack Chrome extension for resuming work with saved context,
next actions, browser tabs, and progress checkpoints.

**Topics:** `chrome-extension`, `react`, `typescript`, `vite`, `nodejs`, `express`,
`postgresql`, `drizzle`, `productivity`.

## Draft release notes

# ReEntry v1.0.0

ReEntry's first feature-complete portfolio release: a full-stack Chrome extension
for returning to ongoing work without reconstructing its context.

Highlights:

- Context-aware work items with Where I Left Off, Next Action, and checklists.
- Save Workspace and Resume Work for selected browser tabs with URL deduplication.
- Progress checkpoints and compact Recent progress history.
- Individual page/link capture through Save to ReEntry.
- Email/password authentication, revocable sessions, and user-scoped PostgreSQL data.
- Shared API access across extension views, profiles, and devices.
- Retry-safe V1 migration, transactional checkpoints, and explicit failure states.
- Render deployment configuration, regression tests, and local setup documentation.

The Chrome extension is loaded unpacked from a configured build. The hosted demo
uses Render's free tier and is subject to cold starts and database expiry.
