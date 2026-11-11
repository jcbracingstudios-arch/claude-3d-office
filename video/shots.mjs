// Shot list for the presentation video: scripted office state, camera path and voice line per shot.
// Times are in seconds from the start of the shot. Negative times = what happened before (sets the scene).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createState, apply } = require('../daemon/state.js');

export const START = Date.parse('2026-11-11T10:00:00.000Z'); // virtual clock origin

const S = {
  A: ['demo-a', 'C:\\code\\landing-page'],
  B: ['demo-b', 'C:\\code\\api-server'],
  C: ['demo-c', 'C:\\code\\mobile-app'],
  D: ['demo-d', 'C:\\code\\docs-site'],
};
const BRANCH = { 'landing-page': 'feat/hero', 'api-server': 'feat/auth', 'mobile-app': 'main', 'docs-site': 'main' };
const ev = (t, who, event, extra = {}) => ({ t, session_id: S[who][0], cwd: S[who][1], event, ...extra });

// Everyone exists, arrival order A, B, C, D (pods 0..3).
const base = [ev(-300, 'A', 'SessionStart'), ev(-299, 'B', 'SessionStart'), ev(-298, 'C', 'SessionStart'), ev(-297, 'D', 'SessionStart')];
const working = (who, t = -60) => [
  ev(t, who, 'UserPromptSubmit'),
  ev(t + 1, who, 'PreToolUse', { tool: 'Read', detail: 'src/index.ts' }),
];

const POD0_SEAT = [-8.4, -7.22];
const presenterCam = (from, to) => [
  { t: 0, pos: [POD0_SEAT[0] + from[0], from[1], POD0_SEAT[1] + from[2]], look: [POD0_SEAT[0], 0.98, POD0_SEAT[1]], fov: 60 },
  { t: 6, pos: [POD0_SEAT[0] + to[0], to[1], POD0_SEAT[1] + to[2]], look: [POD0_SEAT[0], 0.98, POD0_SEAT[1]], fov: 60 },
];

