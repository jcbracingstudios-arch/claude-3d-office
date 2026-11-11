//! Office state, built from events.jsonl lines. Rust port of daemon/state.js (same JSON shape for the UI).
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

const LOG_MAX: usize = 60;
// shortcut: sessions killed without SessionEnd vanish after 3h idle; upgrade with a liveness check (pid) if needed
const STALE_SECS: i64 = 3 * 3600;

#[derive(Deserialize, Default)]
pub struct Event {
    #[serde(default)] pub ts: String,
    pub session_id: Option<String>,
    pub cwd: Option<String>,
    pub event: Option<String>,
    pub tool: Option<String>,
    pub agent_id: Option<String>,
    pub agent_type: Option<String>,
    pub kind: Option<String>,
    pub detail: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Agent { pub id: String, #[serde(rename = "type")] pub kind: String, pub status: String, pub last_action: String }

#[derive(Serialize, Clone)]
pub struct Log { pub ts: String, pub event: String, pub tool: Option<String>, pub agent: Option<String>, pub detail: String }

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String, pub cwd: String, pub project: String, pub branch: Option<String>,
    pub status: String, pub since: String, pub last_ts: String, pub last_action: String,
    pub task_start: Option<String>, pub tool_count: u32, pub errors: u32,
    pub agents: BTreeMap<String, Agent>, pub logs: Vec<Log>,
}

#[derive(Default)]
pub struct Office { pub sessions: BTreeMap<String, Session> }

fn basename(p: &str) -> String {
    p.trim_end_matches(['\\', '/']).rsplit(['\\', '/']).next().unwrap_or("?").to_string()
}

pub fn git_branch(cwd: &str) -> Option<String> {
    let mut dir = Some(Path::new(cwd));
    while let Some(d) = dir {
        let git = d.join(".git");
        if git.exists() {
            let git_dir = if git.is_file() {
                let t = std::fs::read_to_string(&git).ok()?;
                d.join(t.trim().trim_start_matches("gitdir:").trim())
            } else { git };
            let head = std::fs::read_to_string(git_dir.join("HEAD")).ok()?;
            let head = head.trim();
            return Some(head.strip_prefix("ref: refs/heads/").map(String::from).unwrap_or_else(|| head.chars().take(7).collect()));
        }
        dir = d.parent();
    }
    None
}

impl Office {
    pub fn apply(&mut self, e: Event) {
        let (Some(id), Some(ev)) = (e.session_id.clone(), e.event.clone()) else { return };
        if ev == "SessionEnd" {
            self.sessions.remove(&id);
            return;
        }
        let s = self.sessions.entry(id.clone()).or_insert_with(|| Session {
            id: id.clone(), cwd: e.cwd.clone().unwrap_or_default(), project: e.cwd.as_deref().map(basename).unwrap_or("?".into()),
            branch: None, status: "idle".into(), since: e.ts.clone(), last_ts: e.ts.clone(), last_action: String::new(),
            task_start: None, tool_count: 0, errors: 0, agents: BTreeMap::new(), logs: vec![],
        });
        if let Some(cwd) = e.cwd.as_deref().filter(|c| !c.is_empty()) {
            if cwd != s.cwd { s.cwd = cwd.into(); s.project = basename(cwd); }
            s.branch = git_branch(cwd);
        }
        s.last_ts = e.ts.clone();
        let detail = e.detail.clone().unwrap_or_default();
        s.logs.push(Log { ts: e.ts.clone(), event: ev.clone(), tool: e.tool.clone(), agent: e.agent_type.clone(), detail: detail.clone() });
        if s.logs.len() > LOG_MAX { s.logs.drain(..s.logs.len() - LOG_MAX); }

        let action = [e.tool.clone().unwrap_or_default(), detail.clone()].into_iter().filter(|x| !x.is_empty()).collect::<Vec<_>>().join(" · ");
        let ts = e.ts.clone();
        let set = |s: &mut Session, st: &str| if s.status != st { s.status = st.into(); s.since = ts.clone(); };
        let start_task = |s: &mut Session| if s.task_start.is_none() || s.status == "idle" || s.status == "done" {
            s.task_start = Some(ts.clone()); s.tool_count = 0; s.errors = 0;
        };
        if let Some(aid) = &e.agent_id {
            s.agents.entry(aid.clone()).or_insert_with(|| Agent {
                id: aid.clone(), kind: e.agent_type.clone().unwrap_or("agent".into()), status: "working".into(), last_action: String::new(),
            });
        }
        match ev.as_str() {
            "SessionStart" => { set(s, "idle"); s.agents.clear(); }
            "UserPromptSubmit" => { start_task(s); set(s, "working"); s.last_action = "Nouvelle tâche".into(); }
            "PreToolUse" => {
                if s.status != "working" { start_task(s); set(s, "working"); }
                let mut prefix = String::new();
                if let Some(a) = e.agent_id.as_ref().and_then(|a| s.agents.get_mut(a)) {
                    a.status = "working".into(); a.last_action = action.clone(); prefix = format!("[{}] ", a.kind);
                }
                s.last_action = prefix + &action;
            }
            "PostToolUse" => { s.tool_count += 1; if s.status == "waiting" { set(s, "working"); } }
            "PostToolUseFailure" => { s.tool_count += 1; s.errors += 1; if s.status == "waiting" { set(s, "working"); } }
            "PermissionRequest" => { set(s, "waiting"); s.last_action = format!("Validation demandée : {action}"); }
            "Notification" => match e.kind.as_deref() {
                Some("permission_prompt") => { set(s, "waiting"); s.last_action = if detail.is_empty() { "Validation demandée".into() } else { detail.clone() }; }
                Some("idle_prompt") if s.status != "error" && s.status != "limited" => set(s, "idle"),
                Some("quota_auto_resume_fired") => { set(s, "working"); s.last_action = "Reprise après la limite".into(); }
                _ => {}
            },
            "SubagentStart" => {}
            "SubagentStop" => { if let Some(a) = &e.agent_id { s.agents.remove(a); } }
            "Stop" => { set(s, "done"); s.agents.clear(); s.last_action = "Tâche terminée".into(); }
            "StopFailure" => {
                s.agents.clear();
                // Usage limit reached: the mascot waits in the server room with a stopwatch.
                if e.kind.as_deref() == Some("rate_limit") { set(s, "limited"); s.last_action = "Limite Claude atteinte".into(); }
                else { set(s, "error"); s.last_action = format!("Erreur : {}", if detail.is_empty() { "API" } else { &detail }); }
            }
            _ => {}
        }
    }

