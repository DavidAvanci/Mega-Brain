use std::fs::OpenOptions;
use std::io::Write;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

const MAX_EXPORT_BYTES: usize = 8 * 1024 * 1024;

fn validate_export(filename: &str, markdown: &str) -> Result<(), String> {
    if filename.len() > 240
        || !filename.ends_with(".md")
        || filename
            .chars()
            .any(|character| !character.is_alphanumeric() && !matches!(character, '-' | '_' | '.'))
        || filename.contains("..")
    {
        return Err("Nome de arquivo inválido".into());
    }
    if markdown.is_empty() || markdown.len() > MAX_EXPORT_BYTES {
        return Err("O chat deve conter entre 1 byte e 8 MB para exportação".into());
    }
    Ok(())
}

/// The destination comes only from the native Save dialog, never from the WebView.
#[tauri::command]
pub async fn export_chat_markdown(
    app: AppHandle,
    filename: String,
    markdown: String,
) -> Result<bool, String> {
    validate_export(&filename, &markdown)?;
    tauri::async_runtime::spawn_blocking(move || {
        let destination = app
            .dialog()
            .file()
            .set_title("Exportar chat")
            .set_file_name(filename)
            .add_filter("Markdown", &["md"])
            .blocking_save_file();
        let Some(destination) = destination else {
            return Ok(false);
        };
        let path = destination.into_path().map_err(|error| error.to_string())?;
        let mut options = OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(path)
            .map_err(|_| "Não foi possível abrir o arquivo selecionado".to_string())?;
        file.write_all(markdown.as_bytes())
            .map_err(|_| "Não foi possível salvar o chat".to_string())?;
        Ok(true)
    })
    .await
    .map_err(|_| "Não foi possível abrir a janela de exportação".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_markdown_and_rejects_paths_and_oversized_content() {
        assert!(validate_export("mb-1-execuções.md", "# Conversa").is_ok());
        for name in [
            "../chat.md",
            "/tmp/chat.md",
            "chat.exe",
            "..md",
            "chat\\chat.md",
        ] {
            assert!(validate_export(name, "texto").is_err());
        }
        assert!(validate_export("chat.md", "").is_err());
        assert!(validate_export("chat.md", &"x".repeat(MAX_EXPORT_BYTES + 1)).is_err());
    }
}
