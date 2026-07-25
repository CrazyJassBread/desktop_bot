import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const distRoot = join(projectRoot, "dist");
const required = [
  "server.mjs",
  "server/config.mjs",
  "server/vision/frame-store.mjs",
  "server/vision/http-server.mjs",
  "server/vision/print.mjs",
  "server/api/api.mjs",
  "server/api/database.mjs",
  "server/services/deepseek-client.mjs",
  "server/services/thermal-letter.mjs",
  "public/index.html",
  "public/app.js",
  "public/vision/receiver.js",
  "public/vision/processing.js",
  "public/styles.css",
  "public/services/api-client.js"
];

for (const relativePath of required) {
  const info = await stat(join(projectRoot, relativePath));
  if (!info.isFile() || info.size === 0) throw new Error(`Build validation failed: ${relativePath}`);
}

const html = await readFile(join(projectRoot, "public", "index.html"), "utf8");
for (const marker of ["id=\"app\"", "manifest.webmanifest", "app.js"]) {
  if (!html.includes(marker)) throw new Error(`Missing app marker: ${marker}`);
}

await rm(distRoot, { recursive: true, force: true });
await mkdir(distRoot, { recursive: true });
await cp(join(projectRoot, "public"), join(distRoot, "public"), { recursive: true });
await cp(join(projectRoot, "server"), join(distRoot, "server"), { recursive: true });
await cp(join(projectRoot, "server.mjs"), join(distRoot, "server.mjs"));
await cp(join(projectRoot, "package.json"), join(distRoot, "package.json"));
await writeFile(join(distRoot, "build-meta.json"), JSON.stringify({
  name: "Paper Bridge hackathon MVP",
  builtAt: new Date().toISOString(),
  database: "SQLite",
  routes: ["/", "/login", "/register", "/records", "/circle", "/letters", "/photos", "/vision", "/profile"],
  transport: "Same-origin REST with server-side LAN backend adapter"
}, null, 2));
console.log(`Build complete: ${distRoot}`);
