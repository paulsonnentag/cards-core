import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  plugins: [wasm(), solid()],
  build: { target: "esnext" },
  worker: { format: "es", plugins: () => [wasm()] },
});
