#!/usr/bin/env node
/**
 * MapLibre 6 runs tile work in an ES-module web worker that bundlers do not
 * emit by themselves. Copy the worker and its shared chunk into the web app's
 * public folder (served same-origin, CSP-friendly). Runs before dev and build.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "apps/web/package.json"));
const dist = dirname(require.resolve("maplibre-gl/dist/maplibre-gl.css"));
const target = join(root, "apps/web/public/maplibre");
mkdirSync(target, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) copyFileSync(join(dist, file), join(target, file));
console.log(`copied MapLibre worker to ${target}`);
