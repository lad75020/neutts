import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { synthesizeToMp3 } from "./neutts.js";

const SynthesizeInput = {
  text: z.string().min(1).describe("Text to synthesise into speech."),
  reference_text: z
    .string()
    .min(1)
    .describe("Transcript of the reference voice sample (must match what is spoken in the audio)."),
  reference_audio_base64: z
    .string()
    .min(1)
    .describe(
      "Base64-encoded reference voice sample. Any audio format that ffmpeg can decode is accepted (wav, mp3, ogg, m4a, flac, ...).",
    ),
  backbone: z
    .string()
    .optional()
    .describe("Optional NeuTTS backbone repo id, e.g. 'neuphonic/neutts-air-q4-gguf'."),
  codec: z
    .string()
    .optional()
    .describe("Optional NeuCodec repo id, e.g. 'neuphonic/neucodec'."),
  device: z
    .enum(["cpu", "cuda"])
    .optional()
    .describe("Compute device for the NeuTTS backbone and codec."),
};

export function buildMcpServer({ log } = {}) {
  const server = new McpServer(
    { name: "neutts-mcp-server", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Voice-cloning text-to-speech via the NeuTTS Python backend. " +
        "Provide a short clean reference audio sample (3-15 s, mono speech) plus its transcript " +
        "and the text to synthesise. The server normalises the reference to WAV with ffmpeg, " +
        "runs NeuTTS, and returns the result as an MP3.",
    },
  );

  server.registerTool(
    "synthesize_speech",
    {
      title: "Synthesize speech (NeuTTS voice cloning)",
      description:
        "Synthesise text in the voice of a reference audio sample using NeuTTS. " +
        "The reference audio may be in any format that ffmpeg can decode; it is " +
        "automatically converted to mono 24 kHz WAV before being fed to the backend. " +
        "The synthesised audio is returned as MP3.",
      inputSchema: SynthesizeInput,
    },
    async ({ text, reference_text, reference_audio_base64, backbone, codec, device }) => {
      let referenceAudio;
      try {
        referenceAudio = Buffer.from(reference_audio_base64, "base64");
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text", text: `Invalid base64 reference_audio: ${err.message}` }],
        };
      }
      if (referenceAudio.length === 0) {
        return {
          isError: true,
          content: [{ type: "text", text: "reference_audio_base64 decoded to zero bytes." }],
        };
      }

      try {
        const mp3 = await synthesizeToMp3({
          referenceAudio,
          referenceText: reference_text,
          text,
          backbone,
          codec,
          device,
          log,
        });
        return {
          content: [
            { type: "audio", data: mp3.toString("base64"), mimeType: "audio/mpeg" },
            { type: "text", text: `Synthesised ${mp3.length} bytes of MP3 audio.` },
          ],
        };
      } catch (err) {
        log?.error({ err }, "synthesize_speech failed");
        return {
          isError: true,
          content: [{ type: "text", text: `NeuTTS synthesis failed: ${err.message}` }],
        };
      }
    },
  );

  return server;
}
