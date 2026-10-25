# Package loader

Status: implemented in `loader/` (`@cards/loader`)
Depends on: an Automerge repo, pnpm 12 (custom resolvers and fetchers in a `globalPnpmfile`), `@jspm/generator`, pushwork, `@inkandswitch/patchwork-bootloader` (service worker and handoff protocol), `@inkandswitch/patchwork-filesystem` (`resolvePath`, URL helpers)
Browser support: Chrome with multiple import maps (133 and later). Other browsers are out of scope for now.

## Summary

The package loader turns an Automerge URL into a live ES module. You ask it for a package by URL; it pins the package and every dependency to exact heads, adds an import map scope for that exact version, imports the entry module natively, and tells you when any part of that closure changes so you can pick up the new version. Applications build on it without knowing about import maps, heads, scopes, or the service worker.

Module bytes reach the browser through the service worker from `patchwork-next`: a request under the page origin whose first path segment is an encoded `automerge:` URL is handed off over a `BroadcastChannel`, answered by the tab that holds the repo, and cached by exact URL.

The loader has no knowledge of Cards. Cards' dealer is one consumer.

## Goals

- **One call to get a module.** `load(url)` returns the entry module of the package at `url`.
- **Live.** `watch(url)` delivers a new module whenever the package or anything it depends on changes.
- **Exact and cacheable.** Every module URL names exact bytes bound to exact dependency versions. Nothing is invalidated; a change is a new URL.
- **Shared dependencies.** Two packages that resolve a dependency to the same version load one copy.
- **Native loading.** The browser fetches, parses, and links modules. Workers, assets, and `import.meta.url` work as they do for any site.
- **No bundling.** Packages publish transpiled files with bare specifiers; resolution happens at load.
- **Types on disk.** A package's dependencies install into `node_modules` through pnpm, from the same documents the loader loads, and the lockfile is the single record of versions for both.

## Non-goals

