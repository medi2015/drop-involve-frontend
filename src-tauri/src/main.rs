#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Manager, PhysicalPosition};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri_plugin_autostart::MacosLauncher;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::init())
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
            // 1. Check if we should start hidden
            let args: Vec<String> = std::env::args().collect();
            let is_silent = args.contains(&"--silent".to_string());

            if !is_silent {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                }
            }

            // 2. Setup Tray and Menu
            let quit_i = MenuItem::with_id(app, "quit", "Avslutt", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "Åpne Drop Involve", true, None::<&str>)?;
            let hist_i = MenuItem::with_id(app, "history", "Vis historikk", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &hist_i, &quit_i])?;

            let icon = app.default_window_icon().cloned().expect("Could not find default icon");

            let _tray = TrayIconBuilder::new()
                .tooltip("Drop Involve")
                .icon(icon)
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "history" => {
                        if let Some(tray_window) = app.get_webview_window("tray") {
                            let _ = tray_window.show();
                            let _ = tray_window.set_focus();
                        }
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = window.unminimize();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| match event {
                    TrayIconEvent::Click { 
                        button: MouseButton::Left, 
                        button_state: MouseButtonState::Up, 
                        position, .. 
                    } => {
                        let app = tray.app_handle();
                        if let Some(tray_window) = app.get_webview_window("tray") {
                            if tray_window.is_visible().unwrap_or(false) {
                                let _ = tray_window.hide();
                            } else {
                                if let Ok(size) = tray_window.outer_size() {
                                    let x = position.x as i32 - (size.width as i32 / 2);
                                    let y = if cfg!(target_os = "macos") {
                                        position.y as i32 + 10 
                                    } else {
                                        position.y as i32 - size.height as i32 - 10 
                                    };
                                    let _ = tray_window.set_position(tauri::Position::Physical(PhysicalPosition { x, y }));
                                }
                                let _ = tray_window.show();
                                let _ = tray_window.set_always_on_top(true);
                                let _ = tray_window.set_focus();
                            }
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
                    let _ = window.hide();
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