# tick

A small, fast countdown app — a compact vertical list of named timers. Built to be
lighter and simpler than the Windows Clock app.

Stack: **Tauri v2** (Rust shell + WebView2) with a plain HTML/CSS/JS frontend — no
framework, no bundler. The whole UI is three files in `src/`.

## Run it

```sh
pnpm install
pnpm dev        # = tauri dev
```

First run compiles the Rust shell (a minute or two); after that it's instant.

## Build a release exe / installer

```sh
pnpm build      # = tauri build
```

Output lands in `src-tauri/target/release/` (the `.exe`) and
`src-tauri/target/release/bundle/` (MSI / NSIS installers).

## Features

- Multiple named countdown timers in a compact list
- Start / pause / reset per timer; edit name & duration; delete
- Audible triple-beep + native notification when a timer hits zero
- Timers persist across restarts — a running timer resumes where it left off, and one
  that finished while the app was closed shows as done with a catch-up notification
- Runs in the background: closing the window hides it to the system tray (timers keep
  ticking); optional **Start at login** from the tray menu
- Keyboard: `Ctrl+N` new timer, `Esc` close the dialog

## Layout

```
src/                 frontend (no build step)
  index.html
  styles.css
  main.js            all timer logic + a single 250ms tick loop
src-tauri/           Rust shell, window config, icons
  tauri.conf.json    window size lives here
  src/lib.rs         tray, background, autostart, window setup
```

## License

[MIT](LICENSE) © Ângelo Tadeucci
