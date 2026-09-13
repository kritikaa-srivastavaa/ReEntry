# Development and API reference

For the product overview, see [README](../README.md). Use either the managed
Windows helper or an independently configured PostgreSQL database, not both.
Examples assume commands run from the repository root unless noted.

## Local setup (Windows, no Docker)

On Windows, the local helper configures an independent PostgreSQL cluster in the ignored `.reentry-dev/` folder, with generated passwords and a non-superuser application role. It does not use or modify your normal PostgreSQL service. For a fresh checkout, install both packages and build the server and extension before using the helper. Do not create `server/.env` first on this managed setup path:

```powershell
npm ci
Push-Location server
npm ci
Pop-Location
npm run server:build
npm run build
```

Then run from the root:

```powershell
npm run local:start
npm run local:stop
```

Restart with stop/start after rebuilding the API. Start launches the database on port 55432, API on 3001, and development dashboard on 5173 in hidden processes. Stop retains the database and private `.env` configuration. The helper derives the expected unpacked-extension ID for this checkout's `dist` path using Chromium's Windows path-hashing algorithm; it does not inspect browser profiles or change the manifest identity. If Chrome shows a different ID (for example, another loaded folder), authorize that ID and restart the API with:

```powershell
npm run local:start -- -ExtensionId YOUR_32_LETTER_EXTENSION_ID
```

The helper does not overwrite independently created `server/.env` files or replace processes occupying these ports. Rebuild the server after source changes, then stop/start the helper to use the updated output. Do not delete `.reentry-dev/` if you want to retain this local database. The manual setup below is an alternative for your normal PostgreSQL installation; it is not required when using the helper.

Requirements: Node.js/npm, desktop Chrome 102+, and PostgreSQL 14+ with its `bin` directory on PATH. Use Node.js 22 to match the Render configuration. PostgreSQL integration is verified with PostgreSQL 18.

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
Copy-Item .env.example .env # First setup only; keep an existing .env
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
Copy-Item .env.example .env # First setup only; keep an existing .env
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

The extension requires `storage`, `activeTab`, `contextMenus`, and the configured API host. Workspace capture/resume requests optional `tabs` permission to read current-window tab titles/URLs and detect duplicates. There are no content scripts, history API calls, or all-sites host permissions.

### 4. Browser development dashboard

```powershell
npm run dev
```

Open `http://localhost:5173/workspace.html`. This uses the same API and UI. Its token lives only in page memory, so a full page reload requires login again. Browser-extension capture and V1 migration require the installed extension. If Vite selects another port, add that exact origin to `CORS_ORIGINS` and restart the backend.

## Authentication and security

- Email is trimmed and normalized to lowercase. Passwords are bcrypt-hashed with cost 12. Passwords must be at least 10 characters and at most 72 UTF-8 bytes, avoiding bcrypt truncation.
- JWTs expire after seven days and are checked for algorithm, issuer, audience, UUID subject/session, expiration, and a live database session. Logout revokes the current session.
- The extension stores its token under `reentry.session.v2` in `chrome.storage.local` so login survives browser/service-worker restarts. Access is restricted to `TRUSTED_CONTEXTS` when `setAccessLevel` is available. Browsers without that method retain extension-local storage defaults; ReEntry has no content scripts or script-injection permission. The worker uses the token and returns only public user/session information to React views. Tokens are not put in URLs, UI state, or logs.
- Registration includes password confirmation; both auth screens offer password visibility controls. Unfinished auth input is stored under `reentry.auth-draft.v2` in memory-only `chrome.storage.session`, so closing and reopening the popup preserves it. Drafts clear after successful authentication or browser exit. Password visibility resets to hidden on reopening. The localhost preview keeps drafts only in page memory; they do not survive a full reload. Draft passwords are never written to `chrome.storage.local`, and confirmation is never sent to the API.
- Chrome local storage is not encrypted secret storage. Someone with access to the Chrome profile or extension developer tools can inspect it. ReEntry uses a limited, revocable session rather than claiming protection from a compromised device.
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

The device's source is bound to the importing account before upload, so even a partial import cannot be continued by another account. Older completion markers also establish ownership when moving from localhost to the hosted API. Completion remains specific to each API, allowing the same owner to retry safely against a new database; other accounts are never offered that retained backup. **Not now** postpones an unclaimed import prompt until the next login/reopen. Account data comes solely from the API. Keep the same unpacked extension ID/folder to retain access to the V1 source and migration marker.

## Database schema

Versioned SQL migrations in `server/migrations/` are the schema history; Drizzle
models live in `server/src/schema.ts`.

| Entity                      | Purpose                                                           |
| --------------------------- | ----------------------------------------------------------------- |
| Users and sessions          | Password hashes, account identity, and revocable login sessions   |
| Work items                  | User-owned title, status, goal, stopping context, and next action |
| Checklist items             | Ordered steps belonging to a work item                            |
| Resources                   | Manual links and ordered workspace URLs belonging to a work item  |
| Work checkpoints            | Historical stopping context and next action, with retry identity  |
| Imports and create receipts | Retry-safe migration and work-item creation records               |

Child data uses foreign keys and cascading deletes. Checkpoint creation updates
current context and history in one transaction. Apply migrations with the commands
above; never reset a populated database to update its schema.

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
| POST   | `/api/work-items/:id/resources/bulk`     | Save selected workspace resources (up to 50)                                  |
| GET    | `/api/work-items/:id/checkpoints`        | Newest-first history; `limit` (1-50) and `offset`                             |
| POST   | `/api/work-items/:id/checkpoints`        | Save context, optional workspace links, and history atomically                |
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

## Supporting scripts

- `server/scripts/backup-local.mjs`: full local PostgreSQL backup into ignored runtime storage.
- `server/scripts/transfer-local.mjs`: retained V2 transfer utility; refuses V3 schemas to avoid omitting checkpoint history. Use a reviewed full backup/restore for any future database move.
- `server/scripts/smoke-local.mjs`: local account/API smoke check that cleans up only its own generated test accounts.
- `scripts/start-local.ps1` / `stop-local.ps1`: manage only ReEntry development processes and retain database files on stop.

Startup, migration, and script completion logs are intentional. The worker diagnostic channel reports only safe operational state and is used by timeout recovery. V1 model fixtures and migration receipts remain for compatibility and regression coverage.
