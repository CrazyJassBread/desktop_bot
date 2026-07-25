import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const testsDirectory = fileURLToPath(new URL("../tests/", import.meta.url));
const testFiles = readdirSync(testsDirectory)
  .filter((name) => name.endsWith(".test.mjs"))
  .sort()
  .map((name) => fileURLToPath(new URL(`../tests/${name}`, import.meta.url)));

const result = spawnSync(process.execPath, ["--test", ...testFiles], {
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "test",
    NODE_NO_WARNINGS: "1"
  }
});

process.exit(result.status ?? 1);
