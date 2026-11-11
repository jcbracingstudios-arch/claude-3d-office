// @ts-check
'use strict';
// Pure reducer: events.jsonl lines -> office state (bosses = sessions, employees = subagents).
const path = require('path');
const fs = require('fs');

const LOG_MAX = 60;
const STALE_MS = 3 * 60 * 60 * 1000; // shortcut: sessions killed without SessionEnd vanish after 3h idle; upgrade with a liveness check (pid) if needed

/** Status of a session: idle (pause area), working (at desk), waiting (needs you), error, done (celebrates). */
function createState() {
  return { sessions: {}, stats: { day: null, projects: {} } };
}

// Today's stats per project: time spent working / waiting for you / blocked by the usage limit, tasks done, errors.
const TIMED = ['working', 'waiting', 'limited'];
const dayOf = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function statsFor(state, project, ts) {
  const day = dayOf(ts);
  if (state.stats.day !== day) state.stats = { day, projects: {} };
  return (state.stats.projects[project] ||= { working: 0, waiting: 0, limited: 0, tasks: 0, errors: 0 });
}
function accrue(state, s, until) {
  if (!TIMED.includes(s.status) || !s.since) return;
  const midnight = new Date(until); midnight.setHours(0, 0, 0, 0);
  const from = Math.max(Date.parse(s.since), midnight.getTime()); // only today's part counts
  const ms = Date.parse(until) - from;
  if (ms > 0) statsFor(state, s.project, until)[s.status] += ms;
}

function gitBranch(cwd) {
  try {
    let dir = cwd;
    for (let i = 0; i < 30 && dir; i++) {
      const git = path.join(dir, '.git');
      if (fs.existsSync(git)) {
        let gitDir = git;
        if (fs.statSync(git).isFile()) gitDir = path.resolve(dir, fs.readFileSync(git, 'utf8').replace(/^gitdir:\s*/, '').trim());
        const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
        return head.startsWith('ref: refs/heads/') ? head.slice(16) : head.slice(0, 7);
      }
      const up = path.dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  } catch {}
  return null;
}

function apply(state, e, opts = {}) {
  if (!e || !e.session_id || !e.event) return state;
  const branchOf = opts.gitBranch || gitBranch;
  let s = state.sessions[e.session_id];
  if (e.event === 'SessionEnd') {
    if (s) accrue(state, s, e.ts);
    delete state.sessions[e.session_id];
    return state;
  }
  if (!s) {
    s = state.sessions[e.session_id] = {
      id: e.session_id, cwd: e.cwd, project: e.cwd ? path.basename(e.cwd) : '?', branch: null,
      status: 'idle', since: e.ts, lastTs: e.ts, lastAction: '', taskStart: null, toolCount: 0, errors: 0,
      agents: {}, logs: [], tasks: {},
    };
  }
  if (e.cwd && e.cwd !== s.cwd) { s.cwd = e.cwd; s.project = path.basename(e.cwd); }
  if (e.cwd) s.branch = branchOf(e.cwd);
  s.lastTs = e.ts;
  s.logs.push({ ts: e.ts, event: e.event, tool: e.tool || null, agent: e.agent_type || null, detail: e.detail || '' });
  if (s.logs.length > LOG_MAX) s.logs.splice(0, s.logs.length - LOG_MAX);

  const action = [e.tool, e.detail].filter(Boolean).join(' · ');
  const agent = e.agent_id ? (s.agents[e.agent_id] ||= { id: e.agent_id, type: e.agent_type || 'agent', status: 'working', lastAction: '' }) : null;
  const setStatus = (st) => { if (s.status !== st) { accrue(state, s, e.ts); s.status = st; s.since = e.ts; } };
  if (e.teammate && agent) agent.name = e.teammate;
  const startTask = () => { if (!s.taskStart || s.status === 'idle' || s.status === 'done') { s.taskStart = e.ts; s.toolCount = 0; s.errors = 0; } };

  switch (e.event) {
    case 'SessionStart': setStatus('idle'); s.agents = {}; s.tasks = {}; break;
    case 'UserPromptSubmit': startTask(); setStatus('working'); s.lastAction = 'Nouvelle tâche'; break;
    case 'PreToolUse':
      if (s.status !== 'working') { startTask(); setStatus('working'); }
      if (agent) { agent.status = 'working'; agent.lastAction = action; }
      s.lastAction = (agent ? `[${agent.type}] ` : '') + action;
      break;
    case 'PostToolUse': s.toolCount++; if (s.status === 'waiting') setStatus('working'); break;
    case 'PostToolUseFailure': s.toolCount++; s.errors++; if (s.status === 'waiting') setStatus('working'); break;
    case 'PermissionRequest': setStatus('waiting'); s.lastAction = `Validation demandée : ${action}`; break;
    case 'Notification':
      if (e.kind === 'permission_prompt') { setStatus('waiting'); s.lastAction = e.detail || 'Validation demandée'; }
      else if (e.kind === 'idle_prompt') { if (s.status !== 'error' && s.status !== 'limited') setStatus('idle'); }
      else if (e.kind === 'quota_auto_resume_fired') { setStatus('working'); s.lastAction = 'Reprise après la limite'; }
      break;
    case 'SubagentStart': if (agent) agent.status = 'working'; break;
    case 'SubagentStop': if (e.agent_id) delete s.agents[e.agent_id]; break;
    case 'Stop': setStatus('done'); s.agents = {}; s.lastAction = 'Tâche terminée'; statsFor(state, s.project, e.ts).tasks++; break;
    // Agent teams: shared task list and idle teammates.
    case 'TaskCreated': if (e.task_id) s.tasks[e.task_id] = { id: e.task_id, subject: e.detail || '', owner: e.teammate || null, done: false }; break;
    case 'TaskCompleted':
      if (e.task_id) s.tasks[e.task_id] = { ...(s.tasks[e.task_id] || { id: e.task_id, subject: e.detail || '' }), owner: e.teammate || s.tasks[e.task_id]?.owner || null, done: true };
      break;
    case 'TeammateIdle': if (agent) agent.status = 'idle'; break;
    case 'StopFailure':
      s.agents = {};
      // Usage limit reached: the mascot waits in the server room with a stopwatch.
      if (e.kind === 'rate_limit') { setStatus('limited'); s.lastAction = 'Limite Claude atteinte'; }
      else { setStatus('error'); s.lastAction = `Erreur : ${e.detail || 'API'}`; statsFor(state, s.project, e.ts).errors++; }
      break;
  }
  return state;
}

function prune(state, now = Date.now()) {
  for (const [id, s] of Object.entries(state.sessions)) if (now - Date.parse(s.lastTs) > STALE_MS) delete state.sessions[id];
  return state;
}

module.exports = { createState, apply, prune, gitBranch };
