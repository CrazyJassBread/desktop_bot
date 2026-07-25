import { FilesetResolver, GestureRecognizer } from "/vendor/mediapipe/tasks-vision/vision_bundle.mjs";
import { createPixelArt, GestureStabilizer, packPrinterBitmap } from "./processing.js";

let currentSession = null;

function imageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => resolve({ image, url });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Invalid image frame"));
    };
    image.src = url;
  });
}

function setStatus(text, tone = "") {
  const element = document.querySelector("#vision-status");
  if (element) {
    element.textContent = text;
    element.dataset.tone = tone;
  }
}

function captureFrame(liveCanvas) {
  const original = document.querySelector("#vision-capture");
  const processed = document.querySelector("#vision-processed");
  if (!original || !processed) return;

  original.width = liveCanvas.width;
  original.height = liveCanvas.height;
  original.getContext("2d").drawImage(liveCanvas, 0, 0);

  const width = 384;
  const height = Math.max(1, Math.round(liveCanvas.height * width / liveCanvas.width));
  const work = document.createElement("canvas");
  work.width = width;
  work.height = height;
  const context = work.getContext("2d", { willReadFrequently: true });
  context.drawImage(liveCanvas, 0, 0, width, height);
  const source = context.getImageData(0, 0, width, height);
  const result = createPixelArt(source);

  processed.width = width;
  processed.height = height;
  processed.getContext("2d").putImageData(new ImageData(result.data, width, height), 0, 0);

  const originalDownload = document.querySelector("#download-capture");
  const processedDownload = document.querySelector("#download-processed");
  const stamp = new Date().toISOString().replaceAll(":", "-");
  originalDownload.href = original.toDataURL("image/jpeg", 0.92);
  originalDownload.download = `victory_${stamp}.jpg`;
  const imageDataUrl = processed.toDataURL("image/png");
  processedDownload.href = imageDataUrl;
  processedDownload.download = `victory_${stamp}_pixel_art.png`;
  document.querySelector("#vision-results")?.removeAttribute("hidden");
  return {
    width,
    height,
    bitmap: btoa(String.fromCharCode(...packPrinterBitmap(result))),
    imageDataUrl
  };
}

export function stopVisionReceiver() {
  currentSession?.stop();
  currentSession = null;
}

export async function startVisionReceiver({ labels, onError, onPrint, onSave }) {
  stopVisionReceiver();
  let stopped = false;
  let timer = null;
  let recognizer = null;
  let lastFrameId = "";
  const stabilizer = new GestureStabilizer();
  const liveCanvas = document.querySelector("#vision-live");
  const liveContext = liveCanvas?.getContext("2d");

  const session = {
    stop() {
      stopped = true;
      clearTimeout(timer);
      recognizer?.close();
      recognizer = null;
    }
  };
  currentSession = session;

  document.querySelector("#vision-stop")?.addEventListener("click", () => {
    session.stop();
    setStatus(labels.paused);
  }, { once: true });

  try {
    setStatus(labels.loading);
    const fileset = await FilesetResolver.forVisionTasks("/vendor/mediapipe/tasks-vision/wasm");
    if (stopped) return;
    recognizer = await GestureRecognizer.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: "/models/gesture_recognizer.task", delegate: "CPU" },
      runningMode: "IMAGE",
      numHands: 2,
      cannedGesturesClassifierOptions: { scoreThreshold: 0.7 }
    });
    if (stopped) return;
    setStatus(labels.waiting);
  } catch (error) {
    if (!stopped) {
      setStatus(labels.failed, "error");
      onError(error);
    }
    return;
  }

  const poll = async () => {
    if (stopped) return;
    try {
      const response = await fetch(`/vision/latest?after=${encodeURIComponent(lastFrameId)}`, { cache: "no-store" });
      if (response.status === 204) {
        setStatus(lastFrameId ? labels.receiving : labels.waiting);
      } else if (!response.ok) {
        throw new Error(`Frame request failed (${response.status})`);
      } else {
        lastFrameId = response.headers.get("x-frame-id") || lastFrameId;
        const { image, url } = await imageFromBlob(await response.blob());
        if (!stopped && liveCanvas && liveContext) {
          liveCanvas.width = image.naturalWidth;
          liveCanvas.height = image.naturalHeight;
          liveContext.drawImage(image, 0, 0);
          const result = recognizer.recognize(image);
          const categories = result.gestures?.flat() || [];
          const victory = categories.find((category) => category.categoryName === "Victory");
          const best = [...categories].sort((a, b) => b.score - a.score)[0];
          document.querySelector("#vision-gesture").textContent = best
            ? `${best.categoryName} · ${(best.score * 100).toFixed(0)}%`
            : labels.none;
          setStatus(labels.receiving, "live");
          if (stabilizer.update(Boolean(victory))) {
            const printPayload = captureFrame(liveCanvas);
            setStatus(labels.captured, "success");
            const printStatus = document.querySelector("#vision-print-status");
            if (printStatus) printStatus.textContent = labels.printing;
            void onPrint({ width: printPayload.width, height: printPayload.height, bitmap: printPayload.bitmap }).then(() => {
              if (printStatus) {
                printStatus.textContent = labels.printed;
                printStatus.dataset.tone = "success";
              }
            }).catch((error) => {
              if (printStatus) {
                printStatus.textContent = labels.printFailed;
                printStatus.dataset.tone = "error";
              }
              onError(error);
            });
            const saveStatus = document.querySelector("#vision-save-status");
            if (saveStatus) saveStatus.textContent = labels.saving;
            void onSave({ width: printPayload.width, height: printPayload.height, imageDataUrl: printPayload.imageDataUrl }).then(() => {
              if (saveStatus) {
                saveStatus.textContent = labels.saved;
                saveStatus.dataset.tone = "success";
              }
            }).catch((error) => {
              if (saveStatus) {
                saveStatus.textContent = labels.saveFailed;
                saveStatus.dataset.tone = "error";
              }
              onError(error);
            });
          }
        }
        URL.revokeObjectURL(url);
      }
    } catch {
      if (!stopped) setStatus(labels.disconnected, "error");
    } finally {
      if (!stopped) timer = setTimeout(poll, 200);
    }
  };
  poll();
}
