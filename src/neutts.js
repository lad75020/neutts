import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { toReferenceWav, wavToMp3, withTempDir } from "./audio.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const RUNNER = join(PROJECT_ROOT, "python", "tts_runner.py");
const PYTHON = process.env.PYTHON_BIN ?? "/home/laurent/miniconda3/envs/neutts/bin/python3";

function runPython(spec, log) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, [RUNNER], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: PROJECT_ROOT,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    child.stdout.on("data", (c) => stdoutChunks.push(c));
    child.stderr.on("data", (c) => {
      stderrChunks.push(c);
      if (log) log.debug({ stderr: c.toString() }, "neutts stderr");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString().trim();
      const stderr = Buffer.concat(stderrChunks).toString();
      const lastLine = stdout.split("\n").pop() ?? "";
      let parsed = null;
      try { parsed = JSON.parse(lastLine); } catch {}
      if (code === 0 && parsed?.ok) {
        resolve(parsed);
      } else {
        const msg = parsed?.error ?? `python exited with code ${code}`;
        const err = new Error(`NeuTTS backend failed: ${msg}`);
        err.stderr = stderr;
        err.stdout = stdout;
        reject(err);
      }
    });
    child.stdin.end(JSON.stringify(spec));
  });
}

export async function synthesizeToMp3({
  referenceAudio, referenceText, text, backbone, codec, device, log,
}) {
  if (!Buffer.isBuffer(referenceAudio) || referenceAudio.length === 0) {
    throw new Error("referenceAudio must be a non-empty Buffer");
  }
  if (!referenceText || typeof referenceText !== "string") {
    throw new Error("referenceText is required");
  }
  if (!text || typeof text !== "string") {
    throw new Error("text is required");
  }

  log?.info({ bytes: referenceAudio.length }, "converting reference audio to wav");
  const refWav = await toReferenceWav(referenceAudio, log);

  return withTempDir(async (dir) => {
    const refPath = join(dir, "ref.wav");
    const outPath = join(dir, "out.wav");
    await writeFile(refPath, refWav);

    log?.info({ refPath, outPath }, "invoking neutts backend");
    await runPython(
      {
        ref_audio_path: refPath,
        ref_text: referenceText,
        input_text: text,
        output_path: outPath,
        ...(backbone ? { backbone } : {}),
        ...(codec ? { codec } : {}),
        ...(device ? { device } : {}),
      },
      log,
    );

    const wav = await readFile(outPath);
    log?.info({ wavBytes: wav.length }, "encoding output to mp3");
    return wavToMp3(wav, log);
  });
}
