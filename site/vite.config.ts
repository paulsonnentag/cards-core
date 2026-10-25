import { readdir, readFile } from "node:fs/promises";
import { loader } from "@cards/loader/vite";
import { defineConfig, type Plugin } from "vite";
import solid from "vite-plugin-solid";
import wasm from "vite-plugin-wasm";

// a checkout of cards-packages next to this repo
const PACKAGES = new URL("../../cards-packages/", import.meta.url);

export default defineConfig({
  plugins: [
    wasm(),
    solid(),
    // what packages share with the page instead of bringing their own
    loader({
      "solid-js": "solid-js",
      "solid-js/web": "solid-js/web",
      "solid-js/store": "solid-js/store",
      "@automerge/automerge-repo": "@automerge/automerge-repo",
      "@cards/core": "@cards/core",
      "@cards/core/dom": "@cards/core/dom",
      "@cards/core/render": "@cards/core/render",
    }),
    packages(),
  ],
  build: { target: "esnext" },
  worker: { format: "es", plugins: () => [wasm()] },
});

// `virtual:cards/packages`: the document each folder in cards-packages was published as, by folder name. Only read
// when seeding a new space; a folder that was never published isn't listed
function packages(): Plugin {
  const ID = "virtual:cards/packages";
  return {
    name: "cards:packages",
    resolveId: (id) => (id === ID ? `\0${ID}` : undefined),
    async load(id) {
      if (id !== `\0${ID}`) return;
      const urls: Record<string, string> = {};
      for (const name of (await readdir(PACKAGES)).sort()) {
        const config = new URL(`${name}/.pushwork/config.json`, PACKAGES);
        const text = await readFile(config, "utf8").catch(() => undefined);
        if (text === undefined) continue;
        this.addWatchFile(config.pathname);
        urls[name] = JSON.parse(text).rootUrl;
      }
      return `export default ${JSON.stringify(urls)};`;
    },
  };
}
