//! Lifecycle state owned by the desktop backend supervisor.
//!
//! Starting the WSL process and parsing its handshake deliberately live in the
//! next layer.  Keeping the lifecycle here makes those operations serialize
//! against shutdown and gives the WebView a small, explicit state vocabulary.

use serde::{Deserialize, Serialize};
use crate::runtime_contract::{NodeVersion, RuntimeLayout, RuntimeManifest};
use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    net::{TcpStream, ToSocketAddrs},
    process::{Child, Command, Stdio},
    sync::{mpsc, Arc, Mutex},
    time::Duration,
};

const READY_PROTOCOL_VERSION: u32 = 1;
const WSL_BACKEND_ENVIRONMENT: [&str; 4] = [
    "MEGA_BRAIN_MODE/u",
    "MEGA_BRAIN_SESSION_TOKEN/u",
    "MEGA_BRAIN_SESSION_ID/u",
    "WORKSPACE_DIR/u",
];
const WSL_DEV_ORIGIN_ENVIRONMENT: &str = "MEGA_BRAIN_DEV_ORIGIN/u";
const WSL_RUNTIME_INSTALL_ENVIRONMENT: [&str; 4] = [
    "MEGA_BRAIN_RUNTIME_ROOT/u",
    "MEGA_BRAIN_RUNTIME_VERSION/u",
    "MEGA_BRAIN_RUNTIME_SHA256/u",
    "MEGA_BRAIN_RUNTIME_SIZE/u",
];
const WSL_RUNTIME_ACTIVATE_ENVIRONMENT: [&str; 2] = [
    "MEGA_BRAIN_RUNTIME_ROOT/u",
    "MEGA_BRAIN_RUNTIME_VERSION/u",
];
const RUNTIME_ARTIFACT_PLACEHOLDER: &str = "__MEGA_BRAIN_RUNTIME_ARTIFACT__";
// Installation never changes `active`: it only creates an immutable candidate.
// Activation is deliberately a separate, atomic operation performed after the
// candidate answered health. Keeping these scripts named also makes their
// transactional boundary regression-testable without a WSL host.
const WSL_RUNTIME_INSTALL: &str = r#"set -eu
root="${MEGA_BRAIN_RUNTIME_ROOT:?}"
version="${MEGA_BRAIN_RUNTIME_VERSION:?}"
sha="${MEGA_BRAIN_RUNTIME_SHA256:?}"
size="${MEGA_BRAIN_RUNTIME_SIZE:?}"
target="$root/$version"
mkdir -p "$root"
if [ -f "$target/main.mjs" ] && [ -f "$target/runtime-manifest.json" ]; then
  actual_size=$(wc -c < "$target/main.mjs" | tr -d ' ')
  actual_sha=$(sha256sum "$target/main.mjs" | awk '{print $1}')
  [ "$actual_size" = "$size" ] && [ "$actual_sha" = "$sha" ] && exit 0
fi
# Versions are immutable: never overwrite an existing runtime on collision.
[ ! -e "$target" ] || exit 1
stage="$root/.install-$version-$$"
trap 'rm -rf "$stage"' EXIT HUP INT TERM
mkdir -p "$stage"
base64 -d > "$stage/main.mjs" <<'MEGA_BRAIN_ARTIFACT'
__MEGA_BRAIN_RUNTIME_ARTIFACT__
MEGA_BRAIN_ARTIFACT
actual_size=$(wc -c < "$stage/main.mjs" | tr -d ' ')
actual_sha=$(sha256sum "$stage/main.mjs" | awk '{print $1}')
[ "$actual_size" = "$size" ]
[ "$actual_sha" = "$sha" ]
printf '{"schemaVersion":1,"runtimeVersion":"%s","entrypoint":"main.mjs","sha256":"%s","sizeBytes":%s}\n' "$version" "$sha" "$size" > "$stage/runtime-manifest.json"
mv "$stage" "$target"
trap - EXIT HUP INT TERM
"#;
const WSL_RUNTIME_ACTIVATE: &str = "set -eu\nroot=\"${MEGA_BRAIN_RUNTIME_ROOT:?}\"\nversion=\"${MEGA_BRAIN_RUNTIME_VERSION:?}\"\n[ -f \"$root/$version/main.mjs\" ]\ntmp=\"$root/.active-$$\"\nln -s \"$version\" \"$tmp\"\n# -T prevents following an existing active symlink as a directory.\nmv -Tf \"$tmp\" \"$root/active\"\n";
// Both files are build outputs and are embedded in the desktop executable.
// A release therefore never starts a mutable repository checkout.
const EMBEDDED_BACKEND: &[u8] = include_bytes!("../../dist/server/main.mjs");
const EMBEDDED_RUNTIME_MANIFEST: &str = include_str!("../../dist/server/runtime-manifest.json");

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct WslDistroPreference {
    selected: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    workspace_dir: Option<String>,
}

/// Stable, secret-free failures sent to the WebView. Details from WSL stderr
/// stay local: they frequently contain paths or user supplied workspace data.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartupFailure {
    WslNotInstalled,
    DistributionNotFound,
    RuntimeUnavailable,
    InvalidWorkspace,
    BackendIncompatible,
    BackendFailed,
}

impl StartupFailure {
    pub const fn code(self) -> &'static str {
        match self {
            Self::WslNotInstalled => "wsl-not-installed",
            Self::DistributionNotFound => "distribution-not-found",
            Self::RuntimeUnavailable => "runtime-unavailable",
            Self::InvalidWorkspace => "invalid-workspace",
            Self::BackendIncompatible => "backend-incompatible",
            Self::BackendFailed => "backend-failed",
        }
    }
}

