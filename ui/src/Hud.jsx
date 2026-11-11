import { STATUS } from './App.jsx';

const time = (ts) => new Date(ts).toLocaleTimeString('fr-FR');
function duration(from) {
  if (!from) return '–';
  const s = Math.max(0, Math.round((Date.now() - Date.parse(from)) / 1000));
  return s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
}

export default function Hud({ session: s, onClose }) {
  const st = STATUS[s.status] || STATUS.idle;
  const agents = Object.values(s.agents || {});
  return (
    <aside className="hud">
      <div className="hud-head">
        <div>
          <h2>{s.project}</h2>
          <div className="muted mono" title={s.cwd}>{s.cwd}</div>
        </div>
        <button className="close" onClick={onClose} aria-label="Fermer">×</button>
      </div>
      <div className="status" style={{ background: st.color }}>{st.label}</div>
      <dl>
        <dt>Branche</dt><dd className="mono">{s.branch || '–'}</dd>
        <dt>Dernière action</dt><dd>{s.lastAction || '–'}</dd>
        <dt>Tâche en cours</dt><dd>{s.status === 'working' || s.status === 'waiting' ? duration(s.taskStart) : '–'}</dd>
        <dt>Outils utilisés</dt><dd>{s.toolCount}{s.errors ? ` (${s.errors} en échec)` : ''}</dd>
      </dl>
      <h3>Employés ({agents.length})</h3>
      {agents.length ? (
        <ul className="agents">
          {agents.map((a) => <li key={a.id}><b>{a.type}</b> <span className="muted">{a.lastAction}</span></li>)}
        </ul>
      ) : <p className="muted">Aucun sous-agent actif.</p>}
      <h3>Logs en direct</h3>
      <ol className="logs mono">
        {[...s.logs].reverse().map((l, i) => (
          <li key={i}>
            <span className="muted">{time(l.ts)}</span> <b>{l.event}</b>{l.tool ? ` ${l.tool}` : ''}{l.agent ? ` [${l.agent}]` : ''}
            {l.detail && <div className="detail">{l.detail}</div>}
          </li>
        ))}
      </ol>
    </aside>
  );
}
