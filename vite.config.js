import path from "node:path";
import { rm } from "node:fs/promises";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Сирі дані для скриптів (fetch:regions / repair:*) лежать у public/data, але застосунок
// їх НЕ завантажує (карта читає лише /data/world-topology.json). Щоб вони не потрапляли
// на кожен деплой (~47 МБ), прибираємо їх із готової збірки; у репозиторії вони лишаються.
const BUILD_ONLY_DATA = ["data/world-regions.geojson", "data/world-regions"];
function dropBuildOnlyData() {
  let outDir = "dist";
  return {
    name: "drop-build-only-geo-data",
    apply: "build",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      for (const rel of BUILD_ONLY_DATA) await rm(path.join(outDir, rel), { recursive: true, force: true });
    },
  };
}

export default defineConfig({
  plugins: [react(), dropBuildOnlyData()],
});