fn classify_startup_failure(detail: &str) -> StartupFailure {
    let detail = detail.to_ascii_lowercase();
    if detail.contains("wsl is not installed") || detail.contains("wsl.exe is not recognized")
        || detail.contains("wsl.exe: not found") || detail.contains("os error 2") {
        StartupFailure::WslNotInstalled
    } else if detail.contains("no installed distributions") || detail.contains("there are no installed distributions")
        || detail.contains("distribution") && (detail.contains("not found") || detail.contains("does not exist")) {
        StartupFailure::DistributionNotFound
    } else if detail.contains("node: command not found") || detail.contains("node.exe is not recognized")
        || detail.contains("node.exe: not found") {
        StartupFailure::RuntimeUnavailable
    } else if detail.contains("workspace") && (detail.contains("not found") || detail.contains("invalid") || detail.contains("not a directory")) {
        StartupFailure::InvalidWorkspace
    } else {
        StartupFailure::BackendFailed
    }
}

/// The only secret-bearing response exposed to the WebView. It is held only
/// in this process memory and is never included in stdout/stderr diagnostics.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendConfig {
    pub base_url: String,
    pub port: u16,
    pub token: String,
}

#[derive(Debug, Deserialize)]
struct ReadyLine {
    #[serde(rename = "type")]
    kind: String,
    version: u32,
    port: u16,
    #[serde(rename = "sessionId")]
    session_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SupervisorState {
    Starting,
    Ready,
    Failed,
    Stopping,
    Stopped,
}

impl SupervisorState {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Starting => "starting",
            Self::Ready => "ready",
            Self::Failed => "failed",
            Self::Stopping => "stopping",
            Self::Stopped => "stopped",
        }
    }
}

/// Thread-safe lifecycle state for the one backend process owned by Tauri.
#[derive(Debug, Clone)]
pub struct BackendSupervisor {
    state: Arc<Mutex<SupervisorState>>,
    config: Arc<Mutex<Option<BackendConfig>>>,
    // Retained before waiting for the handshake so shutdown can also reclaim a
    // backend which is still starting; it is deliberately not exposed to the
    // WebView.
    child: Arc<Mutex<Option<Child>>>,
    failure: Arc<Mutex<Option<StartupFailure>>>,
    wsl_preference_path: Arc<Mutex<Option<PathBuf>>>,
}

impl Default for BackendSupervisor {
    fn default() -> Self {
        Self::new()
    }
}

