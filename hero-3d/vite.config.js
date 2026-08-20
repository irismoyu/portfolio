import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server: normal Vite app using the local index.html, for fast HMR
// iteration on the 3D scene in isolation.
//
// Production build: library mode, so `vite build` emits one predictable
// `dist/hero-3d.js` (self-mounting on import) instead of hashed multi-chunk
// output — the root site's static index.html can then reference a fixed
// path without any server-side build step.
export default defineConfig({
  plugins: [react()],
  // Library-mode builds skip Vite's normal HTML-entry pipeline, which is
  // what normally strips dev-only `process.env.NODE_ENV` checks out of
  // React's own bundled code. Without this, the embedded bundle throws
  // "process is not defined" at runtime in a browser (no Node `process`
  // global) — this define makes that check a build-time constant instead.
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: "dist",
    lib: {
      entry: "src/main.jsx",
      formats: ["es"],
      fileName: () => "hero-3d.js",
    },
  },
});
