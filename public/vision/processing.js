export class GestureStabilizer {
  constructor({ windowSize = 5, requiredHits = 3, releaseFrames = 2 } = {}) {
    this.windowSize = windowSize;
    this.requiredHits = requiredHits;
    this.releaseFrames = releaseFrames;
    this.history = [];
    this.armed = true;
    this.absentFrames = 0;
  }

  update(present) {
    this.history.push(Boolean(present));
    if (this.history.length > this.windowSize) this.history.shift();
    if (present) {
      this.absentFrames = 0;
    } else {
      this.absentFrames += 1;
      if (this.absentFrames >= this.releaseFrames) {
        this.armed = true;
        this.history = [];
      }
    }
    if (this.armed && this.history.length === this.windowSize && this.history.filter(Boolean).length >= this.requiredHits) {
      this.armed = false;
      return true;
    }
    return false;
  }
}

function grayscaleAndBlur(source) {
  const { data, width, height } = source;
  const gray = new Float32Array(width * height);
  for (let pixel = 0, offset = 0; pixel < gray.length; pixel += 1, offset += 4) {
    gray[pixel] = data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
  }
  const blurred = new Float32Array(gray);
  const kernel = [1, 2, 1, 2, 4, 2, 1, 2, 1];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      let sum = 0;
      let kernelIndex = 0;
      for (let ky = -1; ky <= 1; ky += 1) {
        for (let kx = -1; kx <= 1; kx += 1) {
          sum += gray[(y + ky) * width + x + kx] * kernel[kernelIndex++];
        }
      }
      blurred[y * width + x] = sum / 16;
    }
  }
  return blurred;
}

export function cannyEdges(source, { lowThreshold = 80, highThreshold = 160 } = {}) {
  if (!(lowThreshold >= 0 && lowThreshold < highThreshold)) throw new Error("Invalid Canny thresholds");
  const { width, height } = source;
  const blurred = grayscaleAndBlur(source);
  const magnitude = new Float32Array(width * height);
  const direction = new Uint8Array(width * height);
  const gxKernel = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const gyKernel = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      let gx = 0;
      let gy = 0;
      let kernelIndex = 0;
      for (let ky = -1; ky <= 1; ky += 1) {
        for (let kx = -1; kx <= 1; kx += 1) {
          const value = blurred[(y + ky) * width + x + kx];
          gx += value * gxKernel[kernelIndex];
          gy += value * gyKernel[kernelIndex++];
        }
      }
      const index = y * width + x;
      magnitude[index] = Math.hypot(gx, gy);
      let angle = Math.atan2(gy, gx) * 180 / Math.PI;
      if (angle < 0) angle += 180;
      direction[index] = angle < 22.5 || angle >= 157.5 ? 0 : angle < 67.5 ? 1 : angle < 112.5 ? 2 : 3;
    }
  }

  const suppressed = new Float32Array(width * height);
  const neighbors = [[-1, 1], [-width + 1, width - 1], [-width, width], [-width - 1, width + 1]];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const [before, after] = neighbors[direction[index]];
      if (magnitude[index] >= magnitude[index + before] && magnitude[index] >= magnitude[index + after]) {
        suppressed[index] = magnitude[index];
      }
    }
  }

  const edges = new Uint8Array(width * height);
  const stack = [];
  for (let index = 0; index < suppressed.length; index += 1) {
    if (suppressed[index] >= highThreshold) {
      edges[index] = 1;
      stack.push(index);
    } else if (suppressed[index] >= lowThreshold) {
      edges[index] = 2;
    }
  }
  while (stack.length) {
    const index = stack.pop();
    const x = index % width;
    const y = Math.floor(index / width);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const neighbor = ny * width + nx;
        if (edges[neighbor] === 2) {
          edges[neighbor] = 1;
          stack.push(neighbor);
        }
      }
    }
  }

  const output = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0, offset = 0; pixel < edges.length; pixel += 1, offset += 4) {
    const value = edges[pixel] === 1 ? 0 : 255;
    output[offset] = output[offset + 1] = output[offset + 2] = value;
    output[offset + 3] = 255;
  }
  return { data: output, width, height };
}