impl BackendSupervisor {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(SupervisorState::Starting)),
            config: Arc::new(Mutex::new(None)),
            child: Arc::new(Mutex::new(None)),
            failure: Arc::new(Mutex::new(None)),
            wsl_preference_path: Arc::new(Mutex::new(None)),
        }
    }

    /// The preference belongs to Tauri's per-user app-config directory, never
    /// to the repository or the WSL installation.  There is intentionally no
    /// default distribution: choosing one is a user-visible setup decision.
    pub fn set_wsl_preference_path(&self, path: PathBuf) {
        *self.wsl_preference_path.lock().expect("WSL preference lock poisoned") = Some(path);
    }

    pub fn available_wsl_distributions(&self) -> Result<Vec<String>, String> {
        let output = Command::new("wsl.exe").args(["-l", "-q"]).output()
            .map_err(|error| classify_startup_failure(&error.to_string()).code().to_owned())?;
        if !output.status.success() {
            return Err(classify_startup_failure(&String::from_utf8_lossy(&output.stderr)).code().to_owned());
        }
        Ok(parse_wsl_distribution_list(&output.stdout))
    }

    pub fn select_wsl_distribution(&self, distro: String) -> Result<(), String> {
        let distro = distro.trim();
        if distro.is_empty() || !self.available_wsl_distributions()?.iter().any(|candidate| candidate == distro) {
            return Err(StartupFailure::DistributionNotFound.code().to_owned());
        }
        let path = self.wsl_preference_path.lock().expect("WSL preference lock poisoned").clone()
            .ok_or_else(|| "WSL preference path is not configured".to_owned())?;
        let workspace_dir = load_wsl_preference(&path).and_then(|preference| preference.workspace_dir);
        save_wsl_preference(&path, WslDistroPreference { selected: distro.to_owned(), workspace_dir })?;
        // Setup can now retry startup; a selected distro is never inferred.
        if self.state() == SupervisorState::Failed {
            *self.failure.lock().expect("backend failure lock poisoned") = None;
            self.transition_to(SupervisorState::Starting).map_err(|error| error.to_string())?;
        }
        Ok(())
    }

    /// Stores only a POSIX path. The directory itself is checked in the
    /// selected distro immediately before the backend starts.
    pub fn set_workspace_dir(&self, workspace_dir: String) -> Result<(), String> {
        let workspace_dir = validate_wsl_workspace_path(&workspace_dir)
            .ok_or_else(|| StartupFailure::InvalidWorkspace.code().to_owned())?;
        let path = self.wsl_preference_path.lock().expect("WSL preference lock poisoned").clone()
            .ok_or_else(|| "WSL preference path is not configured".to_owned())?;
        let mut preference = load_wsl_preference(&path)
            .ok_or_else(|| StartupFailure::DistributionNotFound.code().to_owned())?;
        preference.workspace_dir = Some(workspace_dir);
        save_wsl_preference(&path, preference)?;
        if self.state() == SupervisorState::Failed {
            *self.failure.lock().expect("backend failure lock poisoned") = None;
            self.transition_to(SupervisorState::Starting).map_err(|error| error.to_string())?;
        }
        Ok(())
    }

    /// Converts one directory explicitly chosen in the native Windows picker
    /// into the POSIX path consumed by the selected WSL backend. The WebView
    /// never receives shell or general filesystem capabilities.
    pub fn normalize_selected_directory(&self, selected: String) -> Result<String, String> {
        let distro = self.selected_wsl_distribution()
            .map_err(|_| StartupFailure::DistributionNotFound.code().to_owned())?;
        let selected = selected.trim();
        if selected.is_empty() || selected.len() > 4096 || selected.contains(['\0', '\r', '\n']) {
            return Err(StartupFailure::InvalidWorkspace.code().to_owned());
        }
        let path = match wsl_unc_to_posix(selected, &distro) {
            Ok(Some(path)) => path,
            Ok(None) => {
                let windows_absolute = selected.as_bytes().get(1) == Some(&b':') || selected.starts_with("\\\\");
                if !windows_absolute {
                    return Err(StartupFailure::InvalidWorkspace.code().to_owned());
                }
                let output = Command::new("wsl.exe")
                    .args(["-d", &distro, "--exec", "wslpath", "-u", selected])
                    .output()
                    .map_err(|_| StartupFailure::RuntimeUnavailable.code().to_owned())?;
                if !output.status.success() {
                    return Err(StartupFailure::InvalidWorkspace.code().to_owned());
                }
                String::from_utf8(output.stdout)
                    .ok()
                    .and_then(|value| validate_wsl_workspace_path(&value))
                    .ok_or_else(|| StartupFailure::InvalidWorkspace.code().to_owned())?
            }
            Err(()) => return Err(StartupFailure::DistributionNotFound.code().to_owned()),
        };
        let status = Command::new("wsl.exe")
            .args(["-d", &distro, "--exec", "test", "-d", &path])
            .status()
            .map_err(|_| StartupFailure::RuntimeUnavailable.code().to_owned())?;
        status.success().then_some(path)
            .ok_or_else(|| StartupFailure::InvalidWorkspace.code().to_owned())
    }

    pub fn state(&self) -> SupervisorState {
        *self.state.lock().expect("backend supervisor state lock poisoned")
    }

    /// Applies a valid lifecycle transition. Repeated notifications are safe
    /// so that a process-exit watcher and app shutdown can race harmlessly.
    pub fn transition_to(&self, next: SupervisorState) -> Result<(), SupervisorTransitionError> {
        let mut current = self.state.lock().expect("backend supervisor state lock poisoned");
        if *current == next {
            return Ok(());
        }
        if !can_transition(*current, next) {
            return Err(SupervisorTransitionError { from: *current, to: next });
        }
        *current = next;
        Ok(())
    }

    /// Starts exactly one WSL child. The first stdout line is a strict,
    /// versioned protocol message; ordinary backend logs remain on stderr.
    pub fn start_once(&self) -> Result<(), String> {
        if self.state() != SupervisorState::Starting {
            return Ok(());
        }
        let token = random_hex(32);
        let session_id = random_hex(16);
        let distro = self.selected_wsl_distribution()
            .map_err(|_| self.fail_before_spawn(StartupFailure::DistributionNotFound))?;
        self.verify_node_runtime(&distro)
            .map_err(|_| self.fail_before_spawn(StartupFailure::RuntimeUnavailable))?;
        let (backend_path, candidate_version) = self.materialize_runtime(&distro)
            .map_err(|failure| self.fail_before_spawn(failure))?;
        let workspace_dir = self.workspace_dir(&distro)
            .map_err(|_| self.fail_before_spawn(StartupFailure::InvalidWorkspace))?;
        // WSL only imports selected Windows environment variables. The session
        // capability must cross that boundary, but it must never be put in
        // shell source, argv, a manifest, or a file.
        let mut backend_environment = WSL_BACKEND_ENVIRONMENT.to_vec();
        if cfg!(debug_assertions) { backend_environment.push(WSL_DEV_ORIGIN_ENVIRONMENT); }
        let wslenv = wsl_env_with(std::env::var("WSLENV").ok().as_deref(), &backend_environment);
        let mut command = Command::new("wsl.exe");
        command
            .args(["-d", &distro, "--exec", "node", &backend_path])
            .env("MEGA_BRAIN_MODE", "desktop")
            .env("MEGA_BRAIN_SESSION_TOKEN", &token)
            .env("MEGA_BRAIN_SESSION_ID", &session_id)
            .env("WORKSPACE_DIR", &workspace_dir)
            .env("WSLENV", wslenv)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if cfg!(debug_assertions) { command.env("MEGA_BRAIN_DEV_ORIGIN", "http://127.0.0.1:15173"); }
        let mut child = command.spawn()
            .map_err(|error| self.fail_before_spawn(classify_startup_failure(&error.to_string())))?;
        let stdout = match child.stdout.take() {
            Some(stdout) => stdout,
            None => {
                let _ = child.kill();
                let _ = child.wait();
                self.mark_failed();
                return self.fail_start_with("Backend sem stdout para handshake.".to_owned(), StartupFailure::BackendFailed);
            }
        };
        // Drain stderr in the background. Diagnostics are intentionally not
        // reflected in command errors because they may contain user data.
        let (stderr_tx, stderr_rx) = mpsc::sync_channel(1);
        if let Some(stderr) = child.stderr.take() {
            std::thread::spawn(move || {
                let mut detail = String::new();
                let _ = BufReader::new(stderr).read_to_string(&mut detail);
                let _ = stderr_tx.send(detail);
            });
        }
        // Store ownership before the blocking read. In particular, closing the
        // desktop while WSL is still booting must not leave its command alive.
        *self.child.lock().expect("backend child lock poisoned") = Some(child);
        let (tx, rx) = mpsc::sync_channel(1);
        std::thread::spawn(move || {
            let result = BufReader::new(stdout).lines().next()
                .ok_or_else(|| "Backend encerrou antes do handshake.".to_owned())
                .and_then(|line| line.map_err(|_| "Não foi possível ler o handshake do backend.".to_owned()));
            let _ = tx.send(result);
        });
        let line = match rx.recv_timeout(Duration::from_secs(10)) {
            Ok(Ok(line)) => line,
            Ok(Err(error)) => return self.fail_start_with_stderr(error, &stderr_rx),
            Err(_) => return self.fail_start_with_stderr("Timeout aguardando o handshake do backend.".into(), &stderr_rx),
        };
        let ready = parse_ready_line(&line, &session_id).map_err(|error| {
            self.terminate_owned_child();
            self.mark_failed_with(StartupFailure::BackendIncompatible);
            error
        })?;
        if self.state() != SupervisorState::Starting {
            // The app began closing while stdout was being read. `shutdown`
            // already reaped the child, so never publish a usable config.
            return Err("Backend foi encerrado durante a inicialização.".into());
        }
        let config = BackendConfig {
            base_url: format!("http://127.0.0.1:{}", ready.port), port: ready.port, token,
        };
        // A new directory is deliberately not made active until the exact
        // candidate process has answered an authenticated health request.
        // Keeping `active` untouched gives a failed update a natural rollback.
        if candidate_version.is_some() && !health_check(&config) {
            return self.fail_start_with("Backend não respondeu ao health check.".into(), StartupFailure::BackendFailed);
        }
        if let Some(version) = candidate_version {
            if self.activate_runtime(&distro, &version).is_err() {
                return self.fail_start_with("Não foi possível ativar o runtime validado.".into(), StartupFailure::BackendFailed);
            }
        }
        *self.config.lock().expect("backend config lock poisoned") = Some(config);
        self.transition_to(SupervisorState::Ready).map_err(|error| error.to_string())
    }

    /// Materializes into a staging directory and renames that directory only
    /// after size and SHA-256 validation inside the selected WSL distro.
    /// `MEGA_BRAIN_WSL_BACKEND_PATH` is intentionally accepted only by debug
    /// builds, preserving the repository workflow without becoming a release
    /// fallback or a packaged-app escape hatch.
    fn materialize_runtime(&self, distro: &str) -> Result<(String, Option<String>), StartupFailure> {
        #[cfg(debug_assertions)]
        if let Ok(path) = std::env::var("MEGA_BRAIN_WSL_BACKEND_PATH") {
            if !path.trim().is_empty() { return Ok((path, None)); }
        }
        let manifest = RuntimeManifest::parse_and_validate(EMBEDDED_RUNTIME_MANIFEST)
            .map_err(|_| StartupFailure::BackendIncompatible)?;
        if manifest.size_bytes != EMBEDDED_BACKEND.len() as u64 { return Err(StartupFailure::BackendIncompatible); }
        let home = self.wsl_home(distro).map_err(|_| StartupFailure::RuntimeUnavailable)?;
        let layout = RuntimeLayout::for_wsl_home(home);
        let target = layout.backend_path(&manifest).map_err(|_| StartupFailure::BackendIncompatible)?;
        let root = wsl_path(layout.root());
        let status = install_runtime_in_wsl(distro, &root, &manifest, EMBEDDED_BACKEND)
            .map_err(|_| StartupFailure::BackendFailed)?;
        if !status { return Err(StartupFailure::BackendIncompatible); }
        Ok((wsl_path(&target), Some(manifest.runtime_version)))
    }

    fn wsl_home(&self, distro: &str) -> Result<PathBuf, ()> {
        let home = wsl_environment_value(distro, "HOME")?;
        let home = home.trim();
        if !home.starts_with('/') || home.contains('\0') { return Err(()); }
        Ok(PathBuf::from(home))
    }

    fn activate_runtime(&self, distro: &str, version: &str) -> Result<(), ()> {
        let manifest = RuntimeManifest::parse_and_validate(EMBEDDED_RUNTIME_MANIFEST).map_err(|_| ())?;
        let home = self.wsl_home(distro)?;
        let root = wsl_path(RuntimeLayout::for_wsl_home(home).root());
        let wslenv = wsl_env_with(std::env::var("WSLENV").ok().as_deref(), &WSL_RUNTIME_ACTIVATE_ENVIRONMENT);
        let mut child = Command::new("wsl.exe")
            .args(["-d", distro, "--exec", "sh"])
            .env("MEGA_BRAIN_RUNTIME_ROOT", &root)
            .env("MEGA_BRAIN_RUNTIME_VERSION", version)
            .env("WSLENV", wslenv)
            .stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null())
            .spawn().map_err(|_| ())?;
        child.stdin.take().ok_or(())?.write_all(WSL_RUNTIME_ACTIVATE.as_bytes()).map_err(|_| ())?;
        let status = child.wait().map_err(|_| ())?;
        if manifest.runtime_version != version || !status.success() { return Err(()); }
        Ok(())
    }

    fn selected_wsl_distribution(&self) -> Result<String, String> {
        let path = self.wsl_preference_path.lock().expect("WSL preference lock poisoned").clone()
            .ok_or_else(|| StartupFailure::DistributionNotFound.code().to_owned())?;
        load_wsl_preference(&path).map(|preference| preference.selected)
            .ok_or_else(|| StartupFailure::DistributionNotFound.code().to_owned())
    }

    fn workspace_dir(&self, distro: &str) -> Result<String, ()> {
        let configured = self.wsl_preference_path.lock().expect("WSL preference lock poisoned").clone()
            .and_then(|path| load_wsl_preference(&path))
            .and_then(|preference| preference.workspace_dir);
        if let Some(path) = configured {
            return validate_wsl_workspace_path(&path).ok_or(());
        }
        // Read the existing WSL login environment rather than importing the
        // Windows process environment. The fallback matches the backend's
        // established default while remaining an absolute WSL path.
        let home = self.wsl_home(distro)?;
        let path = wsl_environment_value(distro, "WORKSPACE_DIR")
            .unwrap_or_else(|_| format!("{}/mega-brain-files/workspace", home.display()));
        validate_wsl_workspace_path(&path).ok_or(())
    }

    /// Node remains an explicit WSL prerequisite in this bootstrap phase. The
    /// check is made before launching the bundle so a missing or old runtime is
    /// reported as actionable setup instead of a generic handshake failure.
    fn verify_node_runtime(&self, distro: &str) -> Result<NodeVersion, ()> {
        let output = Command::new("wsl.exe").args(["-d", distro, "--", "node", "--version"])
            .output().map_err(|_| ())?;
        if !output.status.success() { return Err(()); }
        let version = String::from_utf8_lossy(&output.stdout);
        let version = NodeVersion::parse(&version).ok_or(())?;
        version.meets_minimum().then_some(version).ok_or(())
    }

    fn fail_start_with_stderr(&self, error: String, stderr: &mpsc::Receiver<String>) -> Result<(), String> {
        let detail = stderr.recv_timeout(Duration::from_millis(250)).unwrap_or_default();
        self.fail_start_with(error.clone(), classify_startup_failure(&format!("{error}\n{detail}")))
    }

    fn fail_start_with(&self, error: String, failure: StartupFailure) -> Result<(), String> {
        self.terminate_owned_child();
        self.mark_failed_with(failure);
        Err(error)
    }

    fn fail_before_spawn(&self, failure: StartupFailure) -> String {
        self.mark_failed_with(failure);
        failure.code().to_owned()
    }

    fn mark_failed(&self) {
        self.mark_failed_with(StartupFailure::BackendFailed);
    }

    fn mark_failed_with(&self, failure: StartupFailure) {
        *self.failure.lock().expect("backend failure lock poisoned") = Some(failure);
        if self.state() == SupervisorState::Starting {
            let _ = self.transition_to(SupervisorState::Failed);
        }
    }

    fn terminate_owned_child(&self) {
        let child = self.child.lock().expect("backend child lock poisoned").take();
        if let Some(mut child) = child {
            // `wsl.exe` owns the command it launched. Reaping that exact
            // handle closes this app's WSL command rather than targeting a
            // distro or any unrelated desktop/backend instance.
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    /// Reaps the WSL command owned by this app. Safe to call from both the
    /// window-close and application-exit paths: only the first caller takes
    /// the child handle, and no unrelated WSL process is ever targeted.
    pub fn shutdown(&self) {
        match self.state() {
            SupervisorState::Stopped | SupervisorState::Stopping => return,
            SupervisorState::Starting | SupervisorState::Ready | SupervisorState::Failed => {
                let _ = self.transition_to(SupervisorState::Stopping);
            }
        }
        *self.config.lock().expect("backend config lock poisoned") = None;
        self.terminate_owned_child();
        let _ = self.transition_to(SupervisorState::Stopped);
    }

    pub fn backend_config(&self) -> Result<BackendConfig, String> {
        self.config.lock().expect("backend config lock poisoned").clone()
            .ok_or_else(|| self.failure.lock().expect("backend failure lock poisoned").map(StartupFailure::code).unwrap_or("backend-starting").to_owned())
    }
}

fn wsl_env_with(existing: Option<&str>, required: &[&str]) -> String {
    let mut entries: Vec<&str> = existing
        .unwrap_or_default()
        .split(':')
        .filter(|entry| !entry.is_empty())
        .filter(|entry| {
            let name = entry.split('/').next().unwrap_or_default();
            !required.iter().any(|required| name == required.split('/').next().unwrap_or_default())
        })
        .collect();
    entries.extend(required.iter().copied());
    entries.join(":")
}

fn wsl_environment_value(distro: &str, key: &str) -> Result<String, ()> {
    let output = Command::new("wsl.exe").args(["-d", distro, "--exec", "env"])
        .output().map_err(|_| ())?;
    if !output.status.success() { return Err(()); }
    let prefix = format!("{key}=");
    String::from_utf8(output.stdout).map_err(|_| ())?
        .lines().find_map(|line| line.strip_prefix(&prefix)).map(str::to_owned).ok_or(())
}

fn wsl_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn install_runtime_in_wsl(distro: &str, root: &str, manifest: &RuntimeManifest, artifact: &[u8]) -> Result<bool, ()> {
    let size = manifest.size_bytes.to_string();
    let wslenv = wsl_env_with(std::env::var("WSLENV").ok().as_deref(), &WSL_RUNTIME_INSTALL_ENVIRONMENT);
    let mut child = Command::new("wsl.exe")
        .args(["-d", distro, "--exec", "sh"])
        .env("MEGA_BRAIN_RUNTIME_ROOT", root)
        .env("MEGA_BRAIN_RUNTIME_VERSION", &manifest.runtime_version)
        .env("MEGA_BRAIN_RUNTIME_SHA256", &manifest.sha256)
        .env("MEGA_BRAIN_RUNTIME_SIZE", &size)
        .env("WSLENV", wslenv)
        .stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null())
        .spawn().map_err(|_| ())?;
    child.stdin.take().ok_or(())?.write_all(&runtime_install_script(artifact)).map_err(|_| ())?;
    child.wait().map(|status| status.success()).map_err(|_| ())
}

