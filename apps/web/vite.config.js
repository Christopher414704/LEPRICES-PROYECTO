import path from "node:path";

import {
  fileURLToPath,
} from "node:url";

import { defineConfig, normalizePath } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

const archivoActual =
  fileURLToPath(import.meta.url);

const directorioActual =
  path.dirname(archivoActual);

const urlBaseCesium =
  "/cesium/";

export default defineConfig({
  plugins: [viteStaticCopy({
    targets: ["Workers", "Assets", "Widgets", "ThirdParty"].map((carpeta) => ({
      src: normalizePath(path.resolve(directorioActual, "node_modules/cesium/Build/Cesium", carpeta)),
      dest: "cesium",
      rename: { stripBase: 4 },
    })),
  })],
  build: {
    rolldownOptions: {
      input: {
        inicio: path.resolve(directorioActual, "index.html"),
        login: path.resolve(directorioActual, "login.html"),
        mapa: path.resolve(directorioActual, "mapa.html"),
        precios: path.resolve(directorioActual, "precios.html"),
        gasolineras: path.resolve(directorioActual, "gasolineras.html"),
        publico: path.resolve(directorioActual, "publico.html"),
      },
    },
  },
  define: {
    CESIUM_BASE_URL: JSON.stringify(
      urlBaseCesium,
    ),
  },

  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:3000" },
    fs: {
      allow: [
        directorioActual,
        path.resolve(
          directorioActual,
          "node_modules",
        ),
      ],
    },
  },
});
