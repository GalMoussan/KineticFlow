#!/usr/bin/env bash
# Run analyze.py twice per case in fresh processes and compare SHA-256 of the JSON outputs.
# Also compares CPU vs MPS output with the "device" field removed.
set -euo pipefail
cd "$(dirname "$0")"
tmp=$(mktemp -d)
cases=(
  "audio/reel11.wav --fps 30"
  "audio/reel12.wav --fps 60"
  "audio/it_had_to_be_you_1924.oga --fps 60"
  "audio/it_had_to_be_you_1924.oga --fps 30 --offset 30.017 --duration 26"
  "audio/beat_electronic_pd.ogg --fps 60 --offset 10 --duration 26"
)
i=0
for c in "${cases[@]}"; do
  i=$((i + 1))
  # shellcheck disable=SC2086
  uv run analyze.py $c -o "$tmp/$i.a.json" 2>/dev/null
  # shellcheck disable=SC2086
  uv run analyze.py $c -o "$tmp/$i.b.json" 2>/dev/null
  # shellcheck disable=SC2086
  uv run analyze.py $c --device mps -o "$tmp/$i.mps.json" 2>/dev/null
  ha=$(shasum -a 256 "$tmp/$i.a.json" | cut -c1-16)
  hb=$(shasum -a 256 "$tmp/$i.b.json" | cut -c1-16)
  hc=$(jq -cS 'del(.analysis.device)' "$tmp/$i.a.json" | shasum -a 256 | cut -c1-16)
  hm=$(jq -cS 'del(.analysis.device)' "$tmp/$i.mps.json" | shasum -a 256 | cut -c1-16)
  same=$([ "$ha" = "$hb" ] && echo IDENTICAL || echo DIFFERENT)
  mps=$([ "$hc" = "$hm" ] && echo same || echo differs)
  echo "| \`$c\` | $ha | $hb | $same | cpu vs mps (device field removed): $mps |"
done
rm -rf "$tmp"