fn runtime_install_script(artifact: &[u8]) -> Vec<u8> {
    WSL_RUNTIME_INSTALL.replace(RUNTIME_ARTIFACT_PLACEHOLDER, &base64_encode(artifact)).into_bytes()
}

fn base64_encode(input: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = String::with_capacity((input.len() + 2) / 3 * 4);
    for chunk in input.chunks(3) {
        let first = chunk[0];
        let second = *chunk.get(1).unwrap_or(&0);
        let third = *chunk.get(2).unwrap_or(&0);
        output.push(ALPHABET[(first >> 2) as usize] as char);
        output.push(ALPHABET[(((first & 0b11) << 4) | (second >> 4)) as usize] as char);
        output.push(if chunk.len() > 1 { ALPHABET[(((second & 0b1111) << 2) | (third >> 6)) as usize] as char } else { '=' });
        output.push(if chunk.len() > 2 { ALPHABET[(third & 0b11_1111) as usize] as char } else { '=' });
    }
    output
}

fn health_check(config: &BackendConfig) -> bool {
    let Ok(mut addresses) = ("127.0.0.1", config.port).to_socket_addrs() else { return false; };
    let Some(address) = addresses.next() else { return false; };
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_secs(2)) else { return false; };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let request = health_request(config);
    if stream.write_all(request.as_bytes()).is_err() { return false; }
    let mut response = [0_u8; 128];
    let Ok(size) = stream.read(&mut response) else { return false; };
    is_successful_health_response(&response[..size])
}

