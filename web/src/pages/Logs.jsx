import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { useApi, Loading, ErrorBox, fmtDate, Empty } from '../ui.jsx';

export default function Logs() {
  const { isAdmin } = useAuth();
  const { data, loading, error } = useApi('/me/logs');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const base = isAdmin ? '/today' : '/';
  return (
    <>
      <div className="head">
        <div>
          <h1>Log history</h1>
          <div className="sub">Your last 60 daily logs. Open a day to see or edit it while it is unlocked.</div>
        </div>
      </div>
      <div className="panel scroll-x">
        {!data.logs.length ? (
          <Empty title="No logs yet">Your first log appears here after you save it on the Today screen.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Day</th>
                <th>Status</th>
                <th className="r">Lines</th>
                <th className="r">Hours</th>
                <th>Blockers</th>
              </tr>
            </thead>
            <tbody>
              {data.logs.map((l) => (
                <tr key={l.id}>
                  <td className="nowrap">
                    <Link to={`${base}?date=${l.date}`}>{fmtDate(l.date)}</Link>
                  </td>
                  <td>{l.submitted_at ? 'Submitted' : 'Draft'}{l.locked ? ', locked' : ''}</td>
                  <td className="r">{l.lines}</td>
                  <td className="r num">{l.hours}</td>
                  <td className="small muted">{l.blockers || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
