'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { redact, toLine } = require('../collector/hook.js');
const { addHooks, removeHooks, install, uninstall } = require('../scripts/settings.js');

const HOOK = path.join(__dirname, '..', 'collector', 'hook.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'c3o-'));

test('hook is silent, exits 0 and appends one line', () => {
  const dir = tmp();
  const ev = { session_id: 's1', cwd: 'C:\\p', hook_event_name: 'PreToolUse', tool_name: 'Bash', agent_id: 'a1', agent_type: 'Explore', tool_input: { command: 'curl -H "Authorization: Bearer abc.def" x' } };
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(ev), env: { ...process.env, CLAUDE_OFFICE_DIR: dir } });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout.length, 0);
  assert.strictEqual(r.stderr.length, 0);
  const line = JSON.parse(fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8'));
  assert.deepStrictEqual([line.session_id, line.event, line.tool, line.agent_type], ['s1', 'PreToolUse', 'Bash', 'Explore']);
  assert.ok(!line.detail.includes('abc.def'));
});

test('hook stays silent and exits 0 on garbage input and unwritable dir', () => {
  for (const [input, dir] of [['not json', tmp()], ['{}', path.join(HOOK, 'cannot-be-a-dir')]]) {
    const r = spawnSync(process.execPath, [HOOK], { input, env: { ...process.env, CLAUDE_OFFICE_DIR: dir } });
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout.length + r.stderr.length, 0);
  }
});

test('redact hides common secrets', () => {
  const s = redact('k=sk-ant-api03-AAAAAAAAAAAAAAAAAAAA ghp_aaaaaaaaaaaaaaaaaaaaaaaa API_KEY=hunter2 https://u:pw@host token: xyz');
  for (const bad of ['AAAAAAAAAAAA', 'ghp_aaaa', 'hunter2', ':pw@', 'xyz']) assert.ok(!s.includes(bad), `${bad} leaked in ${s}`);
  assert.ok(s.includes('https://u:***@host'));
});

test('toLine never stores raw tool input or prompt', () => {
  const l = JSON.parse(toLine({ hook_event_name: 'UserPromptSubmit', prompt: 'secret plan', tool_input: { content: 'file body' } }));
  assert.ok(!JSON.stringify(l).includes('secret plan'));
  assert.ok(!JSON.stringify(l).includes('file body'));
});

test('install merges, is idempotent; uninstall removes only ours', () => {
  const dir = tmp();
  const file = path.join(dir, 'settings.json');
  const original = { model: 'x', hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk hook claude' }] }] } };
  fs.writeFileSync(file, JSON.stringify(original));
  process.env.CLAUDE_SETTINGS_PATH = file;
  process.env.CLAUDE_OFFICE_DIR = path.join(dir, 'claude-office');
  try {
    const r1 = install();
    assert.ok(fs.existsSync(r1.backup));
    install();
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(s.model, 'x');
    assert.strictEqual(s.hooks.PreToolUse.length, 2); // rtk + ours once
    assert.strictEqual(s.hooks.PreToolUse[1].hooks[0].async, true);
    uninstall();
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), original);
  } finally {
    delete process.env.CLAUDE_SETTINGS_PATH;
    delete process.env.CLAUDE_OFFICE_DIR;
  }
});

test('install refuses invalid JSON and leaves the file untouched', () => {
  const dir = tmp();
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, '{ broken');
  process.env.CLAUDE_SETTINGS_PATH = file;
  process.env.CLAUDE_OFFICE_DIR = path.join(dir, 'claude-office');
  try {
    assert.throws(() => install());
    assert.strictEqual(fs.readFileSync(file, 'utf8'), '{ broken');
  } finally {
    delete process.env.CLAUDE_SETTINGS_PATH;
    delete process.env.CLAUDE_OFFICE_DIR;
  }
});

test('removeHooks keeps a group that mixes ours and others', () => {
  const s = addHooks({}, 'node', 'C:\\x\\claude-office\\hook.js');
  s.hooks.Stop[0].hooks.push({ type: 'command', command: 'other' });
  removeHooks(s);
  assert.deepStrictEqual(s.hooks, { Stop: [{ hooks: [{ type: 'command', command: 'other' }] }] });
});
