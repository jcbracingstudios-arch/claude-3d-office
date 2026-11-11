'use strict';
// Install / uninstall the collector hooks in Claude Code's user settings.json.
// Always: timestamped backup first, merge without touching other entries, refuse to write on invalid JSON.
const fs = require('fs');
const path = require('path');
const os = require('os');

const EVENTS = [
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'PermissionRequest', 'Notification', 'Stop', 'StopFailure', 'SubagentStart', 'SubagentStop', 'SessionEnd',
  'TaskCreated', 'TaskCompleted', 'TeammateIdle', // agent teams
];

const officeDir = () => process.env.CLAUDE_OFFICE_DIR || path.join(os.homedir(), 'claude-office');
const settingsPath = () => process.env.CLAUDE_SETTINGS_PATH || path.join(os.homedir(), '.claude', 'settings.json');

// Our entries are recognised by the hook path, so the uninstall never touches anything else.
const isOurs = (h) => [h.command, ...(h.args || [])].some((s) => /claude-office[\\/]hook\.js$/.test(String(s || '')));

function removeHooks(settings) {
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== 'object') return settings;
  for (const ev of Object.keys(hooks)) {
    if (!Array.isArray(hooks[ev])) continue;
    hooks[ev] = hooks[ev]
      .map((g) => (Array.isArray(g.hooks) && g.hooks.some(isOurs) ? { ...g, hooks: g.hooks.filter((h) => !isOurs(h)) } : g))
      .filter((g) => !Array.isArray(g.hooks) || g.hooks.length > 0);
    if (hooks[ev].length === 0) delete hooks[ev];
  }
  if (Object.keys(hooks).length === 0) delete settings.hooks;
  return settings;
}

function addHooks(settings, nodePath, hookPath) {
  removeHooks(settings); // idempotent: reinstall replaces our entries only
  settings.hooks = settings.hooks || {};
  for (const ev of EVENTS) {
    settings.hooks[ev] = settings.hooks[ev] || [];
    // Exec form (args) avoids any shell; async never blocks Claude Code.
    settings.hooks[ev].push({ hooks: [{ type: 'command', command: nodePath, args: [hookPath], async: true, timeout: 10 }] });
  }
  return settings;
}

function readSettings(file) {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  if (!text.trim()) return {};
  const parsed = JSON.parse(text); // throws on invalid JSON -> caller aborts without writing
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('settings.json is not a JSON object');
  return parsed;
}

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function writeSettings(file, settings) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let backup = null;
  if (fs.existsSync(file)) {
    backup = `${file}.claude-office-${stamp()}.bak`;
    fs.copyFileSync(file, backup);
  }
  const tmp = `${file}.claude-office.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n');
  fs.renameSync(tmp, file);
  return backup;
}

function install() {
  const file = settingsPath();
  const settings = readSettings(file);
  const dir = officeDir();
  fs.mkdirSync(dir, { recursive: true });
  const hookPath = path.join(dir, 'hook.js');
  fs.copyFileSync(path.join(__dirname, '..', 'collector', 'hook.js'), hookPath);
  const tokenFile = path.join(dir, 'token');
  if (!fs.existsSync(tokenFile)) fs.writeFileSync(tokenFile, require('crypto').randomBytes(32).toString('hex'), { mode: 0o600 });
  const backup = writeSettings(file, addHooks(settings, process.execPath, hookPath));
  return { file, backup, hookPath };
}

function uninstall() {
  const file = settingsPath();
  const settings = readSettings(file);
  const backup = writeSettings(file, removeHooks(settings));
  return { file, backup };
}

module.exports = { EVENTS, isOurs, addHooks, removeHooks, readSettings, install, uninstall, officeDir };
