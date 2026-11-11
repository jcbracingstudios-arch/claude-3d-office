'use strict';
// Plays a fake scenario into events.jsonl so the office can be seen without real Claude sessions.
// Demo sessions end themselves (SessionEnd) when the script finishes.
const fs = require('fs');
const path = require('path');
const { officeDir } = require('./settings.js');

const dir = officeDir();
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, 'events.jsonl');
const emit = (session_id, cwd, event, extra = {}) =>
  fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), session_id, cwd, event, ...extra }) + '\n');

const A = ['demo-a', 'C:\\code\\Synapse'];
const B = ['demo-b', 'C:\\code\\bot-trading'];
const C = ['demo-c', 'C:\\code\\site-vitrine'];

const script = [
  [0, () => { emit(...A, 'SessionStart'); emit(...B, 'SessionStart'); emit(...C, 'SessionStart'); }],
  [3, () => emit(...A, 'UserPromptSubmit')],
  [4, () => emit(...A, 'PreToolUse', { tool: 'Read', detail: 'src/index.ts' })],
  [5, () => emit(...A, 'SubagentStart', { agent_id: 'ag1', agent_type: 'Explore' })],
  [5.5, () => emit(...A, 'SubagentStart', { agent_id: 'ag2', agent_type: 'Plan' })],
  [6, () => emit(...A, 'PreToolUse', { tool: 'Grep', detail: 'useState', agent_id: 'ag1', agent_type: 'Explore' })],
  [6.5, () => emit(...A, 'SubagentStart', { agent_id: 'ag3', agent_type: 'general-purpose' })],
  [7.5, () => emit(...B, 'SubagentStart', { agent_id: 'bg1', agent_type: 'Explore' })],
  [16, () => emit(...A, 'SubagentStop', { agent_id: 'ag3' })],
  [25, () => emit(...B, 'SubagentStop', { agent_id: 'bg1' })],
  [7, () => emit(...B, 'UserPromptSubmit')],
  [8, () => emit(...B, 'PreToolUse', { tool: 'Bash', detail: 'npm test' })],
  [11, () => emit(...B, 'PermissionRequest', { tool: 'Bash', detail: 'git push origin main' })],
  [13, () => emit(...A, 'SubagentStop', { agent_id: 'ag2' })],
  [14, () => emit(...A, 'PreToolUse', { tool: 'Edit', detail: 'src/app.tsx' })],
  [18, () => emit(...A, 'SubagentStop', { agent_id: 'ag1' })],
  [19, () => emit(...A, 'Stop')],
  [20, () => emit(...C, 'UserPromptSubmit')],
  [21, () => emit(...C, 'PreToolUse', { tool: 'WebFetch', detail: 'https://example.com' })],
  [24, () => emit(...C, 'StopFailure', { detail: 'rate_limit' })],
  [26, () => emit(...B, 'PostToolUse', { tool: 'Bash' })],
  [30, () => emit(...B, 'Stop')],
  [60, () => { for (const s of [A, B, C]) emit(...s, 'SessionEnd'); }],
];

console.log(`Démo en cours (60 s) → ${file}`);
const t0 = Date.now();
for (const [sec, fn] of script) setTimeout(fn, sec * 1000);
setTimeout(() => console.log(`Démo terminée en ${Math.round((Date.now() - t0) / 1000)} s.`), 60500);
