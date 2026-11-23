#!/usr/bin/env bash
# Recreate spikes/beats/audio/ (git-ignored): reel audio from the dilemaCafe renders + two public-domain recordings.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p audio
for n in 9 11 12; do
  ffmpeg -nostdin -v error -y -i ~/projects/dilemaCafe/reel/dilemma-cafe-reel-$n.mp4 -vn -ac 2 -c:a pcm_s16le audio/reel$n.wav
done
UA="ReelStudioSpike/0.1 (research)"
# Isham Jones & his Orchestra - "It Had to Be You" (1924), Public domain, Wikimedia Commons
curl -sL -A "$UA" -o audio/it_had_to_be_you_1924.oga \
  'https://upload.wikimedia.org/wikipedia/commons/f/fc/Isham_Jones_%26_his_Orchestra_-_%22It_Had_to_Be_You%22_%281924%29.oga'
# "Beat, electronic" (PDSounds #363), Public domain, Wikimedia Commons
curl -sL -A "$UA" -o audio/beat_electronic_pd.ogg 'https://upload.wikimedia.org/wikipedia/commons/3/3c/Beat_electronic.ogg'
shasum -c <<'EOF'
1b87b81735d978533f3b20401543be76958ac00f  audio/it_had_to_be_you_1924.oga
8b6fff899d2a5c1780a22ec7de16890b9da3b2c5  audio/beat_electronic_pd.ogg
EOF
