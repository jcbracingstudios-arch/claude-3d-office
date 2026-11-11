//! Collector mode: `claude-3d-office.exe --hook`, called by Claude Code for each event.
//! Strictly passive: the exe is a GUI-subsystem binary (no console, nothing on stdout/stderr) and
//! always exits 0, so it can never inject text into Claude or block it.
use regex::Regex;
use serde_json::{json, Map, Value};
use std::io::{Read, Write};
use std::sync::OnceLock;
use std::time::Duration;

fn patterns() -> &'static [(Regex, &'static str)] {
    static P: OnceLock<Vec<(Regex, &'static str)>> = OnceLock::new();
    P.get_or_init(|| {
        [
            (r"\bsk-[A-Za-z0-9_-]{16,}", "***"),
            (r"\bgh[pousr]_[A-Za-z0-9]{20,}", "***"),
            (r"\bgithub_pat_[A-Za-z0-9_]{20,}", "***"),
            (r"\bAKIA[0-9A-Z]{16}\b", "***"),
            (r"\bxox[abprs]-[A-Za-z0-9-]{10,}", "***"),
            (r"\bAIza[0-9A-Za-z_-]{30,}", "***"),
            (r"\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}", "***"),
            (r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)", "***"),
            (r#"(?i)(\bbearer\s+)[^\s"']+"#, "${1}***"),
            (r#"(?i)(\b[\w-]*(?:api[_-]?key|token|secret|passw(?:or)?d|pwd|auth)[\w-]*\s*[:=]\s*["']?)[^\s"'&]+"#, "${1}***"),
            (r"(://[^:/\s]+:)[^@\s]+@", "${1}***@"),
        ]
        .into_iter()
        .map(|(p, r)| (Regex::new(p).expect("valid regex"), r))
        .collect()
    })
}

pub fn redact(text: &str) -> String {
    let mut s = text.to_string();
    for (re, rep) in patterns() {
        s = re.replace_all(&s, *rep).into_owned();
    }
    s
}

fn str_of<'a>(v: &'a Value, k: &str) -> Option<&'a str> {
    v.get(k).and_then(Value::as_str).filter(|s| !s.is_empty())
}

/// Short, redacted, truncated hint of what happened. Never the prompt, file contents or tool output.
fn detail(e: &Value) -> String {
    let input = e.get("tool_input").cloned().unwrap_or(Value::Null);
    let raw = ["command", "file_path", "notebook_path", "pattern", "url", "query", "description"]
        .iter()
        .find_map(|k| str_of(&input, k))
        .or_else(|| ["task_subject", "message", "error", "reason", "source"].iter().find_map(|k| str_of(e, k)))
        .unwrap_or("");
    let one_line = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    redact(&one_line).chars().take(160).collect()
}

pub fn to_line(e: &Value, ts: &str) -> String {
    let mut m = Map::new();
    m.insert("ts".into(), json!(ts));
    m.insert("session_id".into(), e.get("session_id").cloned().unwrap_or(Value::Null));
    m.insert("cwd".into(), e.get("cwd").cloned().unwrap_or(Value::Null));
    m.insert("event".into(), e.get("hook_event_name").cloned().unwrap_or(Value::Null));
    for (from, to) in [("tool_name", "tool"), ("agent_id", "agent_id"), ("agent_type", "agent_type"), ("teammate_name", "teammate"), ("task_id", "task_id"), ("notification_type", "kind")] {
        if let Some(s) = str_of(e, from) {
            m.insert(to.into(), json!(s));
        }
    }
    if !m.contains_key("kind") {
        if let Some(s) = str_of(e, "error") {
            m.insert("kind".into(), json!(s)); // StopFailure error type, e.g. rate_limit
        }
    }
    let d = detail(e);
    if !d.is_empty() {
        m.insert("detail".into(), json!(d));
    }
    Value::Object(m).to_string() + "\n"
}

pub fn run() -> ! {
    // Never hang Claude Code if stdin stays open.
    std::thread::spawn(|| {
        std::thread::sleep(Duration::from_secs(5));
        std::process::exit(0);
    });
    let r = (|| -> Option<()> {
        let mut input = String::new();
        std::io::stdin().read_to_string(&mut input).ok()?;
        let event: Value = serde_json::from_str(&input).ok()?;
        let dir = crate::settings::office_dir();
        std::fs::create_dir_all(&dir).ok()?;
        let ts = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        // One write call per line: concurrent hooks won't interleave partial lines.
        let mut f = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("events.jsonl")).ok()?;
        f.write_all(to_line(&event, &ts).as_bytes()).ok()
    })();
    if cfg!(debug_assertions) && std::env::var_os("C3O_DEBUG").is_some() {
        eprintln!("hook result: {r:?}"); // debug builds only; release never writes anything
    }
    std::process::exit(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_common_secrets() {
        let s = redact("k=sk-ant-api03-AAAAAAAAAAAAAAAAAAAA ghp_aaaaaaaaaaaaaaaaaaaaaaaa API_KEY=hunter2 https://u:pw@host token: xyz");
        for bad in ["AAAAAAAAAAAA", "ghp_aaaa", "hunter2", ":pw@", "xyz"] {
            assert!(!s.contains(bad), "{bad} leaked in {s}");
        }
        assert!(s.contains("https://u:***@host"));
    }

    #[test]
    fn line_keeps_only_safe_fields() {
        let e = json!({"session_id":"s","cwd":"C:\\p","hook_event_name":"UserPromptSubmit","prompt":"secret plan","tool_input":{"content":"file body"}});
        let l = to_line(&e, "t");
        assert!(!l.contains("secret plan") && !l.contains("file body"));
        let e = json!({"session_id":"s","hook_event_name":"PreToolUse","tool_name":"Bash","agent_type":"Explore","tool_input":{"command":"curl -H \"Authorization: Bearer abc.def\" x"}});
        let v: Value = serde_json::from_str(&to_line(&e, "t")).unwrap();
        assert_eq!(v["tool"], "Bash");
        assert_eq!(v["agent_type"], "Explore");
        assert!(!v["detail"].as_str().unwrap().contains("abc.def"));
    }
}
