// Inversion · Rust 后端
// 职责：
//   1. 用 OS keychain 安全存储 API key
//      - macOS: Keychain / Windows: Credential Manager / Linux: Secret Service
//   2. 在 App data 目录读写决策档案（明文 JSON，对用户透明）

use keyring::Entry;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

const SERVICE: &str = "com.inversion.app";
const ARCHIVE_FILENAME: &str = "decisions.json";

fn archive_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(ARCHIVE_FILENAME))
}

#[tauri::command]
fn save_api_key(provider: String, key: String) -> Result<(), String> {
    if key.trim().is_empty() {
        return Err("key 不能为空".into());
    }
    let entry = Entry::new(SERVICE, &provider).map_err(|e| e.to_string())?;
    entry.set_password(&key).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_api_key(provider: String) -> Result<Option<String>, String> {
    let entry = Entry::new(SERVICE, &provider).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(p) => Ok(Some(p)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn delete_api_key(provider: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE, &provider).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()), // 幂等
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn has_api_key(provider: String) -> bool {
    if let Ok(entry) = Entry::new(SERVICE, &provider) {
        entry.get_password().is_ok()
    } else {
        false
    }
}

// ============ 决策档案（Archive）============

#[tauri::command]
async fn save_archive(app: tauri::AppHandle, json: String) -> Result<(), String> {
    let path = archive_path(&app)?;
    fs::write(path, json).map_err(|e| e.to_string())
}

#[tauri::command]
async fn load_archive(app: tauri::AppHandle) -> Result<String, String> {
    let path = archive_path(&app)?;
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_archive_path(app: tauri::AppHandle) -> Result<String, String> {
    let path = archive_path(&app)?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            save_api_key,
            load_api_key,
            delete_api_key,
            has_api_key,
            save_archive,
            load_archive,
            get_archive_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
