import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo";
import { addImportMap, type ImportMap } from "./importmap";
import { createPinner, type Pinned } from "./pin";
import { startResponder } from "./responder";
import { registerServiceWorker } from "./service-worker";

export type Loader = {
  // the entry module of the package at `url`, at its current heads
  load<M = unknown>(url: AutomergeUrl): Promise<M>;
  // calls back with the entry module now and again whenever the package or any dependency changes
  watch<M = unknown>(
    url: AutomergeUrl,
    callback: (module: M) => void,
  ): () => void;
};

export type LoaderOptions = {
  repo: Repo;
  environment: ImportMap; // installed once; for example solid-js and @automerge/*
  debounce?: number; // ms to wait after a heads change before reloading; default 300
  onError?: (error: Error, url: AutomergeUrl) => void; // default: console.error
};

export function createLoader({
  repo,
  environment,
  debounce = 300,
  onError = (error, url) => console.error(`couldn't load ${url}`, error),
}: LoaderOptions): Loader {
  addImportMap(environment);
  startResponder(repo);
  const controlled = registerServiceWorker("/service-worker.js");
  const pin = createPinner(repo);
  const scoped = new Set<string>(); // pinned prefixes whose scope is on the page
  const modules = new Map<string, Promise<unknown>>(); // by pinned prefix

  return {
    load: async <M>(url: AutomergeUrl) =>
      (await importPinned(await pin(url))) as M,
    watch,
  };

  function watch<M>(url: AutomergeUrl, callback: (module: M) => void) {
    const followed = new Map<AutomergeUrl, DocHandle<unknown>>();
    let current: string | undefined; // the prefix the callback's module was loaded under
    let latest = 0; // the newest reload; an older one that finishes later is dropped
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const changed = () => {
      clearTimeout(timer);
      timer = setTimeout(reload, debounce);
    };
    void reload();
    return () => {
      stopped = true;
      clearTimeout(timer);
      for (const handle of followed.values())
        handle.off("heads-changed", changed);
      followed.clear();
    };

    async function reload() {
      const run = ++latest;
      try {
        const pinned = await pin(url, follow);
        if (stopped || run !== latest) return;
        unfollowOutside(pinned);
        if (pinned.prefix === current) return;
        const module = await importPinned(pinned);
        if (stopped || run !== latest) return;
        current = pinned.prefix;
        callback(module as M);
      } catch (error) {
        if (!stopped)
          onError(
            error instanceof Error ? error : new Error(String(error)),
            url,
          );
      }
    }

    function follow(handle: DocHandle<unknown>) {
      if (stopped || followed.has(handle.url)) return;
      followed.set(handle.url, handle);
      handle.on("heads-changed", changed);
    }

    // handles that dropped out of the closure
    function unfollowOutside(pinned: Pinned) {
      const inside = new Set(pinned.handles.map((h) => h.url));
      for (const [url, handle] of followed) {
        if (inside.has(url)) continue;
        handle.off("heads-changed", changed);
        followed.delete(url);
      }
    }
  }

  // one module instance per pinned prefix; a failed import is memoized by the browser, so it stays failed
  function importPinned(pinned: Pinned): Promise<unknown> {
    if (!modules.has(pinned.prefix))
      modules.set(
        pinned.prefix,
        controlled.then(() => {
          for (const [prefix, map] of pinned.maps) {
            if (scoped.has(prefix)) continue;
            scoped.add(prefix);
            addImportMap(map);
          }
          return importOnce(pinned.prefix + pinned.entry);
        }),
      );
    return modules.get(pinned.prefix)!;
  }
}

// a failed import() is memoized against its url; the query gives the retry a url of its own
async function importOnce(url: string): Promise<unknown> {
  try {
    return await import(/* @vite-ignore */ url);
  } catch {
    return await import(/* @vite-ignore */ `${url}?retry=1`);
  }
}
