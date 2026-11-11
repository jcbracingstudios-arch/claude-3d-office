'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createState, apply } = require('../daemon/state.js');
const { start } = require('../daemon/server.js');

const opts = { gitBranch: () => 'main' };
const ev = (event, extra = {}) => ({ ts: new Date().toISOString(), session_id: 's1', cwd: 'C:\\code\\Synapse', event, ...extra });

test('session lifecycle: idle -> working -> waiting -> done, employees come and go', () => {
  const st = createState();
  apply(st, ev('SessionStart'), opts);
  assert.strictEqual(st.sessions.s1.status, 'idle');
  assert.strictEqual(st.sessions.s1.project, 'Synapse');
  apply(st, ev('UserPromptSubmit'), opts);
  assert.strictEqual(st.sessions.s1.status, 'working');
  apply(st, ev('SubagentStart', { agent_id: 'a1', agent_type: 'Explore' }), opts);
  apply(st, ev('PreToolUse', { tool: 'Grep', agent_id: 'a1', agent_type: 'Explore', detail: 'foo' }), opts);
  assert.strictEqual(st.sessions.s1.agents.a1.lastAction, 'Grep · foo');
  apply(st, ev('PermissionRequest', { tool: 'Bash' }), opts);
  assert.strictEqual(st.sessions.s1.status, 'waiting');
  apply(st, ev('PostToolUse', { tool: 'Bash' }), opts);
  assert.strictEqual(st.sessions.s1.status, 'working');
  apply(st, ev('SubagentStop', { agent_id: 'a1' }), opts);
  assert.deepStrictEqual(st.sessions.s1.agents, {});
  apply(st, ev('Stop'), opts);
  assert.strictEqual(st.sessions.s1.status, 'done');
  apply(st, ev('StopFailure', { detail: 'overloaded', kind: 'overloaded' }), opts);
  assert.strictEqual(st.sessions.s1.status, 'error');
  apply(st, ev('StopFailure', { kind: 'rate_limit' }), opts);
  assert.strictEqual(st.sessions.s1.status, 'limited');
  apply(st, ev('Notification', { kind: 'idle_prompt' }), opts);
  assert.strictEqual(st.sessions.s1.status, 'limited');
  apply(st, ev('Notification', { kind: 'quota_auto_resume_fired' }), opts);
  assert.strictEqual(st.sessions.s1.status, 'working');
  apply(st, ev('SessionEnd'), opts);
  assert.strictEqual(st.sessions.s1, undefined);
});

test('server: loopback only, token required, streams state', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3o-d-'));
  fs.writeFileSync(path.join(dir, 'events.jsonl'), JSON.stringify(ev('UserPromptSubmit')) + '\n');
  const { server, port, token } = await start({ port: 0, dir });
  try {
    const base = `http://127.0.0.1:${port}`;
    assert.strictEqual((await fetch(`${base}/api/state`)).status, 401);
    assert.strictEqual((await fetch(`${base}/auth?t=wrong`)).status, 403);
    const auth = await fetch(`${base}/auth?t=${token}`, { redirect: 'manual' });
    const cookie = auth.headers.get('set-cookie').split(';')[0];
    const state = await (await fetch(`${base}/api/state`, { headers: { cookie } })).json();
    assert.strictEqual(state.sessions[0].status, 'working');
    const rebind = await new Promise((ok) => require('http').get({ port, host: '127.0.0.1', path: '/api/state', headers: { cookie, host: 'evil.com' } }, (r) => ok(r.statusCode)));
    assert.strictEqual(rebind, 403);
  } finally {
    server.close();
  }
});
