# ReEntry V2

ReEntry helps you resume ongoing work by remembering where you stopped, what to do next, and which resources belong to that work. It is a personal work console, not a generic task manager.

The compact popup cards, dashboard list, direct navigation to details, context editor, checklists, resource capture, search, and status filters remain. The dashboard sorts In Progress, Not Started, then Done, with newest updates first in each group.

## Architecture

```text
Chrome popup + extension dashboard
            |
    shared service worker (session + API requests)
            |
    Express / TypeScript REST API
            |
    Drizzle / node-postgres
            |
        PostgreSQL
```

The API/database is the canonical store for authenticated work. Work items are never written back to V1 storage. `chrome.storage.local` holds only the extension session, migration state, and the untouched V1 source data. There is no offline write queue or permanent local work cache. A connection error is shown instead of silently falling back to old local data.

Open extension views refresh after successful changes and on focus. Visible views also poll every 15 seconds to pick up changes from another browser/profile. No WebSockets or extra infrastructure are needed. Field patches preserve unrelated fields; two edits to the same field use the last saved value. Full checklist/resource edits replace the submitted collection atomically; individual checkbox changes use a narrow endpoint.

## Stack and folders

- Client at repository root: React 18, TypeScript, Vite 6, Manifest V3, locally bundled Lucide icons.
- `server/`: an independent npm package using Express, TypeScript, PostgreSQL, Drizzle, Zod, bcryptjs, and JWT.
- `src/api.ts`: HTTP client and API/UI status mapping.
- `src/transport.ts`: shared view-to-worker messaging; memory-only session adapter for the browser development dashboard.
- `src/session-service.ts`: session management and retry-safe V1 migration.
- `src/background.ts`: serialized extension requests and context-menu capture.
- `src/storage.ts`: existing UI hook facade, now backed by the API rather than Chrome storage.
- `src/AuthGate.tsx`: login/signup/logout and local migration prompt.
- `src/App.tsx`, `src/WorkInventory.tsx`, `src/styles.css`: the preserved V1 work experience.
- `server/src/schema.ts`, `server/migrations/`: relational schema and versioned SQL migrations.
- `server/src/app.ts`, `server/src/work-service.ts`: authentication, ownership checks, REST routes, validation, and transactional work operations.
- `tests/`, `server/tests/`: UI/model/session tests and real PostgreSQL API integration tests.

There is no Docker, OAuth, email verification, password reset, or backend infrastructure beyond one API process and PostgreSQL. For the shared hosted demo, see [deployment setup](DEPLOYMENT.md). A Render Blueprint is prepared; hosting is not live until provisioned and verified.

## Database schema

| Entity              | Purpose                                                                           |
| ------------------- | --------------------------------------------------------------------------------- |
| `users`             | UUID, unique normalized email, password hash, creation/update timestamps          |
| `work_items`        | User-owned title, category, goal, status, stopping point, next action, timestamps |
| `checklist_items`   | Work-item-owned text, completion, position, timestamps                            |
| `resources`         | Work-item-owned title, HTTP(S) URL, timestamps; unique URL per work item          |
| `sessions`          | Revocable JWT session IDs and expiration times                                    |
| `v1_imports`        | Per-user migration receipts; retained after imported work is deleted              |
| `schema_migrations` | Applied SQL migration filenames                                                   |

Foreign keys cascade user/work-item deletion. Import receipts retain a nullable reference after work deletion, so a retry cannot resurrect deleted imported work. Database enum order is `IN_PROGRESS`, `NOT_STARTED`, `DONE` and matches the UI order.

## Local setup (Windows, no Docker)

For this working checkout, the local helper configures an independent PostgreSQL cluster in the ignored `.reentry-dev/` folder, with generated passwords and a non-superuser application role. It does not use or modify your normal PostgreSQL service. Once dependencies and production builds exist, run from the root:

```powershell
npm run local:start
npm run local:stop
```

