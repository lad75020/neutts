import { spawn } from "node:child_process";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FFMPEG = process.env.FFMPEG_BIN ?? "ffmpeg";

function run(cmd, args, { input, log } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    const stdoutChunks = [];
    const stderrChunks = [];
    child.stdout.on("data", (c) => stdoutChunks.push(c));
    child.stderr.on("data", (c) => {
      stderrChunks.push(c);
      if (log) log.debug({ proc: cmd, stderr: c.toString() }, "subprocess stderr");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const stderr = Buffer.concat(stderrChunks).toString();
      if (code === 0) resolve({ stdout: Buffer.concat(stdoutChunks), stderr });
      else reject(new Error(`${cmd} exited with code ${code}: ${stderr.slice(-2000)}`));
    });
    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

export async function toReferenceWav(inputBuffer, log) {
  return (
    await run(
      FFMPEG,
      ["-hide_banner", "-loglevel", "error", "-i", "pipe:0",
       "-vn", "-ac", "1", "-ar", "24000", "-f", "wav", "pipe:1"],
      { input: inputBuffer, log },
    )
  ).stdout;
}

export async function wavToMp3(wavBuffer, log) {
  return (
    await run(
      FFMPEG,
      ["-hide_banner", "-loglevel", "error", "-i", "pipe:0",
       "-codec:a", "libmp3lame", "-b:a", "192k", "-f", "mp3", "pipe:1"],
      { input: wavBuffer, log },
    )
  ).stdout;
}

export async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "neutts-mcp-"));
  try { return await fn(dir); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

export { readFile, writeFile, join };