    pub fn prune(&mut self) {
        let now = chrono::Utc::now();
        self.sessions.retain(|_, s| chrono::DateTime::parse_from_rfc3339(&s.last_ts).map(|t| (now - t.with_timezone(&chrono::Utc)).num_seconds() < STALE_SECS).unwrap_or(true));
    }

    pub fn snapshot(&mut self) -> serde_json::Value {
        self.prune();
        serde_json::json!({ "now": chrono::Utc::now().to_rfc3339(), "sessions": self.sessions.values().collect::<Vec<_>>() })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(event: &str, f: impl FnOnce(&mut Event)) -> Event {
        let mut e = Event { ts: chrono::Utc::now().to_rfc3339(), session_id: Some("s1".into()), cwd: Some("C:\\code\\Synapse".into()), event: Some(event.into()), ..Default::default() };
        f(&mut e);
        e
    }

    #[test]
    fn lifecycle_matches_the_js_daemon() {
        let mut o = Office::default();
        o.apply(ev("SessionStart", |_| {}));
        assert_eq!(o.sessions["s1"].status, "idle");
        assert_eq!(o.sessions["s1"].project, "Synapse");
        o.apply(ev("UserPromptSubmit", |_| {}));
        o.apply(ev("SubagentStart", |e| { e.agent_id = Some("a1".into()); e.agent_type = Some("Explore".into()); }));
        o.apply(ev("PreToolUse", |e| { e.tool = Some("Grep".into()); e.agent_id = Some("a1".into()); e.detail = Some("foo".into()); }));
        assert_eq!(o.sessions["s1"].agents["a1"].last_action, "Grep · foo");
        o.apply(ev("PermissionRequest", |e| e.tool = Some("Bash".into())));
        assert_eq!(o.sessions["s1"].status, "waiting");
        o.apply(ev("PostToolUse", |_| {}));
        assert_eq!(o.sessions["s1"].status, "working");
        o.apply(ev("SubagentStop", |e| e.agent_id = Some("a1".into())));
        assert!(o.sessions["s1"].agents.is_empty());
        o.apply(ev("Stop", |_| {}));
        assert_eq!(o.sessions["s1"].status, "done");
        o.apply(ev("StopFailure", |e| e.kind = Some("rate_limit".into())));
        assert_eq!(o.sessions["s1"].status, "limited");
        o.apply(ev("Notification", |e| e.kind = Some("idle_prompt".into())));
        assert_eq!(o.sessions["s1"].status, "limited"); // still waiting for the reset
        o.apply(ev("Notification", |e| e.kind = Some("quota_auto_resume_fired".into())));
        assert_eq!(o.sessions["s1"].status, "working");
        o.apply(ev("SessionEnd", |_| {}));
        assert!(o.sessions.is_empty());
        let snap = o.snapshot();
        assert!(snap["sessions"].as_array().unwrap().is_empty());
    }
}