Start launches the database on port 55432, API on 3001, and development dashboard on 5173 in hidden processes. Stop retains the database and private `.env` configuration. The helper derives the expected unpacked-extension ID for this checkout's `dist` path using Chromium's Windows path-hashing algorithm; it does not inspect browser profiles or change the manifest identity. If Chrome shows a different ID (for example, another loaded folder), authorize that ID and restart the API with:

```powershell
npm run local:start -- -ExtensionId YOUR_32_LETTER_EXTENSION_ID
```

The helper does not overwrite independently created `server/.env` files or replace processes occupying these ports. Rebuild the server after source changes, then stop/start the helper to use the updated output. Do not delete `.reentry-dev/` if you want to retain this local database. The manual setup below is an alternative for your normal PostgreSQL installation; it is not required when using the helper.

Requirements: Node.js/npm, desktop Chrome 102+, and PostgreSQL 14+ with its `bin` directory on PATH. Development has been checked with the installed Node 18.15.0/npm 9.8.1 and PostgreSQL 18. Use a maintained Node LTS version for ongoing development.

Run these commands from the repository root in PowerShell. `npm.cmd` can be used instead of `npm` if PowerShell blocks `npm.ps1`.

### 1. Create the application database

Connect using the PostgreSQL administrator account created during installation:

```powershell
psql -h localhost -U postgres -d postgres
```

In psql, run:

```sql
CREATE ROLE reentry LOGIN;
\password reentry
CREATE DATABASE reentry OWNER reentry;
\q
```

`\password` prompts for a password without putting it in SQL history. If the role/database already exist, reuse them instead of rerunning the CREATE statements. The application role does not need superuser or CREATEDB privileges.

### 2. Configure and initialize the backend

```powershell
cd server
npm install
Copy-Item .env.example .env
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

Edit `server/.env`:

```dotenv
DATABASE_URL=postgresql://reentry:YOUR_PASSWORD@localhost:5432/reentry
JWT_SECRET=PASTE_THE_GENERATED_RANDOM_VALUE
PORT=3001
HOST=127.0.0.1
CORS_ORIGINS=http://localhost:5173
```

URL-encode special characters in the database password. Never put database credentials or JWT secrets in a `VITE_` variable. Real `.env` files are ignored by Git; only examples are tracked.

Apply migrations, then start the backend:

```powershell
npm run db:migrate
npm run dev
```

Migrations are transactional, use an advisory lock, and can be rerun safely. New database changes should be added as new numbered SQL files in `server/migrations/`, with matching Drizzle schema changes. Existing migrations must not be rewritten after application.

The default health endpoint is `http://localhost:3001/api/health`. Keep the backend running while using ReEntry. To run compiled backend output instead:

```powershell
npm run build
npm start
```

### 3. Build and load the extension

Open another terminal at the repository root:

```powershell
npm install
Copy-Item .env.example .env
npm run build
```

The default client setting is `VITE_API_URL=http://localhost:3001/api`. The build generates an extension host permission for that API host only. Rebuild after changing this setting. HTTP is allowed only for localhost/127.0.0.1; other API hosts require HTTPS.

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. For your existing V1 installation, click **Reload**, keeping its existing `dist` folder and extension ID. Do not uninstall it: uninstalling removes its local data.
4. For a new installation, click **Load unpacked** and select the repository's `dist` directory.
5. Copy ReEntry's extension ID from the extension card.
6. Add its origin to `server/.env`, replacing `YOUR_EXTENSION_ID`:

```dotenv
CORS_ORIGINS=http://localhost:5173,chrome-extension://YOUR_EXTENSION_ID
```

7. Restart the backend after editing `.env`.
8. Pin ReEntry from Chrome's extensions menu and open it. Refresh any already-open ReEntry dashboard tabs.

The extension requests only `storage`, `activeTab`, `contextMenus`, and the configured API host. There are no content scripts or all-sites host permissions.

### 4. Browser development dashboard

```powershell
npm run dev
```

Open `http://localhost:5173/workspace.html`. This uses the same API and UI. Its token lives only in page memory, so a full page reload requires login again. Browser-extension capture and V1 migration require the installed extension. If Vite selects another port, add that exact origin to `CORS_ORIGINS` and restart the backend.