fn health_request(config: &BackendConfig) -> String {
    format!("GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {}\r\nConnection: close\r\n\r\n", config.token)
}

fn is_successful_health_response(response: &[u8]) -> bool {
    response.starts_with(b"HTTP/1.1 200")
}

fn random_hex(bytes: usize) -> String {
    let mut value = vec![0_u8; bytes];
    getrandom::fill(&mut value).expect("system random generator unavailable");
    value.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn parse_wsl_distribution_list(bytes: &[u8]) -> Vec<String> {
    // `wsl.exe -l -q` is UTF-16LE on some Windows versions and UTF-8 on
    // others. Accept both forms, remove its BOM/NULs and retain only actual
    // distribution names.
    let text = if bytes.starts_with(&[0xff, 0xfe]) {
        String::from_utf16_lossy(&bytes[2..].chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]])).collect::<Vec<_>>())
    } else {
        String::from_utf8_lossy(bytes).replace('\0', "")
    };
    text.lines().map(str::trim).filter(|name| !name.is_empty()).map(str::to_owned).collect()
}

fn load_wsl_preference(path: &Path) -> Option<WslDistroPreference> {
    let contents = fs::read_to_string(path).ok()?;
    let preference: WslDistroPreference = serde_json::from_str(&contents).ok()?;
    let selected = preference.selected.trim();
    (!selected.is_empty()).then(|| WslDistroPreference {
        selected: selected.to_owned(),
        workspace_dir: preference.workspace_dir.and_then(|path| validate_wsl_workspace_path(&path)),
    })
}

