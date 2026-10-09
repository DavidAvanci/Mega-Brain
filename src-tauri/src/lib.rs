use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, Position, RunEvent, Size, WebviewWindow, WindowEvent};

mod activity_island;
mod chat_export;
mod supervisor;
mod runtime_contract;
mod stderr_tail;
pub use supervisor::{BackendSupervisor, SupervisorState, SupervisorTransitionError};

const MAIN_WINDOW_LABEL: &str = "main";
#[cfg(target_os = "macos")]
const WINDOW_STATE_FILE: &str = "macos-window-state.json";
#[cfg(not(target_os = "macos"))]
const WINDOW_STATE_FILE: &str = "window-state.json";
#[cfg(target_os = "windows")]
const WSL_DISTRO_FILE: &str = "wsl-distro.json";
const MIN_WIDTH: u32 = 960;
const MIN_HEIGHT: u32 = 640;

#[tauri::command]
fn backend_config(supervisor: tauri::State<'_, BackendSupervisor>) -> Result<supervisor::BackendConfig, String> {
    supervisor.backend_config()
}

#[tauri::command]
fn list_wsl_distributions(supervisor: tauri::State<'_, BackendSupervisor>) -> Result<Vec<String>, String> {
    supervisor.available_wsl_distributions()
}

#[tauri::command]
fn select_wsl_distribution(distro: String, supervisor: tauri::State<'_, BackendSupervisor>) -> Result<(), String> {
    supervisor.select_wsl_distribution(distro)?;
    supervisor.start_once()
}

/// Accepts only an absolute WSL workspace path; validation and startup remain
/// in the supervisor so the WebView never receives filesystem access.
#[tauri::command]
fn set_wsl_workspace_dir(workspace_dir: String, supervisor: tauri::State<'_, BackendSupervisor>) -> Result<(), String> {
    supervisor.set_workspace_dir(workspace_dir)?;
    supervisor.start_once()
}

#[tauri::command]
fn normalize_wsl_directory(path: String, supervisor: tauri::State<'_, BackendSupervisor>) -> Result<String, String> {
    supervisor.normalize_selected_directory(path)
}

/// Opens the app-owned diagnostic directory. It accepts no caller-supplied
/// path, so it cannot become an arbitrary command-execution primitive.
#[tauri::command]
fn open_diagnostics_folder(app: AppHandle) -> Result<(), String> {
    let path = app
        .path()
        .app_log_dir()
        .map_err(|error| format!("could not resolve diagnostics directory: {error}"))?;
    fs::create_dir_all(&path)
        .map_err(|error| format!("could not create diagnostics directory: {error}"))?;

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer.exe")
            .arg(&path)
            .spawn()
            .map_err(|error| format!("could not open diagnostics directory: {error}"))?;
        Ok(())
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("/usr/bin/open")
            .arg(&path)
            .spawn()
            .map_err(|error| format!("could not open diagnostics folder: {error}"))?;
        Ok(())
    }
}

fn main_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "main window is unavailable".to_owned())
}

#[tauri::command]
fn minimize_main_window(app: AppHandle) -> Result<(), String> {
    let window = main_window(&app)?;
    window.minimize().map_err(|error| error.to_string())
}

#[tauri::command]
fn toggle_maximize_main_window(app: AppHandle) -> Result<(), String> {
    let window = main_window(&app)?;
    if window.is_maximized().map_err(|error| error.to_string())? {
        window.unmaximize().map_err(|error| error.to_string())
    } else {
        window.maximize().map_err(|error| error.to_string())
    }
}

#[tauri::command]
fn close_main_window(app: AppHandle) -> Result<(), String> {
    let window = main_window(&app)?;
    window.close().map_err(|error| error.to_string())
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
struct WindowState {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct DisplayArea {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

impl DisplayArea {
    fn contains(&self, state: WindowState) -> bool {
        let right = state.x.saturating_add(state.width as i32);
        let bottom = state.y.saturating_add(state.height as i32);
        state.x >= self.x
            && state.y >= self.y
            && right <= self.x.saturating_add(self.width as i32)
            && bottom <= self.y.saturating_add(self.height as i32)
    }

    fn clamp(&self, state: WindowState) -> WindowState {
        let width = state.width.max(MIN_WIDTH).min(self.width);
        let height = state.height.max(MIN_HEIGHT).min(self.height);
        let max_x = self.x.saturating_add(self.width.saturating_sub(width) as i32);
        let max_y = self.y.saturating_add(self.height.saturating_sub(height) as i32);

        WindowState {
            x: state.x.clamp(self.x, max_x),
            y: state.y.clamp(self.y, max_y),
            width,
            height,
        }
    }
}

fn state_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|path| path.join(WINDOW_STATE_FILE))
}

#[cfg(target_os = "windows")]
fn wsl_preference_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|path| path.join(WSL_DISTRO_FILE))
}

