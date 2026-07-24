import sharp from "sharp";

export const THERMAL_IMAGE_WIDTH = 384;

const profiles = Object.freeze({
  album: { maxWidth: 320, maxHeight: 220 },
  letter: { maxWidth: 300, maxHeight: 150 }
});

function normalizeProfile(profile) {
  return Object.hasOwn(profiles, profile) ? profile : "album";
}

async function normalizeImage(buffer, profile) {
  const selected = profiles[normalizeProfile(profile)];
  return sharp(buffer, { failOn: "none" })
    .rotate()
    .resize({
      width: selected.maxWidth,
      height: selected.maxHeight,
      fit: "inside",
      withoutEnlargement: true
    })
    .greyscale()
    .normalize()
    .threshold(176)
    .png()
    .toBuffer({ resolveWithObject: true });
}

export async function processThermalImage(buffer, { profile = "album" } = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new Error("IMAGE_REQUIRED");
  }
  const { data, info } = await normalizeImage(buffer, profile);
  return {
    profile: normalizeProfile(profile),
    width: info.width,
    height: info.height,
    mimeType: "image/png",
    previewDataUrl: `data:image/png;base64,${data.toString("base64")}`,
    processor: "thermal-image-sharp-threshold-v1",
    constraints: profiles[normalizeProfile(profile)]
  };
}
