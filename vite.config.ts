import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  plugins: [wasm(), solid()],
  // @babel/types (pulled in by babel-preset-solid, which compiles cards in the browser) reads this flag
  define: { "process.env.BABEL_TYPES_8_BREAKING": "false" },
  resolve: {
    alias: {
      assert: fileURLToPath(new URL("./src/shims/assert.cjs", import.meta.url)),
    },
  },
  build: { target: "esnext" },
  worker: { format: "es", plugins: () => [wasm()] },
});