## Authentication and security

- Email is trimmed and normalized to lowercase. Passwords are bcrypt-hashed with cost 12. Passwords must be at least 10 characters and at most 72 UTF-8 bytes, avoiding bcrypt truncation.
- JWTs expire after seven days and are checked for algorithm, issuer, audience, UUID subject/session, expiration, and a live database session. Logout revokes the current session.
- The extension stores its token under `reentry.session.v2` in `chrome.storage.local` so login survives browser/service-worker restarts. Access is restricted to `TRUSTED_CONTEXTS` when `setAccessLevel` is available. Browsers without that method retain extension-local storage defaults; ReEntry has no content scripts or script-injection permission. Revisit that fallback before adding either. The worker uses the token and returns only public user/session information to React views. Tokens are not put in URLs, UI state, or logs.
- Registration includes password confirmation; both auth screens offer password visibility controls. Unfinished auth input is stored under `reentry.auth-draft.v2` in memory-only `chrome.storage.session`, so closing and reopening the popup preserves it. Drafts clear after successful authentication or browser exit. Password visibility resets to hidden on reopening. The localhost preview keeps drafts only in page memory; they do not survive a full reload. Draft passwords are never written to `chrome.storage.local`, and confirmation is never sent to the API.
- Chrome local storage is not encrypted secret storage. Someone with access to the Chrome profile or extension developer tools can inspect it. This MVP uses a limited, revocable session rather than claiming protection from a compromised device.
- Offline logout clears the local session and reports when server revocation could not be confirmed. Such a server session expires automatically. A 401 clears the extension session and returns the user to login.
- Requests use bearer authorization, not ambient cookies. CORS allows only configured browser origins. Request schemas are strict, passwords are never returned, URLs are limited to HTTP(S), body size and request rates are limited, and database/internal errors are not returned to clients.
- Every work operation is user-scoped. Child mutations verify the parent owner; using another user's work, checklist, or resource ID fails with 404.

## V1 migration

After login, ReEntry detects items in `reentry.workItems.v1` and offers **Import local work**, showing the target account email. New accounts otherwise start empty. Existing V1 example work items migrate like any other work; V2 never silently reseeds your account.

1. A stable source UUID is saved locally before upload.
2. Items upload in batches of 50. Each API request is transactional, with unique `(user, source UUID + legacy item ID)` receipts preventing duplicates on concurrent requests or retries.
3. Titles, categories, goals, statuses, context, checklist order/completion, resource titles/URLs, and work timestamps are preserved. Server UUIDs replace legacy IDs. Duplicate resource URLs within a work item collapse to the first entry.
4. Only after all requests succeed is the local migration marked complete. The original V1 data is retained, never deleted or used as a current work database.
5. A failed request or local marker write can be retried safely. Previously committed batches are skipped. Deleting imported work does not make retries recreate it.

The device's source is offered only until successfully imported into one account; subsequent account switches do not offer to copy the previous owner's V1 data. **Not now** postpones the prompt until the next login/reopen. Account data comes solely from the API. Keep the same unpacked extension ID/folder to retain access to the V1 source and migration marker.

## REST API

All routes except registration, login, and health require `Authorization: Bearer TOKEN`.

| Method | Route                                    | Purpose                                                                       |
| ------ | ---------------------------------------- | ----------------------------------------------------------------------------- |
| POST   | `/api/auth/register`                     | Register with email/password and establish a session                          |
| POST   | `/api/auth/login`                        | Log in                                                                        |
| GET    | `/api/auth/me`                           | Current user                                                                  |
| POST   | `/api/auth/logout`                       | Revoke current session                                                        |
| GET    | `/api/work-items`                        | User's inventory; optional `status=IN_PROGRESS` and `search=load`             |
| GET    | `/api/work-items/:id`                    | Full owned work item                                                          |
| POST   | `/api/work-items`                        | Create work with optional checklist/resources                                 |
| PATCH  | `/api/work-items/:id`                    | Patch fields; replace checklist/resources only when supplied                  |
| DELETE | `/api/work-items/:id`                    | Delete owned work and children                                                |
| PATCH  | `/api/work-items/:id/checklist/:checkId` | Change one checkbox using `{ "completed": true }`                             |
| POST   | `/api/work-items/:id/resources`          | Add `{ "title": "...", "url": "https://..." }`; duplicate URLs are idempotent |
| DELETE | `/api/resources/:id`                     | Delete an owned resource                                                      |
| POST   | `/api/work-items/import`                 | Retry-safe V1 import                                                          |

