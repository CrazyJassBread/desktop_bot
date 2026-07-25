import sharp from "sharp";

export const THERMAL_IMAGE_WIDTH = 384;
export const THERMAL_IMAGE_BATCH_MAX_HEIGHT = 800;

const profiles = Object.freeze({
  album: {
    maxWidth: 320,
    maxHeight: 220,
    pixelSize: 1,
    grayscaleLevels: 32,
    contrast: 1.04,
    brightness: 1,
    cannyLow: 0,
    cannyHigh: 0
  },
  letter: {
    maxWidth: 300,
    maxHeight: 150,
    pixelSize: 1,
    grayscaleLevels: 32,
    contrast: 1.06,
    brightness: 1,
    cannyLow: 0,
    cannyHigh: 0
  },
  print: {
    maxWidth: THERMAL_IMAGE_WIDTH,
    maxHeight: 720,
    paperWidth: THERMAL_IMAGE_WIDTH,
    paddingY: 16,
    pixelSize: 1,
    grayscaleLevels: 32,
    contrast: 1.06,
    brightness: 1,
    cannyLow: 0,
    cannyHigh: 0
  }
});

function normalizeProfile(profile) {
  return Object.hasOwn(profiles, profile) ? profile : "album";
}

function clampInteger(value, minimum, maximum, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function clampNumber(value, minimum, maximum, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function percentile(histogram, total, ratio) {
  const target = Math.max(1, Math.round(total * ratio));
  let seen = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    seen += histogram[value];
    if (seen >= target) return value;
  }
  return 255;
}

function normalizeTones(input, levels, contrast, brightness) {
  const histogram = new Uint32Array(256);
  for (const value of input) histogram[value] += 1;
  const low = percentile(histogram, input.length, 0.015);
  const high = Math.max(low + 24, percentile(histogram, input.length, 0.985));
  const step = 255 / Math.max(1, levels - 1);
  const output = new Float32Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const stretched = Math.max(0, Math.min(255, (input[index] - low) * 255 / (high - low)));
    const adjusted = Math.max(0, Math.min(255, ((stretched - 128) * contrast + 128) * brightness));
    output[index] = Math.round(adjusted / step) * step;
  }
  return output;
}

function diffuseError(work, width, height, x, y, error, direction) {
  const add = (nextX, nextY, weight) => {
    if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) return;
    const index = nextY * width + nextX;
    work[index] = Math.max(0, Math.min(255, work[index] + error * weight));
  };
  add(x + direction, y, 7 / 16);
  add(x - direction, y + 1, 3 / 16);
  add(x, y + 1, 5 / 16);
  add(x + direction, y + 1, 1 / 16);
}

function serpentineFloydSteinberg(input, width, height, threshold = 128) {
  const work = new Float32Array(input);
  const output = Buffer.alloc(width * height, 255);
  for (let y = 0; y < height; y += 1) {
    const direction = y % 2 === 0 ? 1 : -1;
    const start = direction === 1 ? 0 : width - 1;
    const end = direction === 1 ? width : -1;
    for (let x = start; x !== end; x += direction) {
      const index = y * width + x;
      const previous = work[index];
      const next = previous < threshold ? 0 : 255;
      output[index] = next;
      diffuseError(work, width, height, x, y, previous - next, direction);
    }
  }
  return output;
}

function detailPreset(cannyLow, cannyHigh) {
  if (cannyLow <= 0 || cannyHigh <= 0) return { name: "natural", sharpenSigma: 0.55, threshold: 125 };
  if (cannyLow >= 105) return { name: "subject", sharpenSigma: 0.9, threshold: 132 };
  return { name: "detail", sharpenSigma: 0.72, threshold: 128 };
}

