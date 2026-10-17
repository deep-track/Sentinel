# Training videos

Each video is built from its manual chapter by four scripts. Run them from the repo root.

1. `node tools/videos/login.mjs`: opens Chrome so you can sign in to Sentinel (Continue with Google), once. The session is saved to `tools/videos/.auth/` (git-ignored).
2. `node tools/videos/narrate.mjs <script>`: narrates every voice in the script through Convex (`videoNarration:narrate`, ElevenLabs) into `tools/videos/out/<video>/<voice>/`.
3. `node tools/videos/record.mjs <script>`: records Demo Bank Ltd in Chrome, holding each scene for its longest narration. Add `--show` to watch it.
4. `node tools/videos/assemble.mjs <script>`: writes `out/<video>/<video>-<voice>.mp4` (1080p) and `.srt` captions for YouTube.

Scripts live in `tools/videos/scripts/<video>.json`:

- `voices`: `default` is Bella. `kenyan` is Yna Agalo, which needs a paid ElevenLabs plan.
- `prepare`: off-camera steps that reset Demo Bank before recording.
- `scenes`: `say`, the narration, and `show`, the actions.

Actions:

- `goto`, `click`, `highlight`, `zoom`, `scroll`
- `select`, with an optional `option`
- `type`, with `text`
- `card`, with a `subtitle`

Targets:

- `sidebar:<link>`, `button:<name>`, `case:<name>`
- `card:<heading>`, `text:<text>` (the box around it), `heading:<text>`, `field:<label>`, `form:decision`
- `queue-filter:<queue>`, `views`

Needs ffmpeg (`winget install Gyan.FFmpeg`) and Google Chrome.
