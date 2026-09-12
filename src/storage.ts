import { useEffect, useState } from "react";
import type { WorkItem } from "./model";
import { request, subscribe } from "./transport";
export { request } from "./transport";
// Compatibility facade for existing views; no direct storage dependency.
export function useWorkItems() {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true,
      version = 0;
    async function refresh() {
      const current = ++version;
      try {
        const value = await request({ type: "list" });
        if (active && current === version) {
          setItems(value);
          setError("");
        }
      } catch (e) {
        if (active && current === version) setError((e as Error).message);
      } finally {
        if (active && current === version) setLoading(false);
      }
    }
    void refresh();
    const unsubscribe = subscribe(() => void refresh());
    const focused = () => {
      if (document.visibilityState !== "hidden") void refresh();
    };
    const interval = setInterval(focused, 15000);
    window.addEventListener("focus", focused);
    document.addEventListener("visibilitychange", focused);
    return () => {
      active = false;
      unsubscribe();
      clearInterval(interval);
      window.removeEventListener("focus", focused);
      document.removeEventListener("visibilitychange", focused);
    };
  }, []);
  return { items, loading, error };
}
