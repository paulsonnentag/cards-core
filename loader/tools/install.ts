import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
  isImmutableString,
  isValidAutomergeUrl,
  parseAutomergeUrl,
  stringifyAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
  type UrlHeads,
} from "@automerge/automerge-repo";
import { resolvePath } from "@inkandswitch/patchwork-filesystem";
import { findCurrent, openRepo } from "./repo.ts";

// what the lockfile records for a package dependency
export type AutomergeResolution = {
  type: "custom:automerge";
  url: AutomergeUrl;
  heads: UrlHeads;
};

// shared by every project on the machine: the synced documents, and the files of each version fetched
const CACHE =
  process.env.CARDS_CACHE ?? path.join(homedir(), ".cache", "cards");

// A specifier without heads resolves to the document's current heads. The heads are in the id, so pnpm fetches
// again when they move.
export async function resolve(alias: string, specifier: AutomergeUrl) {
  const repo = await cachedRepo();
  const { documentId, heads: wanted } = parseAutomergeUrl(specifier);
  const url = stringifyAutomergeUrl({ documentId });
  const handle = await findCurrent(repo, url);
  const heads = wanted ?? handle.heads();
  const manifest = await readJson(repo, handle.view(heads), "package.json");
  if (!manifest) throw new Error(`${specifier} has no package.json`);
  const resolution: AutomergeResolution = {
    type: "custom:automerge",
    url,
    heads,
  };
  return {
    id: `${alias}@${manifest.version ?? "0.0.0"}+${headsId(heads)}`,
    resolution,
    manifest,
  };
}

// a plain install advances a dependency whose document has moved on
export async function headsMoved(
  resolution: AutomergeResolution,
): Promise<boolean> {
  const repo = await cachedRepo();
  const handle = await findCurrent(repo, resolution.url);
  return headsId(handle.heads()) !== headsId(resolution.heads);
}

// writes the package's files at the locked heads to `<cache>/store/<id>@<heads>/` and returns that directory
export async function fetchFiles(
  resolution: AutomergeResolution,
): Promise<string> {
  const { documentId } = parseAutomergeUrl(resolution.url);
  const dir = path.join(
    CACHE,
    "store",
    `${documentId}@${resolution.heads.join(",")}`,
  );
  if (existsSync(dir)) return dir;

  const repo = await cachedRepo();
  const view = (await repo.find(resolution.url)).view(resolution.heads);
  const partial = `${dir}.partial`;
  await rm(partial, { recursive: true, force: true });
  for (const file of filesIn(view.doc() as Record<string, unknown>)) {
    const found = await resolvePath(repo, view, file.split("/"));
    if (!found) continue;
    const to = path.join(partial, file);
    await mkdir(path.dirname(to), { recursive: true });
    await writeFile(to, found.content);
  }
  await rename(partial, dir);
  return dir;
}

let opened: Promise<Repo> | undefined;
function cachedRepo(): Promise<Repo> {
  opened ??= openRepo(path.join(CACHE, "repo"));
  return opened;
}

// the paths a directory document links to a file
function filesIn(doc: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(doc).flatMap(([key, value]) => {
    if (key === "@patchwork") return [];
    const at = prefix + key;
    const link = isImmutableString(value) ? String(value) : value;
    if (typeof link === "string") return isValidAutomergeUrl(link) ? [at] : [];
    if (value && typeof value === "object" && !(value instanceof Uint8Array))
      return filesIn(value as Record<string, unknown>, `${at}/`);
    return [];
  });
}

async function readJson(repo: Repo, view: DocHandle<unknown>, file: string) {
  const found = await resolvePath(repo, view, [file]);
  if (!found) return undefined;
  return JSON.parse(
    typeof found.content === "string"
      ? found.content
      : new TextDecoder().decode(found.content),
  );
}

// heads as a semver build identifier
function headsId(heads: UrlHeads): string {
  return createHash("sha256")
    .update([...heads].sort().join(","))
    .digest("hex")
    .slice(0, 12);
}
