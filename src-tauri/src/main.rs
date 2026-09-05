#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri_plugin_autostart::MacosLauncher;

mod oauth;

fn main() {
    tauri::Builder::default()
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

            let version_text = format!("Versjon {}", app.package_info().version);
            let version_i = MenuItem::with_id(app, "version", version_text, false, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;

            // macOS menu bar icons are template images: black plus alpha, with
            // the system inverting them for light and dark menu bars. The full
            // colour app icon can't do that, so it sat there looking like a
            // sticker among the system icons.
            //
            // Windows and Linux get the normal coloured icon — a black glyph
            // would vanish against the Windows taskbar.
            #[cfg(target_os = "macos")]
            let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-template.png"))
                .expect("Could not read the tray template icon");

            #[cfg(not(target_os = "macos"))]
            let icon = app.default_window_icon().cloned().expect("Could not find default icon");

            let menu = Menu::with_items(app, &[&show_i, &sep, &version_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .tooltip("Drop Involve")
                .icon(icon)
                // Tells macOS to tint the icon to the menu bar instead of
                // drawing it as artwork. A no-op on Windows and Linux.
                .icon_as_template(true)
                .menu(&menu)
                .show_menu_on_left_click(false)
                // One behaviour, one click. The separate history panel this used
                // to toggle is gone — history now lives in the main window,
                // which removes a pile of platform-specific focus handling.
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                })
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the main window hides it to the tray rather than quitting,
            // so the app stays available from the tray icon.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app, _event| {
            // Clicking the dock icon on macOS did nothing.
            //
            // Closing the window hides it to the tray rather than quitting, so
            // the app is running with no visible windows. In that state macOS
            // sends a "reopen" event rather than launching anything, and an app
            // that ignores it simply looks dead — which is what was happening.
            // Only the menu bar icon brought it back.
            //
            // Windows has no equivalent: clicking the taskbar button restores
            // the window itself, which is why this was never seen there.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { has_visible_windows, .. } = _event {
                if !has_visible_windows {
                    if let Some(window) = _app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                    }
                }
            }
        });
}
