import type { Process } from "./node";
import type { Overlay } from "./state";

// each process's puts, by path; seq orders puts across processes
export type Layer = Record<string, { value: unknown; seq: number }>;
export type Layers = Map<Process, Layer>;

// every put from every process, oldest first, so a later put wins at its path
export function applyPuts(doc: Record<string, unknown>, layers: Layers) {
  const puts = [...layers.values()].flatMap((layer) => Object.entries(layer));
  puts.sort(([, a], [, b]) => a.seq - b.seq);
  return puts.reduce(
    (value, [path, put]) => setPath(value, path.split("/"), put.value),
    doc,
  );
}

export function overlays(
  doc: Record<string, unknown>,
  layers: Layers,
): Record<string, Overlay> {
  const out: Record<string, Overlay> = {};
  for (const [process, layer] of layers) {
    for (const [path, { value, seq }] of Object.entries(layer)) {
      (out[path] ??= { stored: getPath(doc, path), layers: [] }).layers.push({
        process,
        value,
        seq,
      });
    }
  }
  for (const o of Object.values(out)) o.layers.sort((a, b) => b.seq - a.seq);
  return out;
}

export function withPut(
  layers: Layers,
  process: Process,
  values: Record<string, unknown>,
  next: () => number,
) {
  const layer: Layer = { ...layers.get(process) };
  for (const [path, value] of Object.entries(values)) {
    if (value === undefined) delete layer[path];
    else layer[path] = { value, seq: next() };
  }
  return new Map(layers).set(process, layer);
}

export function without(layers: Layers, process: Process) {
  const copy = new Map(layers);
  copy.delete(process);
  return copy;
}

// copies only the objects along the path
function setPath(target: any, [key, ...rest]: string[], value: unknown): any {
  const copy = Array.isArray(target) ? [...target] : { ...target };
  copy[key] =
    rest.length === 0 ? value : setPath(target?.[key] ?? {}, rest, value);
  return copy;
}

function getPath(target: any, path: string): unknown {
  return path.split("/").reduce((value, key) => value?.[key], target);
}
