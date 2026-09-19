#!/bin/sh
# vhs 0.12 (Homebrew) writes no GIF with ffmpeg 9, but its frame capture works.
# Encode each demo/<name>.frames/ into demo/<name>.gif: text frames with the cursor overlaid.
set -e
cd "$(dirname "$0")/.."
for d in demo/*.frames; do
  name=$(basename "$d" .frames)
  ffmpeg -y -loglevel error -framerate 50 -i "$d/frame-text-%05d.png" -framerate 50 -i "$d/frame-cursor-%05d.png" \
    -filter_complex "[0:v][1:v]overlay,fps=20,scale=1000:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5" \
    "demo/$name.gif"
  echo "demo/$name.gif $(du -h "demo/$name.gif" | cut -f1)"
done
