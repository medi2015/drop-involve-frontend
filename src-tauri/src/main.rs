#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Manager, PhysicalPosition};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = app.get_webview_window("main").map(|w| {
                let _ = w.show();
                let _ = w.set_focus();
            });
        }))
        .setup(|app| {
            let quit_i = MenuItem::with_id(app, "quit", "Avslutt", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "Åpne Drop Involve", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            // 1. Get the default app icon (your custom favicon/logo)
            let icon = app.default_window_icon().cloned().expect("Could not find default icon");

            let _tray = TrayIconBuilder::new()
            .tooltip("Drop Involve") // <--- THIS IS THE NEW LINE
                .icon(icon) // 2. Assign the icon to the tray so it isn't blank
                .menu(&menu)
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
                .on_tray_icon_event(|tray, event| match event {
                    TrayIconEvent::DoubleClick { button: MouseButton::Left, .. } => {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
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
                                // 3. DYNAMIC POSITIONING FOR DIFFERENT PC SCALES
                                if let Ok(size) = tray_window.outer_size() {
                                    // Center horizontally over the tray icon
                                    let x = position.x as i32 - (size.width as i32 / 2);
                                    // Place directly above the mouse click, minus window height and a 10px gap
                                    let y = position.y as i32 - size.height as i32 - 10;
                                    
                                    let _ = tray_window.set_position(tauri::Position::Physical(PhysicalPosition { x, y }));
                                }
                                
                                let _ = tray_window.show();
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