# KineticFlow (Reel Studio)

Turns pasted text, logos, colours, fonts and music into kinetic-typography MP4s for Instagram (Hebrew right-to-left first, English too).

It has two parts:
- **The studio**, a local web app at `http://127.0.0.1:<port>`.
- **`reelgen`**, a terminal renderer.

Rendering is deterministic: the same job gives the same video. Everything runs on your own Mac; the only things fetched from the internet are the downloads made by `reelgen setup` and the optional AI calls.

- Design and decisions: [`PLAN.md`](PLAN.md).
- How a style is built and the rendering rules: [`packages/traits/README.md`](packages/traits/README.md).
- The sketch-overlay feature in progress lives on the `sketch` branch.

## Requirements

Any Apple-silicon Mac (M1/M2/M3/M4) on a recent macOS.

| Tool | Version | Why |
|---|---|---|
| Node.js | **26 or newer** | runs the TypeScript sources directly (no build step) |
| pnpm | 10 (the repo pins 10.32.0) | workspace install |
| ffmpeg | current Homebrew build (tested with 9.0) | video encoding and audio loudness |
| uv | any recent | only for beat analysis of your own music files (Python sidecar; uv fetches Python 3.12 itself) |
| Playwright Chromium | installed by step 4 below | renders the frames headlessly |

Disk: about 1 GB for dependencies, fonts, samples and Chromium, plus about 0.8 GB if you set up beat analysis.

Memory: an 8 GB Mac works. With the terminal renderer, use `--workers 3` or `--workers 4`; the default is 8 parallel browsers, which suits 16 GB or more.

## Setup (step by step)

```sh
# 1. Tools (Homebrew: https://brew.sh)
brew install node pnpm ffmpeg uv
node --version          # must print v26.x or newer

# 2. Code
git clone https://github.com/GalMoussan/KineticFlow.git
cd KineticFlow

# 3. Dependencies
pnpm install

# 4. Headless Chromium for rendering
pnpm --filter @reel/render exec playwright install chromium

# 5. Fonts, sound samples and the beat-analysis sidecar (all SHA-256 checked)
pnpm reelgen setup                  # = fonts + samples + analysis
#   lighter alternative, if you never use your own music files:
#   pnpm reelgen setup fonts samples
```

Check it works:

```sh
# Render a sample reel (about 20–60 s); it prints "done ✓" and the output folder under out/
pnpm reelgen render examples/kq-en.json --quality draft --formats 9:16 --workers 4

# Start the studio (it opens the browser; stop it with Ctrl+C)
pnpm reelgen serve
```

### Optional: AI features

AI-assisted steps in the studio need an API key. These are splitting pasted text into sections, suggesting emphasised words and ranking styles; on the `sketch` branch they also include drawings made from a description or a photo. Create a `.env` file in the repo root; it is gitignored, so never commit keys.

```sh
GEMINI_API_KEY=...
ANTHROPIC_API_KEY=...
```

Either key is enough. Without keys, everything else works.

### Optional: AI-generated music

`pnpm reelgen setup music-ai` installs the ACE-Step add-on. It is large: about 1.4 GB of Python packages plus 10 GB of model files, so only install it if you want AI-generated music.

## Everyday use

| Command | What it does |
|---|---|
| `pnpm reelgen serve` | studio web app (default port 5173, or the next free one); `--port N`, `--no-open` |
| `pnpm reelgen render <job.json>` | render a job; `--quality draft\|standard\|final`, `--formats 9:16,1:1,4:5,16:9`, `--workers N`, `--no-cache` |
| `pnpm reelgen clean` | delete temp files and trim caches (`--cache` empties them) |
| `pnpm reelgen --help` | full usage |
| `pnpm typecheck` / `pnpm test` | checks for developers |

Videos go to `out/<job-id>/`. Studio projects live in `data/`, which is local and gitignored.

## Troubleshooting

- **`browserType.launch: Executable doesn't exist`**: Chromium is missing (macOS cache cleaners sometimes delete `~/Library/Caches/ms-playwright`). Re-run step 4.
- **`Ignored build scripts: esbuild` during `pnpm install`**: harmless; nothing needs approving.
- **`EADDRINUSE` on `serve`**: the port is taken; pass `--port 5199` (or any free port).
- **Render is slow or the Mac swaps**: lower `--workers`.
- **`uv: command not found` during `reelgen setup`**: run `brew install uv`, or use `pnpm reelgen setup fonts samples`.

## For Claude Code (or any coding agent) setting this up

Run the "Setup (step by step)" commands in order from the repo root, then the two "Check it works" commands. Notes:

- Confirm `node --version` is ≥ 26 before anything else. If it is older, `brew upgrade node`. Don't add a transpiler or change `engines`: the code relies on Node 26 running `.ts` directly.
- Use `pnpm`, not npm or yarn. The lockfile is `pnpm-lock.yaml`; install with `pnpm install`.
- Step 4 must use the Playwright version from the repo (`pnpm --filter @reel/render exec …`), not a global one, or the browser revision won't match.
- Start the studio with `pnpm reelgen serve --no-open --port <free port>` and keep it running in the background. It's ready when it prints `Reel Studio → http://127.0.0.1:<port>`.
- On an 8 GB machine, pass `--workers 3` to `render`.
- Success means the sample render prints `done ✓` with all `QA ✓` lines, and the studio page loads in a browser.
- Don't create `.env` or ask for API keys unless the user wants AI features; nothing else needs them.
- Before changing code, read `PLAN.md` (architecture and decisions) and `packages/traits/README.md` §1 (determinism rules). Pages must be pure functions of time, with no `Math.random`, `Date` or CSS animations.
