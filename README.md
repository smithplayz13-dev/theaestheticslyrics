<p align="center">
  <img src="docs/images/banner.png" alt="theaestheticslyrics: every word lights up" width="100%">
</p>

<p align="center">
  <a href="https://github.com/darshanseenivasakumar/theaestheticslyrics/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/darshanseenivasakumar/theaestheticslyrics?color=ca415e&label=download"></a>
  <a href="https://github.com/darshanseenivasakumar/theaestheticslyrics/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/darshanseenivasakumar/theaestheticslyrics/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Windows 10 and 11" src="https://img.shields.io/badge/Windows-10%20%7C%2011-ca415e">
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-ca415e"></a>
</p>

**theaestheticslyrics** lights up the lyrics of the song you're playing one word at a time, right as each word is sung. It sits in the Windows system tray and follows Spotify, Apple Music or the [Kodama](https://github.com/KiyoshiTheDevil/Kodama) YouTube Music client. The lyrics show on a full-screen lyrics screen when you step away, float over your desktop while you work, or expand into an immersive split-screen Ambient Mode with full playback controls.

It's a Windows take on [Verci](https://verci.xyz), a Mac app. It's free and open source, and you don't need an account or an API key.

## Download

1. Download the **`theaestheticslyrics-<version>-win-x64.zip`** file from the [latest release](https://github.com/darshanseenivasakumar/theaestheticslyrics/releases/latest). It needs Windows 10 or 11, 64-bit.
2. Unzip it anywhere you like.
3. Run **`theaestheticslyrics.exe`**. There's nothing to install. To uninstall, delete the folder.

> [!NOTE]
> The app isn't code-signed, so Windows SmartScreen may say *"Windows protected your PC"* the first time. Click **More info → Run anyway**. Every release is built from the source in this repository, and you can build it yourself (see [Build from source](#build-from-source)).

**Tip:** to put an icon on your desktop, right-click `theaestheticslyrics.exe`, then **Show more options → Send to → Desktop (create shortcut)**. Opening that icon while the app is already running shows the lyrics right away.

## Five Visualization Styles

| Ship | Fisheye |
|:---:|:---:|
| <img src="docs/images/style-ship.png" alt="Ship style" width="420"> | <img src="docs/images/style-fisheye.png" alt="Fisheye style" width="420"> |
| Words stack into a wall that drifts in 3D. The word being sung pops forward on a highlight box. | A convex stack of words under a WebGL glass-lens shader. The word being sung sits closest to the glass. |
| **Fisheye Visual** | **Visual** |
| <img src="docs/images/style-fisheye-visual.png" alt="Fisheye Visual style" width="420"> | <img src="docs/images/style-visual.png" alt="Visual style" width="420"> |
| The same WebGL lens, with matching Fluent icons beside the words. | One word at a time, with a matching icon or emoji popping in beside it. |

### Codestyle (New!)
A developer-focused coding environment aesthetic. Lyrics are rendered as tokenized syntax within an authentic code editor canvas featuring line numbers, keyword highlight boxes, active line indicator, and an editor status bar. Codestyle features an **invariant dark gradient background** (`#0b0a09` &rarr; `#060607` &rarr; `#000000`) that preserves its distinct terminal identity across all playback states and transitions.

*The screenshots use an original demo song written for this project.*

## Ambient Mode (Fullscreen Player)

Press **A** (or click the expand toggle in the top-right corner, or select tray &rarr; **Ambient Mode (Fullscreen Player)**) to switch to the immersive Ambient Mode.

- **Split-Screen Experience:**
  - **Left Side:** Active lyrics visualization adapted dynamically to the selected style.
  - **Right Side:** High-resolution album artwork card, track title, artist, live interactive seekbar with elapsed and total time, and media controls (Play / Pause, Next, Previous).
- **Artwork-Derived Ambient Glow:** A large, breathing, blurred glow derived from the album cover art fills the background, adding rich depth and atmosphere.
- **Style-Aware Adaptation:**
  - **Ship & Visual:** Lyrics float cleanly over the ambient glow and artwork-derived gradient.
  - **Fisheye & Fisheye-Visual:** Refactored WebGL lens shader preserves transparency so ambient glow and backgrounds shine through the glass, while disabling clock fades to ensure full word stack visibility.
  - **Codestyle:** Retains its invariant code editor background, pinning the code editor on the left and ambient artwork on the right without introducing album color washes over the editor.
- **Automatic Instrumental Gap Transitions:**
  - Automatically detects extended instrumental breaks (&ge; 8 seconds) in timed lyrics.
  - Crossfades smoothly (500ms) away from the lyrics to focus on the centered album artwork card.
  - Seamlessly restores the lyrics presentation ~500ms before the next vocal begins.
  - Supports seeking into or out of gaps, track changes, and paused playback without visual jumps.

## How to use it

1. Play a song in **Spotify**, **Apple Music** or **Kodama**.
2. Press **Ctrl+Alt+L**. The lyrics fill the screen. Press **Esc** to close them.
3. Every setting is in the tray icon (the pink **a**). On Windows 11 it may be hidden under the **^** arrow; drag it onto the taskbar to keep it visible.

### Where the lyrics show

Pick one in tray → **Show Lyrics**.

- **On the Lock Screen** (the default). Windows doesn't let apps draw on the real lock screen, so the app has its own full-screen lyrics screen with a clock.
  - **Ctrl+Alt+L** opens it. It stays up while you move the mouse or skip songs. **Esc** closes it, and so does pressing **Ctrl+Alt+L** again.
  - **When you're away:** after 2 minutes without input, while a song with lyrics is playing, the lyrics screen opens on its own and closes when you come back. Change the delay or turn it off in tray → **Lyrics Screen When Idle**.
  - **Lock Windows When I Come Back** (off by default) turns Ctrl+Alt+L into "lock my PC with lyrics". Any key or mouse move then closes the lyrics and locks Windows, so your PIN or password is needed.
- **Always.** The words float above everything. Clicks go straight through them, and they hide 3 seconds after you pause.

### Dynamic Background & Colours

- **Dynamic Artwork Background:** Automatically extracts dominant and secondary colors from album artwork and renders smooth, dual-layer crossfading background gradients.
- **Lyrics Colors Window:** Pick tray &rarr; **Lyric Text…**, **Highlight…**, or **Secondary Text…** to open the dedicated Lyrics Colors window.
  - **Auto Sync:** Automatically extracts readable lyric text, highlight box, and upcoming word colors directly from the album art.
  - **Custom Palette Wells:** Choose your own hex colors for sung words, the active highlight box, and upcoming lines.
  - **Reset Colors:** Reverts to the default aesthetic palette (crimson, rose highlight, and soft pink).

### Everything in the tray

| Setting | What it does |
|---|---|
| **Display** | Picks the monitor the lyrics appear on. |
| **Style** | Ship, Fisheye, Fisheye Visual, Visual, or Codestyle. |
| **Ambient Mode (Fullscreen Player)** | Toggles the split-screen player with album art card and controls (hotkey **A**). |
| **Timing** | Shifts the words earlier or later. Bluetooth headphones usually need *0.25–0.5 s Later*. |
| **Precise Word Timing (NetEase)** | Uses real per-word timing when NetEase has the song in *Automatic*. |
| **Players** | *Spotify and Apple Music* (the default), *Kodama* only, or *All Media Apps* (browsers and anything else that shows in Windows' media controls). |
| **Lyrics Provider** | *Automatic* (the default) uses every source below in order. Pick *Local Files Only*, *Musixmatch*, *Karalyr*, *Better Lyrics*, *Better Lyrics Portato*, *Unison*, *LRCLIB* or *NetEase* to use only that source. |
| **Open Lyrics Folder** | Opens the folder for your own `.lrc` files. |
| **Start with Windows** | Starts the app quietly in the tray when you sign in. |

While a song with lyrics plays, your display stays awake. When the music stops, Windows' normal sleep and lock timers take over again.

### Following Kodama (YouTube Music)

[Kodama](https://github.com/KiyoshiTheDevil/Kodama) is a free desktop YouTube Music client for Windows. theaestheticslyrics follows it through Windows' own media controls — the same system Spotify and Apple Music use — so titles, artists, album art and progress arrive on their own; no plugin is needed in either app.

- Pick tray → **Players → Kodama** to follow only Kodama. Browsers and other apps stop competing for the lyrics, even with a paused YouTube session in the background.
- **All Media Apps** follows Kodama too, but it prefers whatever Windows considers the current session, so a second playing app can take over the lyrics. Choose *Kodama* when you want it to be the one and only source.

## Where the lyrics come from

In **Automatic**, free sources are tried in order and prioritized by synchronization quality (**syllable > word > line > unsynced**):

1. **[Karalyr](https://karalyr.com)**: Open karaoke lyrics database with real *word-by-word* timing.
2. **[Better Lyrics](https://docs.betterlyrics.org)**: Cache-first API delivering Apple-Music-style TTML with *syllable-level* timing.
3. **Better Lyrics Portato**: Word-level synchronized lyrics and karaoke timing associated with QQ Music (via QRC / TTML).
4. **Better Lyrics Unison**: Community-contributed lyrics platform (`https://unison.betterlyrics.org`) supporting syllable, word, line, and unsynchronized community lyrics.
5. **[LRCLIB](https://lrclib.net)**: Open, community-run lyrics database with exact *line* timing for a vast catalog of tracks. Inside each line, the app estimates word timing from syllables and punctuation.
6. **NetEase Cloud Music**: Web API providing real *per-word* timing for supported tracks.
7. **[Musixmatch](https://developer.musixmatch.com)**: Developers can paste their own API key into `src/main/secrets.ts` (from `secrets.example.ts`) for word-by-word timing.
8. **Local Files**: Drop `.lrc` files into `%APPDATA%\theaestheticslyrics\Lyrics`, named `Artist - Title.lrc`. Enhanced LRC with `<mm:ss.xx>` word tags is supported natively.

> [!NOTE]
> **Ambient Rim Lighting (Experimental / Work in Progress):**
> A native multi-layer, Lumn-inspired screen-edge ambient rim lighting system (with corner emitters, edge diffusion wash, and music-reactive breathing) is actively under development. While undergoing refinement and performance optimization, this feature is disabled by default and hidden from user-facing settings.

## Privacy

- To look lyrics up, the app sends only the song's **title, artist, album and length** to the sources that can answer: `karalyr.com`, `api.betterlyrics.org`, `unison.betterlyrics.org`, `lrclib.net`, `music.163.com`, and `api.musixmatch.com` (if configured). Pinning a provider limits requests to that provider; *Local Files Only* makes no external requests.
- It has no accounts, analytics, telemetry or ads.
- Everything else stays on your PC in `%APPDATA%\theaestheticslyrics`: settings, the lyrics cache, logs, and local lyrics.

## Troubleshooting

| Problem | Fix |
|---|---|
| The first launch takes a few seconds | Windows scans a newly downloaded app once. The lyrics screen appears as soon as the scan finishes, and later launches are instant. |
| The tray says *Cannot read what is playing* | The app reads Windows' media controls through Windows PowerShell 5.1, which comes with Windows. Check that `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe` exists and isn't blocked by a policy. |
| *No synced lyrics for …* | The selected source has no timed lyrics for that song. Add your own `.lrc` file or select another provider in the tray. |
| **Musixmatch** is greyed out | It needs a Musixmatch API key in `src/main/secrets.ts`. Without one, other sources continue to work seamlessly. |
| Words light up a little early or late | Use tray → **Timing**. Bluetooth audio usually runs 0.25–0.5 s behind. |
| Ctrl+Alt+L does nothing | Another app already uses that shortcut. Open the lyrics screen via the tray menu. |
| Touching anything after Ctrl+Alt+L shows the Windows sign-in screen | **Lock Windows When I Come Back** is on. Turn it off in the tray. |
| Ambient Mode doesn't dismiss on mouse move | In Ambient Mode, mouse movements and media scrubbing are expected; press **Esc** or click the exit button to return to the desktop. |

- **Log:** `%APPDATA%\theaestheticslyrics\logs\theaestheticslyrics.log`
- **Settings:** `%APPDATA%\theaestheticslyrics\settings.json`

## Build from source

Requires Windows 10 or 11 and [Node.js](https://nodejs.org) 22.12 or newer (24 LTS recommended).

```powershell
git clone https://github.com/darshanseenivasakumar/theaestheticslyrics.git
cd theaestheticslyrics
npm ci
npm run dev
```

| Command | What it does |
|---|---|
| `npm run dev` | Runs the app with hot reload. |
| `npm test` | Runs the unit test suite (Vitest). |
| `npm run typecheck` | Runs strict TypeScript verification for main and renderer processes. |
| `npm run build` | Builds the production bundles for Electron main, preload, and renderer. |
| `npm run package` | Builds the portable Windows application folder and zip into `release\`. |
| `npm run snapshot` | Renders every style offscreen into `snapshots\*.png`. |
| `npm run fake-player` | Starts a silent test player that registers in Windows media controls. |
| `npm run check:lrclib` | Runs a live metadata verification check against lrclib.net. |
| `npm run lyrics:server` | Starts the optional zero-dependency Better Lyrics proxy on `127.0.0.1:8787`. |
| `npm run icons` | Regenerates the Fluent icon subset and application icons. |

## Credits

- Inspired by [Verci](https://verci.xyz) for macOS.
- Lyrics provided by [Karalyr](https://karalyr.com), [Better Lyrics](https://docs.betterlyrics.org), [LRCLIB](https://lrclib.net), and NetEase Cloud Music.
- Font: [Inter](https://rsms.me/inter/) (SIL OFL 1.1) and Space Mono.
- Icons: [Fluent UI System Icons](https://github.com/microsoft/fluentui-system-icons) (MIT) and Segoe UI Emoji.
- Built with [Electron](https://www.electronjs.org), [electron-vite](https://electron-vite.org), and TypeScript.

theaestheticslyrics is an independent open-source project. It is not affiliated with or endorsed by Verci, Spotify, Apple, Karalyr, Better Lyrics, NetEase, LRCLIB or Kodama. Lyrics belong to their respective songwriters and publishers.

## License

[MIT](LICENSE) © 2026 darshanseenivasakumar