fn save_wsl_preference(path: &Path, preference: WslDistroPreference) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| "WSL preference has no parent directory".to_owned())?;
    fs::create_dir_all(parent).map_err(|_| "Unable to save WSL preference".to_owned())?;
    let encoded = serde_json::to_vec(&preference)
        .map_err(|_| "Unable to save WSL preference".to_owned())?;
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, encoded).map_err(|_| "Unable to save WSL preference".to_owned())?;
    fs::rename(&temporary, path).map_err(|_| "Unable to save WSL preference".to_owned())
}

/// Accept only absolute, single-line POSIX paths. This prevents Windows paths
/// and shell-control bytes from crossing the desktop boundary.
fn validate_wsl_workspace_path(path: &str) -> Option<String> {
    let path = path.trim();
    (path.len() <= 4096
        && path.starts_with('/')
        && !path.contains('\0')
        && !path.contains('\r')
        && !path.contains('\n')
        && !path.split('/').any(|segment| segment == ".."))
        .then(|| path.to_owned())
}

fn wsl_unc_to_posix(path: &str, distro: &str) -> Result<Option<String>, ()> {
    let normalized = path.replace('/', "\\");
    let lowercase = normalized.to_ascii_lowercase();
    let prefixes = ["\\\\wsl.localhost\\", "\\\\wsl$\\"];
    let Some(prefix) = prefixes.iter().find(|prefix| lowercase.starts_with(**prefix)) else {
        return Ok(None);
    };
    let remainder = &normalized[prefix.len()..];
    let (selected_distro, tail) = remainder.split_once('\\').unwrap_or((remainder, ""));
    if !selected_distro.eq_ignore_ascii_case(distro) {
        return Err(());
    }
    let path = if tail.is_empty() { "/".to_owned() } else { format!("/{}", tail.replace('\\', "/")) };
    validate_wsl_workspace_path(&path).map(Some).ok_or(())
}

fn parse_ready_line(line: &str, expected_session_id: &str) -> Result<ReadyLine, String> {
    let ready: ReadyLine = serde_json::from_str(line).map_err(|_| "Handshake do backend inválido.".to_owned())?;
    if ready.kind != "mega-brain-ready" || ready.version != READY_PROTOCOL_VERSION || ready.port == 0 || ready.session_id != expected_session_id {
        return Err("Handshake do backend incompatível.".into());
    }
    Ok(ready)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SupervisorTransitionError {
    pub from: SupervisorState,
    pub to: SupervisorState,
}

impl std::fmt::Display for SupervisorTransitionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "invalid supervisor transition: {} -> {}", self.from.as_str(), self.to.as_str())
    }
}

impl std::error::Error for SupervisorTransitionError {}

