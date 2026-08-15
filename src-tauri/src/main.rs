#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Manager, PhysicalPosition};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri_plugin_autostart::MacosLauncher;
use std::sync::Mutex;
use std::time::{Instant, Duration};

mod oauth;

// State to track window status and prevent "Focus Fights"
struct TrayState {
    last_interaction: Mutex<Instant>,
    is_visible: Mutex<bool>,
}

fn main() {
    tauri::Builder::default()
        .manage(TrayState {
            last_interaction: Mutex::new(Instant::now() - Duration::from_secs(1)),
            is_visible: Mutex::new(false),
        })
        .manage(oauth::OauthState::default())
        .invoke_handler(tauri::generate_handler![
            oauth::oauth_start,
            oauth::oauth_wait
        ])
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--silent"])))
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = app.get_webview_window("main").map(|w| {
                let _ = w.show();
                let _ = w.set_focus();
                let _ = w.unminimize();
            });
        }))
.setup(|app| {
            let quit_i = MenuItem::with_id(app, "quit", "Avslutt", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "Åpne Drop Involve", true, None::<&str>)?;
            
            // 1. Create the version label (grayed out) and a separator
            let version_text = format!("Versjon {}", app.package_info().version);
            let version_i = MenuItem::with_id(app, "version", version_text, false, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;

            let icon = app.default_window_icon().cloned().expect("Could not find default icon");

            // 2. IMPORTANT: You must add &sep and &version_i to this array
            let menu = Menu::with_items(app, &[&show_i, &sep, &version_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .tooltip("Drop Involve")
                .icon(icon)
                .menu(&menu)
                // ... rest of your tray logic ...
                .show_menu_on_left_click(false) 
                .on_tray_icon_event(|tray, event| match event {
                    TrayIconEvent::Click { button: MouseButton::Left, position, .. } => {
                        let app = tray.app_handle();
                        let state = app.state::<TrayState>();
                        
                        // 1. Debounce: Ignore clicks faster than 300ms to prevent double-toggling
                        let now = Instant::now();
                        let mut last_interaction = state.last_interaction.lock().unwrap();
                        if now.duration_since(*last_interaction) < Duration::from_millis(300) {
                            return;
                        }
                        *last_interaction = now;

                        if let Some(tray_window) = app.get_webview_window("tray") {
                            let mut is_visible = state.is_visible.lock().unwrap();
                            
                            if *is_visible {
                                let _ = tray_window.hide();
                                *is_visible = false;
                            } else {
                                if let Ok(size) = tray_window.outer_size() {
                                    let x = position.x as i32 - (size.width as i32 / 2);
                                    let y = if cfg!(target_os = "macos") {
                                        position.y as i32 + 10 
                                    } else {
                                        position.y as i32 - size.height as i32 - 20 
                                    };
                                    let _ = tray_window.set_position(tauri::Position::Physical(PhysicalPosition { x, y }));
                                }
                                
                                let _ = tray_window.show();
                                let _ = tray_window.set_focus();
                                let _ = tray_window.set_always_on_top(true);
                                *is_visible = true;
                            }
                        }
                    }
                    _ => {}
                })
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::Focused(focused) => {
                if !focused && window.label() == "tray" {
                    let app = window.app_handle();
                    let state = app.state::<TrayState>();
                    
                    // 2. Focus Guard: Ignore blur events that happen immediately after opening
                    let elapsed = state.last_interaction.lock().unwrap().elapsed();
                    if elapsed > Duration::from_millis(600) {
                        let _ = window.hide();
                        let mut is_visible = state.is_visible.lock().unwrap();
                        *is_visible = false;
                    }
                }
            }
            tauri::WindowEvent::CloseRequested { api, .. } => {
                if window.label() == "main" {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}