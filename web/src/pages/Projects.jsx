import { Link } from 'react-router-dom';
import { useApi, Loading, ErrorBox, PlanLine, fmtDate, Empty } from '../ui.jsx';

/** Workforce list of projects they have work in. */
export default function Projects() {
  const { data, loading, error } = useApi('/projects');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  return (
    <>
      <div className="head">
        <div>
          <h1>Projects</h1>
          <div className="sub">Projects you have work in.</div>
        </div>
      </div>
      <div className="panel">
        {!data.projects.length && <Empty title="No projects yet">You will see a project here once you are assigned to part of it.</Empty>}
        {data.projects.map((p) => (
          <Link key={p.id} to={`/projects/${p.id}`} className="vcard">
            <div>
              <div className="vn">{p.name}</div>
              <div className="tiny muted">
                {p.company_name}. {p.my_open_features} open feature{p.my_open_features === 1 ? '' : 's'} for you. Ends {fmtDate(p.end_date)}.
              </div>
            </div>
            {p.progress_pct != null ? <PlanLine done={p.progress_pct} thin /> : <span />}
            <span />
          </Link>
        ))}
      </div>
    </>
  );
}
