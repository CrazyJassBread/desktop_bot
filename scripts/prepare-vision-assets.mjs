import { cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const copies = [
  ["models/gesture_recognizer.task", "public/models/gesture_recognizer.task"],
  ["node_modules/@mediapipe/tasks-vision/vision_bundle.mjs", "public/vendor/mediapipe/tasks-vision/vision_bundle.mjs"],
  ["node_modules/@mediapipe/tasks-vision/wasm", "public/vendor/mediapipe/tasks-vision/wasm"]
];

for (const [source, destination] of copies) {
  const target = join(root, destination);
  await mkdir(dirname(target), { recursive: true });
  await cp(join(root, source), target, { recursive: true });
}

