use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_window_state::StateFlags;

// True when this process was launched at login (autostart passes --autostart).
// The frontend reads this via the `started_hidden` command to skip its reveal,
// so an autostarted instance stays in the tray instead of popping a window.
static STARTED_HIDDEN: AtomicBool = AtomicBool::new(false);

#[tauri::command]
fn started_hidden() -> bool {
    STARTED_HIDDEN.load(Ordering::Relaxed)
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    STARTED_HIDDEN.store(
        std::env::args().any(|a| a == "--autostart"),
        Ordering::Relaxed,
    );

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        // Autostart launches the app with --autostart so it can start hidden in the tray.
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        // Restore size/position/maximized, but NOT visibility — the frontend shows the
        // window itself once it has painted, to avoid a white flash + reposition jump.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED,
                )
                .build(),
        )
        .invoke_handler(tauri::generate_handler![started_hidden])
        .setup(|app| {
            // Tray menu: show the window, toggle launch-at-login, or really quit.
            let show_i = MenuItem::with_id(app, "show", "Show Tick", true, None::<&str>)?;
            let autostart_i = CheckMenuItem::with_id(
                app,
                "autostart",
                "Start at login",
                true,
                app.autolaunch().is_enabled().unwrap_or(false),
                None::<&str>,
            )?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&show_i, &autostart_i, &sep, &quit_i])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Tick")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main(app),
                    "quit" => app.exit(0),
                    "autostart" => {
                        // The check item toggles its own mark; mirror that to the OS setting.
                        let mgr = app.autolaunch();
                        let _ = if mgr.is_enabled().unwrap_or(false) {
                            mgr.disable()
                        } else {
                            mgr.enable()
                        };
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        // Closing the window hides it to the tray; the app keeps running so timers and
        // notifications still fire. Quit (tray menu) is the only real exit.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
