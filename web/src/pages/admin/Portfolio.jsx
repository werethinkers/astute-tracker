import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi, Loading, ErrorBox, PlanLine, PlanLegend, Health, DaysLeft, fmtDate, Empty } from '../../ui.jsx';
import { ProjectForm } from '../adminForms.jsx';

export default function Portfolio() {
  const { data, loading, error, reload } = useApi('/admin/portfolio');
  const [venture, setVenture] = useState('');
  const [newProject, setNewProject] = useState(false);
  const nav = useNavigate();
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const order = { red: 0, amber: 1, green: 2, none: 3, done: 4 };
  const list = data.projects.filter((p) => !venture || String(p.company_id) === venture).sort((a, b) => order[a.health] - order[b.health] || a.name.localeCompare(b.name));
  const groups = new Map();
  for (const p of list) {
    if (!groups.has(p.company_name)) groups.set(p.company_name, []);
    groups.get(p.company_name).push(p);
  }
  return (
    <>
      <div className="head">
        <div>
          <h1>Portfolio</h1>
          <div className="sub">Every active project, worst first. The amber tick shows where the plan says each project should be today.</div>
        </div>
        <div className="actions">
          <select className="input" style={{ width: 'auto' }} value={venture} onChange={(e) => setVenture(e.target.value)} aria-label="Filter by venture">
            <option value="">All ventures</option>
            {data.companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button className="btn primary" onClick={() => setNewProject(true)}>
            New project
          </button>
        </div>
      </div>
      {!list.length && (
        <div className="panel">
          <Empty title="No active projects">Create a project, then add its modules and features.</Empty>
        </div>
      )}
      {[...groups.entries()].map(([name, ps]) => (
        <div className="panel mb16 scroll-x" key={name}>
          <div className="ph">
            <h2>{name}</h2>
          </div>
          <table className="table" style={{ tableLayout: 'fixed', minWidth: 900 }}>
            <thead>
              <tr>
                <th style={{ width: '24%' }}>Project</th>
                <th style={{ width: '24%' }}>Progress against plan</th>
                <th style={{ width: '11%' }}>Health</th>
                <th style={{ width: '19%' }}>Schedule</th>
                <th className="r" style={{ width: '8%' }}>Features</th>
                <th className="r" style={{ width: '8%' }}>In review</th>
                <th className="r" style={{ width: '6%' }}>Flags</th>
              </tr>
            </thead>
            <tbody>
              {ps.map((p) => (
                <tr key={p.id} className="click" onClick={() => nav(`/projects/${p.id}`)}>
                  <td>
                    <strong style={{ color: 'var(--ink)' }}>{p.name}</strong>
                    <div className="tiny muted">
                      {fmtDate(p.start_date)} to {fmtDate(p.end_date)}
                      {p.late_vs_target && <span style={{ color: 'var(--red)' }}>, past target {fmtDate(p.target_end_date)}</span>}
                    </div>
                  </td>
                  <td>
                    <PlanLine done={p.progress_pct} review={p.pending_pct} expected={p.expected_pct} />
                  </td>
                  <td>{p.status === 'on_hold' ? <span className="pill on_hold">On hold</span> : <Health h={p.health} />}</td>
                  <td className="small nowrap">
                    <DaysLeft n={p.days_left} end={p.end_date} />
                  </td>
                  <td className="r num">
                    {p.features_done}/{p.features}
                  </td>
                  <td className="r num">{p.features_submitted || ''}</td>
                  <td className="r num" style={{ color: p.red_flags ? 'var(--red)' : undefined }}>
                    {p.open_flags || ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <PlanLegend />
      {data.closed.length > 0 && (
        <div className="panel mt24">
          <div className="ph">
            <h3>Closed projects</h3>
          </div>
          <div className="divide">
            {data.closed.map((p) => (
              <div key={p.id} className="pb gap8 small" style={{ justifyContent: 'space-between', cursor: 'pointer' }} onClick={() => nav(`/projects/${p.id}`)}>
                <span>
                  {p.name} <span className="muted">{p.company_name}</span>
                </span>
                <span className="muted">
                  {p.status}, {Math.round(p.progress_pct)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {newProject && <ProjectForm onClose={() => setNewProject(false)} onDone={(out) => (out?.project?.id ? nav(`/projects/${out.project.id}`) : reload())} />}
    </>
  );
}
