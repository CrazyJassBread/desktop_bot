import { config } from "../config.mjs";
import { pcm16leToWav } from "./wav.mjs";

export async function transcribePcm(pcm, { language } = {}) {
  if (!config.transcription.apiKey) throw new Error("OPENAI_API_KEY is not configured");
  const wav = pcm16leToWav(pcm);
  const form = new FormData();
  form.set("file", new Blob([wav], { type: "audio/wav" }), "recording.wav");
  form.set("model", config.transcription.model);
  form.set("response_format", "json");
  if (language === "en" || language === "zh") form.set("language", language);
  const response = await fetch(`${config.transcription.baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.transcription.apiKey}` },
    body: form,
    signal: AbortSignal.timeout(config.transcription.requestTimeoutMs)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `OpenAI transcription failed with ${response.status}`);
  const transcript = String(payload.text || "").trim();
  if (!transcript) throw new Error("OpenAI returned an empty transcription");
  return { transcript, provider: config.transcription.model };
}
