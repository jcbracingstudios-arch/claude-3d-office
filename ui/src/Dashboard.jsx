// "Aujourd'hui" panel: time per project spent working, waiting for you, or blocked by the usage limit.
const COLORS = { working: '#5b8c5a', waiting: '#e0902f', limited: '#7a5cc4' };
const LABELS = { working: 'Travail', waiting: 'Attend ta validation', limited: 'Limite Claude' };

const fmt = (ms) => {
  const m = Math.round(ms / 60000);
  return m < 1 ? '< 1 min' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
};

/** Stats from the daemon plus the part of the current status not counted yet (it is added on the next change). */
export function todayStats(stats, sessions, now = Date.now()) {
  const projects = JSON.parse(JSON.stringify(stats?.projects || {}));
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  for (const s of sessions) {
    if (!COLORS[s.status] || !s.since) continue;
    const ms = now - Math.max(Date.parse(s.since), midnight.getTime());
    if (ms <= 0) continue;
    const p = (projects[s.project] ||= { working: 0, waiting: 0, limited: 0, tasks: 0, errors: 0 });
    p[s.status] += ms;
  }
  return Object.entries(projects).map(([name, p]) => ({ name, ...p, total: p.working + p.waiting + p.limited }))
    .sort((a, b) => b.total - a.total);
}

export default function Dashboard({ stats, sessions, onClose }) {
  const rows = todayStats(stats, sessions);
  const max = Math.max(1, ...rows.map((r) => r.total));
  const sum = (k) => rows.reduce((n, r) => n + r[k], 0);
  return (
    <aside className="dash">
      <div className="hud-head">
        <div>
          <h2>Aujourd'hui</h2>
          <div className="muted">{fmt(sum('working'))} de travail · {sum('tasks')} tâche{sum('tasks') > 1 ? 's' : ''} terminée{sum('tasks') > 1 ? 's' : ''}
            {sum('waiting') > 0 ? ` · ${fmt(sum('waiting'))} à t'attendre` : ''}{sum('limited') > 0 ? ` · ${fmt(sum('limited'))} bloqué par la limite` : ''}</div>
        </div>
        <button className="close" onClick={onClose} aria-label="Fermer">×</button>
      </div>
      {rows.length ? (
        <table>
          <thead><tr><th>Projet</th><th>Temps</th><th className="num">Travail</th><th className="num">Tâches</th><th className="num">Erreurs</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td><b>{r.name}</b></td>
                <td>
                  <div className="meter" style={{ width: `${Math.max(8, (r.total / max) * 100)}%` }} title={Object.keys(COLORS).map((k) => `${LABELS[k]} : ${fmt(r[k])}`).join('\n')}>
                    {Object.keys(COLORS).map((k) => r[k] > 0 && <span key={k} style={{ width: `${(r[k] / (r.total || 1)) * 100}%`, background: COLORS[k] }} />)}
                  </div>
                </td>
                <td className="num">{fmt(r.working)}</td>
                <td className="num">{r.tasks}</td>
                <td className="num">{r.errors || '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="muted">Rien encore aujourd'hui. Lance une tâche dans Claude Code.</p>}
      <div className="legend">{Object.keys(COLORS).map((k) => <span key={k}><i style={{ background: COLORS[k] }} />{LABELS[k]}</span>)}</div>
    </aside>
  );
}
