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
  build: {
    outDir: "dist",
    lib: {
      entry: "src/main.jsx",
      formats: ["es"],
      fileName: () => "hero-3d.js",
    },
  },
});