const fn can_transition(from: SupervisorState, to: SupervisorState) -> bool {
    matches!(
        (from, to),
        (SupervisorState::Starting, SupervisorState::Ready | SupervisorState::Failed | SupervisorState::Stopping)
            | (SupervisorState::Ready, SupervisorState::Failed | SupervisorState::Stopping)
            | (SupervisorState::Failed, SupervisorState::Starting | SupervisorState::Stopping | SupervisorState::Stopped)
            | (SupervisorState::Stopping, SupervisorState::Stopped)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passes_ephemeral_wsl_values_without_duplicates() {
        let environment = wsl_env_with(Some(
            "PATH/p:MEGA_BRAIN_SESSION_ID:OTHER/u:MEGA_BRAIN_MODE/l",
        ), &WSL_BACKEND_ENVIRONMENT);
        let entries: Vec<_> = environment.split(':').collect();

        assert!(entries.contains(&"PATH/p"));
        assert!(entries.contains(&"OTHER/u"));
        for expected in WSL_BACKEND_ENVIRONMENT {
            assert_eq!(entries.iter().filter(|entry| **entry == expected).count(), 1);
        }
    }

    #[test]
    fn runtime_scripts_read_dynamic_values_from_the_wsl_environment() {
        assert!(WSL_RUNTIME_INSTALL.contains("${MEGA_BRAIN_RUNTIME_ROOT:?}"));
        assert!(WSL_RUNTIME_ACTIVATE.contains("${MEGA_BRAIN_RUNTIME_VERSION:?}"));
        assert!(!WSL_RUNTIME_INSTALL.contains("root=\"$1\""));
        assert!(String::from_utf8(runtime_install_script(b"abc")).unwrap().contains("YWJj"));
    }

    #[test]
    #[ignore = "requires a local Windows WSL distribution"]
    fn materializes_the_embedded_runtime_in_a_real_wsl_distribution() {
        let distro = std::env::var("MEGA_BRAIN_TEST_WSL_DISTRO")
            .expect("set MEGA_BRAIN_TEST_WSL_DISTRO to a local WSL distribution");
        let manifest = RuntimeManifest::parse_and_validate(EMBEDDED_RUNTIME_MANIFEST).unwrap();
        let supervisor = BackendSupervisor::new();
        let home = supervisor.wsl_home(&distro).unwrap();
        let layout = RuntimeLayout::for_wsl_home(home);
        let root = wsl_path(layout.root());

        let size = manifest.size_bytes.to_string();
        let wslenv = wsl_env_with(std::env::var("WSLENV").ok().as_deref(), &WSL_RUNTIME_INSTALL_ENVIRONMENT);
        let mut child = Command::new("wsl.exe")
            .args(["-d", &distro, "--exec", "sh"])
            .env("MEGA_BRAIN_RUNTIME_ROOT", &root)
            .env("MEGA_BRAIN_RUNTIME_VERSION", &manifest.runtime_version)
            .env("MEGA_BRAIN_RUNTIME_SHA256", &manifest.sha256)
            .env("MEGA_BRAIN_RUNTIME_SIZE", &size)
            .env("WSLENV", wslenv)
            .stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::piped())
            .spawn().unwrap();
        child.stdin.take().unwrap().write_all(&runtime_install_script(EMBEDDED_BACKEND)).unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        assert!(wsl_path(&layout.backend_path(&manifest).unwrap()).starts_with(&root));
    }

    #[test]
    #[ignore = "requires a local Windows WSL distribution"]
    fn launches_the_embedded_runtime_in_a_real_wsl_distribution() {
        let distro = std::env::var("MEGA_BRAIN_TEST_WSL_DISTRO").unwrap();
        let manifest = RuntimeManifest::parse_and_validate(EMBEDDED_RUNTIME_MANIFEST).unwrap();
        let home = BackendSupervisor::new().wsl_home(&distro).unwrap();
        let backend = wsl_path(&RuntimeLayout::for_wsl_home(home).backend_path(&manifest).unwrap());
        let session = "a".repeat(32);
        let token = "b".repeat(64);
        let wslenv = wsl_env_with(std::env::var("WSLENV").ok().as_deref(), &WSL_BACKEND_ENVIRONMENT);
        let mut child = Command::new("wsl.exe")
            .args(["-d", &distro, "--exec", "node", &backend])
            .env("MEGA_BRAIN_MODE", "desktop")
            .env("MEGA_BRAIN_SESSION_TOKEN", token)
            .env("MEGA_BRAIN_SESSION_ID", &session)
            .env("MEGA_BRAIN_WORKSPACE_DIR", "/home/david/mega-brain")
            .env("WSLENV", wslenv)
            .stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
        let line = BufReader::new(child.stdout.take().unwrap()).lines().next().unwrap().unwrap();
        child.kill().unwrap();
        assert!(parse_ready_line(&line, &session).is_ok(), "{line}");
    }

    #[test]
    fn starts_in_starting_and_exposes_stable_names() {
        let supervisor = BackendSupervisor::new();
        assert_eq!(supervisor.state(), SupervisorState::Starting);
        assert_eq!(SupervisorState::Ready.as_str(), "ready");
        assert_eq!(SupervisorState::Failed.as_str(), "failed");
        assert_eq!(SupervisorState::Stopping.as_str(), "stopping");
        assert_eq!(SupervisorState::Stopped.as_str(), "stopped");
    }

    #[test]
    fn follows_normal_startup_and_shutdown_lifecycle() {
        let supervisor = BackendSupervisor::new();
        supervisor.transition_to(SupervisorState::Ready).unwrap();
        supervisor.transition_to(SupervisorState::Stopping).unwrap();
        supervisor.transition_to(SupervisorState::Stopped).unwrap();
        assert_eq!(supervisor.state(), SupervisorState::Stopped);
    }

    #[test]
    fn permits_startup_failure_then_cleanup() {
        let supervisor = BackendSupervisor::new();
        supervisor.transition_to(SupervisorState::Failed).unwrap();
        supervisor.transition_to(SupervisorState::Stopping).unwrap();
        supervisor.transition_to(SupervisorState::Stopped).unwrap();
    }

    #[test]
    fn shutdown_from_startup_is_idempotent() {
        let supervisor = BackendSupervisor::new();
        supervisor.shutdown();
        supervisor.shutdown();
        assert_eq!(supervisor.state(), SupervisorState::Stopped);
        assert!(supervisor.backend_config().is_err());
    }

    #[test]
    fn fake_failed_start_can_retry_without_reusing_config_or_failure() {
        let supervisor = BackendSupervisor::new();
        supervisor.mark_failed_with(StartupFailure::RuntimeUnavailable);
        assert_eq!(supervisor.state(), SupervisorState::Failed);
        assert_eq!(supervisor.backend_config().unwrap_err(), "runtime-unavailable");

        // Same reset used after the user fixes setup; no `wsl.exe` is invoked.
        *supervisor.failure.lock().unwrap() = None;
        supervisor.transition_to(SupervisorState::Starting).unwrap();
        assert_eq!(supervisor.state(), SupervisorState::Starting);
        assert_eq!(supervisor.backend_config().unwrap_err(), "backend-starting");
    }

    #[test]
    fn rejects_skipping_lifecycle_steps_but_allows_duplicate_notifications() {
        let supervisor = BackendSupervisor::new();
        assert_eq!(supervisor.transition_to(SupervisorState::Stopped), Err(SupervisorTransitionError { from: SupervisorState::Starting, to: SupervisorState::Stopped }));
        supervisor.transition_to(SupervisorState::Ready).unwrap();
        supervisor.transition_to(SupervisorState::Ready).unwrap();
        assert_eq!(supervisor.transition_to(SupervisorState::Starting), Err(SupervisorTransitionError { from: SupervisorState::Ready, to: SupervisorState::Starting }));
    }

    #[test]
    fn accepts_only_the_expected_versioned_handshake() {
        let session = "a".repeat(32);
        let parsed = parse_ready_line(&format!(r#"{{"type":"mega-brain-ready","version":1,"port":43123,"sessionId":"{session}"}}"#), &session).unwrap();
        assert_eq!(parsed.port, 43123);
        assert!(parse_ready_line(r#"{"type":"mega-brain-ready","version":2,"port":1,"sessionId":"x"}"#, "x").is_err());
        assert!(parse_ready_line(r#"{"type":"other","version":1,"port":1,"sessionId":"x"}"#, "x").is_err());
    }

    #[test]
    fn fake_backend_health_requires_the_ephemeral_bearer_token() {
        let config = BackendConfig { base_url: "http://127.0.0.1:43123".into(), port: 43123, token: "fake-session-token".into() };
        let request = health_request(&config);
        assert!(request.starts_with("GET /health HTTP/1.1\r\n"));
        assert!(request.contains("Authorization: Bearer fake-session-token\r\n"));
        assert!(is_successful_health_response(b"HTTP/1.1 200 OK\r\n\r\n"));
        assert!(!is_successful_health_response(b"HTTP/1.1 401 Unauthorized\r\n\r\n"));
        assert!(!is_successful_health_response(b"garbage"));
    }

    #[test]
    fn classifies_each_actionable_startup_prerequisite_without_exposing_stderr() {
        assert_eq!(classify_startup_failure("wsl.exe is not recognized"), StartupFailure::WslNotInstalled);
        assert_eq!(classify_startup_failure("The distribution 'Ubuntu' does not exist"), StartupFailure::DistributionNotFound);
        assert_eq!(classify_startup_failure("/bin/sh: node: command not found"), StartupFailure::RuntimeUnavailable);
        assert_eq!(classify_startup_failure("workspace /tmp/missing not found"), StartupFailure::InvalidWorkspace);
        assert_eq!(StartupFailure::BackendIncompatible.code(), "backend-incompatible");
    }

    #[test]
    fn parses_wsl_quiet_list_in_utf8_or_utf16le() {
        assert_eq!(parse_wsl_distribution_list(b"Ubuntu\r\nDebian\r\n"), vec!["Ubuntu", "Debian"]);
        let mut utf16 = vec![0xff, 0xfe];
        utf16.extend("Ubuntu\r\n".encode_utf16().flat_map(u16::to_le_bytes));
        assert_eq!(parse_wsl_distribution_list(&utf16), vec!["Ubuntu"]);
    }

    #[test]
    fn persists_an_explicit_wsl_selection_without_a_default() {
        let directory = std::env::temp_dir().join(format!("mega-brain-wsl-preference-{}", random_hex(8)));
        let path = directory.join("wsl-distro.json");
        assert_eq!(load_wsl_preference(&path), None);
        save_wsl_preference(&path, WslDistroPreference { selected: "Debian".into(), workspace_dir: Some("/home/alice/brain".into()) }).unwrap();
        assert_eq!(load_wsl_preference(&path).unwrap().selected, "Debian");
        assert_eq!(load_wsl_preference(&path).unwrap().workspace_dir.as_deref(), Some("/home/alice/brain"));
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn accepts_only_absolute_safe_wsl_workspace_paths() {
        assert_eq!(validate_wsl_workspace_path(" /home/alice/brain ").as_deref(), Some("/home/alice/brain"));
        for invalid in ["", "relative", "C:\\\\brain", "/home/../etc", "/tmp/a\nb", "/tmp/a\0b"] {
            assert_eq!(validate_wsl_workspace_path(invalid), None, "{invalid:?}");
        }
    }

    #[test]
    fn translates_only_unc_paths_from_the_selected_wsl_distribution() {
        assert_eq!(
            wsl_unc_to_posix(r"\\wsl.localhost\Ubuntu\home\alice\mega-brain", "Ubuntu"),
            Ok(Some("/home/alice/mega-brain".to_owned())),
        );
        assert_eq!(wsl_unc_to_posix(r"\\wsl$\ubuntu\home\alice", "Ubuntu"), Ok(Some("/home/alice".to_owned())));
        assert_eq!(wsl_unc_to_posix(r"C:\Users\alice", "Ubuntu"), Ok(None));
        assert_eq!(wsl_unc_to_posix(r"\\wsl.localhost\Debian\home\alice", "Ubuntu"), Err(()));
    }

    #[test]
    fn backend_environment_keeps_the_workspace_out_of_shell_source() {
        assert!(WSL_BACKEND_ENVIRONMENT.contains(&"WORKSPACE_DIR/u"));
        assert!(!WSL_RUNTIME_INSTALL.contains("env -i"));
        assert!(!WSL_RUNTIME_INSTALL.contains(".claude"));
    }

    #[test]
    fn interrupted_upgrade_leaves_active_untouched_until_fake_health_succeeds() {
        // The installer writes only staging/candidate paths and cleanup is
        // trapped for interruption. Activation is a distinct post-health
        // operation, so the prior active symlink is the rollback target.
        assert!(WSL_RUNTIME_INSTALL.contains("stage=\"$root/.install-$version-$$\""));
        assert!(WSL_RUNTIME_INSTALL.contains("trap 'rm -rf \"$stage\"' EXIT HUP INT TERM"));
        assert!(WSL_RUNTIME_INSTALL.contains("mv \"$stage\" \"$target\""));
        assert!(!WSL_RUNTIME_INSTALL.contains("active"));
        assert!(WSL_RUNTIME_ACTIVATE.contains("[ -f \"$root/$version/main.mjs\" ]"));
        assert!(WSL_RUNTIME_ACTIVATE.contains("mv -Tf \"$tmp\" \"$root/active\""));
    }

    #[test]
    fn refuses_to_start_without_a_persisted_distribution_choice() {
        let supervisor = BackendSupervisor::new();
        let directory = std::env::temp_dir().join(format!("mega-brain-wsl-unselected-{}", random_hex(8)));
        supervisor.set_wsl_preference_path(directory.join("wsl-distro.json"));
        assert_eq!(supervisor.start_once(), Err("distribution-not-found".to_owned()));
        assert_eq!(supervisor.state(), SupervisorState::Failed);
        assert_eq!(supervisor.backend_config().unwrap_err(), "distribution-not-found");
    }

    #[test]
    fn only_a_failed_setup_can_return_to_starting_after_selection() {
        let supervisor = BackendSupervisor::new();
        supervisor.transition_to(SupervisorState::Failed).unwrap();
        supervisor.transition_to(SupervisorState::Starting).unwrap();
        assert_eq!(supervisor.state(), SupervisorState::Starting);
    }
}
