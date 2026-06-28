# AGENTS.md

Guidance for AI agents (and humans) working in this repo.

## What this is

**tick** — a small, fast countdown app: a compact vertical list of named timers,
built to be lighter and simpler than the Windows Clock app.

**Stack:** Tauri v2 (Rust shell + WebView2) with a plain HTML/CSS/JS frontend.
**No framework, no bundler, no frontend build step.** The entire UI is three files
in `src/` served directly.

## Layout

```
src/                  frontend — served as-is, no build step
  index.html          markup: topbar, timer list, the new/edit overlay form
  styles.css          all styling; CSS variables (theme) live in :root at the top
  main.js             ALL app logic: state, persistence, render, the tick loop
src-tauri/            Rust shell
  Cargo.toml          Rust deps (Tauri plugins are added here)
  tauri.conf.json     window size/title (initial only), bundle config, withGlobalTauri
  capabilities/default.json   ACL — frontend must be granted each plugin's perms
  src/lib.rs          Builder setup: plugins are registered here
  src/main.rs         thin entry point — calls tick_lib::run(), don't touch
  icons/              app icons
README.md             user-facing overview
```

## How it works (frontend)

- State is an array of `Timer` objects (see the typedef at the top of `main.js`),
  persisted to `localStorage` under `tick.timers.v1`. Running timers are paused on
  reload (never restored mid-flight).
- A single `setInterval(loop, 250)` drives **every** timer. `loop()` does cheap
  per-row text updates via `updateRow()`; `render()` rebuilds the whole list and is
  only called on structural changes (add/remove/start/pause/reset), not 4×/sec.
- `fire()` runs when a timer hits zero: plays a triple-beep (`beep()`, WebAudio) and
  sends a native toast (`notifyDone()`).
- Volume is a slider in the topbar, persisted under `tick.volume.v1` (0–100, where
  **50 == the original fixed loudness**, mapped to a 0–0.5 peak gain in `peakGain()`).

## Conventions

- **Surgical edits.** Match the existing terse, comment-light style. Keep logic in
  the same single-file structure — don't introduce a framework, a bundler, modules,
  or a `package.json` dependency for the frontend.
- **Vanilla only on the frontend.** DOM is built with template strings + `innerHTML`;
  user-supplied text MUST go through `escapeHtml()` (see how `.name` is rendered).
- **Section banners.** `main.js` is organized with `// ---------- section ----------`
  comments — keep new code under the right banner.
- **Theme via CSS variables.** Add/adjust colors through the `:root` vars in
  `styles.css`, don't hardcode hex values in component rules.

## Calling into Tauri / adding a plugin

`withGlobalTauri: true` is set, so the frontend uses the global API at
`window.__TAURI__.*` — **no npm `@tauri-apps/*` packages are installed and none
should be** (there's no bundler to resolve them). Always guard
`window.__TAURI__` so the UI still works when opened in a plain browser.

To add a Tauri plugin, all three steps are required:
1. Add the crate to `src-tauri/Cargo.toml`.
2. Register it in `src-tauri/src/lib.rs` (`.plugin(tauri_plugin_x::init())`).
3. Grant its permission in `src-tauri/capabilities/default.json`
   (e.g. `"notification:default"`) — otherwise the frontend call is blocked by the ACL.

## App name & icon

- The user-facing name is **Tick** (capitalized) — set via `productName` and the window
  `title` in `tauri.conf.json`. The Cargo package / binary is still `tick` (lowercase);
  that's internal and not worth renaming. The bundle `identifier` is `com.atade.tick` and
  must stay stable (it keys the app-data dir, so changing it orphans saved window state).
- The icon source of truth is **`app-icon.svg`** (a stopwatch ring + checkmark on a dark
  squircle — the timer/"tick" pun). To regenerate every platform icon after editing it:
  `pnpm icon` (renders the SVG → `app-icon.png` via `sharp`, then runs `tauri icon` to
  emit `src-tauri/icons/*`). `sharp` is a devDependency used only for this.

## Build & run

```sh
pnpm install
pnpm dev      # = tauri dev   (first run compiles the Rust shell, ~1–2 min)
pnpm build    # = tauri build → src-tauri/target/release/ + .../bundle/
```

- **Use `pnpm` only** — never `npm` or `yarn`.
- Changing anything under `src-tauri/` (Rust, Cargo deps, capabilities) requires a
  **recompile** — restart `pnpm dev`; the frontend hot-reload alone won't pick it up.
- On Windows, use the `py` launcher for any Python, not `python3`.

## Bumping the version

The version is duplicated in four files (`package.json`, `src-tauri/tauri.conf.json`,
`src-tauri/Cargo.toml`, and the `tick` entry in `src-tauri/Cargo.lock`). Don't edit them
by hand — run `pnpm bump <x.y.z>` (e.g. `pnpm bump 0.1.2`), which updates all four in
place (see `bump-version.mjs`). Then commit and `pnpm build`.

## Gotchas

- **Notifications show the right app name/icon only in the *installed* build.** The
  notification plugin deliberately omits the AppUserModelID when the exe runs from
  `target/debug` or `target/release` (see `desktop.rs` in the plugin), so in `pnpm dev`
  — *and* when running the loose `target/release/tick.exe` directly — toasts are
  attributed to "Windows PowerShell" (a fallback so they appear at all). To see the
  real "tick" name + icon you must run the app **installed via the generated installer**
  (`pnpm build` → `src-tauri/target/release/bundle/nsis|msi/` → launch from Start Menu);
  the installer registers the AUMID (`com.atade.tick`) and a matching shortcut. There is
  no override to fix the dev-mode attribution. Focus Assist / DnD also suppresses toasts.
- **The window starts hidden and is revealed from JS after first paint.**
  `tauri.conf.json` sets `"visible": false`; `window-state` restores geometry only
  (no `VISIBLE` flag); `main.js` calls `getCurrentWindow().show()` after two animation
  frames (with a `setTimeout` safety net). This prevents the white-flash + reposition
  jump on launch. If you change startup/render logic, make sure `show()` still runs on
  every path — otherwise the window stays invisible.
- **Window size/position persist across launches** via `tauri-plugin-window-state`
  (registered in `lib.rs`). It saves on exit and restores on launch, so the `width`/
  `height` in `tauri.conf.json` only apply to the *first ever* launch; after that the
  saved state wins. The state lives in an OS app-data file, not `localStorage`. To
  reset to the config defaults, delete that file (or call the plugin's clear command).
- **`localStorage` keys are versioned** (`...v1`). If you change a stored shape,
  bump the key and handle migration in the corresponding `load*()` function.
- **Don't edit `src-tauri/src/main.rs`** — the real setup lives in `lib.rs`.
