import { fileURLToPath } from "node:url";
import { rolldown } from "rolldown";
import type { Plugin } from "vite";

// bare specifier -> the module the page provides under it, as the app imports it
export type Environment = Record<string, string>;

const ENVIRONMENT = "virtual:loader/environment";
const MODULE = "\0loader-environment:";

// Serves the service worker at /service-worker.js and each environment module at /environment/<specifier>.js,
// re-exporting the app's own instance. `virtual:loader/environment` is the import map to pass to createLoader.
export function loader(environment: Environment): Plugin[] {
  const imports = Object.fromEntries(
    Object.keys(environment).map((s) => [s, `/environment/${s}.js`]),
  );
  return [
    {
      name: "loader",
      resolveId(id) {
        if (id === ENVIRONMENT) return `\0${ENVIRONMENT}`;
        if (id.startsWith(MODULE)) return id;
        const specifier = specifierAt(id);
        if (specifier) return MODULE + specifier;
      },
      load(id) {
        if (id === `\0${ENVIRONMENT}`)
          return `export default ${JSON.stringify({ imports })};`;
        if (id.startsWith(MODULE))
          return `export * from ${JSON.stringify(environment[id.slice(MODULE.length)])};`;
      },
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url !== "/service-worker.js") return next();
          res.setHeader("content-type", "text/javascript");
          res.end(await serviceWorker());
        });
      },
    },
    {
      name: "loader:build",
      apply: "build",
      async buildStart() {
        for (const specifier of Object.keys(environment))
          this.emitFile({
            type: "chunk",
            id: MODULE + specifier,
            fileName: `environment/${specifier}.js`,
            preserveSignature: "strict",
          });
        this.emitFile({
          type: "asset",
          fileName: "service-worker.js",
          source: await serviceWorker(),
        });
      },
    },
  ];

  function specifierAt(id: string): string | undefined {
    const match = /^\/environment\/(.+)\.js$/.exec(id);
    return match && match[1] in environment ? match[1] : undefined;
  }
}

let bundled: Promise<string> | undefined;

// patchwork's service worker as one file: it imports its handoff constants
function serviceWorker(): Promise<string> {
  bundled ??= (async () => {
    const input = fileURLToPath(
      import.meta.resolve("@inkandswitch/patchwork-bootloader/service-worker"),
    );
    const bundle = await rolldown({ input, platform: "browser" });
    const { output } = await bundle.generate({ format: "esm" });
    await bundle.close();
    return output[0].code;
  })();
  return bundled;
}
