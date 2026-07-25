import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
const distRoot = join(projectRoot, "dist");
const requiredFiles = [
  "index.html",
  "simulator.html",
  "styles.css",
  "app.js",
  "simulator.js",
  "api/mock-api.mjs",
  "services/api-client.js",
  "services/companion-store.js",
  "services/device-bus.js"
];

for (const file of requiredFiles) {
  const filePath = join(webRoot, file);
  const info = await stat(filePath);
  if (!info.isFile() || info.size === 0) {
    throw new Error(`Build validation failed: ${file}`);
  }
}

const html = await readFile(join(webRoot, "index.html"), "utf8");
for (const marker of ["id=\"app\"", "manifest.webmanifest", "app.js"]) {
  if (!html.includes(marker)) throw new Error(`Missing app marker: ${marker}`);
}

await rm(distRoot, { recursive: true, force: true });
await mkdir(distRoot, { recursive: true });

for (const file of requiredFiles) {
  const source = join(webRoot, file);
  const target = join(distRoot, file);
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target);
}

for (const optional of ["manifest.webmanifest", "favicon.svg"]) {
  await cp(join(webRoot, optional), join(distRoot, optional));
}

await writeFile(
  join(distRoot, "build-meta.json"),
  JSON.stringify({
    name: "PrintPal Companion + Community + Letter MVP",
    built_at: new Date().toISOString(),
    database: false,
    routes: [
      "/", "/welcome", "/login", "/register", "/forgot-password", "/reset-password",
      "/community", "/create-post", "/match", "/match/preferences",
      "/letter", "/letter/create", "/profile",
      "/account", "/conversations", "/prints", "/device", "/images"
    ],
    api: "/api/v1 (in-memory repository MVP)",
    transport: "REST API + DeviceBus v1 (WebSocket/MQTT gateway ready)"
  }, null, 2)
);

console.log(`Build complete: ${distRoot}`);
