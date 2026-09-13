# V2.1 deployment and reliability verification

V2.1 is **deployed, with production acceptance reported passed by the owner**.
This record distinguishes owner-reported manual checks from automated tests
and directly observed results. Retain the procedures below for future releases. Complete one external phase
at a time with the owner. Do not commit, push, rotate secrets, reset databases,
or provision paid resources as part of verification without authorization.

## Before deployment: source and data

Render deploys GitHub source, not the local working tree. Provisioning the V2
code establishes the baseline, but does not verify V2.1. Record the exact commit
Render deploys and verify the acceptance scenarios against that version.

Keep local PostgreSQL and V1 Chrome storage unchanged. A new hosted database
starts empty: local V2 accounts/work do not automatically transfer. The V1
import prompt transfers only the retained V1 Chrome source. Stop and review a
backup/transfer plan if existing local V2 work must move to the hosted database.

## A–E. Render service, environment, migrations, URL and health

1. Open the Render dashboard. Check whether `reentry-api` and `reentry-db`
   already exist. Reuse existing resources; do not make another database.
2. If absent, choose **New → Blueprint**, connect the ReEntry GitHub repository,
   select its approved branch and root `render.yaml`. Review the free plans and
   database expiry before creating the resources. Stop if payment is requested.
3. Supply `CORS_ORIGINS` as an exact extension origin. For the current checkout:
   `chrome-extension://ncekgiocfckdlkadccajdakfdihjkkim`.
   Add other device IDs later, separated by commas, without spaces inside IDs.
4. In the API's Environment settings, verify names/settings only:
   `NODE_ENV=production`, `HOST=0.0.0.0`, `NODE_VERSION=22`,
   `TRUST_PROXY_HOPS=1` for the existing Render proxy route, provider-assigned
   `PORT`, generated `JWT_SECRET`, and `DATABASE_URL` linked to `reentry-db`.
   Never copy secret values into chat. Keep the JWT secret across restarts.
5. Verify the commands: root directory `server`, build
   `npm ci --include=dev && npm run build`, start
   `npm run db:migrate:production && npm start`.
   Startup applies pending migrations automatically and then starts the API.
   Do not run schema reset or drop commands. For V2.1, migrations include
   `001_initial.sql` and `002_create_receipts.sql`; repeated starts are safe.
6. Wait for a successful deploy. Logs should include `Database migrations
applied.` and `ReEntry API listening`. Record the deployed commit and the
   public HTTPS API URL shown on the service page.
7. Open `https://YOUR-API-HOST/api/health`. Expected: HTTP 200 and exactly
   `{"status":"ok"}`. This checks PostgreSQL as well as HTTP availability.
   An initial free-tier cold start can take about a minute.
8. Verify the database's external access list is empty (private API-to-database
   access remains available). Keep certificate verification enabled if using
   an external PostgreSQL endpoint instead.

## F–G. Configure and load the hosted extension

1. Create `.env.hosted.local` at the repository root (ignored by Git):

   ```dotenv
   VITE_API_URL=https://YOUR-API-HOST/api
   VITE_API_TIMEOUT_MS=90000
   ```

2. From the repository root run `npm run build:hosted`. It rejects a localhost
   or non-HTTPS API. Ordinary `npm run build` continues to use local `.env`.
3. Check `dist/manifest.json`: its host permission must name only the deployed
   API host, not `<all_urls>`. Keep using the existing `dist` directory so this
   unpacked installation keeps its identity and V1 source data.
4. Open `chrome://extensions`, enable Developer mode, and reload ReEntry.
   On a new profile choose **Load unpacked** and select the same built `dist`.
   Close existing ReEntry tabs, then reopen the popup.
5. For each profile/device, copy only the extension ID into the API's
   `CORS_ORIGINS` list and apply the environment update. Keep every existing
   allowed ID. IDs may differ on different computers. Use the same build and
   API URL everywhere; do not change the manifest key to force a matching ID.

## H–J. User A, saved context and restart

1. In profile A register a disposable test account using an email you control.
   Enter matching passwords; never share the password. Record the test email
   privately. Verify duplicate registration with the same email is rejected.
2. Create **System Design Prep**, category **System Design**, status
   **In Progress**, goal **Prepare for system design interviews**.
   Set **Where I Left Off** to **Finished load balancing.** and **Next Action**
   to **Study caching.** Add one checklist item and one HTTPS resource.