async function normalizeThermalImage(buffer, profile, options = {}) {
  const selected = profiles[normalizeProfile(profile)];
  const pixelSize = clampInteger(options.pixelSize, 1, 8, selected.pixelSize);
  const grayscaleLevels = clampInteger(options.grayscaleLevels, 2, 64, selected.grayscaleLevels);
  const contrast = clampNumber(options.contrast, 0.7, 2.2, selected.contrast);
  const brightness = clampNumber(options.brightness, 0.7, 1.4, selected.brightness);
  const cannyLow = clampInteger(options.cannyLow, 0, 512, selected.cannyLow);
  const cannyHigh = clampInteger(options.cannyHigh, 0, 1_024, selected.cannyHigh);
  const detail = detailPreset(cannyLow, cannyHigh);

  let { data, info } = await sharp(buffer, { failOn: "none" })
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({
      width: selected.maxWidth,
      height: selected.maxHeight,
      fit: "inside",
      withoutEnlargement: profile !== "print"
    })
    .greyscale()
    .sharpen({ sigma: detail.sharpenSigma, m1: 0.45, m2: 1.15, x1: 2, y2: 10, y3: 20 })
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (pixelSize > 1) {
    const smallWidth = Math.max(1, Math.round(info.width / pixelSize));
    const smallHeight = Math.max(1, Math.round(info.height / pixelSize));
    data = await sharp(data, { raw: { width: info.width, height: info.height, channels: 1 } })
      .resize(smallWidth, smallHeight, { kernel: sharp.kernel.lanczos3 })
      .resize(info.width, info.height, { kernel: sharp.kernel.nearest })
      .raw()
      .toBuffer();
  }

  const tones = normalizeTones(data, grayscaleLevels, contrast, brightness);
  const pixels = serpentineFloydSteinberg(tones, info.width, info.height, detail.threshold);
  const paperWidth = selected.paperWidth ?? info.width;
  const horizontalPadding = Math.max(0, paperWidth - info.width);
  const left = Math.floor(horizontalPadding / 2);
  const right = horizontalPadding - left;
  return sharp(pixels, { raw: { width: info.width, height: info.height, channels: 1 } })
    .extend({
      top: selected.paddingY ?? 0,
      bottom: selected.paddingY ?? 0,
      left,
      right,
      background: "#ffffff"
    })
    .png()
    .toBuffer({ resolveWithObject: true })
    .then(({ data: output, info: outputInfo }) => ({
      data: output,
      info: outputInfo,
      processing: {
        pixelSize,
        grayscaleLevels,
        contrast,
        brightness,
        cannyLow,
        cannyHigh,
        detailMode: detail.name,
        dither: "serpentine-floyd-steinberg"
      }
    }));
}

export async function processThermalImage(buffer, { profile = "album", ...options } = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new Error("IMAGE_REQUIRED");
  }
  const selectedProfile = normalizeProfile(profile);
  const normalized = await normalizeThermalImage(buffer, selectedProfile, options);
  const { data, info } = normalized;
  return {
    profile: selectedProfile,
    width: info.width,
    height: info.height,
    mimeType: "image/png",
    previewDataUrl: `data:image/png;base64,${data.toString("base64")}`,
    processor: "thermal-image-photo-dither-v2",
    constraints: profiles[selectedProfile],
    processing: normalized.processing ?? null
  };
}

function dataUrlBuffer(dataUrl) {
  const match = String(dataUrl ?? "").match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error("THERMAL_PREVIEW_INVALID");
  return Buffer.from(match[1], "base64");
}

export async function renderThermalImageBatches(
  previewDataUrl,
  { rotate180 = true, maxBatchHeight = THERMAL_IMAGE_BATCH_MAX_HEIGHT } = {}
) {
  const safeBatchHeight = clampInteger(maxBatchHeight, 128, 960, THERMAL_IMAGE_BATCH_MAX_HEIGHT);
  let pipeline = sharp(dataUrlBuffer(previewDataUrl))
    .flatten({ background: "#ffffff" })
    .greyscale()
    .threshold(128);
  if (rotate180) pipeline = pipeline.rotate(180);
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  if (info.width > THERMAL_IMAGE_WIDTH) throw new RangeError(`Thermal image width exceeds ${THERMAL_IMAGE_WIDTH}px`);

  const widthBytes = Math.ceil(info.width / 8);
  const batches = [];
  for (let top = 0, index = 0; top < info.height; top += safeBatchHeight, index += 1) {
    const height = Math.min(safeBatchHeight, info.height - top);
    const bitmap = Buffer.alloc(widthBytes * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        if (data[(top + y) * info.width + x] < 128) {
          bitmap[y * widthBytes + Math.floor(x / 8)] |= 1 << (7 - (x % 8));
        }
      }
    }
    batches.push({ index, width: info.width, height, bitmap });
  }
  return {
    width: info.width,
    height: info.height,
    rotate180,
    maxBatchHeight: safeBatchHeight,
    batchCount: batches.length,
    batches
  };
}