export function pixelate(source, blockSize = 2) {
  const { data, width, height } = source;
  const output = new Uint8ClampedArray(data);
  for (let y = 0; y < height; y += blockSize) {
    for (let x = 0; x < width; x += blockSize) {
      let sum = 0;
      let count = 0;
      for (let py = y; py < Math.min(y + blockSize, height); py += 1) {
        for (let px = x; px < Math.min(x + blockSize, width); px += 1) {
          sum += data[(py * width + px) * 4];
          count += 1;
        }
      }
      const value = Math.round(sum / count);
      for (let py = y; py < Math.min(y + blockSize, height); py += 1) {
        for (let px = x; px < Math.min(x + blockSize, width); px += 1) {
          const offset = (py * width + px) * 4;
          output[offset] = output[offset + 1] = output[offset + 2] = value;
          output[offset + 3] = 255;
        }
      }
    }
  }
  return { data: output, width, height };
}

export function createPixelArt(source, {
  blockSize = 4,
  grayscaleLevels = 4,
  contrast = 1.3,
  brightness = 1.05,
  cannyLow = 60,
  cannyHigh = 130,
  edgeRadius = 1
} = {}) {
  const { data, width, height } = source;
  const luminance = new Float32Array(width * height);
  for (let pixel = 0, offset = 0; pixel < luminance.length; pixel += 1, offset += 4) {
    const gray = data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
    luminance[pixel] = Math.max(0, Math.min(255, (gray * brightness - 128) * contrast + 128));
  }

  const output = new Uint8ClampedArray(width * height * 4);
  const quantizeStep = 255 / Math.max(1, grayscaleLevels - 1);
  for (let y = 0; y < height; y += blockSize) {
    for (let x = 0; x < width; x += blockSize) {
      let sum = 0;
      let count = 0;
      for (let py = y; py < Math.min(y + blockSize, height); py += 1) {
        for (let px = x; px < Math.min(x + blockSize, width); px += 1) {
          sum += luminance[py * width + px];
          count += 1;
        }
      }
      const value = Math.round(Math.round((sum / count) / quantizeStep) * quantizeStep);
      for (let py = y; py < Math.min(y + blockSize, height); py += 1) {
        for (let px = x; px < Math.min(x + blockSize, width); px += 1) {
          const offset = (py * width + px) * 4;
          output[offset] = output[offset + 1] = output[offset + 2] = value;
          output[offset + 3] = 255;
        }
      }
    }
  }

  const edges = cannyEdges(source, { lowThreshold: cannyLow, highThreshold: cannyHigh });
  const edgeMask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (edges.data[(y * width + x) * 4] !== 0) continue;
      for (let dy = -edgeRadius; dy <= edgeRadius; dy += 1) {
        for (let dx = -edgeRadius; dx <= edgeRadius; dx += 1) {
          const targetX = x + dx;
          const targetY = y + dy;
          if (targetX >= 0 && targetX < width && targetY >= 0 && targetY < height) {
            edgeMask[targetY * width + targetX] = 1;
          }
        }
      }
    }
  }
  for (let pixel = 0; pixel < edgeMask.length; pixel += 1) {
    if (!edgeMask[pixel]) continue;
    const offset = pixel * 4;
    output[offset] = output[offset + 1] = output[offset + 2] = 0;
  }

  return { data: output, width, height };
}

export function packPrinterBitmap(source) {
  const { data, width, height } = source;
  const grayscale = new Float32Array(width * height);
  for (let pixel = 0, offset = 0; pixel < grayscale.length; pixel += 1, offset += 4) {
    grayscale[pixel] = data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
  }

  const widthBytes = Math.ceil(width / 8);
  const bitmap = new Uint8Array(widthBytes * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const oldValue = grayscale[index];
      const newValue = oldValue < 128 ? 0 : 255;
      const error = oldValue - newValue;
      if (newValue === 0) bitmap[y * widthBytes + Math.floor(x / 8)] |= 1 << (7 - (x % 8));
      if (x + 1 < width) grayscale[index + 1] += error * 7 / 16;
      if (y + 1 < height) {
        if (x > 0) grayscale[index + width - 1] += error * 3 / 16;
        grayscale[index + width] += error * 5 / 16;
        if (x + 1 < width) grayscale[index + width + 1] += error / 16;
      }
    }
  }
  return bitmap;
}
