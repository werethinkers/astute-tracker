import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, Loading, ErrorBox, Status, Size, fmtDate, Empty, PlanLine, fmtWhen } from '../ui.jsx';
import { ProposeModal } from './workActions.jsx';
import { FeatureForm } from './adminForms.jsx';
import { useAuth } from '../auth.jsx';

export default function MyWork() {
  const { data, loading, error, reload } = useApi('/me/work');
  const { user } = useAuth();
  const [propose, setPropose] = useState(null);
  const [addTo, setAddTo] = useState(null);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const byProject = new Map();
  for (const f of data.open) {
    if (!byProject.has(f.project_id)) byProject.set(f.project_id, { name: f.project_name, company: f.company_name, items: [] });
    byProject.get(f.project_id).items.push(f);
  }
  return (
    <>
      <div className="head">
        <div>
          <h1>My work</h1>
          <div className="sub">
            {data.open.length} open feature{data.open.length === 1 ? '' : 's'}, {data.submitted.length} in review.
          </div>
        </div>
      </div>

      <div className="grid2">
        <div className="stack">
          {!data.open.length && (
            <div className="panel">
              <Empty title="Nothing open">
                Work you are put on appears here. To start something of your own, open <Link to="/projects">Projects</Link> and add a module.
              </Empty>
            </div>
          )}
          {[...byProject.entries()].map(([pid, p]) => (
            <div className="panel" key={pid}>
              <div className="ph">
                <div>
                  <h3>
                    <Link to={`/projects/${pid}`} style={{ textDecoration: 'none' }}>
                      {p.name}
                    </Link>
                  </h3>
                  <div className="tiny muted">{p.company}</div>
                </div>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>Feature</th>
                    <th>Status</th>
                    <th>Planned finish</th>
                  </tr>
                </thead>
                <tbody>
                  {p.items.map((f) => (
                    <tr key={f.id}>
                      <td>
                        <div className="gap8">
                          <Size s={f.size} />
                          <Link to={`/items/${f.id}`} style={{ fontWeight: 600 }}>
                            {f.name}
                          </Link>
                        </div>
                        <div className="tiny muted" style={{ marginLeft: 30 }}>
                          {f.module_name}
                          {f.requires_proof ? ', needs proof' : ''}
                        </div>
                      </td>
                      <td>
                        <Status s={f.status} sentBack={f.sent_back} />
                      </td>
                      <td className="nowrap">{fmtDate(f.planned_end)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        <div className="stack">
          <div className="panel">
            <div className="ph">
              <h3>My modules</h3>
            </div>
            {!data.modules.length && <Empty title="No modules">You are assigned to individual features only.</Empty>}
            <div className="divide">
              {data.modules.map((m) => (
                <div key={m.id} className="pb">
                  <div className="gap8" style={{ justifyContent: 'space-between' }}>
                    <div>
                      <Link to={`/items/${m.id}`} style={{ fontWeight: 600 }}>
                        {m.name}
                      </Link>
                      <div className="tiny muted">
                        {m.project_name}. Due {fmtDate(m.end_date)}
                      </div>
                    </div>
                    {!['done', 'cancelled', 'on_hold'].includes(m.status) &&
                      (m.can_manage ? (
                        <button className="btn sm" onClick={() => setAddTo(m)}>
                          Add feature
                        </button>
                      ) : (
                        <button className="btn sm" onClick={() => setPropose(m)}>
                          Suggest a feature
                        </button>
                      ))}
                  </div>
                  <div className="mt8">
                    <PlanLine done={m.progress_pct} thin />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {data.submitted.length > 0 && (
            <div className="panel">
              <div className="ph">
                <h3>Waiting for review</h3>
              </div>
              <div className="divide">
                {data.submitted.map((f) => (
                  <div key={f.id} className="pb">
                    <Link to={`/items/${f.id}`} style={{ fontWeight: 600 }}>
                      {f.name}
                    </Link>
                    <div className="tiny muted">
                      {f.project_name} / {f.module_name}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.done.length > 0 && (
            <div className="panel">
              <div className="ph">
                <h3>Recently approved</h3>
              </div>
              <div className="divide">
                {data.done.map((f) => (
                  <div key={f.id} className="pb small">
                    <Link to={`/items/${f.id}`}>{f.name}</Link> <span className="muted">in {f.project_name}, {fmtWhen(f.completed_at)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      {propose && <ProposeModal module={propose} onClose={() => setPropose(null)} onDone={reload} />}
      {addTo && <FeatureForm module={addTo} me={user} onClose={() => setAddTo(null)} onDone={reload} />}
    </>
  );
}
