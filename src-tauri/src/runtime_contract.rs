//! Versioned, secret-free contract for the backend artifact installed in WSL.
//!
//! The installer owns copying the artifact and changing the active version. This
//! module deliberately only defines and validates the boundary, so startup does
//! not silently fall back to a repository checkout in a packaged application.

use serde::Deserialize;
use std::path::{Path, PathBuf};

pub const RUNTIME_MANIFEST_SCHEMA_VERSION: u32 = 1;
pub const MINIMUM_NODE_VERSION: NodeVersion = NodeVersion { major: 18, minor: 19, patch: 0 };
pub const WSL_RUNTIME_RELATIVE_ROOT: &str = ".local/share/mega-brain/runtime";

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct NodeVersion {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
}

impl NodeVersion {
    pub fn parse(value: &str) -> Option<Self> {
        let value = value.trim().strip_prefix('v').unwrap_or(value.trim());
        let mut components = value.split('.');
        let major = components.next()?.parse().ok()?;
        let minor = components.next()?.parse().ok()?;
        // Node's `--version` normally has no suffix, but accepting a suffix
        // after the numeric patch keeps this parser forward compatible.
        let patch = components.next()?.split('-').next()?.parse().ok()?;
        if components.next().is_some() { return None; }
        Some(Self { major, minor, patch })
    }

    pub fn meets_minimum(self) -> bool { self >= MINIMUM_NODE_VERSION }
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeManifest {
    pub schema_version: u32,
    pub runtime_version: String,
    pub entrypoint: String,
    pub sha256: String,
    pub size_bytes: u64,
}

impl RuntimeManifest {
    pub fn parse_and_validate(source: &str) -> Result<Self, RuntimeContractError> {
        let manifest: Self = serde_json::from_str(source).map_err(|_| RuntimeContractError::InvalidManifest)?;
        manifest.validate()?;
        Ok(manifest)
    }

    pub fn validate(&self) -> Result<(), RuntimeContractError> {
        if self.schema_version != RUNTIME_MANIFEST_SCHEMA_VERSION
            || !is_safe_version(&self.runtime_version)
            || self.entrypoint != "main.mjs"
            || self.size_bytes == 0
            || self.sha256.len() != 64
            || !self.sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(RuntimeContractError::InvalidManifest);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeLayout { root: PathBuf }

impl RuntimeLayout {
    pub fn for_wsl_home(home: impl AsRef<Path>) -> Self {
        Self { root: home.as_ref().join(WSL_RUNTIME_RELATIVE_ROOT) }
    }

    pub fn version_dir(&self, version: &str) -> Result<PathBuf, RuntimeContractError> {
        if !is_safe_version(version) { return Err(RuntimeContractError::UnsafeVersion); }
        Ok(self.root.join(version))
    }

    pub fn root(&self) -> &Path { &self.root }

    pub fn backend_path(&self, manifest: &RuntimeManifest) -> Result<PathBuf, RuntimeContractError> {
        Ok(self.version_dir(&manifest.runtime_version)?.join(&manifest.entrypoint))
    }
}

fn is_safe_version(version: &str) -> bool {
    !version.is_empty() && version.len() <= 64 && version.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeContractError { InvalidManifest, UnsafeVersion }

#[cfg(test)]
mod tests {
    use super::*;

    const VALID: &str = r#"{"schemaVersion":1,"runtimeVersion":"0.1.0","entrypoint":"main.mjs","sha256":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","sizeBytes":42}"#;

    #[test]
    fn accepts_only_the_versioned_backend_manifest_contract() {
        let manifest = RuntimeManifest::parse_and_validate(VALID).unwrap();
        assert_eq!(manifest.runtime_version, "0.1.0");
        assert!(RuntimeManifest::parse_and_validate(r#"{"schemaVersion":2,"runtimeVersion":"0.1.0","entrypoint":"main.mjs","sha256":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","sizeBytes":42}"#).is_err());
        assert!(RuntimeManifest::parse_and_validate(r#"{"schemaVersion":1,"runtimeVersion":"../../escape","entrypoint":"main.mjs","sha256":"bad","sizeBytes":0}"#).is_err());
    }

    #[test]
    fn installs_only_below_the_wsl_user_data_root() {
        let manifest = RuntimeManifest::parse_and_validate(VALID).unwrap();
        let layout = RuntimeLayout::for_wsl_home("/home/alice");
        assert_eq!(layout.backend_path(&manifest).unwrap(), PathBuf::from("/home/alice/.local/share/mega-brain/runtime/0.1.0/main.mjs"));
        assert_eq!(layout.version_dir("../repo"), Err(RuntimeContractError::UnsafeVersion));
    }

    #[test]
    fn parses_and_enforces_the_documented_node_minimum() {
        assert_eq!(NodeVersion::parse("v18.19.0"), Some(MINIMUM_NODE_VERSION));
        assert!(NodeVersion::parse("v18.19.0").unwrap().meets_minimum());
        assert!(!NodeVersion::parse("v18.18.9").unwrap().meets_minimum());
        assert!(!NodeVersion::parse("not-node").is_some());
    }
}
