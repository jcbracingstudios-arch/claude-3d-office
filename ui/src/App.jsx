import { useEffect, useRef, useState } from 'react';
import Office from './Office.jsx';
import Hud from './Hud.jsx';

export const STATUS = {
  idle: { label: 'En pause', color: '#8a8780' },
  working: { label: 'Au travail', color: '#5b8c5a' },
  waiting: { label: 'Attend ta validation', color: '#e0902f' },
  error: { label: 'Erreur', color: '#c94a3f' },
  done: { label: 'Terminé', color: '#4f7fbf' },
  limited: { label: 'Limite Claude atteinte', color: '#7a5cc4' },
};

const ALERT = new Set(['waiting', 'error', 'limited']);
const TAURI = window.__TAURI__;
import { FILM, filmTime, stepAt } from './film.js';

// Desktop app only: connect / disconnect Claude Code (adds or removes our hooks in settings.json).
function Connection() {
  const [st, setSt] = useState(null);
  const [msg, setMsg] = useState('');
  const refresh = () => TAURI.core.invoke('hooks_status').then(setSt);
  useEffect(() => { refresh(); }, []);
  if (!st) return null;
  const run = (cmd, ok) => TAURI.core.invoke(cmd)
    .then((r) => { setMsg(ok + (r.backup ? ` Sauvegarde : ${r.backup}` : '')); refresh(); })
    .catch((e) => setMsg(String(e)));
  if (!st.current) {
    return (
      <div className="connect">
        <h2>Connecter Claude Code</h2>
        <p>Le bureau a besoin de petits hooks dans <code>{st.settings}</code> pour voir tes sessions.
          Ton fichier est sauvegardé avant, rien d'autre n'est modifié, et rien ne quitte ton PC. Zéro token consommé.</p>
        <button onClick={() => run('connect', 'Connecté ! Les nouvelles sessions Claude Code apparaîtront ici.')}>
          {st.installed ? 'Mettre à jour la connexion' : 'Connecter'}
        </button>
        {msg && <p className="muted">{msg}</p>}
      </div>
    );
  }
  return (
    <button className="link" title={msg || 'Retire les hooks de Claude 3D Office de settings.json'}
      onClick={() => confirm('Déconnecter Claude Code ? Les hooks de Claude 3D Office seront retirés (sauvegarde faite avant).') && run('disconnect', 'Déconnecté.')}>
      Déconnecter
    </button>
  );
}

function notify(s) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const body = s.status === 'waiting' ? `Attend ta validation : ${s.lastAction || ''}` : s.status === 'limited' ? 'Limite Claude atteinte : pause aux serveurs' : `Erreur : ${s.lastAction || ''}`;
  new Notification(`Claude 3D Office · ${s.project}`, { body, tag: s.id });
}

export default function App() {
  const [data, setData] = useState({ sessions: [], now: null });
  const [online, setOnline] = useState(false);
  const [selected, setSelected] = useState(null);
  const [notifPerm, setNotifPerm] = useState(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  const prev = useRef({});
  const [, setTick] = useState(0);
  // Re-render every second: task timers and "celebrate then go to the pause area" depend on wall-clock time.
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 1000); return () => clearInterval(t); }, []);

  useEffect(() => {
    // Film mode (video capture): scripted snapshots on the virtual clock.
    if (FILM) {
      let last = null;
      const loop = () => {
        const t = filmTime();
        const snap = stepAt(FILM.snapshots, t);
        if (snap && snap !== last) { last = snap; setData(snap.data); }
        const sel = stepAt(FILM.selected, t);
        setSelected(sel ? sel.id : null);
        requestAnimationFrame(loop);
      };
      loop();
      return;
    }
    // Desktop app (Tauri): state comes from the app itself, which also sends system notifications.
    if (TAURI) {
      let unlisten;
      TAURI.core.invoke('get_state').then(setData);
      TAURI.event.listen('state', (e) => setData(e.payload)).then((u) => (unlisten = u));
      setOnline(true);
      return () => unlisten?.();
    }
    const es = new EventSource('/api/stream');
    es.onopen = () => setOnline(true);
    es.onerror = () => setOnline(false);
    es.onmessage = (m) => {
      const d = JSON.parse(m.data);
      for (const s of d.sessions) {
        if (ALERT.has(s.status) && prev.current[s.id] !== s.status) notify(s);
        prev.current[s.id] = s.status;
      }
      setData(d);
    };
    return () => es.close();
  }, []);

  const alerts = data.sessions.filter((s) => ALERT.has(s.status)).length;
  useEffect(() => { document.title = (alerts ? `(${alerts}) ` : '') + 'Claude 3D Office'; }, [alerts]);

  const sel = data.sessions.find((s) => s.id === selected) || null;
  const working = data.sessions.filter((s) => s.status === 'working').length;

  return (
    <div className="app">
      <Office sessions={data.sessions} selected={selected} onSelect={setSelected} />
      {!FILM && <header className="bar">
        <strong>Claude 3D Office</strong>
        <span className={'dot ' + (online ? 'on' : 'off')} title={online ? 'Connecté au daemon local' : 'Daemon injoignable'} />
        <span>{data.sessions.length} session{data.sessions.length > 1 ? 's' : ''} · {working} au travail{alerts ? ` · ${alerts} alerte${alerts > 1 ? 's' : ''}` : ''}</span>
        {TAURI && <Connection />}
        {!TAURI && notifPerm === 'default' && (
          <button onClick={() => Notification.requestPermission().then(setNotifPerm)}>Activer les notifications</button>
        )}
      </header>}
      {!FILM && !data.sessions.length && (
        <div className="empty">
          {online ? 'Aucune session active. Lance Claude Code : une mascotte arrivera ici.' : 'Daemon injoignable. Lance : npx claude-3d-office'}
        </div>
      )}
      {sel && <Hud session={sel} onClose={() => setSelected(null)} />}
    </div>
  );
}
