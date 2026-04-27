# NeuTTS MCP server

A streaming-HTTP Model Context Protocol server, built with Fastify, that exposes
the NeuTTS Python backend as a single tool:

| Tool                | Description                                                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `synthesize_speech` | Takes a reference voice sample (any format ffmpeg can decode) plus a transcript and a target text, runs NeuTTS voice-cloning TTS, and returns MP3. |

Pipeline: `client → MCP /mcp → ffmpeg (→ WAV) → python/tts_runner.py (NeuTTS) → ffmpeg (→ MP3) → client`.

## Requirements
- Node.js ≥ 20
- `ffmpeg` on `PATH` (or set `FFMPEG_BIN`)
- Python 3.10+ (or set `PYTHON_BIN`) with `neutts` importable. Either
  `pip install -r python/requirements.txt`, or clone the upstream repo into
  `./neutts/` (the runner adds it to `sys.path` automatically).

## Run
