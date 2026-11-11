//! Connect / disconnect Claude Code: add or remove our hooks in the user's settings.json.
//! Always a timestamped backup first, merge without touching other entries, refuse to write on invalid JSON.
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};

pub const EVENTS: [&str; 15] = [
    "SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest",
    "Notification", "Stop", "StopFailure", "SubagentStart", "SubagentStop", "SessionEnd",
    "TaskCreated", "TaskCompleted", "TeammateIdle", // agent teams
];

fn home() -> PathBuf {
    std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from).unwrap_or_default()
}

pub fn office_dir() -> PathBuf {
    std::env::var_os("CLAUDE_OFFICE_DIR").map(PathBuf::from).unwrap_or_else(|| home().join("claude-office"))
}

pub fn settings_path() -> PathBuf {
    std::env::var_os("CLAUDE_SETTINGS_PATH").map(PathBuf::from).unwrap_or_else(|| home().join(".claude").join("settings.json"))
}

fn strings(h: &Value) -> Vec<String> {
    let mut v = vec![h.get("command").and_then(Value::as_str).unwrap_or("").to_string()];
    if let Some(a) = h.get("args").and_then(Value::as_array) {
        v.extend(a.iter().filter_map(Value::as_str).map(String::from));
    }
    v
}

/// Ours = this app's exe with `--hook`, or the older Node collector (claude-office/hook.js).
pub fn is_ours(h: &Value) -> bool {
    let s = strings(h);
    let node = s.iter().any(|x| {
        let x = x.replace('\\', "/");
        x.ends_with("claude-office/hook.js")
    });
    let app = s.iter().any(|x| x == "--hook") && s[0].to_lowercase().contains("claude-3d-office");
    node || app
}

pub fn remove_hooks(settings: &mut Map<String, Value>) {
    let Some(Value::Object(hooks)) = settings.get_mut("hooks") else { return };
    for groups in hooks.values_mut() {
        let Value::Array(list) = groups else { continue };
        for g in list.iter_mut() {
            if let Some(Value::Array(hs)) = g.get_mut("hooks") {
                hs.retain(|h| !is_ours(h));
            }
        }
        list.retain(|g| !matches!(g.get("hooks"), Some(Value::Array(hs)) if hs.is_empty()));
    }
    hooks.retain(|_, g| !matches!(g, Value::Array(a) if a.is_empty()));
    if hooks.is_empty() {
        settings.remove("hooks");
    }
}

pub fn add_hooks(settings: &mut Map<String, Value>, exe: &str) {
    remove_hooks(settings); // idempotent, and migrates the old Node collector
    let hooks = settings.entry("hooks").or_insert_with(|| json!({}));
    if !hooks.is_object() {
        *hooks = json!({});
    }
    let hooks = hooks.as_object_mut().unwrap();
    for ev in EVENTS {
        let list = hooks.entry(ev).or_insert_with(|| json!([]));
        if let Value::Array(a) = list {
            // Exec form (args): no shell. async: never blocks Claude Code.
            a.push(json!({ "hooks": [{ "type": "command", "command": exe, "args": ["--hook"], "async": true, "timeout": 10 }] }));
        }
    }
}

pub fn read_settings(file: &Path) -> Result<Map<String, Value>, String> {
    if !file.exists() {
        return Ok(Map::new());
    }
    let text = std::fs::read_to_string(file).map_err(|e| e.to_string())?;
    let text = text.trim_start_matches('\u{feff}');
    if text.trim().is_empty() {
        return Ok(Map::new());
    }
    match serde_json::from_str(text) {
        Ok(Value::Object(m)) => Ok(m),
        Ok(_) => Err("settings.json n'est pas un objet JSON".into()),
        Err(e) => Err(format!("settings.json invalide, rien n'a été modifié : {e}")),
    }
}

fn write_settings(file: &Path, settings: &Map<String, Value>) -> Result<Option<PathBuf>, String> {
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let mut backup = None;
    if file.exists() {
        let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
        let b = PathBuf::from(format!("{}.claude-office-{stamp}.bak", file.display()));
        std::fs::copy(file, &b).map_err(|e| e.to_string())?;
        backup = Some(b);
    }
    let tmp = PathBuf::from(format!("{}.claude-office.tmp", file.display()));
    let text = serde_json::to_string_pretty(&Value::Object(settings.clone())).map_err(|e| e.to_string())? + "\n";
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, file).map_err(|e| e.to_string())?;
    Ok(backup)
}

pub fn connect(exe: &str) -> Result<Option<PathBuf>, String> {
    let file = settings_path();
    let mut s = read_settings(&file)?;
    add_hooks(&mut s, exe);
    write_settings(&file, &s)
}

pub fn disconnect() -> Result<Option<PathBuf>, String> {
    let file = settings_path();
    let mut s = read_settings(&file)?;
    remove_hooks(&mut s);
    write_settings(&file, &s)
}

/// (any of our hooks present, all of them point to this exe)
pub fn status(exe: &str) -> (bool, bool) {
    let Ok(s) = read_settings(&settings_path()) else { return (false, false) };
    let mut ours = vec![];
    if let Some(Value::Object(hooks)) = s.get("hooks") {
        for g in hooks.values().filter_map(Value::as_array).flatten() {
            if let Some(Value::Array(hs)) = g.get("hooks") {
                ours.extend(hs.iter().filter(|h| is_ours(h)).cloned());
            }
        }
    }
    let current = ours.len() >= EVENTS.len() && ours.iter().all(|h| h.get("command").and_then(Value::as_str) == Some(exe));
    (!ours.is_empty(), current)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_is_idempotent_and_removal_is_exact() {
        let original = json!({"model":"x","hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"rtk hook claude"}]}]}});
        let mut s = original.as_object().unwrap().clone();
        // an older Node collector entry gets migrated
        s["hooks"]["Stop"] = json!([{ "hooks": [{ "type": "command", "command": "node", "args": ["C:\\Users\\x\\claude-office\\hook.js"] }] }]);
        add_hooks(&mut s, "C:\\Apps\\claude-3d-office.exe");
        add_hooks(&mut s, "C:\\Apps\\claude-3d-office.exe");
        assert_eq!(s["hooks"]["PreToolUse"].as_array().unwrap().len(), 2);
        assert_eq!(s["hooks"]["Stop"].as_array().unwrap().len(), 1);
        assert_eq!(s["hooks"]["Stop"][0]["hooks"][0]["args"][0], "--hook");
        remove_hooks(&mut s);
        assert_eq!(Value::Object(s), original);
    }

    #[test]
    fn keeps_foreign_hooks_in_a_shared_group() {
        let mut s = Map::new();
        add_hooks(&mut s, "C:\\Apps\\claude-3d-office.exe");
        s["hooks"]["Stop"][0]["hooks"].as_array_mut().unwrap().push(json!({"type":"command","command":"other"}));
        remove_hooks(&mut s);
        assert_eq!(s["hooks"], json!({"Stop":[{"hooks":[{"type":"command","command":"other"}]}]}));
    }

    #[test]
    fn refuses_invalid_json() {
        let dir = std::env::temp_dir().join(format!("c3o-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("settings.json");
        std::fs::write(&f, "{ broken").unwrap();
        assert!(read_settings(&f).is_err());
    }
}
