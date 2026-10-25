import {
  parseAutomergeUrl,
  stringifyAutomergeUrl,
  type AutomergeUrl,
  type UrlHeads,
} from "@automerge/automerge-repo";

// the package a module was loaded from, without heads: the same for every version of it
export function packageUrl(moduleUrl: string): AutomergeUrl {
  const [segment] = new URL(moduleUrl).pathname.split("/")[1].split("@");
  return decodeURIComponent(segment).split("#")[0] as AutomergeUrl;
}

// `/<encodeURIComponent("automerge:<id>#<heads>")>@<digest>/`: a package at exact heads, bound to its closure
export function pinnedPrefix(
  url: AutomergeUrl,
  heads: UrlHeads,
  digest: string,
): string {
  const { documentId } = parseAutomergeUrl(url);
  return `/${encodeURIComponent(stringifyAutomergeUrl({ documentId, heads }))}@${digest}/`;
}

// a same-origin path into a package, as published import maps write them: `/automerge%3A<id>/dist/index.js`
export function packagePath(
  target: string,
): { url: AutomergeUrl; rest: string } | undefined {
  if (!target.startsWith("/automerge%3A")) return undefined;
  const [segment, ...rest] = target.slice(1).split("/");
  const { documentId } = parseAutomergeUrl(
    decodeURIComponent(segment.split("@")[0]) as AutomergeUrl,
  );
  return { url: stringifyAutomergeUrl({ documentId }), rest: rest.join("/") };
}

// what the service worker hands off: `automerge:<id>#<heads>@<digest>/<path>`, split into the pinned url and the path
export function handoffTarget(handoffUrl: string): {
  url: AutomergeUrl;
  heads?: UrlHeads;
  path: string[];
} {
  const [segment, ...path] = handoffUrl.split("/");
  const { documentId, heads } = parseAutomergeUrl(
    segment.split("@")[0] as AutomergeUrl,
  );
  return {
    url: stringifyAutomergeUrl({ documentId }),
    heads,
    path: path.filter(Boolean),
  };
}