3. Save, reopen the detail view, and confirm every field. Check the checklist
   item, save context again, and confirm the changes after reopening.
4. Close all Chrome windows, restart Chrome, reopen ReEntry and confirm the
   account/work persists. If Chrome is configured to clear extension state,
   log in again and confirm the server work is still present.
5. In a separate approved external phase, restart the API using Render's service
   action or manually redeploy the **same commit**. Keep the database and JWT
   secret unchanged. Repeat `/api/health`, `/api/auth/me` through the extension,
   and work-item lookup. Existing sessions and work must remain valid.

## K–M. Profile/device B, same-account synchronization

1. Create another normal Chrome profile (not incognito) or use another device.
   Load the hosted build and allow its extension ID as above.
2. Log in as the same User A. Confirm **System Design Prep** appears with
   **Study caching.**, its stopping point, checklist and resource.
3. Change Next Action on B to **Study CDN.** and save.
4. Focus or reopen ReEntry on A. Expected: **Study CDN.** appears; a visible view
   also polls every 15 seconds. Allow additional network/cold-start time.
5. Make a change from A and verify B sees it. Do not leave unsaved edits in the
   same field while testing; concurrent saved edits to one field are last-write-wins.

## N–O. User B and direct server-side isolation

1. Log out in profile B and register a different account, User B. Verify User A's
   work is absent. Create one User B item to use in child-ID substitution checks.
2. In profile A's ReEntry service-worker DevTools, make an authenticated GET of
   `/api/work-items` using the snippet below with `method: "GET"`. Inspect locally
   and copy only the IDs of User A's work, checklist and resource. Never copy
   the token. Close A's DevTools before switching profiles to avoid confusion.
3. In profile B's service-worker Console, run the snippet using User B's own
   session and each request below. Replace the API URL and IDs, not credentials:

   ```javascript
   (async () => {
     const api = "https://YOUR-API-HOST/api";
     const stored = await chrome.storage.local.get(`reentry.session.v2:${api}`);
     const session = stored[`reentry.session.v2:${api}`];
     if (!session)
       throw new Error("Log in with this profile's hosted build first.");
     const path = "/work-items/USER_A_WORK_ID";
     const method = "GET";
     const body = undefined;
     const response = await fetch(api + path, {
       method,
       headers: {
         Authorization: `Bearer ${session.token}`,
         ...(body === undefined ? {} : { "Content-Type": "application/json" }),
       },
       body: body === undefined ? undefined : JSON.stringify(body),
     });
     console.log(response.status, await response.json().catch(() => null));
   })();
   ```

   | Method | Path                                                   | Body                                                               | Expected for User B |
   | ------ | ------------------------------------------------------ | ------------------------------------------------------------------ | ------------------- |
   | GET    | `/work-items/USER_A_WORK_ID`                           | none                                                               | 404                 |
   | PATCH  | `/work-items/USER_A_WORK_ID`                           | `{ "nextAction": "Forbidden" }`                                    | 404                 |
   | DELETE | `/work-items/USER_A_WORK_ID`                           | none                                                               | 404                 |
   | PATCH  | `/work-items/USER_A_WORK_ID/checklist/USER_A_CHECK_ID` | `{ "completed": false }`                                           | 404                 |
   | PATCH  | `/work-items/USER_B_WORK_ID/checklist/USER_A_CHECK_ID` | `{ "completed": false }`                                           | 404                 |
   | POST   | `/work-items/USER_A_WORK_ID/resources`                 | `{ "title": "Forbidden", "url": "https://example.com/forbidden" }` | 404                 |
   | DELETE | `/resources/USER_A_RESOURCE_ID`                        | none                                                               | 404                 |

4. Return to User A and verify their work, checklist and resources are unchanged.
   Never run these destructive-ID checks with User A's token by accident.

## P–Q. Browser capture and logout

1. On an ordinary HTTPS page, right-click **Save to ReEntry**. Select a work item
   belonging to the current account. Confirm the resource has the page title and
   URL. Repeat capture of the same URL: there should be one resource for it.
2. Verify the resource in the other profile signed into the same account.
3. Log out, then use capture while signed out. The captured page should remain
   waiting at sign-in. Log in and associate it with a work item.
4. Log out of profile A; profile B's independent session should remain valid.
   Log in again on A and confirm its server work is intact.

## Migration and failure phases

- Use a spare profile with retained V1 work. Do not overwrite a real profile's
  storage just to manufacture a test. Record the title/category/goal/status,
  stopping point, next action, checklists and resources before import.
