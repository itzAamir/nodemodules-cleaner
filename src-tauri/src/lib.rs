use std::{
    fs,
    path::{Path, PathBuf},
    thread,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::Emitter;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScanItem {
    pub project_path: String,
    pub node_modules_path: String,
    pub size: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScanProgress {
    pub current_folder: String,
    pub folders_scanned: usize,
    pub total_folders_estimated: usize,
    pub node_modules_found: usize,
    pub directories_skipped: usize,
    pub is_complete: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DeleteResult {
    pub path: String,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DriveInfo {
    pub path: String,
    pub name: String,
}

#[tauri::command]
async fn list_drives() -> Result<Vec<DriveInfo>, String> {
    #[cfg(target_os = "windows")]
    {
        let mut drives = Vec::new();
        for letter in b'A'..=b'Z' {
            let drive_path = format!("{}:\\", letter as char);
            if Path::new(&drive_path).exists() {
                drives.push(DriveInfo {
                    path: drive_path.clone(),
                    name: format!("Drive {}", letter as char),
                });
            }
        }
        Ok(drives)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let mut drives = Vec::new();

        // Add root directory
        drives.push(DriveInfo {
            path: "/".to_string(),
            name: "Root Directory".to_string(),
        });

        // On macOS, also check /Volumes for mounted volumes
        #[cfg(target_os = "macos")]
        {
            if let Ok(entries) = fs::read_dir("/Volumes") {
                for entry in entries.flatten() {
                    if let Ok(metadata) = entry.metadata() {
                        if metadata.is_dir() {
                            let path = entry.path();
                            if let Some(name) = path.file_name() {
                                drives.push(DriveInfo {
                                    path: path.to_string_lossy().to_string(),
                                    name: format!("Volume {}", name.to_string_lossy()),
                                });
                            }
                        }
                    }
                }
            }
        }

        // On Linux, check /media and /mnt for mounted volumes
        #[cfg(target_os = "linux")]
        {
            for mount_point in &["/media", "/mnt"] {
                if let Ok(entries) = fs::read_dir(mount_point) {
                    for entry in entries.flatten() {
                        if let Ok(metadata) = entry.metadata() {
                            if metadata.is_dir() {
                                let path = entry.path();
                                if let Some(name) = path.file_name() {
                                    drives.push(DriveInfo {
                                        path: path.to_string_lossy().to_string(),
                                        name: format!("Mount {}", name.to_string_lossy()),
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }

        Ok(drives)
    }
}

#[tauri::command]
async fn start_scan(roots: Vec<String>, include_sizes: bool) -> Result<Vec<ScanItem>, String> {
    // Start the scan with progress tracking
    let scan_result = scan_directory_with_progressive_progress(&roots, include_sizes, None).await;

    match scan_result {
        Ok(items) => Ok(items),
        Err(e) => Err(format!("Scan failed: {}", e)),
    }
}

#[tauri::command]
async fn start_scan_with_progress(
    roots: Vec<String>,
    include_sizes: bool,
    window: tauri::Window,
) -> Result<Vec<ScanItem>, String> {
    // Emit initial progress update
    let initial_progress = ScanProgress {
        current_folder: "Starting scan...".to_string(),
        folders_scanned: 0,
        total_folders_estimated: 0,
        node_modules_found: 0,
        directories_skipped: 0,
        is_complete: false,
    };

    if let Err(e) = window.emit("scan_progress", initial_progress) {
        eprintln!("Failed to emit initial progress: {}", e);
    }

    // Start the scan with progressive estimation
    let scan_result =
        scan_directory_with_progressive_progress(&roots, include_sizes, Some(&window)).await;

    match scan_result {
        Ok(items) => {
            // Send final progress update
            let final_progress = ScanProgress {
                current_folder: "Scan completed".to_string(),
                folders_scanned: items.len(), // Use actual scanned count
                total_folders_estimated: items.len(), // Use actual count
                node_modules_found: items.len(),
                directories_skipped: 0, // Will be updated in the scan
                is_complete: true,
            };

            if let Err(e) = window.emit("scan_progress", final_progress) {
                eprintln!("Failed to emit final progress: {}", e);
            }

            Ok(items)
        }
        Err(e) => Err(format!("Scan failed: {}", e)),
    }
}

#[tauri::command]
async fn open_folder_dialog(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use std::sync::{Arc, Mutex};
    use std::time::Duration;
    use tauri_plugin_dialog::DialogExt;
    use tokio::time::sleep;

    let result = Arc::new(Mutex::new(None::<String>));
    let result_clone = result.clone();

    app.dialog().file().pick_folder(move |path| {
        if let Some(path) = path {
            let path_str = path.to_string();
            if let Ok(mut result) = result_clone.lock() {
                *result = Some(path_str);
            }
        }
    });

    // Wait for the dialog result with polling
    for _ in 0..300 {
        // 30 seconds timeout (300 * 100ms)
        if let Ok(result_guard) = result.lock() {
            if result_guard.is_some() {
                return Ok(result_guard.clone());
            }
        }
        sleep(Duration::from_millis(100)).await;
    }

    Ok(None) // Timeout or cancelled
}

#[tauri::command]
async fn open_folder_in_explorer(path: String) -> Result<(), String> {
    use std::process::Command;

    #[cfg(target_os = "windows")]
    {
        // On Windows, explorer expects the path to be properly formatted
        let formatted_path = if path.ends_with(':') {
            // For drive letters like "D:", add a backslash
            format!("{}\\", path)
        } else {
            // Convert forward slashes to backslashes for Windows
            path.replace('/', "\\")
        };

        Command::new("explorer")
            .arg(&formatted_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        // Try different file managers
        let managers = ["xdg-open", "nautilus", "dolphin", "thunar", "pcmanfm"];
        let mut opened = false;

        for manager in &managers {
            if Command::new(manager).arg(&path).spawn().is_ok() {
                opened = true;
                break;
            }
        }

        if !opened {
            return Err("No suitable file manager found".to_string());
        }
    }

    Ok(())
}

#[tauri::command]
async fn delete_node_modules(paths: Vec<String>) -> Result<Vec<DeleteResult>, String> {
    let mut results: Vec<DeleteResult> = Vec::new();

    for path in paths {
        let result = delete_single_node_modules(&path);
        results.push(result);
    }

    Ok(results)
}

fn calculate_directory_size(path: &Path) -> Option<u64> {
    let mut total_size = 0u64;
    let mut stack = vec![path.to_path_buf()];

    while let Some(current_path) = stack.pop() {
        if let Ok(entries) = fs::read_dir(&current_path) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Ok(metadata) = entry.metadata() {
                    if metadata.is_file() {
                        total_size += metadata.len();
                    } else if metadata.is_dir() {
                        stack.push(path);
                    }
                }
            }
        }
    }

    Some(total_size)
}

fn delete_single_node_modules(path: &str) -> DeleteResult {
    let path_buf = PathBuf::from(path);

    // Enhanced safety checks
    if !path_buf.exists() {
        return DeleteResult {
            path: path.to_string(),
            success: false,
            error: Some("Path does not exist".to_string()),
        };
    }

    if !path_buf.is_dir() {
        return DeleteResult {
            path: path.to_string(),
            success: false,
            error: Some("Path is not a directory".to_string()),
        };
    }

    // CRITICAL SAFETY CHECK: Ensure it's actually a node_modules directory
    if path_buf.file_name() != Some(std::ffi::OsStr::new("node_modules")) {
        return DeleteResult {
            path: path.to_string(),
            success: false,
            error: Some("Path does not end with 'node_modules'".to_string()),
        };
    }

    // Additional safety: Check if this is a legitimate node_modules directory
    if !is_legitimate_node_modules(&path_buf) {
        return DeleteResult {
            path: path.to_string(),
            success: false,
            error: Some("Safety check failed: This doesn't appear to be a legitimate node_modules directory".to_string()),
        };
    }

    // Use system trash instead of permanent deletion for safety
    match move_to_trash(&path_buf) {
        Ok(_) => DeleteResult {
            path: path.to_string(),
            success: true,
            error: None,
        },
        Err(e) => DeleteResult {
            path: path.to_string(),
            success: false,
            error: Some(format!("Failed to delete: {}", e)),
        },
    }
}

fn is_legitimate_node_modules(path: &Path) -> bool {
    // Check if this directory contains typical node_modules contents
    if let Ok(entries) = fs::read_dir(path) {
        let mut has_package_json = false;
        let mut has_node_modules_structure = false;
        let mut entry_count = 0;

        for entry in entries.flatten() {
            entry_count += 1;

            if let Ok(metadata) = entry.metadata() {
                if metadata.is_dir() {
                    // Check for common package directories
                    let name = entry.file_name();
                    let name_str = name.to_string_lossy();
                    if name_str.contains('.') && name_str.len() > 3 {
                        has_node_modules_structure = true;
                    }
                } else if metadata.is_file() {
                    // Check for package.json or similar files
                    let name = entry.file_name();
                    let name_str = name.to_string_lossy();
                    if name_str == "package.json" || name_str == "package-lock.json" {
                        has_package_json = true;
                    }
                }
            }

            // Limit check to first 100 entries for performance
            if entry_count > 100 {
                break;
            }
        }

        // Must have either typical structure or package files
        has_node_modules_structure || has_package_json
    } else {
        false
    }
}

fn move_to_trash(path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(target_os = "windows")]
    {
        // On Windows, use PowerShell to move to Recycle Bin
        let path_str = path.to_string_lossy().replace('/', "\\");
        let script = format!(
            "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('{}', 'RecycleBin')",
            path_str
        );

        let output = std::process::Command::new("powershell")
            .args(["-Command", &script])
            .output()?;

        if !output.status.success() {
            // Fallback to regular deletion if PowerShell fails
            fs::remove_dir_all(path)?;
        }
    }

    #[cfg(target_os = "macos")]
    {
        // On macOS, use the 'trash' command or fallback
        if std::process::Command::new("trash")
            .arg(path)
            .status()
            .is_ok()
        {
            return Ok(());
        }
        // Fallback to regular deletion
        fs::remove_dir_all(path)?;
    }

    #[cfg(target_os = "linux")]
    {
        // On Linux, try to use 'trash-cli' or fallback
        if std::process::Command::new("trash")
            .arg(path)
            .status()
            .is_ok()
        {
            return Ok(());
        }
        // Fallback to regular deletion
        fs::remove_dir_all(path)?;
    }

    Ok(())
}

async fn scan_directory_with_progressive_progress(
    roots: &[String],
    include_sizes: bool,
    window: Option<&tauri::Window>,
) -> Result<Vec<ScanItem>, String> {
    let mut results = Vec::new();
    let mut folders_scanned = 0;
    let mut node_modules_found = 0;

    for root in roots {
        if let Err(e) = scan_directory_progressive_single(
            root,
            include_sizes,
            &mut folders_scanned,
            &mut node_modules_found,
            &mut results,
            window,
        ) {
            eprintln!("Error scanning {}: {}", root, e);
        }
    }

    Ok(results)
}

fn scan_directory_progressive_single(
    root: &str,
    include_sizes: bool,
    folders_scanned: &mut usize,
    node_modules_found: &mut usize,
    results: &mut Vec<ScanItem>,
    window: Option<&tauri::Window>,
) -> Result<(), Box<dyn std::error::Error>> {
    let root_path = Path::new(root);
    if !root_path.exists() || !root_path.is_dir() {
        return Ok(());
    }

    let mut stack = vec![(root_path.to_path_buf(), 0)]; // (path, depth)

    while let Some((current_path, depth)) = stack.pop() {
        // Skip special directories on Unix systems
        #[cfg(not(target_os = "windows"))]
        {
            if let Some(name) = current_path.file_name() {
                let name_str = name.to_string_lossy();
                if matches!(name_str.as_ref(), "proc" | "sys" | "dev") {
                    continue;
                }
            }
        }

        // Skip irrelevant directories that won't contain node_modules
        if let Some(name) = current_path.file_name() {
            let name_str = name.to_string_lossy();
            if should_skip_directory(&name_str, depth) {
                continue;
            }
        }

        if let Ok(entries) = fs::read_dir(&current_path) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Ok(metadata) = entry.metadata() {
                    if metadata.is_dir() {
                        if let Some(name) = path.file_name() {
                            if name == "node_modules" {
                                // Found a node_modules directory
                                let project_path = current_path.to_string_lossy().to_string();
                                let node_modules_path = path.to_string_lossy().to_string();

                                let size = if include_sizes {
                                    calculate_directory_size(&path)
                                } else {
                                    None
                                };

                                let item = ScanItem {
                                    project_path,
                                    node_modules_path,
                                    size,
                                };

                                *node_modules_found += 1;
                                results.push(item.clone());

                                // Don't recurse into node_modules
                                continue;
                            }
                        }

                        // Only add subdirectory if it's worth scanning
                        if depth < 6 && should_scan_subdirectory(&path, depth) {
                            stack.push((path, depth + 1));
                        }
                    }
                }
            }
        }

        *folders_scanned += 1;

        // Emit progress update more frequently for better UX
        if *folders_scanned % 5 == 0 || window.is_some() {
            if let Some(w) = window {
                let progress = ScanProgress {
                    current_folder: current_path.to_string_lossy().to_string(),
                    folders_scanned: *folders_scanned,
                    total_folders_estimated: *folders_scanned + 100, // Progressive estimate
                    node_modules_found: *node_modules_found,
                    directories_skipped: 0, // Will be updated later
                    is_complete: false,
                };

                if let Err(e) = w.emit("scan_progress", progress) {
                    eprintln!("Failed to emit progress: {}", e);
                }
            }
        }

        // Small delay to keep UI responsive
        thread::sleep(Duration::from_millis(1));
    }

    Ok(())
}

fn should_skip_directory(name: &str, depth: usize) -> bool {
    // Always skip these directories regardless of depth
    let always_skip = [
        ".pnpm-store",
        ".npm",
        ".yarn",
        ".npmrc",
        ".yarnrc",
        ".yarn-cache",
        ".npm-cache",
        ".yarn-cache",
        ".npm-cache",
        ".yarn-cache",
        ".git",
        ".svn",
        ".hg",
        ".bzr", // Version control
        ".vscode",
        ".idea",
        ".atom",
        ".sublime",     // IDE
        "node_modules", // Already found
        "dist",
        "build",
        ".next",
        "out",
        "target", // Build outputs
        ".cache",
        ".temp",
        "tmp",
        "temp", // Cache/temp
        "android",
        "ios",
        "macos",
        "windows", // OS specific
        "bin",
        "obj",
        "Debug",
        "Release", // Binary/compiled
        "vendor",
        "composer",
        "gradle",
        "maven", // Other package managers
    ];

    if always_skip.iter().any(|&skip| name == skip) {
        return true;
    }

    // Skip hidden directories at root level (depth 0)
    if depth == 0 && name.starts_with('.') && name != ".config" {
        return true;
    }

    // Skip system directories at root level
    if depth == 0 {
        let system_dirs = [
            "System Volume Information",
            "Recovery",
            "Windows",
            "Program Files",
            "Program Files (x86)",
        ];
        if system_dirs.iter().any(|&sys| name == sys) {
            return true;
        }
    }

    false
}

fn should_scan_subdirectory(path: &Path, depth: usize) -> bool {
    // Don't go deeper than 6 levels
    if depth >= 6 {
        return false;
    }

    // Check if this directory contains development indicators
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            if let Ok(metadata) = entry.metadata() {
                if metadata.is_file() {
                    let name = entry.file_name();
                    let name_str = name.to_string_lossy();
                    // Look for development files
                    if matches!(
                        name_str.as_ref(),
                        "package.json"
                            | "yarn.lock"
                            | "pnpm-lock.yaml"
                            | "lerna.json"
                            | "tsconfig.json"
                            | "webpack.config.js"
                            | "vite.config.ts"
                            | "angular.json"
                            | "vue.config.js"
                            | "next.config.js"
                            | "Cargo.toml"
                            | "pom.xml"
                            | "build.gradle"
                            | "requirements.txt"
                    ) {
                        return true; // This directory is worth scanning
                    }
                }
            }
        }
    }

    // If no development indicators found, only scan if it's a common development folder
    if let Some(name) = path.file_name() {
        let name_str = name.to_string_lossy();
        let dev_folders = [
            "src",
            "lib",
            "app",
            "frontend",
            "backend",
            "client",
            "server",
            "components",
            "pages",
            "routes",
            "api",
            "services",
            "utils",
            "public",
            "assets",
            "styles",
            "scripts",
            "tests",
            "docs",
        ];
        if dev_folders.iter().any(|&folder| name_str == folder) {
            return true;
        }
    }

    // Default: scan if not too deep
    depth < 4
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            list_drives,
            start_scan,
            start_scan_with_progress,
            delete_node_modules,
            open_folder_dialog,
            open_folder_in_explorer
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