fn load_state(app: &AppHandle) -> Option<WindowState> {
    let path = state_path(app)?;
    let contents = fs::read_to_string(path).ok()?;
    serde_json::from_str(&contents).ok()
}

fn save_state(window: &WebviewWindow) {
    // Retain the normal macOS frame when entering full screen or using Zoom.
    #[cfg(target_os = "macos")]
    if window.is_maximized().unwrap_or(false) || window.is_fullscreen().unwrap_or(false) { return; }
    let Some(path) = state_path(&window.app_handle()) else {
        return;
    };
    let size = if cfg!(target_os = "macos") { window.inner_size() } else { window.outer_size() };
    let (Ok(position), Ok(size)) = (window.outer_position(), size) else {
        return;
    };
    let state = WindowState {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    };
    let Ok(json) = serde_json::to_vec(&state) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    // A failed preference write must never block window movement or shutdown.
    let _ = fs::write(path, json);
}

fn available_displays(window: &WebviewWindow) -> Vec<DisplayArea> {
    window
        .available_monitors()
        .unwrap_or_default()
        .into_iter()
        .map(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            DisplayArea {
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
            }
        })
        .collect()
}

fn restore_state(window: &WebviewWindow) {
    let Some(saved) = load_state(&window.app_handle()) else {
        // `center` in tauri.conf.json handles the first launch.
        return;
    };
    let displays = available_displays(window);
    let Some(display) = displays.iter().find(|display| display.contains(saved)) else {
        // A disconnected monitor or invalid saved coordinates must not reopen off-screen.
        let Some(primary) = displays.first() else {
            return;
        };
        let restored = primary.clamp(saved);
        let _ = window.set_size(Size::Physical(PhysicalSize::new(restored.width, restored.height)));
        let _ = window.set_position(Position::Physical(PhysicalPosition::new(restored.x, restored.y)));
        return;
    };
    let restored = display.clamp(saved);
    let _ = window.set_size(Size::Physical(PhysicalSize::new(restored.width, restored.height)));
    let _ = window.set_position(Position::Physical(PhysicalPosition::new(restored.x, restored.y)));
}