export const SHOTS = [
  {
    id: 'intro', line: 'Tes agents Claude Code ont enfin un bureau.',
    presenter: 'demo-a', hours: [{ t: 0, h: 11 }],
    events: [...base, ...working('A'), ...working('B', -40)],
    camera: presenterCam([0.1, 1.1, 1.6], [0.03, 1.07, 1.4]),
  },
  {
    id: 'drone', line: "Chaque session, c'est une mascotte. Ses sous-agents ? Ses employés.",
    hours: [{ t: 0, h: 11 }],
    events: [...base, ...working('A'), ev(-50, 'A', 'SubagentStart', { agent_id: 'a1', agent_type: 'Explore' }),
      ev(-49, 'A', 'SubagentStart', { agent_id: 'a2', agent_type: 'Plan' }), ...working('B', -30),
      ev(-20, 'B', 'SubagentStart', { agent_id: 'b1', agent_type: 'general-purpose' })],
    camera: [{ t: 0, pos: [26, 30, 34], look: [0, 0, 0], fov: 32 }, { t: 5, pos: [4, 7, 8], look: [-5, 0.5, -3.5], fov: 40 }],
  },
  {
    id: 'team', line: "Une tâche démarre : toute l'équipe se met au travail.",
    hours: [{ t: 0, h: 11.5 }],
    // the boss is already sitting down; the employees spawn and walk to their desks during the shot
    events: [...base, ev(-6, 'A', 'UserPromptSubmit'), ev(-5.5, 'A', 'PreToolUse', { tool: 'Read', detail: 'src/App.tsx' }),
      ev(0.2, 'A', 'SubagentStart', { agent_id: 'a1', agent_type: 'Explore' }), ev(0.45, 'A', 'SubagentStart', { agent_id: 'a2', agent_type: 'Plan' }),
      ev(0.7, 'A', 'SubagentStart', { agent_id: 'a3', agent_type: 'general-purpose' }),
      ev(1.3, 'A', 'PreToolUse', { tool: 'Grep', detail: 'useState', agent_id: 'a1', agent_type: 'Explore' }),
      ev(1.6, 'A', 'PreToolUse', { tool: 'Read', detail: 'README.md', agent_id: 'a2', agent_type: 'Plan' }),
      ev(1.9, 'A', 'PreToolUse', { tool: 'Edit', detail: 'src/Hero.tsx', agent_id: 'a3', agent_type: 'general-purpose' })],
    camera: [{ t: 0, pos: [-6.2, 5.6, 0.9], look: [-8.4, 0.3, -4.8], fov: 44 }, { t: 5, pos: [-6.8, 4.8, -0.2], look: [-8.4, 0.3, -5.0], fov: 44 }],
  },
  {
    id: 'meeting', line: 'Elle attend ta validation ? Elle file en réunion, et ton PC te prévient.',
    hours: [{ t: 0, h: 12 }], toast: { at: 2.4, title: 'api-server · attend ta validation', body: 'Validation demandée : Bash · git push origin main' },
    events: [...base, ...working('A'), ...working('B', -30),
      ev(-1.4, 'B', 'PermissionRequest', { tool: 'Bash', detail: 'git push origin main' })],
    camera: [{ t: 0, pos: [2.6, 5.8, 3.2], look: [-0.6, 0.3, -3.8], fov: 50 }, { t: 5, pos: [1.6, 3.9, 0.9], look: [0.5, 0.5, -3.2], fov: 46 }],
  },
  {
    id: 'party', line: 'Tâche finie ? On fête ça…',
    hours: [{ t: 0, h: 13 }],
    events: [...base, ...working('A'), ev(0.25, 'A', 'Stop')],
    camera: [{ t: 0, pos: [-7.3, 2.1, -3.9], look: [-8.4, 0.95, -7.2], fov: 46 }, { t: 3, pos: [-7.6, 1.9, -4.4], look: [-8.4, 1.05, -7.2], fov: 46 }],
  },
  {
    id: 'cheers', line: '…et pause café.',
    hours: [{ t: 0, h: 13 }], shift: 2, // the pair lands on the cafe tables, in the open
    events: [...base, ...working('A', -80), ev(-7, 'A', 'Stop'), ...working('B', -40)],
    camera: [{ t: 0, pos: [0.6, 2.7, 5.6], look: [0.5, 0.7, 2.2], fov: 48 }, { t: 3, pos: [0.5, 2.4, 5.0], look: [0.5, 0.75, 2.2], fov: 46 }],
  },
  {
    id: 'hud', line: 'Un clic : logs en direct, branche Git, dernière action.',
    hours: [{ t: 0, h: 14 }], selected: [{ t: 0.7, id: 'demo-b' }],
    events: [...base, ...working('A'), ev(-40, 'B', 'UserPromptSubmit'),
      ev(-30, 'B', 'PreToolUse', { tool: 'Read', detail: 'src/routes/auth.ts' }), ev(-29, 'B', 'PostToolUse', { tool: 'Read' }),
      ev(-20, 'B', 'PreToolUse', { tool: 'Edit', detail: 'src/routes/auth.ts' }), ev(-19, 'B', 'PostToolUse', { tool: 'Edit' }),
      ev(-12, 'B', 'PreToolUse', { tool: 'Bash', detail: 'npm test -- auth' }), ev(-6, 'B', 'PostToolUse', { tool: 'Bash' }),
      ev(1.2, 'B', 'PreToolUse', { tool: 'Edit', detail: 'src/middleware/session.ts' }),
      ev(2.4, 'B', 'PreToolUse', { tool: 'Bash', detail: 'npm run lint' })],
    camera: [{ t: 0, pos: [-1.6, 2.4, -1.4], look: [-4.6, 0.8, -6.4], fov: 46 }, { t: 5, pos: [-2.2, 2.1, -2.0], look: [-4.9, 0.8, -6.6], fov: 44 }],
  },
  {
    id: 'night', line: "Et le bureau vit à ton rythme, jusqu'à la nuit.",
    hours: [{ t: 0, h: 10 }, { t: 1.0, h: 17.6 }, { t: 1.9, h: 19.2 }, { t: 2.7, h: 22 }],
    events: [...base, ...working('A'), ...working('B', -40)],
    camera: [{ t: 0, pos: [24, 16, 26], look: [0.5, 0, 0], fov: 30 }, { t: 5, pos: [12, 14, 32], look: [0.5, 0, 0], fov: 30 }],
  },
  {
    id: 'outro', line: 'Tout tourne en local. Zéro token consommé.',
    presenter: 'demo-a', hours: [{ t: 0, h: 18.3 }],
    events: [...base, ...working('A'), ...working('B', -40)],
    camera: presenterCam([-0.1, 1.08, 1.55], [-0.03, 1.06, 1.35]),
  },
  {
    id: 'end', line: 'Claude 3D Office. Lien en bio.', card: true,
  },
];

/** Snapshots [{ t, data }] for the UI, from the shot's events (same reducer as the real daemon). */
export function snapshots(events) {
  const state = createState();
  const sorted = [...events].sort((a, b) => a.t - b.t);
  const out = [];
  const snap = (t) => ({ t, data: JSON.parse(JSON.stringify({ now: new Date(START + t * 1000).toISOString(), sessions: Object.values(state.sessions) })) });
  let i = 0;
  for (; i < sorted.length && sorted[i].t <= 0; i++) apply(state, { ...sorted[i], ts: new Date(START + sorted[i].t * 1000).toISOString() }, { gitBranch: (cwd) => BRANCH[cwd.split('\\').pop()] || 'main' });
  out.push(snap(-1e9));
  for (; i < sorted.length; i++) {
    apply(state, { ...sorted[i], ts: new Date(START + sorted[i].t * 1000).toISOString() }, { gitBranch: (cwd) => BRANCH[cwd.split('\\').pop()] || 'main' });
    out.push(snap(sorted[i].t));
  }
  return out;
}
