"""Thin CLI wrapper around the NeuTTS Python backend.

Reads a JSON job spec from stdin:
    {
        "ref_audio_path": "/abs/path/ref.wav",
        "ref_text": "transcript of the reference audio",
        "input_text": "text to synthesise",
        "output_path": "/abs/path/out.wav",
        "backbone": "neuphonic/neutts-air-q4-gguf",
        "codec": "neuphonic/neucodec",
        "device": "cpu"
    }

Writes the synthesised WAV at output_path and prints a JSON status to stdout.
"""

from __future__ import annotations

import json
import os
import sys
import traceback
from pathlib import Path


def _ensure_local_neutts_on_path() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    local = repo_root / "neutts"
    if local.is_dir() and str(local) not in sys.path:
        sys.path.insert(0, str(local))


def main() -> int:
    try:
        spec = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        print(json.dumps({"ok": False, "error": f"invalid job spec: {exc}"}))
        return 2

    try:
        ref_audio_path = spec["ref_audio_path"]
        ref_text = spec["ref_text"]
        input_text = spec["input_text"]
        output_path = spec["output_path"]
        backbone = spec.get("backbone", "neuphonic/neutts-air-q4-gguf")
        codec = spec.get("codec", "neuphonic/neucodec")
        device = spec.get("device", "cpu")
    except KeyError as exc:
        print(json.dumps({"ok": False, "error": f"missing field: {exc}"}))
        return 2

    try:
        _ensure_local_neutts_on_path()
        import soundfile as sf  # type: ignore
        from neutts import NeuTTS  # type: ignore

        tts = NeuTTS(
            backbone_repo=backbone,
            backbone_device=device,
            codec_repo=codec,
            codec_device=device,
        )

        ref_codes = tts.encode_reference(ref_audio_path)
        wav = tts.infer(input_text, ref_codes, ref_text)

        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
        sf.write(output_path, wav, 24000)

        print(json.dumps({"ok": True, "output_path": output_path, "sample_rate": 24000}))
        return 0
    except Exception as exc:
        print(json.dumps({
            "ok": False,
            "error": f"{type(exc).__name__}: {exc}",
            "trace": traceback.format_exc(),
        }))
        return 1


if __name__ == "__main__":
    sys.exit(main())
