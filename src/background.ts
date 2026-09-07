import {
  applyCommand,
  seedItems,
  STORAGE_KEY,
  type Command,
  type WorkItem,
} from "./model";

// A single writer serializes read/modify/write operations across extension views.
let queue: Promise<unknown> = Promise.resolve();
async function execute(command: Command) {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const items: WorkItem[] = stored[STORAGE_KEY] ?? seedItems();
  const next = applyCommand(items, command);
  if (stored[STORAGE_KEY] === undefined || command.type !== "list")
    await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.channel !== "reentry") return;
  const task = queue.then(() => execute(message.command as Command));
  queue = task.catch(() => undefined);
  task.then(
    (items) => respond({ items }),
    (error) =>
      respond({
        error:
          error instanceof Error
            ? error.message
            : "Unable to save your changes.",
      }),
  );
  return true;
});
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "save-reentry",
      title: "Save to ReEntry",
      contexts: ["page", "link"],
      documentUrlPatterns: ["http://*/*", "https://*/*"],
    });
  });
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "save-reentry") return;
  const params = new URLSearchParams({
    saveUrl: info.linkUrl || info.pageUrl,
    saveTitle: info.linkUrl ? info.linkUrl : tab?.title || info.pageUrl,
  });
  void chrome.tabs.create({
    url: chrome.runtime.getURL(`workspace.html?${params}`),
  });
});
