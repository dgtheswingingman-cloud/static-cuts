# Static-Cuts desktop app (Windows)

Local Cuts with folder watching. The app is a small Tauri window that opens
`https://static-cuts.com/local?desktop=1` and adds:

- two folders, chosen once: where new music lands, and where the tidy library goes
- a watcher on the first folder: a new song that has finished arriving is sent
  to the Local Cuts page, which matches, tags, covers and files it, and the
  tidied copy is written into `Static-Cuts/` in the library folder
- a tray icon: closing the window keeps it watching

Safety: the page can only read files inside the watched folder and only write
inside the library folder (checked in Rust, `..` and absolute paths refused).
Originals are never changed. It never downloads music.

Built by GitHub Actions (`.github/workflows/desktop.yml`) on Windows; the
installer is attached to the run as an artifact. Premium only (checked by the
page). Not code-signed yet, so Windows SmartScreen shows "More info → Run anyway".
