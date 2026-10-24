import type { AutomergeUrl } from "@automerge/automerge-repo";
import { Map as MapLibre } from "maplibre-gl";
import {
  createEffect,
  For,
  onCleanup,
  onMount,
  type Component,
} from "solid-js";
import {
  message,
  state,
  State,
  type Behavior,
  type Node,
  type Point,
} from "core";
import { Child, placeIn, removeFrom } from "container";
import { elementOf } from "dom";
import type {
  Container,
  DropRequest,
  PanRequest,
  Shape,
  TakeRequest,
  Taken,
} from "./canvas";

export type Camera = { center: [lng: number, lat: number]; zoom: number };
export type MapShape = Shape &
  Container & {
    width: number;
    height: number;
    camera: Camera;
    dropping?: boolean; // put while something that would land here hovers
  };

const Take = message<TakeRequest, Taken | undefined>("container/take");
const Drop = message<DropRequest, AutomergeUrl | undefined>("container/drop");
const Pan = message<PanRequest, void>("container/pan");

const STYLE = "https://tiles.openfreemap.org/styles/liberty";
const TILE = 512; // MapLibre's world is 512 pixels wide at zoom 0

// A surface on a map. Children sit at x = longitude, y = latitude; their scale is relative to the map, so they
// arrive at the size they had on screen and then grow and shrink with it. The camera is shared: every pan and
// zoom is written to the document.
export default (({ url, request, on }) => {
  const map = () => request(State).read<MapShape>();
  const size = () => ({ x: map().width, y: map().height });

  request(State).put({
    "@tags/surface": true,
    view: () => <MapView map={map()} zoomAt={zoomAt} />,
  });

  on(Drop, ({ node, client, scale, phase = "drop" }, next) => {
    const dropping = phase === "over";
    if (Boolean(map().dropping) !== dropping)
      request(State).put("dropping", dropping || undefined);
    if (phase === "out") return next();
    if (phase === "over") return url;
    const [lng, lat] = fromScreen(toLocal(client), map().camera, size());
    placeIn(request(State), node, {
      x: lng,
      y: lat,
      scale: scale / 2 ** map().camera.zoom,
    });
    return url;
  });

  on(Take, ({ node }, next) =>
    removeFrom(request(State), node) ? { node } : next(),
  );

  on(Pan, ({ delta }) => {
    const camera = map().camera;
    const center = toScreen(camera.center, camera, size());
    setCamera({
      center: fromScreen(
        { x: center.x - delta.x, y: center.y - delta.y },
        camera,
        size(),
      ),
      zoom: camera.zoom,
    });
  });

  // keeps the place under the cursor where it is
  function zoomAt(client: Point, by: number) {
    const camera = map().camera;
    const local = toLocal(client);
    const under = mercator(fromScreen(local, camera, size()));
    const zoom = Math.min(20, Math.max(1, camera.zoom + by));
    const world = TILE * 2 ** zoom;
    const center = lngLat({
      x: under.x - (local.x - size().x / 2) / world,
      y: under.y - (local.y - size().y / 2) / world,
    });
    setCamera({ center, zoom });
  }

  function setCamera(camera: Camera) {
    request(State).change((d: MapShape) => {
      d.camera = camera;
    });
  }

  // client pixels to pixels inside the map, which may itself be scaled
  function toLocal(client: Point): Point {
    const frame = elementOf(url)!.querySelector(".map-gl") as HTMLElement;
    const rect = frame.getBoundingClientRect();
    const scale = frame.offsetWidth ? rect.width / frame.offsetWidth : 1;
    return {
      x: (client.x - rect.left) / scale,
      y: (client.y - rect.top) / scale,
    };
  }
}) satisfies Behavior;

const MapView: Component<{
  map: MapShape;
  zoomAt(client: Point, by: number): void;
}> = (props) => {
  let container!: HTMLDivElement;
  const size = () => ({ x: props.map.width, y: props.map.height });

  onMount(() => {
    const gl = new MapLibre({
      container,
      style: STYLE,
      center: props.map.camera.center,
      zoom: props.map.camera.zoom,
      interactive: false,
      attributionControl: { compact: true },
    });
    createEffect(() =>
      gl.jumpTo({
        center: props.map.camera.center,
        zoom: props.map.camera.zoom,
      }),
    );
    createEffect(() => {
      size();
      gl.resize();
    });
    onCleanup(() => gl.remove());
  });

  return (
    <div
      class="paper map-frame"
      classList={{ droppable: Boolean(props.map.dropping) }}
    >
      <div class="map-title">Map</div>
      <div
        class="map-gl"
        data-pan
        style={{
          width: `${props.map.width}px`,
          height: `${props.map.height}px`,
        }}
        onWheel={(e) => {
          e.preventDefault();
          props.zoomAt({ x: e.clientX, y: e.clientY }, -e.deltaY * 0.002);
        }}
      >
        <div class="map-canvas" ref={container} />
        <div class="map-children">
          <For each={props.map.children ?? []}>
            {(child) => (
              <Child
                node={child}
                style={placement(child, props.map.camera, size())}
              />
            )}
          </For>
        </div>
      </div>
    </div>
  );
};

function placement(child: Node, camera: Camera, size: Point) {
  const s = state<Shape>(child);
  const at = toScreen([s.x ?? 0, s.y ?? 0], camera, size);
  return {
    left: `${at.x}px`,
    top: `${at.y}px`,
    transform: `scale(${(s.scale ?? 1) * 2 ** camera.zoom})`,
  };
}

// Web Mercator, the same projection MapLibre draws with, so children never drift from the tiles

function toScreen(
  lnglat: [number, number],
  camera: Camera,
  size: Point,
): Point {
  const p = mercator(lnglat);
  const c = mercator(camera.center);
  const world = TILE * 2 ** camera.zoom;
  return {
    x: (p.x - c.x) * world + size.x / 2,
    y: (p.y - c.y) * world + size.y / 2,
  };
}

function fromScreen(
  local: Point,
  camera: Camera,
  size: Point,
): [number, number] {
  const c = mercator(camera.center);
  const world = TILE * 2 ** camera.zoom;
  return lngLat({
    x: c.x + (local.x - size.x / 2) / world,
    y: c.y + (local.y - size.y / 2) / world,
  });
}

function mercator([lng, lat]: [number, number]): Point {
  return {
    x: (lng + 180) / 360,
    y:
      (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) /
      2,
  };
}

function lngLat({ x, y }: Point): [number, number] {
  return [
    x * 360 - 180,
    (Math.atan(Math.exp(Math.PI * (1 - 2 * y))) * 360) / Math.PI - 90,
  ];
}
