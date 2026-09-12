import type { Command } from "./model";
import type { AuthCommand } from "./api";
import { createSessionService } from "./session-service";

// Tokens never travel to React views; account switches and requests are serialized.
let workerState = "initializing storage access";
let queue: Promise<unknown> = Promise.resolve().then(async () => {
  // Some Chromium versions expose local storage without this optional method.
  // ReEntry has no content scripts or script-injection permission; retain the
  // browser's extension-local defaults when the extra restriction is unavailable.
  if (typeof chrome.storage.local.setAccessLevel === "function") {
    await chrome.storage.local.setAccessLevel({
      accessLevel: "TRUSTED_CONTEXTS",
    });
  }
});
void queue.then(
  () => {
    workerState = "ready";
  },
  () => {
    workerState = "storage initialization failed";
  },
);
const service = createSessionService(chrome.storage.local, () => {
  void chrome.runtime
    .sendMessage({ channel: "reentry-update" })
    .catch(() => undefined);
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (
    sender.id !== chrome.runtime.id ||
    !sender.url?.startsWith(chrome.runtime.getURL("")) ||
    !["reentry", "reentry-auth", "reentry-diagnostic"].includes(
      message?.channel,
    )
  )
    return;
  // Deliberately bypass the queue: diagnostics must still answer if it is stuck.
  // Return no account information, credentials, request bodies, or stored data.
  if (message.channel === "reentry-diagnostic") {
    respond({ workerState });
    return;
  }
  const task = queue.then(async () => {
    workerState = "waiting for API or extension storage";
    try {
      return await (message.channel === "reentry-auth"
        ? { session: await service.auth(message.command as AuthCommand) }
        : { items: await service.work(message.command as Command) });
    } finally {
      workerState = "ready";
    }
  });
  queue = task.catch(() => undefined);
  task.then(
    (result) => respond(result),
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
