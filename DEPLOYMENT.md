# Shared ReEntry deployment

Status: deployment preparation only. A hosting account and a live API URL are
required before cross-device login can be verified. Local installations still
use localhost until their extension builds are configured with the shared URL.

## Selected option: temporary free Render demo

The root `render.yaml` provisions one free Node service and one free PostgreSQL
database in the same region. It generates the JWT secret, wires the private
database URL, blocks external database access, and runs migrations on startup.
Free services cannot use a paid pre-deploy migration job. The migration runner
uses a PostgreSQL advisory lock and applies each migration only once.

1. Create an account at <https://dashboard.render.com/> and connect the GitHub
   repository containing the reviewed changes. The deployment files must be
   committed and pushed first; that step still requires the owner's approval.
2. Select **New → Blueprint**, choose the repository, and use `render.yaml`.
3. For `CORS_ORIGINS`, enter `chrome-extension://` followed by the extension ID
   shown at `chrome://extensions`. Additional device IDs can be added later,
   separated by commas.
4. Review that both resource plans are **free** before creating the Blueprint.
5. Wait for the database and API to become ready. Copy the API's HTTPS URL from
   Render and check `/api/health`.
6. Configure the extension as described below, using that URL and
   `VITE_API_TIMEOUT_MS=90000`, then rebuild and reload it on each device.

The template trusts one proxy hop for the Render web service. Verify forwarded
client addresses in the deployed topology before using it outside this demo;
do not add another proxy or route around Render without reviewing that setting.

Render's free API sleeps after 15 minutes without traffic and can take about a
minute to wake. Keep the popup open while an initial login is pending, or open
the API health URL first. The free database expires after 30 days and has no
backups. Export any demo data you want to keep before expiry. See the provider's
[free service limits](https://render.com/docs/free) and
[Blueprint reference](https://render.com/docs/blueprint-spec).

## One API and one database

Deploy `server/` as one Node.js web service with one persistent PostgreSQL
database. Use the same database for every API instance. Do not provision a new
database per device. Use a supported Node LTS runtime and keep a single API
instance for this MVP's in-memory rate limits.

Run these commands with `server/` as the working directory:

```sh
npm ci --include=dev
npm run build
```

Before starting a new release, run:

```sh
npm run db:migrate:production
```

Start command:

```sh
npm start
```

Configure these values in the host's secret/environment settings:

| Variable           | Value                                                                          |
| ------------------ | ------------------------------------------------------------------------------ |
| `NODE_ENV`         | `production`                                                                   |
| `DATABASE_URL`     | Provider's connection string for the shared PostgreSQL database                |
| `JWT_SECRET`       | One generated random secret, at least 32 characters; retain across deployments |
| `HOST`             | `0.0.0.0`                                                                      |
| `PORT`             | Host-assigned port                                                             |
| `CORS_ORIGINS`     | Comma-separated exact `chrome-extension://ID` origins for each device          |
| `TRUST_PROXY_HOPS` | Verified number of reverse proxies between client and API; default `0`         |

Do not set proxy trust to an arbitrary value: the correct setting depends on
the provider and must prevent clients spoofing their rate-limit identity.
Use the provider's private database connection when available. For a public
database endpoint, follow its TLS connection instructions and keep certificate
verification enabled. Never commit these secrets or put them in `VITE_` values.

Health check: `GET /api/health` must return HTTP 200 and `{"status":"ok"}`.
Expose the API over HTTPS. Choose a persistent database plan and review its
cost, retention and backup policy before creating resources.

## Point every device at the shared API

Set the repository root `.env` on the build machine:

```dotenv
VITE_API_URL=https://YOUR-API-HOST/api
VITE_API_TIMEOUT_MS=90000
```

Run `npm run build` from the repository root. This also updates the extension's
host permission. Load the resulting `dist` folder via Chrome's **Load unpacked**
on each device, or reload the existing unpacked extension if replacing it in
the same folder. Close any old ReEntry tabs before reopening.

An unpacked extension can have a different ID on each device. Copy each ID from
`chrome://extensions`, add its exact `chrome-extension://ID` origin to the
server's `CORS_ORIGINS`, and restart/redeploy the API. Do not change an existing
extension's identity just to match another device: that can strand V1 local
data. All devices must use the same HTTPS API URL.

The SEE ALL dashboard is an extension page and uses the same service worker
and API; it does not need a separate web host.

## Existing local accounts and work

Local PostgreSQL accounts and V2 work do not automatically move to a newly
created hosted database. Before switching, decide whether to transfer the
local database or start fresh. Do not overwrite a populated hosted database.
A transfer should use a reviewed PostgreSQL dump/restore procedure with a
backup and the source retained until verification. Retaining existing sessions
also requires the same JWT secret; otherwise users log in again.

V1 `chrome.storage.local` work can still use the existing import prompt after
login. That migration does not transfer local PostgreSQL V2 data.

## Acceptance checks on the live service

1. Device A: register a test account and create a work item.
2. Device B: log in with the same credentials; confirm that item appears.
3. Device B: update its next action. Refocus device A; confirm it refreshes.
4. Try registering the same email again, including different capitalization.
   It must be rejected, rather than creating another account.
5. Register another account and confirm the first account's work is absent.
6. Save a browser resource, restart Chrome, and verify the saved work persists.
7. Restart the API and confirm the account and work still exist.

Do not describe cross-device support as live until these checks pass against
the hosted API. No deployment, paid resource creation, commit or push is
performed by this document.
