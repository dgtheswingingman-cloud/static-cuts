fn main() {
    // The app's own commands, so the capability file can allow exactly these
    // for static-cuts.com and nothing else.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "get_folders",
            "choose_folder",
            "list_watched",
            "read_watched",
            "write_library",
            "get_autostart",
            "set_autostart",
            "tidied",
            "update_status",
            "install_update",
            "ai_status",
            "ai_generate",
        ]),
    ))
    .expect("failed to run tauri-build");
}
