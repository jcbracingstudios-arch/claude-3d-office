#!/usr/bin/env node
// Claude 3D Office collector. Strictly passive: never writes to stdout/stderr, always exits 0.
// Anything printed here could be injected into Claude's context (UserPromptSubmit/SessionStart),
// and exit code 2 would block Claude. So: silence + exit 0, no matter what.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const SECRETS = [
  /\bsk-[A-Za-z0-9_-]{16,}/g, // Anthropic / OpenAI style keys
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /\bAIza[0-9A-Za-z_-]{30,}/g, // Google API key
  /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
].map((re) => [re, '***']).concat([
  [/(\bbearer\s+)[^\s"']+/gi, '$1***'],
  [/(\b[\w-]*(?:api[_-]?key|token|secret|passw(?:or)?d|pwd|auth)[\w-]*\s*[:=]\s*["']?)[^\s"'&]+/gi, '$1***'],
  [/(:\/\/[^:\/\s]+:)[^@\s]+@/g, '$1***@'], // user:password@host
]);

function redact(text) {
  let s = String(text);
  for (const [re, repl] of SECRETS) s = s.replace(re, repl);
  return s;
}

// Short human-readable hint of what happened. Redacted and truncated before it is ever stored.
function detail(e) {
  const i = e.tool_input || {};
  const raw = i.command || i.file_path || i.notebook_path || i.pattern || i.url || i.query || i.description ||
    e.task_subject || e.message || e.error || e.reason || e.source || '';
  const oneLine = String(raw).replace(/\s+/g, ' ').trim();
  return redact(oneLine).slice(0, 160);
}

function toLine(e, now = new Date()) {
  const line = {
    ts: now.toISOString(),
    session_id: e.session_id,
    cwd: e.cwd,
    event: e.hook_event_name,
  };
  if (e.tool_name) line.tool = e.tool_name;
  if (e.agent_id) line.agent_id = e.agent_id;
  if (e.agent_type) line.agent_type = e.agent_type;
  if (e.teammate_name) line.teammate = e.teammate_name; // agent teams
  if (e.task_id) line.task_id = e.task_id;
  if (e.notification_type) line.kind = e.notification_type;
  else if (typeof e.error === 'string') line.kind = e.error; // StopFailure error type, e.g. rate_limit
  const d = detail(e);
  if (d) line.detail = d;
  return JSON.stringify(line) + '\n';
}

function main() {
  const quit = () => process.exit(0);
  process.on('uncaughtException', quit);
  setTimeout(quit, 5000).unref(); // never hang Claude Code if stdin stays open
  const chunks = [];
  process.stdin.on('data', (c) => chunks.push(c));
  process.stdin.on('error', quit);
  process.stdin.on('end', () => {
    try {
      const event = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const dir = process.env.CLAUDE_OFFICE_DIR || path.join(os.homedir(), 'claude-office');
      fs.mkdirSync(dir, { recursive: true });
      // One appendFileSync call per line: concurrent hooks won't interleave partial lines.
      fs.appendFileSync(path.join(dir, 'events.jsonl'), toLine(event));
    } catch {}
    quit();
  });
}

if (require.main === module) main();
else module.exports = { redact, toLine };
