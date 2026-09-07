import { useEffect, useState } from "react";
import { STORAGE_KEY, type Command, type WorkItem } from "./model";
export async function request(command: Command): Promise<WorkItem[]> {
  if (!globalThis.chrome?.runtime?.id)
    throw new Error(
      "Load the dist folder in Chrome Extensions to use ReEntry. Browser previews cannot access extension storage.",
    );
  const response = await chrome.runtime.sendMessage({
    channel: "reentry",
    command,
  });
  if (!response || response.error)
    throw new Error(
      response?.error ||
        "ReEntry did not respond. Reload the extension and try again.",
    );
  return response.items;
}
export function useWorkItems() {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === "local" && changes[STORAGE_KEY] && active)
        setItems(changes[STORAGE_KEY].newValue ?? []);
    };
    globalThis.chrome?.storage?.onChanged.addListener(listener);
    request({ type: "list" })
      .then((value) => {
        if (active) setItems(value);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      globalThis.chrome?.storage?.onChanged.removeListener(listener);
    };
  }, []);
  return { items, loading, error };
}
