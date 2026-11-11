#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const settings = require('../scripts/settings.js');

const [cmd = 'start', arg] = process.argv.slice(2);

function open(url) {
  const [bin, args] = process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(bin, args, { detached: true, stdio: 'ignore' }).unref();
}

async function main() {
  switch (cmd) {
    case 'install': {
      const r = settings.install();
      console.log(`Hooks installés dans ${r.file}`);
      if (r.backup) console.log(`Sauvegarde : ${r.backup}`);
      console.log('Les nouvelles sessions Claude Code apparaîtront dans le bureau. Lance : npx claude-3d-office');
      break;
    }
    case 'uninstall': {
      const r = settings.uninstall();
      console.log(`Hooks Claude 3D Office retirés de ${r.file}`);
      if (r.backup) console.log(`Sauvegarde : ${r.backup}`);
      break;
    }
    case 'tail': {
      const file = path.join(settings.officeDir(), 'events.jsonl');
      if (!fs.existsSync(file)) return console.log('Aucun événement pour l’instant.');
      const lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
      console.log(lines.slice(-(Number(arg) || 20)).join('\n'));
      break;
    }
    case 'demo':
      require('../scripts/demo.js');
      break;
    case 'start': {
      const { start } = require('../daemon/server.js');
      try {
        const { url } = await start();
        console.log('Claude 3D Office tourne sur http://127.0.0.1:' + new URL(url).port + ' (Ctrl+C pour arrêter)');
        if (arg !== '--no-open') open(url);
      } catch (e) {
        if (e.code !== 'EADDRINUSE') throw e;
        // Already running: just open it.
        const token = fs.readFileSync(path.join(settings.officeDir(), 'token'), 'utf8').trim();
        const port = Number(process.env.CLAUDE_OFFICE_PORT) || 7431;
        console.log('Déjà lancé, ouverture du bureau.');
        open(`http://127.0.0.1:${port}/auth?t=${token}`);
      }
      break;
    }
    default:
      console.log('Usage : claude-3d-office [start|install|uninstall|tail [n]|demo]');
  }
}

main().catch((e) => { console.error('Erreur :', e.message); process.exit(1); });
