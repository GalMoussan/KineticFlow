# Sources of the M3 example assets

## `it-had-to-be-you.mp3`

- **Recording:** Isham Jones & his Orchestra, "It Had to Be You" (1924).
- **Source:** Wikimedia Commons,
  <https://commons.wikimedia.org/wiki/File:Isham_Jones_&_his_Orchestra_-_%22It_Had_to_Be_You%22_(1924).oga>
  (file URL `https://upload.wikimedia.org/wikipedia/commons/f/fc/Isham_Jones_%26_his_Orchestra_-_%22It_Had_to_Be_You%22_%281924%29.oga`,
  sha1 `1b87b81735d978533f3b20401543be76958ac00f`, sha256 `5bfb4355b5618b9a39c7600c2603d02f9a2150391b5af88a0e0373335e0144c0`).
- **Licence:** public domain (Commons LicenseShortName "Public domain").
- **Excerpt:** 30.000–70.000 s of the original, converted with ffmpeg 9.0.2:

  ```
  ffmpeg -ss 30 -t 40 -i it_had_to_be_you_1924.oga -map a:0 -map_metadata -1 -ac 2 -ar 48000 \
         -c:a libmp3lame -b:a 192k -id3v2_version 0 it-had-to-be-you.mp3
  ```

  Result: 40.000 s, 48 kHz stereo MP3 192 kbit/s, 961,344 bytes, sha256
  `6d6e9ac28dac6af43120f37c13bb4aa90d0681cb2a65252a9c283cc122d89d92`.