API status values are `IN_PROGRESS`, `NOT_STARTED`, and `DONE`; the client maps them to existing human-readable labels. List responses use `{ items }`, work responses `{ item }`, and errors `{ error, details? }`. Checklist creation/removal/reordering use the work PATCH collection field. Unsupported fields and malformed IDs/payloads return 400, unauthenticated requests 401, missing or foreign-owned records 404, duplicate registration 409, and oversized bodies 413.

## Automated checks

From the root:

```powershell
npm test
npm run typecheck
npm run format:check
npm run build
```

From `server/`:

```powershell
npm run test:isolated
npm run typecheck
npm run build
```

The Windows isolated runner locates PostgreSQL through `psql` on PATH (or `POSTGRES_BIN`), creates a temporary SCRAM-password-protected cluster on a loopback port, runs the API tests, then stops and removes only that cluster. It does not alter your normal PostgreSQL service or application database.

Alternatively, set `TEST_DATABASE_URL` in `server/.env` to a maintenance database connection whose role has CREATEDB permission, then run `npm test` in `server/`. The tests create a uniquely named `reentry_test_*` database, apply migrations, and drop only that generated database afterward. Do not give the application role extra privileges just for tests. To provision a separate test role using psql as an administrator:

```sql
CREATE ROLE reentry_test LOGIN CREATEDB;
\password reentry_test
```

```dotenv
TEST_DATABASE_URL=postgresql://reentry_test:YOUR_TEST_PASSWORD@localhost:5432/postgres
```

Tests cover registration/login/hashing, JWT protection/revocation, cross-user work and child ownership, CRUD, sorting/search, migration transactions/retries, client session restart/expiration, capture destination preservation, and the existing workspace interaction flow. The `qs` override pins the patched transitive parser release; dependency audits should be rerun when upgrading packages.

## Manual Chrome acceptance test

1. **Sign up:** with the API running, open ReEntry, choose Sign up, and create account A. If V1 work exists, confirm the email and import it. Otherwise use New work item on See all.
2. **Login:** log out and log back into A; confirm the same inventory appears.
3. **Create/edit:** create an In Progress item with a goal, context, Next Action, checklist, and resource. Resume it; edit context, click Save context, and toggle a checkbox. Check the popup and dashboard agree.
4. **Done:** mark the item Done in Edit item. It remains at the bottom of All, disappears from the popup, and appears in the Done filter.
5. **Capture:** right-click a normal HTTP(S) page or link, choose Save to ReEntry, select a work item, and save. Verify its title/URL in resources. Repeat using Save this page in the popup. Capture while logged out and verify login preserves the pending destination.
6. **Restart:** close and reopen Chrome, keeping the API running. Log in again if the session expired. Confirm work, context, checklists, and resources persist. Restarting the API with the same database and JWT secret also preserves work and valid sessions.
7. **Isolation:** log out, register account B, and confirm A's work is absent. In API tooling, use B's bearer token to GET/PATCH/DELETE an A work ID, update an A checklist ID, or delete an A resource ID; all must return 404. The automated API suite performs these exact checks.
8. **Migration/sync:** reopen the extension after import; no duplicate items or repeat prompt should appear. Use two dashboard tabs to verify mutations refresh the other view. A separate browser session picks up changes on focus or within 15 seconds while visible.
9. **Failures:** stop the API and attempt an edit; an error should appear without erasing local V1 data or reporting a successful save. Restart the API and retry. Invalid or expired sessions should return to login.

Actual Chrome rendering and extension installation must be reviewed manually when browser automation is unavailable.
