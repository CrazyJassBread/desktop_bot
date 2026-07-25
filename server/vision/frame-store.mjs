import sharp from "sharp";

const MAX_FRAME_BYTES = 8 * 1024 * 1024;

async function readBody(request, limit = MAX_FRAME_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error("FRAME_TOO_LARGE");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function createVisionFrameStore({ width = 640, height = 480 } = {}) {
  let latest = null;
  let sequence = 0;

  return {
    async accept(request) {
      const contentType = String(request.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
      if (!["image/jpeg", "image/jpg"].includes(contentType)) {
        const error = new Error("UNSUPPORTED_IMAGE_TYPE");
        error.statusCode = 415;
        throw error;
      }

      const image = await readBody(request);
      if (image.length < 4 || image[0] !== 0xff || image[1] !== 0xd8) {
        const error = new Error("INVALID_JPEG");
        error.statusCode = 400;
        throw error;
      }

      let metadata;
      try {
        metadata = await sharp(image).metadata();
      } catch {
        const error = new Error("INVALID_JPEG");
        error.statusCode = 400;
        throw error;
      }
      if (metadata.width !== width || metadata.height !== height) {
        const error = new Error(`EXPECTED_${width}x${height}`);
        error.statusCode = 422;
        throw error;
      }

      sequence += 1;
      latest = {
        id: String(sequence),
        image,
        receivedAt: Date.now(),
        sessionId: String(request.headers["x-session-id"] || "bot")
      };
      return latest;
    },

    getLatest(after = "") {
      if (!latest || latest.id === String(after)) return null;
      return latest;
    },

    status() {
      return {
        ready: Boolean(latest),
        frameId: latest?.id || null,
        receivedAt: latest?.receivedAt || null,
        width,
        height
      };
    }
  };
}