- Log into the hosted account and choose **Import local work**. Verify every
  recorded field on both profiles. Reload; the prompt should not reappear.
  Source key `reentry.workItems.v1` must remain present.
- In the spare profile only, retain a private copy of the hosted migration
  marker `reentry.migration.v2:https://YOUR-API-HOST/api`. Remove just its
  `completedBy` property, preserving `sourceId`; do not delete the marker.
  Reload and import again. Count the items: no duplicates. The marker should
  become complete again. Do not repeat this against a different account.
- In service-worker DevTools, use network Offline/request blocking for the API
  host, then attempt a save/import. Verify an understandable error and no
  successful-save notice. Remove blocking and retry. V1 data must remain.
- For a lost create response, retry in the same open creation form. Its request
  ID is stable: one work item should exist. Changing the payload after a server
  commit gives a conflict, not another create. Closing/reopening the form starts
  a new operation; refresh before doing so if the outcome was uncertain.
- Wait out free-tier idling and reopen the extension. A pending/loading state
  must remain visible while the API wakes; failure must offer a retry.
- In an isolated test profile, change its stored token to a nonsecret invalid
  value and reload. It must return to login, without showing another user's data.
  403/404/429/500 handling is covered by local tests; do not flood the deployed
  API to force rate limiting. Record any real failures observed during this phase.

## Evidence record — fill only after observation

2026-09-13: HTTPS GET `https://reentry-api-5jfm.onrender.com/api/health`
returned HTTP 200 with `{"status":"ok"}`. The response allowed origin
`chrome-extension://ncekgiocfckdlkadccajdakfdihjkkim`. The owner's Render
Blueprint screenshot identifies deployed baseline commit `42efaaa`.
This was the initial baseline. A later Render screenshot showed `a9abef2`
deployed successfully, and another direct health request returned `{"status":"ok"}`.
The migration ownership fix was then amended and pushed as `c8b871f`; the owner
subsequently reported that its deployment and the remaining production checks passed.

2026-09-13 local-to-Render transfer: inspected an empty target, backed up the
source, rehearsed and rolled back a full copy, then committed the verified
transfer. Target counts confirmed over a new TLS connection: 1 user, 3 work
items, 7 checklist items, 2 resources, 3 V1 import receipts. All copied IDs,
fields, full-precision timestamps and password hashes matched. Local data was
left unchanged. Existing sessions and the local JWT secret were not copied;
the user logged in on Render with their existing email/password and confirmed
the work items were visible. The owner also reported removing temporary database
network access. The agent did not independently recheck the network denial.

The owner subsequently confirmed new-account registration and the migration
ownership fix in Chrome, then explicitly reported all listed remaining checks
passed: latest deployment, cross-profile sync, Chrome restart persistence,
checklist/resources, context-menu capture, network-failure handling, and direct
cross-user ID denial. These are owner-reported results, not agent-run browser tests.

| Check                                                | Result / evidence                                                                                |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Local frontend tests                                 | Passed: 11 tests                                                                                 |
| Local PostgreSQL integration                         | Passed: 9 scenarios                                                                              |
| Frontend/backend TypeScript and builds               | Passed                                                                                           |
| Formatting                                           | Passed                                                                                           |
| Deployed commit and HTTPS URL                        | Owner confirmed `c8b871f`; see URL above                                                         |
| Deployed health and PostgreSQL                       | Direct health and transfer verification; see above                                               |
| Hosted registration/login                            | Owner confirmed existing and new accounts                                                        |
| Saved work/checklist/resources and Chrome restart    | Owner reported passed                                                                            |
| Same account across profiles and updates syncing     | Owner reported passed                                                                            |
| Direct cross-user work/child-ID denial               | Owner reported passed; also covered by local integration tests                                   |
| Browser context-menu capture                         | Owner reported passed                                                                            |
| V1 migration                                         | Transfer and receipts directly verified; ownership fix confirmed by owner; retry covered locally |
| Cold start/offline/error recovery                    | Owner reported passed; failure handling also covered locally                                     |
| Separate API-restart session test and logout/relogin | Not separately recorded in the owner's grouped confirmation; local coverage exists               |

Production acceptance was reported by the owner. Detailed per-request browser
logs were not supplied, so this record does not claim independent reproduction
of every manual scenario. Render's free database expiry and lack of backups
prevent describing this demo as durable production hosting. See [Render's free limits](https://render.com/docs/free).
