# ReEntry

A Chrome extension for pausing and resuming ongoing work without losing context. Leave a note about where you stopped, choose one next action, and keep the resources that belong to that work together.

## Run and load in Chrome

Requirements: Node.js 18+ supported by Vite 6, npm, and desktop Google Chrome. This repository was built with Node 18.15.0 and npm 9.8.1. A current LTS Node release is recommended for future development.

```powershell
npm.cmd install
npm.cmd run build
```

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** in the upper-right corner.
3. Click **Load unpacked**.
4. Select the generated **dist** directory: `C:\Users\user\Documents\ReEntry\ReEntry\dist`.
5. Open Chrome's extensions menu (the puzzle icon) and pin **ReEntry**.
6. Click the ReEntry toolbar icon. The three example work items appear on first use.

After code changes, run `npm.cmd run build`, click ReEntry's **Reload** button on `chrome://extensions`, then reopen the popup and refresh any open ReEntry tabs. Load `dist`, not the repository root. Generated output is ignored by Git.

`npm.cmd run dev` serves the UI during development, but ordinary web pages cannot access the extension APIs. Use the built, unpacked extension for real persistence and browser features. There is intentionally no localStorage fallback or separate preview database.

## Using ReEntry

- **Resume:** click a popup card's Resume button to see your saved stopping point, next action, checklist, goal, and resources. Resume opens the context view; resources open individually in new tabs.
- **Save context:** edit Where I Left Off and Next Action, then click Save context before dismissing the popup. Back and Edit item also save changed context before navigating. Checklist changes save immediately.
- **See all:** scan compact rows showing title, category, Next Action, status, checklist progress, and last updated. Click anywhere on a row, or focus it and press Enter or Space, to open full details directly. In Progress items come first, then Not Started, then Done; each group is newest-updated first. Search and status filters preserve this order. Done items stay visible with quieter styling here and are hidden in the popup.
- **Save this page:** from a normal website, open the popup, click Save this page to a work item, choose an item, and save.
- **Right-click capture:** right-click a web page or link and choose Save to ReEntry. A new extension tab lets you choose the destination work item. Page captures use the page title and URL; link captures use the target URL as their initial title. Rename resources in Edit item.
- **Resources and steps:** add, edit, or remove them in the work item editor. Duplicate captured URLs are not added twice to the same item.

Only HTTP and HTTPS resources are accepted. Chrome settings pages, extension pages, local files, and other browser-internal URLs cannot be captured as resources.

## Small architecture

- `public/manifest.json`: Manifest V3 declaration, popup, module service worker, and the storage, activeTab, and contextMenus permissions. No host-wide permissions or content scripts.
- `popup.html` and `workspace.html`: Vite entry points for the compact popup and full extension page.
- `src/main.tsx`: React entry point.
- `src/App.tsx`: details, create/edit dialog, resource capture dialog, and workspace search/filter UI.
- `src/WorkInventory.tsx`: compact dashboard list rows, popup cards, and shared status/progress components.
- `src/presentation.ts`: shared status presentation classes and active-first ordering; no persistence changes.
- `src/styles.css`: responsive styling, compact scrollable popup, keyboard focus states, and local system fonts. Icons are bundled locally.
- `src/model.ts`: work item types, seed examples, URL validation, and immutable data operations.
- `src/background.ts`: the single storage writer. Serializes mutations from all views through a promise queue and handles context-menu captures.
- `src/storage.ts`: React subscription to storage changes and typed messaging to the service worker.
- `tests/`: model tests, mocked service-worker persistence/concurrency tests, and DOM interaction tests.

`chrome.storage.local` under `reentry.workItems.v1` is the only persistent data store. Examples are created only when this key is absent. Deleting every work item preserves the empty list and does not reseed. IDs and timestamps are generated locally. No backend, server database, Docker, authentication, analytics, or cloud services are used.

The service worker merges field patches into the latest stored item, so unrelated edits from multiple views compose. If two views edit the same field, the last saved value wins. Browser data is local to this Chrome profile and is removed when the extension is uninstalled; there is no cloud sync or export in this MVP.

## Checks

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd run format:check
```

Tests cover seeding, create/edit/delete, status, checklist changes, safe and duplicate resource handling, serialized writes, storage errors, preserving an intentionally empty list, and workspace interaction flows. DOM tests use a mocked Chrome API and do not replace a real Chrome extension smoke test.

Manual Chrome smoke test:

1. Resume Load Balancers, change its context, save, close and reopen the popup. Confirm persistence.
2. Toggle a checklist step. Open See all and confirm it agrees with the popup.
3. Create a work item with resources and steps. Search for it, edit it, mark it Done, and confirm it disappears only from the popup.
4. Save a website from the popup and then from its right-click menu. Confirm the resource belongs to the chosen item and opens correctly.
5. Delete a work item using the confirmation. If all work items are deleted, reopen the extension and confirm the empty state remains.

Browser automation was unavailable in the implementation environment; load the extension using the steps above to review its actual Chrome rendering and browser-specific behavior.
