import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
const distRoot = join(projectRoot, "dist");
const requiredFiles = [
  "index.html",
  "styles.css",
  "app.js",
  "manifest.webmanifest",
  "services/api-client.js"
];

for (const file of requiredFiles) {
  const info = await stat(join(webRoot, file));
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
  const target = join(distRoot, file);
  await mkdir(dirname(target), { recursive: true });
  await cp(join(webRoot, file), target);
}
await writeFile(
  join(distRoot, "build-meta.json"),
  JSON.stringify({
    name: "AI Hub Letter Space",
    builtAt: new Date().toISOString(),
    database: "SQLite",
    routes: ["/login", "/register", "/letters"],
    api: "/api/v1"
  }, null, 2)
);
console.log(`Build complete: ${distRoot}`);
