#!/usr/bin/env node
// cards-importmap [packageDir]: writes the package's importmap.json from pnpm-lock.yaml
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolvePackageExport } from "@inkandswitch/patchwork-filesystem";
import { Generator, type Install } from "@jspm/generator";
import type { ImportMap } from "../src/importmap.ts";
import { parseAllDocuments } from "yaml";

const CONDITIONS = ["browser", "import", "default"];

type Lockfile = {
  importers?: Record<
    string,
    { dependencies?: Record<string, { version: string }> }
  >;
  packages?: Record<string, { resolution?: { type?: string; url?: string } }>;
  snapshots?: Record<string, { dependencies?: Record<string, string> }>;
};

if (import.meta.main) {
  await generateImportMap(process.argv[2] ?? ".");
  process.exit(0);
}

// Never resolves a version on its own: package dependencies map to the same-origin form the service worker serves,
// without heads (the loader pins them), and npm dependencies install from jspm.io at the versions in the lock. The
// environment is the package's peerDependencies, which the page provides.
export async function generateImportMap(dir: string) {
  const packageDir = path.resolve(dir);
  const lockfileDir = workspaceRoot(packageDir);
  const lock = await readLockfile(lockfileDir);
  const manifest = JSON.parse(
    await readFile(path.join(packageDir, "package.json"), "utf8"),
  );
  const importer =
    lock.importers?.[path.relative(lockfileDir, packageDir) || "."];
  const environment = Object.keys(manifest.peerDependencies ?? {});

  const packages: Record<string, string> = {};
  const npm: Install[] = [];
  for (const [alias, { version }] of Object.entries(
    importer?.dependencies ?? {},
  )) {
    const key = lockKey(alias, version);
    const resolution = lock.packages?.[key]?.resolution;
    if (resolution?.type === "custom:automerge")
      packages[alias] = await packageEntry(packageDir, alias, resolution.url!);
    else npm.push({ alias, target: key });
  }

  const generator = new Generator({
    env: ["browser", "module", "production"],
    defaultProvider: "jspm.io",
    inputMap: { imports: packages },
    ignore: (specifier) =>
      specifier in packages ||
      environment.some((e) => specifier === e || specifier.startsWith(`${e}/`)),
    resolutions: resolutionsOf(lock, npm),
    flattenScopes: false,
  });
  if (npm.length > 0) await generator.install(npm);
  const generated = generator.getMap();
  const map: ImportMap = {
    imports: { ...generated.imports, ...packages },
    ...(generated.scopes && Object.keys(generated.scopes).length > 0
      ? { scopes: generated.scopes }
      : {}),
  };
  await writeFile(
    path.join(packageDir, "importmap.json"),
    `${JSON.stringify(map, null, 2)}\n`,
  );
  return map;
}

// pnpm 12 writes the lockfile of its own installation first, as a document of its own
async function readLockfile(lockfileDir: string): Promise<Lockfile> {
  const documents = parseAllDocuments(
    await readFile(path.join(lockfileDir, "pnpm-lock.yaml"), "utf8"),
  ).map((d) => d.toJS() as Lockfile & { settings?: unknown });
  return documents.find((d) => d.settings) ?? documents.at(-1)!;
}

// `/automerge%3A<id>/<entry>`, with the entry from the installed copy
async function packageEntry(packageDir: string, alias: string, url: string) {
  const installed = JSON.parse(
    await readFile(
      path.join(packageDir, "node_modules", alias, "package.json"),
      "utf8",
    ),
  );
  const entry = resolvePackageExport(installed, ".", CONDITIONS);
  return `/${encodeURIComponent(url)}/${entry.replace(/^\.\//, "")}`;
}

// the lock's transitive npm graph, name -> version, so the CDN resolves what node_modules has
function resolutionsOf(
  lock: Lockfile,
  roots: Install[],
): Record<string, string> {
  const resolutions: Record<string, string> = {};
  const queue = roots.map((r) => r.target as string);
  for (let key = queue.shift(); key; key = queue.shift()) {
    const { name, version } = nameAndVersion(key);
    if (name in resolutions) continue;
    resolutions[name] = version;
    const snapshot =
      lock.snapshots?.[key] ?? lock.snapshots?.[withoutPeers(key)];
    for (const [dep, depVersion] of Object.entries(
      snapshot?.dependencies ?? {},
    ))
      queue.push(lockKey(dep, depVersion));
  }
  return resolutions;
}

// a dependency's key in `packages`: `name@version`, or the version itself when it names a package (an alias, or a
// custom resolution's id)
function lockKey(alias: string, version: string): string {
  const bare = withoutPeers(version);
  return bare.lastIndexOf("@") > 0 ? bare : `${alias}@${bare}`;
}

function withoutPeers(version: string): string {
  return version.replace(/\(.*$/, "");
}

function nameAndVersion(key: string) {
  const at = withoutPeers(key).lastIndexOf("@");
  return { name: key.slice(0, at), version: withoutPeers(key).slice(at + 1) };
}

function workspaceRoot(dir: string): string {
  for (let d = dir; d !== path.dirname(d); d = path.dirname(d))
    if (existsSync(path.join(d, "pnpm-lock.yaml"))) return d;
  throw new Error(`no pnpm-lock.yaml above ${dir}`);
}
