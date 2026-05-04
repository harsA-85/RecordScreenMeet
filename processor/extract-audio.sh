#!/usr/bin/env bash
# Convert a recording to a small mono 16kHz m4a so it fits under Whisper's 25 MB limit.
# Usage:  ./extract-audio.sh input.webm  ->  input.m4a
set -euo pipefail
if [ $# -lt 1 ]; then
  echo "Usage: $0 <input-video>"; exit 1
fi
in="$1"
out="${in%.*}.m4a"
ffmpeg -y -i "$in" -vn -ac 1 -ar 16000 -b:a 32k "$out"
echo "Wrote $out"
