//! Native macOS companion. The session capability is passed only via environment.
#[cfg(target_os = "macos")]
use std::{path::PathBuf, process::{Child, Command, Stdio}, sync::Mutex};
#[cfg(target_os = "macos")]
use tauri::Manager;

#[derive(Default)]
pub struct ActivityIsland {
    #[cfg(target_os = "macos")]
    child: Mutex<Option<Child>>,
}

impl ActivityIsland {
    pub fn start(&self, app: &tauri::AppHandle, config: &crate::supervisor::BackendConfig) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            self.stop();
            let bundled = app.path().resource_dir().map_err(|error| error.to_string())?.join("runtime/activity-island");
            let executable = if bundled.is_file() || !cfg!(debug_assertions) {
                bundled
            } else {
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/mega-brain-runtime/activity-island")
            };
            let child = Command::new(executable)
                .arg(&config.base_url)
                .arg(std::process::id().to_string())
                .env("MEGA_BRAIN_SESSION_TOKEN", &config.token)
                .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::inherit())
                .spawn().map_err(|error| error.to_string())?;
            *self.child.lock().map_err(|_| "activity island lock poisoned")? = Some(child);
        }
        #[cfg(not(target_os = "macos"))]
        let _ = (app, config);
        Ok(())
    }

    pub fn stop(&self) {
        #[cfg(target_os = "macos")]
        if let Ok(mut slot) = self.child.lock() {
            if let Some(mut child) = slot.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

impl Drop for ActivityIsland {
    fn drop(&mut self) { self.stop(); }
}

#[derive(serde::Serialize)]
pub struct IslandMonitor { id: String, label: String, primary: bool }

#[tauri::command]
pub fn list_island_monitors(app: tauri::AppHandle) -> Result<Vec<IslandMonitor>, String> {
    let primary = app.primary_monitor().map_err(|e| e.to_string())?;
    app.available_monitors().map_err(|e| e.to_string())?.into_iter().enumerate().map(|(index, monitor)| {
        let p = monitor.position();
        let size = monitor.size();
        let name = monitor.name().cloned().unwrap_or_else(|| format!("Display {}", index + 1));
        Ok(IslandMonitor {
            id: format!("{}|{}|{}|{}|{}", name, p.x, p.y, size.width, size.height),
            label: name,
            primary: primary.as_ref().is_some_and(|m| m.position() == monitor.position() && m.size() == monitor.size()),
        })
    }).collect()
}
