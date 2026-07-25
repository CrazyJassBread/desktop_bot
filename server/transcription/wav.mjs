const SAMPLE_RATE = 16_000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

export function pcm16leToWav(pcm) {
  const input = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm);
  if (input.length % 2 !== 0) throw new TypeError("PCM16 data must contain complete 16-bit samples");
  const header = Buffer.alloc(44);
  const byteRate = SAMPLE_RATE * CHANNELS * (BITS_PER_SAMPLE / 8);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + input.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(CHANNELS * (BITS_PER_SAMPLE / 8), 32);
  header.writeUInt16LE(BITS_PER_SAMPLE, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(input.length, 40);
  return Buffer.concat([header, input]);
}

export const pcmFormat = Object.freeze({ sampleRate: SAMPLE_RATE, channels: CHANNELS, bitsPerSample: BITS_PER_SAMPLE, encoding: "signed-integer", endianness: "little" });
