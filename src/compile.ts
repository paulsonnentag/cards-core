import * as Babel from "@babel/standalone";
import solidPreset from "babel-preset-solid";
import * as maplibre from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import * as solid from "solid-js";
import * as solidStore from "solid-js/store";
import * as solidWeb from "solid-js/web";
import * as container from "./container";
import * as core from "./core";
import type { Behavior } from "./core";
import * as dom from "./dom";

// the only modules a card can import; they must be the app's own instances or reactivity breaks
const modules: Record<string, unknown> = {
  "solid-js": solid,
  "solid-js/web": solidWeb,
  "solid-js/store": solidStore,
  "maplibre-gl": maplibre,
  core,
  container,
  dom,
};

maplibre.setWorkerUrl(workerUrl);

const compiled = new Map<string, Behavior>();

// turns a card's TSX source into its Behavior, once per distinct source
export function compile(source: string): Behavior {
  const cached = compiled.get(source);
  if (cached) return cached;

  const behavior = evaluate(transform(source)).default as Behavior;
  if (typeof behavior !== "function")
    throw new Error("a card's source must export a default Behavior");
  compiled.set(source, behavior);
  return behavior;
}

function transform(source: string): string {
  return Babel.transform(source, {
    filename: "card.tsx",
    presets: [
      [solidPreset, { generate: "dom" }],
      ["typescript", { isTSX: true, allExtensions: true }],
    ],
    plugins: ["transform-modules-commonjs"],
  }).code!;
}

function evaluate(code: string): Record<string, unknown> {
  const module = { exports: {} as Record<string, unknown> };
  const require = (name: string) => {
    if (!(name in modules)) throw new Error(`cards can't import "${name}"`);
    return modules[name];
  };
  new Function("require", "module", "exports", code)(
    require,
    module,
    module.exports,
  );
  return module.exports;
}
