// Static-Cuts desktop app: Local Cuts with folder watching.
//
// The window shows https://static-cuts.com/local?desktop=1. This file adds
// what a browser can't do, as five commands that page may call:
//   get_folders / choose_folder  the two folders, chosen with the system dialog
//   list_watched                 every song already in the watched folder
//   read_watched                 one song's bytes (only inside the watched folder)
//   write_library                one tidied file (only inside the library folder)
// and a watcher that tells the page when a new song has finished arriving
// ("local-cuts://new-files"). Closing the window keeps it running in the tray.
// It can start with Windows (quietly, in the tray: "--hidden") and shows a
// notification when the page has tidied a batch. It updates itself: every few
// hours it looks for a newer signed version, downloads it quietly and offers
// a restart (tray menu, window, notification).
// Originals are never changed, and nothing is ever downloaded.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::mpsc;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_updater::{Update, UpdaterExt};

const AUDIO: &[&str] = &[
    "mp3", "m4a", "mp4", "aac", "flac", "wav", "ogg", "oga", "opus", "webm", "alac", "aif", "aiff",
];
// A new file counts as finished once its size hasn't changed for this long.
const SETTLE: Duration = Duration::from_secs(4);

#[derive(Default, Clone, Serialize, Deserialize)]
struct Folders {
    watch: Option<PathBuf>,
    library: Option<PathBuf>,
}

#[derive(Default)]
struct AppState {
    folders: Mutex<Folders>,
    watcher: Mutex<Option<RecommendedWatcher>>,
    // A newer version, already downloaded, waiting for a restart.
    update: Mutex<Option<(Update, Vec<u8>)>>,
}

fn is_audio(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| AUDIO.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

// "Carti/Die Lit/x.mp3" inside `root`. Absolute paths, drive letters and ".."
// are refused, so the page can't reach anything outside the folder.
fn inside(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    let mut out = root.to_path_buf();
    for c in rel_path.components() {
        match c {
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            _ => return Err("that path isn't inside the folder".into()),
        }
    }
    if out == root {
        return Err("no file named".into());
    }
    Ok(out)
}

// "C:\Music\Carti\x.mp3" -> "Carti/x.mp3"
fn relative(root: &Path, p: &Path) -> Option<String> {
    let rel = p.strip_prefix(root).ok()?;
    let parts: Vec<String> = rel
        .components()
        .filter_map(|c| match c {
            Component::Normal(s) => Some(s.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect();
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("/"))
    }
}

// ------------------------------------------------------------ saved folders

fn settings_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("folders.json"))
}

