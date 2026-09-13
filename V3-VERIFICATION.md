# V3 review: workspace resume and checkpoints

V3 is **validated for release**: automated checks passed and the owner confirmed
all acceptance tests complete on 2026-09-13, authorizing commit and push. Manual
results below are owner-reported, not independently reproduced by the agent.
Confirm the resulting Render deployment separately; validation is not evidence
that the newly published commit is already live.

## Local setup

Use the existing local PostgreSQL configuration; do not replace it with Render's
database URL. The local and hosted databases contain independent data.

From the repository root on Windows:

```powershell
npm install
npm --prefix server install
npm run server:build
npm run build
npm run local:stop
npm run local:start
```

The existing Windows helper uses the private local cluster, applies pending
migrations, then runs the built API and Vite dashboard. Stop/start ensures the
API uses the latest build. Local configuration must use
`VITE_API_URL=http://localhost:3001/api`. Do not use `build:hosted` for local review.

For a separately configured PostgreSQL installation, use the existing
`server/.env` setup from README instead of the helper:

```powershell
cd server
npm run db:migrate
npm run dev
```

In another terminal, run `npm run build` from the repository root. Migration
`003_workspace_checkpoints.sql` is additive and runs inside the existing migration
transaction/lock. It preserves old resources as `MANUAL`, assigns their existing
order, and creates an empty checkpoint history. Do not reset the database or
rerun the old local-to-Render transfer. That V2-only script now rejects V3 schemas
to prevent omitting checkpoints; a future database move requires a full reviewed
backup/restore. `backup-local.mjs` still backs up the complete local database.

Open `chrome://extensions`, enable Developer mode, and reload the existing
ReEntry extension using the same `dist` folder. A first installation uses **Load
unpacked → dist**. Version should read **3.0.0**. The local build connects to your
local account/database, not the hosted account. The helper retains the previously
configured extension origin. If loading a different folder/profile produces a
different ID, rerun `npm run local:start -- -ExtensionId YOUR_EXTENSION_ID`.

The browser dashboard at `http://localhost:5173/workspace.html` supports API and
checkpoint review. Tab capture/restoration requires the installed extension.

## Acceptance sequence (record actual results)

1. **A — Work item:** log in locally. Open/create an In Progress work item.
   Verify the dashboard remains a compact list; clicking a row opens detail
   directly. The popup still uses compact cards and Resume opens that detail.
2. **B — Browser tabs:** in the same normal Chrome window, open three HTTP(S)
   pages (an article, a lecture URL including a timestamp, and documentation).
   Also open `chrome://settings` and a duplicate article tab.
3. **C–D — Select:** click **Save Workspace** in detail. Allow the optional tab
   permission when prompted. No tabs should start selected. Verify titles and
   URLs; internal pages and duplicates should be omitted. Select only the
   article and lecture, then click **Save selected tabs**.
4. **E — Saved workspace:** verify only those selections appear under Workspace
   in browser-tab order. Save them again; no duplicate entries should appear.
   Manual links remain under Other resources. Selecting an existing manual link
   promotes the same resource to Workspace instead of creating a second copy.
5. **F — Checkpoint:** click **Save checkpoint**, enter `Finished replication`
   in Where did you stop? and `Understand consistent hashing` in What should
   you do next? Optionally choose the documentation tab. Save checkpoint.
   Verify both current context fields update and Recent progress gains one entry.
   Optional tabs should save with the context, not as a separate partial save.
6. **G–H — Persistence:** close the saved article/lecture tabs and restart Chrome
   while keeping the local API running. Reopen ReEntry, log in if needed, and
   verify context, workspace, and checkpoint history remain.
7. **I–K — Resume:** open the work detail from Resume. Verify its context is
   visible, choose saved workspace entries, then click **Resume Work**. URLs
   should open as background tabs in the same window. Already open/navigating
   URLs should be skipped. Check lecture query parameters and fragments survive.
   Click Resume again; existing tabs should not multiply.
8. **L–N — Progress:** save another checkpoint with different notes. Verify newest
   first and the earlier entry unchanged. Save enough to exceed five entries;
   initially five appear and **Show more progress** expands the list. Ordinary
   Save context must not create history. Removing a resource must not delete
   checkpoint notes; deleting the work item must delete its history.
9. **O–P — Another profile:** load the same extension build in another Chrome
   profile/device connected to the same API. Log in to the same account. Verify
   workspace/history, save a checkpoint there, then refocus the first profile
   and allow the existing 15-second refresh to show the new context/history.
   For a different physical device, use a deployed V3 API rather than localhost.
10. **Q — Isolation:** create User B. Its inventory must not contain User A's work.
    Repeat the direct ID checks below, not just the visual inventory check.
11. **R — Existing capture:** right-click a normal page/link → **Save to ReEntry**,
    choose a work item, save, and verify the manual resource. Repeat from the
    popup's Save this page action. Edit a manual URL and delete a resource.
    Existing checklist completion and work-item editing must still work.

