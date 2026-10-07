import { Link } from 'react-router-dom';
import { useApi, Loading, ErrorBox, Empty } from '../../ui.jsx';

const dFmt = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
const level = (n) => (n >= 4 ? 4 : n);

export default function Workload() {
  const { data, loading, error } = useApi('/admin/workload?days=10');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  return (
    <>
      <div className="head">
        <div>
          <h1>Workload</h1>
          <div className="sub">Features each person has planned on each of the next 10 working days. A red dot means something is due that day.</div>
        </div>
      </div>
      <div className="panel scroll-x">
        <div className="pb">
          {!data.people.length ? (
            <Empty title="No team members yet" />
          ) : (
            <table className="heat">
              <thead>
                <tr>
                  <th className="name" />
                  {data.days.map((d) => (
                    <th key={d}>{dFmt.format(new Date(d + 'T00:00:00Z'))}</th>
                  ))}
                  <th>Overdue</th>
                </tr>
              </thead>
              <tbody>
                {data.people.map((p) => (
                  <tr key={p.id}>
                    <th className="name">
                      <Link to={`/people/${p.id}`}>{p.name}</Link>
                    </th>
                    {p.cells.map((c, i) => (
                      <td key={i} className={`c l${level(c.active)}`} title={c.names.length ? `${c.names.join('\n')}${c.due ? `\n${c.due} due this day` : ''}` : 'Nothing planned'}>
                        {c.active || ''}
                        {c.due > 0 && <span className="due" />}
                      </td>
                    ))}
                    <td className="c" style={{ color: p.overdue ? 'var(--red)' : 'var(--faint)', fontWeight: 700 }}>
                      {p.overdue || '0'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="legend mt16">
            <span>Darker cells mean more features in progress at once. Four or more is shown in black.</span>
          </div>
        </div>
      </div>
    </>
  );
}
