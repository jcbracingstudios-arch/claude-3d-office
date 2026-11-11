// GUI subsystem in release: no console window, and in --hook mode nothing can reach stdout.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod hook;
mod settings;
mod state;

use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tauri_plugin_notification::NotificationExt;

type Shared = Arc<Mutex<state::Office>>;
const TAIL_BYTES: u64 = 2 * 1024 * 1024;

fn exe() -> String {
    std::env::current_exe().map(|p| p.display().to_string()).unwrap_or_default()
}

#[tauri::command]
fn get_state(office: State<Shared>) -> serde_json::Value {
    office.lock().unwrap().snapshot()
}

#[tauri::command]
fn hooks_status() -> serde_json::Value {
    let (any, current) = settings::status(&exe());
    serde_json::json!({ "installed": any, "current": current, "settings": settings::settings_path() })
}

#[tauri::command]
fn connect() -> Result<serde_json::Value, String> {
    let backup = settings::connect(&exe())?;
    Ok(serde_json::json!({ "backup": backup }))
}

#[tauri::command]
fn disconnect() -> Result<serde_json::Value, String> {
    let backup = settings::disconnect()?;
    Ok(serde_json::json!({ "backup": backup }))
}

fn show(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Follow events.jsonl, update the state, push it to the window and notify on alerts.
fn tail_loop(app: AppHandle, office: Shared) {
    let file = settings::office_dir().join("events.jsonl");
    let (mut offset, mut partial) = (0u64, String::new());
    let mut last_status: HashMap<String, String> = HashMap::new();
    let mut first = true;
    loop {
        let size = std::fs::metadata(&file).map(|m| m.len()).unwrap_or(0);
        if size < offset { offset = 0; partial.clear(); }
        if size > offset {
            let start = if offset == 0 && size > TAIL_BYTES { size - TAIL_BYTES } else { offset };
            let mut buf = Vec::new();
            if let Ok(mut f) = std::fs::File::open(&file) {
                if f.seek(SeekFrom::Start(start)).is_ok() { let _ = f.take(size - start).read_to_end(&mut buf); }
            }
            offset = size;
            let mut text = partial.clone() + &String::from_utf8_lossy(&buf);
            if start > 0 && start == size - TAIL_BYTES { text = text.split_once('\n').map(|x| x.1.to_string()).unwrap_or_default(); }
            let mut lines: Vec<&str> = text.split('\n').collect();
            partial = lines.pop().unwrap_or("").to_string();
            let snapshot = {
                let mut o = office.lock().unwrap();
                for l in lines.iter().filter(|l| !l.trim().is_empty()) {
                    if let Ok(mut e) = serde_json::from_str::<state::Event>(l) {
                        e.detail = e.detail.map(|d| hook::redact(&d)); // defense in depth
                        o.apply(e);
                    }
                }
                o.snapshot()
            };
            // Notify on new alerts (not for the history replayed at start-up).
            for s in snapshot["sessions"].as_array().into_iter().flatten() {
                let (id, st) = (s["id"].as_str().unwrap_or(""), s["status"].as_str().unwrap_or(""));
                let changed = last_status.insert(id.to_string(), st.to_string()).as_deref() != Some(st);
                if !first && changed && (st == "waiting" || st == "error" || st == "limited") {
                    let what = match st { "waiting" => "attend ta validation", "limited" => "limite Claude atteinte", _ => "erreur" };
                    let title = format!("{} · {}", s["project"].as_str().unwrap_or("?"), what);
                    let _ = app.notification().builder().title(title).body(s["lastAction"].as_str().unwrap_or("")).show();
                }
            }
            first = false;
            let _ = app.emit("state", snapshot);
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

async fn check_update(app: AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    use tauri_plugin_updater::UpdaterExt;
    let Some(update) = app.updater()?.check().await? else { return Ok(()) };
    let _ = app.notification().builder().title("Claude 3D Office").body(format!("Mise à jour {} en cours d'installation…", update.version)).show();
    update.download_and_install(|_, _| {}, || {}).await?;
    app.restart();
}

fn main() {
    if std::env::args().any(|a| a == "--hook") {
        hook::run();
    }
    let office: Shared = Arc::new(Mutex::new(state::Office::default()));
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(office.clone())
        .invoke_handler(tauri::generate_handler![get_state, hooks_status, connect, disconnect])
        .setup(move |app| {
            let open = MenuItem::with_id(app, "open", "Ouvrir le bureau", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quitter", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().cloned().expect("app icon"))
                .tooltip("Claude 3D Office")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, e| match e.id.as_ref() {
                    "open" => show(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, e| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                        show(tray.app_handle());
                    }
                })
                .build(app)?;
            let handle = app.handle().clone();
            std::thread::spawn(move || tail_loop(handle, office));
            // Auto-update: check GitHub Releases at start-up (signed packages only), install and restart.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move { let _ = check_update(handle).await; });
            Ok(())
        })
        .on_window_event(|w, e| {
            // Closing the window keeps the office running in the tray.
            if let WindowEvent::CloseRequested { api, .. } = e {
                let _ = w.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Claude 3D Office");
}
