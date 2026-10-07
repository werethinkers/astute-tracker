import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth.jsx';
import { useApi, Loading, ErrorBox, PlanLine, PlanLegend, Health, DaysLeft, fmtDate, Empty } from '../../ui.jsx';
import { ProjectForm } from '../adminForms.jsx';
import FlagList from './FlagList.jsx';

export default function CommandCentre() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useApi('/admin/overview');
  const [newProject, setNewProject] = useState(false);
  const nav = useNavigate();
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const c = data.counts;
  const red = data.flags.filter((f) => f.severity === 'red' && !f.acknowledged_at).length;
  const projectsTotal = data.ventures.reduce((s, v) => s + v.projects.length, 0);

  return (
    <>
      <div className="head">
        <div>
          <div className="crumbs">{fmtDate(data.today)}</div>
          <h1>{red ? `${red} thing${red === 1 ? ' needs' : 's need'} you today` : `All clear, ${user.name.split(' ')[0]}`}</h1>
          <div className="sub">
            {projectsTotal} active project{projectsTotal === 1 ? '' : 's'} across {data.ventures.length} venture{data.ventures.length === 1 ? '' : 's'}. Flags are visible to admins only.
          </div>
        </div>
        <div className="actions">
          <button className="btn primary" onClick={() => setNewProject(true)}>
            New project
          </button>
        </div>
      </div>

      <div className="counters">
        <Link to="/portfolio" className={`counter${c.at_risk_projects ? ' hot' : ''}`}>
          <div className="n">{c.at_risk_projects}</div>
          <div className="l">Projects at risk</div>
        </Link>
        <Link to="/flags" className={`counter${c.overdue_features ? ' hot' : ''}`}>
          <div className="n">{c.overdue_features}</div>
          <div className="l">Overdue features</div>
        </Link>
        <Link to="/reviews" className={`counter${c.reviews_waiting ? ' warm' : ''}`}>
          <div className="n">{c.reviews_waiting}</div>
          <div className="l">Waiting for your review</div>
        </Link>
        <Link to="/reviews" className={`counter${c.proposed_features ? ' warm' : ''}`}>
          <div className="n">{c.proposed_features}</div>
          <div className="l">Features proposed by the team</div>
        </Link>
        <Link to="/team" className={`counter${c.missing_logs ? ' warm' : ''}`}>
          <div className="n">{c.missing_logs}</div>
          <div className="l">No log on {fmtDate(data.yesterday)}</div>
        </Link>
      </div>

      <div className="grid2">
        <div className="panel">
          <div className="ph">
            <h2>Flags</h2>
            <span className="small muted">
              {data.flags.length} open. <Link to="/flags">History</Link>
            </span>
          </div>
          <FlagList flags={data.flags} onChange={reload} />
        </div>

        <div className="stack">
          {data.ventures.map((v) => (
            <div className="panel venture" key={v.id}>
              <div className="ph">
                <h2>{v.name}</h2>
                <span className="small muted">
                  {v.projects.length} project{v.projects.length === 1 ? '' : 's'}
                </span>
              </div>
              {!v.projects.length && <Empty title="No active projects">Start one with New project.</Empty>}
              {v.projects.map((p) => (
                <Link key={p.id} to={`/projects/${p.id}`} className="vcard" style={{ gridTemplateColumns: '1fr' }}>
                  <div className="gap8" style={{ justifyContent: 'space-between' }}>
                    <span className="vn">{p.name}</span>
                    <Health h={p.status === 'on_hold' ? 'none' : p.health} />
                  </div>
                  <PlanLine done={p.progress_pct} review={p.pending_pct} expected={p.expected_pct} />
                  <div className="gap8 tiny muted" style={{ justifyContent: 'space-between' }}>
                    <span>
                      {p.features_done} of {p.features} features, {p.people} people
                      {p.open_flags ? `, ${p.open_flags} flag${p.open_flags === 1 ? '' : 's'}` : ''}
                    </span>
                    <span>{p.status === 'on_hold' ? 'On hold' : <DaysLeft n={p.days_left} end={p.end_date} />}</span>
                  </div>
                </Link>
              ))}
            </div>
          ))}
          <PlanLegend />
        </div>
      </div>
      {newProject && <ProjectForm onClose={() => setNewProject(false)} onDone={(out) => (out?.project?.id ? nav(`/projects/${out.project.id}`) : reload())} />}
    </>
  );
}