fn focus_existing_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };

    // A second launch is routed here by the OS-level single-instance plugin.
    // Show/unminimize first so a hidden or minimized main window can receive focus.
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            focus_existing_main_window(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_dialog::init())
        .manage(BackendSupervisor::new())
        .manage(activity_island::ActivityIsland::default())
        .setup(|app| {
            let window = app
                .get_webview_window(MAIN_WINDOW_LABEL)
                .expect("main window must be declared in tauri.conf.json");
            restore_state(&window);
            // macOS restores a regular native window; Windows keeps its maximized launch.
            #[cfg(not(target_os = "macos"))]
            let _ = window.maximize();
            let state_window = window.clone();
            window.on_window_event(move |event| {
                if matches!(event, WindowEvent::Moved(_) | WindowEvent::Resized(_) | WindowEvent::CloseRequested { .. }) {
                    save_state(&state_window);
                }
            });
            // Startup is independent of window restoration and happens once
            // for the application lifetime. The command remains unavailable
            // until the versioned child handshake is accepted.
            let supervisor = app.state::<BackendSupervisor>().inner().clone();
            #[cfg(target_os = "windows")]
            if let Some(path) = wsl_preference_path(&app.handle()) {
                supervisor.set_wsl_preference_path(path);
            }
            #[cfg(target_os = "macos")]
            {
                let home = PathBuf::from(std::env::var_os("HOME").ok_or_else(|| {
                    std::io::Error::new(std::io::ErrorKind::NotFound, "HOME is unavailable")
                })?);
                let config_dir = app.path().app_config_dir()?;
                let resource_dir = app.path().resource_dir()?;
                let bundled_backend = resource_dir.join("server/main.mjs");
                let backend = if bundled_backend.is_file() || !cfg!(debug_assertions) {
                    bundled_backend
                } else {
                    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist/server/main.mjs")
                };
                let bundled_node = resource_dir.join("runtime/node");
                let node = if cfg!(debug_assertions) {
                    std::env::var_os("MEGA_BRAIN_NODE_BIN").map(PathBuf::from)
                        .unwrap_or_else(|| if bundled_node.is_file() {
                            bundled_node.clone()
                        } else {
                            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/mega-brain-runtime/node")
                        })
                } else {
                    bundled_node
                };
                let data_dir = home.join("Documents/Mega Brain");
                supervisor.set_native_backend_paths(supervisor::NativeBackendPaths {
                    node,
                    backend,
                    settings_file: config_dir.join("settings.json"),
                    workspace_dir: data_dir.join("cards"),
                    worktrees_dir: data_dir.join("worktrees"),
                    home_dir: home,
                });
            }
            let island_app = app.handle().clone();
            std::thread::spawn(move || {
                if supervisor.start_once().is_err() {
                    let failure = supervisor.backend_config().err().unwrap_or_else(|| "backend-failed".to_owned());
                    eprintln!("Mega Brain backend startup failed: {failure}");
                } else if let Ok(config) = supervisor.backend_config() {
                    if let Err(error) = island_app.state::<activity_island::ActivityIsland>().start(&island_app, &config) {
                        eprintln!("Mega Brain activity island startup failed: {error}");
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            backend_config,
            activity_island::list_island_monitors,
            list_wsl_distributions,
            select_wsl_distribution,
            set_wsl_workspace_dir,
            normalize_wsl_directory,
            open_diagnostics_folder,
            chat_export::export_chat_markdown,
            minimize_main_window,
            toggle_maximize_main_window,
            close_main_window
        ])
        .build(tauri::generate_context!())
        .expect("error while running Mega Brain desktop application");
    app.run(|app, event| {
        // This runs for both an explicit app exit and the last-window close.
        // The supervisor operation is idempotent because Tauri can emit more
        // than one exit-related event.
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            app.state::<activity_island::ActivityIsland>().stop();
            app.state::<BackendSupervisor>().shutdown();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const PRIMARY: DisplayArea = DisplayArea { x: 0, y: 0, width: 1920, height: 1080 };

    // This is deliberately a source-level guard: adding a privileged Tauri plugin
    // must be an explicit security decision accompanied by a narrowly scoped
    // capability, never an incidental dependency update.
    #[test]
    fn webview_has_no_shell_or_filesystem_plugin_surface() {
        let manifest = include_str!("../Cargo.toml");
        for forbidden_plugin in [
            "tauri-plugin-shell",
            "tauri-plugin-fs",
            "tauri-plugin-opener",
            "tauri-plugin-process",
        ] {
            assert!(
                !manifest.contains(forbidden_plugin),
                "the WebView must not receive the privileged {forbidden_plugin} API"
            );
        }

        let capability = include_str!("../capabilities/desktop-backend.json");
        assert!(capability.contains("allow-backend-config"));
        assert!(capability.contains("allow-list-wsl-distributions"));
        assert!(capability.contains("allow-select-wsl-distribution"));
        assert!(capability.contains("allow-set-wsl-workspace-dir"));
        assert!(capability.contains("allow-normalize-wsl-directory"));
        assert!(capability.contains("dialog:allow-open"));
        assert!(capability.contains("core:window:allow-set-icon"));
        assert!(capability.contains("allow-open-diagnostics-folder"));
        assert!(!capability.contains("shell:"));
        assert!(!capability.contains("fs:"));
    }

    #[test]
    fn keeps_a_saved_window_that_fits_an_available_display() {
        let saved = WindowState { x: 40, y: 50, width: 1440, height: 940 };
        assert!(PRIMARY.contains(saved));
        assert_eq!(PRIMARY.clamp(saved), saved);
    }

    #[test]
    fn restores_an_offscreen_window_inside_the_primary_display() {
        let offscreen = WindowState { x: 4000, y: -300, width: 1440, height: 940 };
        let restored = PRIMARY.clamp(offscreen);
        assert!(PRIMARY.contains(restored));
        assert_eq!(restored.x, 480);
        assert_eq!(restored.y, 0);
    }

    #[test]
    fn respects_minimum_size_when_restoring_old_preferences() {
        let restored = PRIMARY.clamp(WindowState { x: 0, y: 0, width: 10, height: 20 });
        assert_eq!((restored.width, restored.height), (MIN_WIDTH, MIN_HEIGHT));
    }

    #[test]
    fn configures_os_level_single_instance_with_window_focus_handler() {
        let source = include_str!("lib.rs");
        assert!(source.contains("tauri_plugin_single_instance::init"));
        assert!(source.contains("focus_existing_main_window(app)"));
        assert!(source.contains("window.unminimize()"));
        assert!(source.contains("window.set_focus()"));
    }

    #[test]
    fn leaves_devtools_to_tauri_debug_builds_only() {
        // Tauri exposes Web Inspector automatically in debug builds, but only
        // compiles it into release builds when its opt-in `devtools` feature is
        // enabled. Keep that feature absent and do not override the default in
        // the window configuration.
        let manifest = include_str!("../Cargo.toml");
        assert!(manifest.contains("tauri = { version = \"2\", features = [\"image-png\"] }"));
        assert!(!manifest.contains("devtools"));

        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).expect("valid Tauri config");
        assert!(config["app"]["windows"][0].get("devtools").is_none());
    }

    #[test]
    fn packages_a_per_user_nsis_installer_with_existing_icons() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).expect("valid Tauri config");
        let bundle = &config["bundle"];
        assert_eq!(bundle["targets"], serde_json::json!(["nsis"]));
        assert_eq!(bundle["windows"]["nsis"]["installMode"], "currentUser");
        assert_eq!(bundle["windows"]["webviewInstallMode"]["type"], "downloadBootstrapper");
        assert_eq!(bundle["windows"]["allowDowngrades"], false);
        assert!(bundle["icon"].as_array().is_some_and(|icons| icons.iter().any(|icon| icon == "icons/icon.ico")));
    }
}