## Failure and ownership checks

- Decline optional tab access: a clear error should appear, with no save and no
  automatic capture. Other work features must remain usable. Try again and grant
  permission. Chrome may describe this as reading browsing history; ReEntry only
  queries current-window tabs on capture/resume and never calls a history API.
- In a full-page extension detail, type checkpoint text and select optional tabs.
  Stop only the local API (or block its requests in that page's developer tools).
  Save: the draft must remain with an error and no success notice. Restore the
  API/connection and retry the unchanged draft; exactly one checkpoint should
  appear, even if the first request reached the server before the response failed.
- If a saved checkpoint attempt is edited after an ambiguous response, the server
  can return a conflict. Inspect Recent progress, cancel that attempt, and start
  another checkpoint; the existing saved checkpoint is never silently overwritten.
- Failed tab opens should report a partial failure; retry skips successful opens.
  Invalid/internal/credential-bearing URLs must not be opened or persisted.
- Use the authenticated console pattern in `VERIFICATION.md` for direct ID tests.
  While logged into User B, send these work commands with User A's IDs through
  `chrome.runtime.sendMessage`; expect `error`, never a successful result:

```javascript
await chrome.runtime.sendMessage({
  channel: "reentry-history",
  command: { type: "history", id: "USER_A_WORK_ID", limit: 5, offset: 0 },
});
await chrome.runtime.sendMessage({
  channel: "reentry",
  command: {
    type: "checkpoint",
    id: "USER_A_WORK_ID",
    input: {
      requestId: crypto.randomUUID(),
      whereILeftOff: "Must fail",
      nextAction: "Must fail",
    },
  },
});
await chrome.runtime.sendMessage({
  channel: "reentry",
  command: {
    type: "workspace",
    id: "USER_A_WORK_ID",
    resources: [{ title: "Must fail", url: "https://example.com/" }],
  },
});
await chrome.runtime.sendMessage({
  channel: "reentry",
  command: {
    type: "remove-resource",
    id: "USER_A_WORK_ID",
    resourceId: "USER_A_RESOURCE_ID",
  },
});
```

Tokens stay in the background service. Do not paste credentials or tokens into
chat or screenshots. Local integration tests separately assert HTTP 404 for these
cross-user routes and 401 for unauthenticated requests.

## Hosted release verification

The owner completed review and authorized publication on 2026-09-13. After the
push, confirm the resulting Render deployment. The existing Render start command runs
migrations automatically before starting the API. Wait for the approved V3 commit
to be Live and confirm health before using a hosted V3 extension. Configure
`.env.hosted.local` with `VITE_API_URL=https://reentry-api-5jfm.onrender.com/api`
and `VITE_API_TIMEOUT_MS=90000`, then run `npm run build:hosted` and reload `dist`.
Repeat the acceptance sequence against production, including another device.
No database credentials or new cloud services are required for this release.

## Scope and evidence

Workspace saves add selected URLs; they do not replace all resources, close tabs,
or remove previously saved workspace entries. Remove unused entries explicitly.
Resume supports 50 selected tabs per operation, with 500 resources per work item.
Ordering is first-save order; saving an existing URL updates its title/source but
does not move it. Checkpoints store text, not historic workspace snapshots.
Unsaved drafts survive a request failure while the form is open; closing/reloading
the view discards unsaved text. There is no offline write queue.

### Local verification record — 2026-09-13

| Check                                        | Result                                                                                                                     |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Frontend regression suite                    | Passed, 14 tests including existing UI/auth/model tests and V3 coverage                                                    |
| Isolated PostgreSQL integration              | Passed, 11 scenarios, including V3 ownership, URL validation, ordering, atomic saves, retries, and cascade deletion        |
| Frontend and backend TypeScript              | Passed, including test files                                                                                               |
| Configured formatting check                  | Passed; no separate lint script is configured                                                                              |
| Production builds                            | Passed: backend, local extension, and hosted extension configuration                                                       |
| Existing local data migration                | Backed up first; migration rerun safely; all existing fields preserved on 3 work items, 7 checklist items, and 2 resources |
| Running local API                            | Restarted with V3 build; `/api/health` returned `{"status":"ok"}`                                                          |
| Real Chrome visual/permission/tab acceptance | Validated by owner; main Chrome flow explicitly confirmed, then all tests reported complete                                |
| V3 publication and production acceptance     | Publication authorized; resulting Render release needs deployment confirmation                                             |

`dist` is the local review build. The hosted configuration was verified separately
under ignored `.reentry-dev/v3-hosted-build`; it has not been loaded or deployed.
The existing configured extension ID remains authorized locally. Backups, runtime
files, and private environment configuration remain ignored by Git.

The owner first confirmed the main Chrome acceptance sequence, then stated
"all tests are done" and requested this validated status and publication. This
records that confirmation without claiming agent-run browser tests or detailed
per-environment evidence. The release deployment check remains separate from
the completed test report; do not infer that a new Render deploy has succeeded
merely because a commit was pushed.
