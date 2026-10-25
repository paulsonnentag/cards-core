import {
  parseAutomergeUrl,
  stringifyAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
  type UrlHeads,
} from "@automerge/automerge-repo";
import {
  resolvePackageExport,
  resolvePath,
} from "@inkandswitch/patchwork-filesystem";
import type { ImportMap } from "./importmap";
import { packagePath, pinnedPrefix } from "./urls";

// a package and its closure, each at exact heads
export type Pinned = {
  prefix: string; // the package's pinned prefix
  entry: string; // its entry module, relative to the prefix
  maps: Map<string, ImportMap>; // the scope of every package in the closure, by pinned prefix
  handles: DocHandle<unknown>[]; // every package in the closure
};

type Version = {
  url: AutomergeUrl;
  heads: UrlHeads;
  files: Files;
  dependencies: AutomergeUrl[]; // the packages its import map references
};
type Files = { packageJson: Record<string, any>; importMap: ImportMap };

const CONDITIONS = ["browser", "import", "default"];

// Pins `url` and everything it depends on to the heads they have now. `found` sees every handle as it's found, so
// a caller can follow a closure that doesn't load yet.
export function createPinner(repo: Repo) {
  const files = new Map<AutomergeUrl, Promise<Files>>(); // by pinned url: what's at exact heads never changes

  return async function pin(
    url: AutomergeUrl,
    found?: (handle: DocHandle<unknown>) => void,
  ): Promise<Pinned> {
    const handles: DocHandle<unknown>[] = [];
    const versions = await closureOf(url, (handle) => {
      handles.push(handle);
      found?.(handle);
    });
    const prefixes = new Map<AutomergeUrl, string>();
    for (const version of versions.values())
      prefixes.set(
        version.url,
        pinnedPrefix(
          version.url,
          version.heads,
          await digest(reachable(version, versions)),
        ),
      );
    return {
      prefix: prefixes.get(url)!,
      entry: entryOf(versions.get(url)!.files.packageJson),
      maps: new Map(
        [...versions.values()].map((v) => [
          prefixes.get(v.url)!,
          scopeOf(v, prefixes),
        ]),
      ),
      handles,
    };
  };

  async function closureOf(
    url: AutomergeUrl,
    found: (handle: DocHandle<unknown>) => void,
  ): Promise<Map<AutomergeUrl, Version>> {
    const reads = new Map<AutomergeUrl, Promise<Version>>();
    const visit = async (url: AutomergeUrl): Promise<void> => {
      if (reads.has(url)) return;
      const read = versionOf(url, found);
      reads.set(url, read);
      await Promise.all((await read).dependencies.map(visit));
    };
    await visit(url);
    const versions = new Map<AutomergeUrl, Version>();
    for (const [url, read] of reads) versions.set(url, await read);
    return versions;
  }

  async function versionOf(
    url: AutomergeUrl,
    found: (handle: DocHandle<unknown>) => void,
  ): Promise<Version> {
    const handle = await repo.find<unknown>(url);
    found(handle);
    const heads = handle.heads();
    const pinned = stringifyAutomergeUrl({
      documentId: parseAutomergeUrl(url).documentId,
      heads,
    });
    if (!files.has(pinned)) files.set(pinned, filesAt(handle.view(heads)));
    const read = await files.get(pinned)!.catch((error) => {
      files.delete(pinned);
      throw error;
    });
    const dependencies = Object.values(read.importMap.imports ?? {})
      .map((target) => packagePath(target)?.url)
      .filter((dep): dep is AutomergeUrl => dep !== undefined);
    return {
      url,
      heads,
      files: read,
      dependencies: [...new Set(dependencies)],
    };
  }

  async function filesAt(view: DocHandle<unknown>): Promise<Files> {
    const packageJson = await readJson(view, "package.json");
    if (!packageJson) throw new Error(`${view.url} has no package.json`);
    const importMap = (await readJson(view, "importmap.json")) ?? {};
    return { packageJson, importMap };
  }

  async function readJson(view: DocHandle<unknown>, path: string) {
    const file = await resolvePath(repo, view, [path]);
    if (!file) return undefined;
    return JSON.parse(
      typeof file.content === "string"
        ? file.content
        : new TextDecoder().decode(file.content),
    );
  }
}

// the closure of `version`: itself and everything it reaches
function reachable(
  version: Version,
  versions: Map<AutomergeUrl, Version>,
): Version[] {
  const seen = new Map<AutomergeUrl, Version>();
  const visit = (v: Version) => {
    if (seen.has(v.url)) return;
    seen.set(v.url, v);
    for (const dep of v.dependencies) visit(versions.get(dep)!);
  };
  visit(version);
  return [...seen.values()];
}

async function digest(closure: Version[]): Promise<string> {
  const text = closure
    .map((v) => `${v.url}#${[...v.heads].sort().join("|")}`)
    .sort()
    .join("\n");
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(hash).slice(0, 8)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// the package's import map with every package entry moved under that dependency's pinned prefix
function scopeOf(
  version: Version,
  prefixes: Map<AutomergeUrl, string>,
): ImportMap {
  const { imports = {}, scopes = {} } = version.files.importMap;
  const resolved: Record<string, string> = {};
  for (const [specifier, target] of Object.entries(imports)) {
    const dep = packagePath(target);
    resolved[specifier] = dep ? prefixes.get(dep.url)! + dep.rest : target;
  }
  return { scopes: { ...scopes, [prefixes.get(version.url)!]: resolved } };
}

function entryOf(packageJson: Record<string, any>): string {
  return resolvePackageExport(packageJson, ".", CONDITIONS).replace(
    /^\.\//,
    "",
  );
}
