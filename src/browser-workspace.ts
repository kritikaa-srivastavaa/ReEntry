import { safeUrl, type WorkspaceLink } from "./model";

export interface TabChoice extends WorkspaceLink {
  id: number;
}
export function selectableTabs(tabs: chrome.tabs.Tab[]) {
  const seen = new Set<string>();
  const choices: TabChoice[] = [];
  let skipped = 0;
  for (const tab of [...tabs].sort((a, b) => a.index - b.index)) {
    const raw = tab.pendingUrl || tab.url;
    if (!raw || !safeUrl(raw) || tab.id === undefined || raw.length > 8192) {
      skipped++;
      continue;
    }
    const url = new URL(raw).href;
    if (seen.has(url)) {
      skipped++;
      continue;
    }
    seen.add(url);
    choices.push({ id: tab.id, title: (tab.title || url).slice(0, 2000), url });
  }
  return { choices, skipped };
}
// Called only from explicit user actions, never on load or from a tab listener.
async function tabAccess() {
  if (!globalThis.chrome?.runtime?.id || !chrome.permissions?.request)
    throw new Error(
      "Use the installed ReEntry extension to capture or reopen browser tabs.",
    );
  if (!(await chrome.permissions.request({ permissions: ["tabs"] })))
    throw new Error(
      "Tab access was not granted. Try again and allow access to choose your workspace tabs.",
    );
}
export async function currentWorkspaceTabs() {
  await tabAccess();
  try {
    return selectableTabs(await chrome.tabs.query({ currentWindow: true }));
  } catch {
    throw new Error("Unable to load browser tabs. Try Save Workspace again.");
  }
}
export async function resumeWorkspace(links: WorkspaceLink[]) {
  if (!links.length)
    throw new Error("Select at least one saved tab to resume.");
  if (links.length > 50) throw new Error("Open up to 50 tabs at a time.");
  await tabAccess();
  let current: chrome.tabs.Tab[];
  try {
    current = await chrome.tabs.query({ currentWindow: true });
  } catch {
    throw new Error(
      "Unable to inspect the current window. Try Resume Work again.",
    );
  }
  const existing = new Set(
    current.flatMap((tab) => {
      const raw = tab.pendingUrl || tab.url;
      return raw && safeUrl(raw) ? [new URL(raw).href] : [];
    }),
  );
  let opened = 0,
    alreadyOpen = 0,
    failed = 0;
  const attempted = new Set<string>();
  for (const link of links) {
    if (!safeUrl(link.url)) {
      failed++;
      continue;
    }
    const url = new URL(link.url).href;
    if (attempted.has(url)) continue;
    attempted.add(url);
    if (existing.has(url)) {
      alreadyOpen++;
      continue;
    }
    try {
      await chrome.tabs.create({
        url,
        active: false,
        ...(current[0]?.windowId !== undefined
          ? { windowId: current[0].windowId }
          : {}),
      });
      existing.add(url);
      opened++;
    } catch {
      failed++;
    }
  }
  return { opened, alreadyOpen, failed };
}