- Compiling at load time. Packages are published already transpiled.
- Unloading. Old module instances remain until the page reloads. See [Known limitations](#known-limitations) for what keeps this possible later.
- Defining what a package exports. That's the consumer's contract; Cards defines `cards`.
- Browsers without multiple import maps.
- Access control or signing.

## Terminology

**Package**
: An Automerge document holding a published package: `package.json`, `dist/`, and `importmap.json`.

**Package dependency**
: A `package.json` dependency whose specifier is an `automerge:` URL. Resolved by pnpm through a custom resolver and by the loader through pinning.

**Lockfile**
: `pnpm-lock.yaml`. Records exact versions for npm dependencies and exact heads for package dependencies. The import map is derived from it.

**Closure**
: A package and, transitively, every package its import map references.

**Pinned URL**
: A same-origin URL prefix made from a package URL, its heads, and a digest of its closure's heads. The identity of a loaded module graph.

**Scope**
: An import map `scopes` entry keyed by a pinned URL prefix, holding that version's resolved mappings.

**Environment**
: Bare specifiers the host page provides and that packages must not bring their own copy of.

**Responder**
: The code in the tab that answers the service worker's handoff requests from the repo.

## API

```ts
type Loader = {
  // the entry module of the package at `url`, at its current heads
  load<M = unknown>(url: AutomergeUrl): Promise<M>;
  // calls back with the entry module now and again whenever the package or any dependency changes
  watch<M = unknown>(
    url: AutomergeUrl,
    callback: (module: M) => void,
  ): () => void;
};

type LoaderOptions = {
  repo: Repo;
  environment: ImportMap; // installed once; for example solid-js and @automerge/*
  debounce?: number; // ms to wait after a heads change before reloading; default 300
  onError?: (error: Error, url: AutomergeUrl) => void; // default: console.error
};

function createLoader(options: LoaderOptions): Loader;
```

`load` rejects if the package can't be loaded. `watch` reports a failed first load or reload through `onError` and keeps watching; the callback is only ever called with a module that loaded. The returned function stops the watch.

### Ownership

When the callback is called with a new module, the consumer must stop using the previous one and anything reachable from it before the call returns. The loader doesn't enforce this; it's what lets unloading be added later without changing consumers.

## Design

### Pinning

Given `url`, the loader:

1. Finds the handle and reads its heads.
2. Reads `importmap.json` and `package.json` from the document at those heads, directly from the repo.
3. For each package URL in the map, repeats steps 1 to 3, building `closure`.
4. Computes `digest = hash(closure, sorted)` and the pinned prefix:

   ```
   /<encodeURIComponent("automerge:<id>#<heads>")>@<digest>/
   ```

Up to the `@`, the first segment is the form `getImportableUrlFromAutomergeUrl` produces and the service worker recognizes. The `@<digest>` suffix carries no information for resolving a file. It exists so that a change anywhere in the closure produces a new prefix even when the package's own heads didn't change. The browser's module map, import map scopes, and the service worker cache are all keyed by URL; without the digest, a loaded module would keep importing the old version of a dependency. `@` is never produced by `encodeURIComponent`, so the suffix is unambiguous.

Pinned prefixes are memoized. Asking for the same closure twice yields the same prefix and the same module instance.

### Import map scopes

For each pinned package, the loader appends one import map to the document:

```ts
const script = document.createElement("script");
script.type = "importmap";
script.textContent = JSON.stringify({ scopes: { [pinned]: resolved } });
document.head.append(script);
```

`resolved` is the package's `importmap.json` `imports`, with each package entry (`/automerge%3A<dep>/…`, without heads) rewritten to the dependency's own pinned prefix (`/automerge%3A<dep>%23<heads>@<digest>/…`) and CDN URLs left as they are. Any `scopes` the generator emitted for conflicting transitive CDN versions pass through unchanged.

Chrome merges multiple import maps and ignores, with a console warning, any entry that would change the resolution of a specifier that has already been resolved. Scopes here are only ever added, and a prefix is unique to a version-plus-closure, so a new scope never conflicts with a resolved specifier. Relative imports inside a package resolve under the same prefix and inherit the scope.

The environment is the single top-level `imports` block. `createLoader` appends it as the first import map, before any scope and before anything is imported through it. Package maps never contain environment specifiers (the generator is run with `inputMap` and `ignore` for them at publish), so a dependency that imports `solid-js` gets the page's copy.

The environment must map to the host's own module instances, not to copies. With Vite, the `loader()` plugin from `@cards/loader/vite` does this. You give it each specifier and the module the app imports it as, and it emits `/environment/<specifier>.js` re-exporting that module, so the page and its packages share one instance. The plugin also serves the service worker at `/service-worker.js`. Its `virtual:loader/environment` module is the import map to pass as `environment`:

```ts
// vite.config.ts
loader({ "solid-js": "solid-js", "@cards/core": "@cards/core" });

// main.tsx
import environment from "virtual:loader/environment";
const loader = createLoader({ repo, environment });
```

### Fetching

The service worker is `@inkandswitch/patchwork-bootloader/service-worker`, bundled into one file (it imports its handoff constants), emitted as `/service-worker.js`, and registered by `createLoader`. It is used unchanged. The loader waits until the page is controlled before its first import. A hard reload bypasses an active service worker for that page load and the worker won't claim the page again, so in that case the loader reloads the page once. For a same-origin request whose first path segment decodes to an `automerge:` URL, it checks its cache, and on a miss broadcasts a handoff request on `HANDOFF_CHANNEL` and waits for a reply. Everything else passes through to the network and is cached opportunistically, which is what makes CDN dependencies available offline after first use.

The responder runs in the tab, next to the repo, and listens on the same channel. It's written here rather than taken from `patchwork-next`, whose responder lives inside its automerge SharedWorker and doesn't know the `@<digest>` suffix. For each request it:

1. Parses the handoff URL into `automerge:<id>#<heads>` and a path.
2. Rejects a URL without heads. The loader never issues one; a headless module URL would be memoized by the browser under its first redirect and could never update.
3. Drops the `@<digest>` suffix from the first segment.
4. Waits for the heads to be present locally, then resolves the path with `resolvePath(repo, handle.view(heads), path)`.
5. Writes the response into the service worker's cache under the original request and replies `cached`, or replies with an inline error.

On startup the responder broadcasts `online`, so the service worker re-sends requests that raced the tab's boot. With several tabs open every tab answers; the first `cache.put` wins and the others are redundant.

Because the service worker gives package files real URLs, `new Worker(new URL("./worker.js", import.meta.url))`, `fetch()` of a package asset, and CSS `url()` all work with no extra machinery. `import.meta.url` is the pinned URL. A package can recover its own identity, without heads, from it:

```ts
export function packageUrl(moduleUrl: string): AutomergeUrl {
  const [segment] = new URL(moduleUrl).pathname.split("/")[1].split("@");
  return decodeURIComponent(segment).split("#")[0] as AutomergeUrl;
}
```

### Entry resolution

The entry is `package.json` `exports["."]` or `main`, resolved with `resolvePackageExport` from `@inkandswitch/patchwork-filesystem` under the conditions `["browser", "import", "default"]`. `load` calls `import(pinned + entry)`.

A failed `import()` is memoized by the browser against its URL. The loader retries once under the same URL with a `?retry=1` query, as `importModule` in `patchwork-filesystem` does; the service worker and responder ignore the query when resolving.

### Change tracking

For every handle in a watched closure, the loader listens to `heads-changed`. On a change it waits `debounce` ms (a `pushwork sync` commits a burst), then re-pins. If the resulting prefix differs from the one the current module was loaded under, it adds the new scope, imports the new entry, and calls the callback with the new module. Handles that drop out of the closure are unsubscribed; new ones are subscribed.

Old modules are not unloaded. Once the consumer drops them, they are unreachable for the page's lifetime. Memory grows with the number of distinct closures loaded in one session, which is bounded by how often packages change while a page is open.

### Publishing

The loader reads what the publish pipeline writes. A package folder publishes with:

```
pnpm install                       # npm from the registry, package dependencies from the repo
babel src --out-dir dist           # TS → JS, Solid JSX → DOM calls; no bundling
tsc                                # type check, and dist/*.d.ts for dependents
cards-importmap                    # importmap.json, derived from the lockfile
pushwork sync                      # publish the folder as a package document
```

Only `cards-importmap` comes from the loader, as the bin of `@cards/loader`. The rest is the package's own `build` script and configs: Babel with the Solid preset (`generate: "dom"`) and the TypeScript preset, file by file, and a `tsconfig.json` that emits declarations only. `pushwork init` replaces `sync` the first time.

Pinning reads `package.json` and `importmap.json` at the root's heads, and the responder serves `dist/` at them, so these must be exact bytes at those heads. The package's `.pushworkattributes` marks them as artifacts, which pushwork stores immutably and links with heads in the root document:

```
dist/**         artifact
package.json    artifact
importmap.json  artifact
```

Everything else, such as `src/` and the configs, is linked without heads.

#### Installing package dependencies

A package dependency is written as an `automerge:` URL:

```json
"dependencies": { "shapes": "automerge:3RFhQ8vNwJmU7Ki5yX2bHdLpTcE9" }
```

`loader/tools/pnpmfile.cjs` registers a resolver and a fetcher for that scheme. It is meant as pnpm's `globalPnpmfile`, which runs for every project ahead of the project's own, so a package folder needs no pnpmfile and no workspace; pnpm leaves it out of the lockfile's `pnpmfileChecksum`. The resolver opens a Node repo (storage in `~/.cache/cards/repo`, or under `$CARDS_CACHE`, plus the Subduction endpoint, as pushwork does), shared by every project on the machine, and finds the document. A Node repo answers from its storage first, which can hold heads from an earlier session, so the resolver waits until the document is current with the sync server: its synced heads are present locally and either arrived during this lookup or have stopped changing. It returns `{ id: "<alias>@<version>+<headsId>", resolution: { type: "custom:automerge", url, heads }, manifest }`, where `version` is read from the document's `package.json`, `heads` are the document's current heads, and `headsId` is a short hash of them. pnpm keys its store by `id`, so without the heads in it a republished package with an unchanged version would never be fetched again.

The fetcher views the document at those heads, walks it with `resolvePath`, writes the files to `~/.cache/cards/store/<id>@<heads>/`, and returns `{ delegate: { type: "directory", directory } }`. pnpm then treats it as a directory dependency: it imports the files into `node_modules/<alias>`, including `dist/*.d.ts`, and writes `url` and `heads` to the lockfile.

A frozen install reproduces the exact package. A plain `pnpm install` re-resolves when `shouldRefreshResolution` says the heads have moved, so dependencies advance when you ask them to and not otherwise. pnpm skips resolution entirely when the lockfile and manifests haven't changed, which would also skip that check, so the global pnpm config sets `optimisticRepeatInstall: false`.

The hooks run in a process pnpm 12 ends when the install is done. Older pnpm runs them in its own process, where the resolver's open sync connection keeps it alive after the install, so packages pin pnpm 12 with `packageManager`.

The alias is free. Nothing keys on a name or a scope; a dependency is a document.

#### Generating the import map

`cards-importmap` reads `pnpm-lock.yaml` (the document with `settings`; pnpm 12 writes its own toolchain into a first YAML document) and never resolves a version on its own:

- **Package dependencies** (lock entries with `resolution.type === "custom:automerge"`) go into the map directly as `/automerge%3A<id>/<entry>`, the same same-origin form the service worker serves, with `<entry>` from the installed copy's `package.json`. They are passed to the generator through `inputMap` and `ignore`, so it never traces them. Tracing isn't needed: a package dependency publishes its own `importmap.json`, and the loader installs that scope when it pins the dependency. The entry has no heads; the loader pins it.
- **The environment** is passed the same way, so a dependency that imports `solid-js` gets the page's copy.
- **npm dependencies** are installed through the generator at the exact versions in the lock (`name@version`), against `jspm.io`. The lock's transitive graph is passed as `resolutions`, so the CDN graph matches `node_modules` wherever a name resolves to one version. `flattenScopes: false` keeps the generator's per-package scopes.

The published map is relative to whatever origin loads it. That's fine: only the loader consumes it, and the loader runs on the origin the service worker is registered for.

### Package conventions

These keep packages replaceable, which is what live reloading and any future unloading depend on.

- A module exports values and functions. Effects (listeners, DOM, workers, global registrations) happen inside lifetimes the consumer controls, and anything with teardown is paired with a dispose.
- Packages reach the environment only through bare specifiers, never through globals.
- CSS is attached and detached by the consumer (for example with `adoptedStyleSheets`), not appended at import.

## Example

Package `lines` depends on the `shapes` package document and on `maplibre-gl`.

```json
{
  "name": "lines",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": "./dist/index.js" },
  "types": "./dist/index.d.ts",
  "dependencies": {
    "shapes": "automerge:3RFhQ8vNwJmU7Ki5yX2bHdLpTcE9",
    "maplibre-gl": "^5.6.0"
  },
  "peerDependencies": { "solid-js": "*", "@automerge/automerge-repo": "*" }
}
```

After `pnpm install`, the lockfile holds `shapes` at `{ url, heads: [S1] }` and `maplibre-gl` at `5.6.0`. Generated `importmap.json`:

```json
{
  "imports": {
    "shapes": "/automerge%3A3RFhQ8vNwJmU7Ki5yX2bHdLpTcE9/dist/index.js",
    "maplibre-gl": "https://ga.jspm.io/npm:maplibre-gl@5.6.0/dist/maplibre-gl.js"
  }
}
```

Consumer:

```ts
const loader = createLoader({ repo, environment });
let dispose: (() => void) | undefined;
const stop = loader.watch<{ cards: CardDescriptor[] }>(linesUrl, (module) => {
  dispose?.();
  dispose = setup(module.cards);
});
```

On the first load the loader pins `lines@L1` with closure `{ shapes: S1 }`, appends an import map with a scope under `/automerge%3A…lines%23L1@d1/`, and imports the entry. The browser requests `…L1@d1/dist/index.js`; the service worker hands it off; the responder serves it from the document at `L1`. When `shapes` republishes at `S2`, the digest changes to `d2`; the loader appends a scope under `…lines%23L1@d2/` mapping `shapes` to `…shapes%23S2@d3/dist/index.js`, imports the entry again, and calls the callback with the new module. The `lines` bytes served under `@d1` and `@d2` are identical; both stay cached.

## Known limitations

**Transitive CDN versions can differ across workspaces.** Within one workspace every map derives from the same lockfile, so shared transitive dependencies agree. Packages published from different workspaces may pin the same transitive to different versions under the generator's `https://ga.jspm.io/` scope; Chrome keeps the first mapping it saw and warns. A provider whose modules import transitives by absolute URL (`esm.sh`) would remove the shared scope entirely, at the cost of switching CDN.

**Duplicate versions of one name aren't aligned.** `resolutions` is flat (`name → version`). Where pnpm installed two versions of a name, the generator picks per its own rules and the CDN graph can differ from `node_modules` for that name. This affects which transitive the browser loads, not types.

**A publish can reload a watched package twice.** `pushwork sync` commits the files, then stamps `lastSyncAt` on the root document about a second later. Both change the root's heads, so if the gap is longer than `debounce` the callback runs twice, with identical bytes under two prefixes.

**Adopted stylesheets cascade after the document's.** A package that attaches its CSS with `adoptedStyleSheets`, as the conventions ask, wins ties against the host's stylesheets. Host rules that style a package's elements need higher specificity.

**Modules are never unloaded.** A module can't be removed from the realm it was loaded into, so old closures stay in memory until the page reloads. Real unloading would mean a disposable realm per closure (an iframe, or a `ShadowRealm` later) with the environment bridged in. The design keeps that possible as long as the environment is reached only through the import map, consumers follow the [ownership](#ownership) rule, and packages follow the [conventions](#package-conventions) above.

## Alternatives considered

**es-module-shims in shim mode.** Dynamic import maps on every browser and a `fetch` hook that reads the repo directly, with no service worker on the module path. Rejected because every module is then fetched, rewritten, and loaded from a blob URL by the shim, and because workers and assets still need real URLs, so the service worker comes back anyway. Native loading plus Chrome's multiple import maps gives the same result with the browser doing the work.

**Serve-time specifier rewriting.** Resolve dependencies in the responder while serving each file. Keeps native loading without import maps, but recomputes per request, and the result isn't addressable by an exact URL.

**Bundling.** Simplest loading, but no shared dependencies and no in-place dependency updates. A package may still bundle internally; the loader doesn't care.

**Headless URLs in the map.** Freeze at first import, because the browser memoizes a module under its request URL after the redirect. Every URL the loader installs is pinned.
