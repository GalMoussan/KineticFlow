# Sources of the m3-reactive example assets

## `beat-electronic.mp3`

- **Recording:** "Beat, electronic" (PDSounds #363).
- **Source:** Wikimedia Commons, <https://commons.wikimedia.org/wiki/File:Beat_electronic.ogg>
  (file URL `https://upload.wikimedia.org/wikipedia/commons/3/3c/Beat_electronic.ogg`, sha1
  `8b6fff899d2a5c1780a22ec7de16890b9da3b2c5`, sha256 `6a8797ed97e78e28d8c22eca5348d52f50c2d2a736520fbc08fd131b9581ff58`;
  fetched by `spikes/beats/fetch_audio.sh`).
- **Licence:** public domain.
- **Excerpt:** 10.000–40.000 s of the original, converted with ffmpeg 9.0.2:

  ```
  ffmpeg -ss 10 -t 30 -i beat_electronic_pd.ogg -map a:0 -map_metadata -1 -ac 2 -ar 48000 \
         -c:a libmp3lame -b:a 192k -id3v2_version 0 beat-electronic.mp3
  ```

  Result: 30.000 s, 48 kHz stereo MP3 192 kbit/s, 721,152 bytes, sha256
  `cbbfaf9a36e6a498e10af4cb086200a2529fc95616039f64a7d005501738d4f8`.

## `ayalim.png`, `kiryat-shmona.png`

Copies of `examples/assets/` (the dilemma example's logos).
