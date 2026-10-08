import { Link } from 'react-router-dom';
import { useApi, Loading, ErrorBox, PlanLine, fmtDate, Empty } from '../ui.jsx';

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Every venture and its projects, for the whole team. Open a project to see its modules or add one. */
export default function Projects() {
  const { data, loading, error } = useApi('/projects');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const ventures = (data.ventures || []).map((v) => ({ ...v, projects: data.projects.filter((p) => p.company_id === v.id) }));
  return (
    <>
      <div className="head">
        <div>
          <h1>Projects</h1>
          <div className="sub">Every venture and project. Open a project to see its modules, or add a module of your own.</div>
        </div>
      </div>
      {!ventures.length && (
        <div className="panel">
          <Empty title="No ventures yet">Your admin sets up ventures and projects first.</Empty>
        </div>
      )}
      <div className="stack">
        {ventures.map((v) => (
          <div className="panel" key={v.id}>
            <div className="ph">
              <h3>{v.name}</h3>
              <span className="small muted">{plural(v.projects.length, 'project')}</span>
            </div>
            {!v.projects.length && <div className="pb small muted">No projects yet.</div>}
            {v.projects.map((p) => (
              <Link key={p.id} to={`/projects/${p.id}`} className="vcard">
                <div>
                  <div className="vn">
                    {p.name}
                    {p.status !== 'active' && (
                      <span className="tag" style={{ marginLeft: 8 }}>
                        {p.status.replace('_', ' ')}
                      </span>
                    )}
                  </div>
                  <div className="tiny muted">
                    {p.on_project ? `${plural(p.my_open_features, 'open feature')} for you` : 'You are not on this project yet'}. {plural(p.modules, 'module')}
                    {p.end_date && <>, ends {fmtDate(p.end_date)}</>}.
                  </div>
                </div>
                {p.progress_pct != null ? <PlanLine done={p.progress_pct} thin /> : <span />}
                <span className="small muted">{p.can_add_module ? 'Open or add a module' : 'Open'}</span>
              </Link>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