fn load_folders(app: &AppHandle) -> Folders {
    settings_file(app)
        .and_then(|f| fs::read_to_string(f).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_folders(app: &AppHandle, f: &Folders) {
    if let Some(file) = settings_file(app) {
        if let Some(dir) = file.parent() {
            let _ = fs::create_dir_all(dir);
        }
        if let Ok(s) = serde_json::to_string_pretty(f) {
            let _ = fs::write(file, s);
        }
    }
}

// ----------------------------------------------------------------- watcher

// Watch `root`; when an audio file has appeared or changed and then stayed the
// same size for SETTLE, tell the page. Replaces any earlier watcher.
fn start_watching(app: &AppHandle, state: &AppState) {
    let root = match state.folders.lock().unwrap().watch.clone() {
        Some(r) if r.is_dir() => r,
        _ => {
            *state.watcher.lock().unwrap() = None;
            return;
        }
    };
    let (tx, rx) = mpsc::channel::<PathBuf>();
    let watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(ev) = res {
            if ev.kind.is_create() || ev.kind.is_modify() {
                for p in ev.paths {
                    if is_audio(&p) {
                        let _ = tx.send(p);
                    }
                }
            }
        }
    });
    let mut watcher = match watcher {
        Ok(w) => w,
        Err(_) => return,
    };
    if watcher.watch(&root, RecursiveMode::Recursive).is_err() {
        return;
    }
    // Dropping the old watcher ends its thread (its channel closes).
    *state.watcher.lock().unwrap() = Some(watcher);

    let app = app.clone();
    thread::spawn(move || {
        let mut pending: HashMap<PathBuf, (u64, Instant)> = HashMap::new();
        loop {
            match rx.recv_timeout(Duration::from_secs(1)) {
                Ok(p) => {
                    let size = fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
                    pending.insert(p, (size, Instant::now()));
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
            let mut ready = Vec::new();
            pending.retain(|p, (size, since)| {
                let now = match fs::metadata(p) {
                    Ok(m) if m.is_file() => m.len(),
                    _ => return false, // gone
                };
                if now != *size {
                    *size = now;
                    *since = Instant::now();
                    return true;
                }
                if now > 0 && since.elapsed() >= SETTLE {
                    if let Some(rel) = relative(&root, p) {
                        ready.push(rel);
                    }
                    return false;
                }
                true
            });
            if !ready.is_empty() {
                let _ = app.emit("local-cuts://new-files", ready);
            }
        }
    });
}

// ---------------------------------------------------------------- commands

#[derive(Serialize)]
struct FoldersOut {
    watch: Option<String>,
    library: Option<String>,
}

fn out(f: &Folders) -> FoldersOut {
    FoldersOut {
        watch: f.watch.as_ref().map(|p| p.to_string_lossy().into_owned()),
        library: f.library.as_ref().map(|p| p.to_string_lossy().into_owned()),
    }
}

#[tauri::command]
fn get_folders(state: State<'_, AppState>) -> FoldersOut {
    out(&state.folders.lock().unwrap())
}

#[tauri::command]
async fn choose_folder(app: AppHandle, state: State<'_, AppState>, which: String) -> Result<FoldersOut, String> {
    let title = if which == "watch" {
        "Where does your new music land?"
    } else {
        "Where should the tidy library go?"
    };
    let picked = app.dialog().file().set_title(title).blocking_pick_folder();
    if let Some(p) = picked {
        let path = p.into_path().map_err(|e| e.to_string())?;
        {
            let mut f = state.folders.lock().unwrap();
            match which.as_str() {
                "watch" => f.watch = Some(path),
                "library" => f.library = Some(path),
                _ => return Err("unknown folder".into()),
            }
            // The library can't be inside the watched folder (or the other way
            // round), or tidied files would be picked up again forever.
            if let (Some(w), Some(l)) = (&f.watch, &f.library) {
                if l.starts_with(w) || w.starts_with(l) {
                    if which == "watch" {
                        f.watch = None;
                    } else {
                        f.library = None;
                    }
                    return Err("The library folder can't be inside the folder being watched (or the other way round). Pick a different one.".into());
                }
            }
            save_folders(&app, &f);
        }
        start_watching(&app, &state);
    }
    Ok(out(&state.folders.lock().unwrap()))
}

#[tauri::command]
fn list_watched(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let root = state.folders.lock().unwrap().watch.clone().ok_or("No folder is being watched yet.")?;
    let mut found = Vec::new();
    let mut stack = vec![root.clone()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for e in entries.flatten() {
            let p = e.path();
            let Ok(t) = e.file_type() else { continue };
            if t.is_dir() {
                stack.push(p);
            } else if t.is_file() && is_audio(&p) {
                if let Some(rel) = relative(&root, &p) {
                    found.push(rel);
                }
                if found.len() >= 100_000 {
                    return Ok(found);
                }
            }
        }
    }
    found.sort();
    Ok(found)
}

#[tauri::command]
fn read_watched(state: State<'_, AppState>, rel: String) -> Result<Response, String> {
    let root = state.folders.lock().unwrap().watch.clone().ok_or("No folder is being watched yet.")?;
    let path = inside(&root, &rel)?;
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    Ok(Response::new(bytes))
}

// The file's bytes are the request body; its path ("Static-Cuts/Artist/x.mp3",
// URL-encoded) is the x-path header.
#[tauri::command]
fn write_library(state: State<'_, AppState>, request: Request<'_>) -> Result<(), String> {
    let root = state.folders.lock().unwrap().library.clone().ok_or("No library folder chosen yet.")?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected the file's bytes".into());
    };
    let header = request
        .headers()
        .get("x-path")
        .and_then(|v| v.to_str().ok())
        .ok_or("missing x-path")?;
    let rel = percent_encoding::percent_decode_str(header)
        .decode_utf8()
        .map_err(|e| e.to_string())?;
    if !is_audio(Path::new(rel.as_ref())) && !rel.ends_with(".csv") {
        return Err("only music files and the changes list are written".into());
    }
    let path = inside(&root, &rel)?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(&path, bytes).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_autostart(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
fn set_autostart(app: AppHandle, on: bool) -> Result<bool, String> {
    let a = app.autolaunch();
    let res = if on { a.enable() } else { a.disable() };
    res.map_err(|e| e.to_string())?;
    Ok(a.is_enabled().unwrap_or(false))
}

// The page tidied a batch: a notification, so it's clear it worked even with
// the window closed.
#[tauri::command]
fn tidied(app: AppHandle, count: u32, failed: u32) {
    if count == 0 && failed == 0 {
        return;
    }
    let mut body = format!("{} new song{} tidied into your library.", count, if count == 1 { "" } else { "s" });
    if failed > 0 {
        body.push_str(&format!(" {} couldn't be written.", failed));
    }
    let _ = app.notification().builder().title("Static-Cuts").body(body).show();
}

// ---------------------------------------------------------------- updates

// Looks for a newer version (signed with the Static-Cuts key; anything else is
// refused by the updater), downloads it, and says so. Shortly after start, then
// every 6 hours. Only runs when the build has an update key (see desktop.yml).
async fn check_for_update(app: &AppHandle) {
    if app.state::<AppState>().update.lock().unwrap().is_some() {
        return;
    }
    let Ok(updater) = app.updater() else { return };
    let Ok(Some(update)) = updater.check().await else { return };
    let Ok(bytes) = update.download(|_, _| {}, || {}).await else { return };
    let version = update.version.clone();
    *app.state::<AppState>().update.lock().unwrap() = Some((update, bytes));
    let _ = app.emit("local-cuts://update-ready", version.clone());
    let _ = app
        .notification()
        .builder()
        .title("Static-Cuts update ready")
        .body(format!("Version {} is downloaded. Restart from the tray icon when it suits you.", version))
        .show();
}

fn install_and_restart(app: &AppHandle) -> Result<(), String> {
    let pending = app.state::<AppState>().update.lock().unwrap().take();
    let Some((update, bytes)) = pending else {
        return Err("No update is waiting.".into());
    };
    update.install(bytes).map_err(|e| e.to_string())?;
    app.restart();
}

#[tauri::command]
fn update_status(state: State<'_, AppState>) -> Option<String> {
    state.update.lock().unwrap().as_ref().map(|(u, _)| u.version.clone())
}

#[tauri::command]
fn install_update(app: AppHandle) -> Result<(), String> {
    install_and_restart(&app)
}

// -------------------------------------------------------------------- app

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn main() {
    tauri::Builder::default()
        // A second launch just brings the open window forward.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        // Started with Windows: "--hidden", so it opens quietly in the tray.
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--hidden"])))
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            get_folders,
            choose_folder,
            list_watched,
            read_watched,
            write_library,
            get_autostart,
            set_autostart,
            tidied,
            update_status,
            install_update
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let state = app.state::<AppState>();
            *state.folders.lock().unwrap() = load_folders(&handle);
            start_watching(&handle, &state);
            // The window starts hidden; shown unless started with Windows.
            // (Hidden, the page still loads and keeps tidying.)
            if !std::env::args().any(|a| a == "--hidden") {
                show_main(&handle);
            }

            let open = MenuItem::with_id(app, "open", "Open Local Cuts", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit (stop watching)", true, None::<&str>)?;
            let restart = MenuItem::with_id(app, "update", "Restart to update", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &restart, &quit])?;
            let mut tray = TrayIconBuilder::new()
                .tooltip("Static-Cuts: watching for new music")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "quit" => app.exit(0),
                    "update" => {
                        if install_and_restart(app).is_err() {
                            let _ = app.notification().builder().title("Static-Cuts")
                                .body("You're on the newest version.").show();
                        }
                    }
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            // Updates: only when this build was given an update key (the
            // updater section in tauri.conf.json is added by the build then).
            if app.config().plugins.0.contains_key("updater") {
                app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(Duration::from_secs(20)).await;
                    loop {
                        check_for_update(&handle).await;
                        tokio::time::sleep(Duration::from_secs(6 * 60 * 60)).await;
                    }
                });
            }
            Ok(())
        })
        // Closing the window hides it; the tray icon keeps it watching.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running the Static-Cuts app");
}
