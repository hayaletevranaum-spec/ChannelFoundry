import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const developmentContentOrigin = (process.env.BIRDESENGOR_PUBLIC_URL || "https://birdesengor.alwaysdata.net").replace(/\/+$/, "");

function webChunk(id: string) {
  if (id.includes("/node_modules/@babylonjs/core/")) return "babylon-vendor";
  if (id.includes("/node_modules/react/") || id.includes("/node_modules/react-dom/")) return "react-vendor";
  return undefined;
}

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/content/publication.json": {
        target: developmentContentOrigin,
        changeOrigin: true,
      },
      "/content/assets": {
        target: developmentContentOrigin,
        changeOrigin: true,
      },
      "/api/youtube": {
        target: developmentContentOrigin,
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: [
      {
        find: /^@babylonjs\/core$/,
        replacement: fileURLToPath(new URL("./src/3d/babylon-core-lite.js", import.meta.url)),
      },
    ],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: webChunk,
      },
    },
  },
});
