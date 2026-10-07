import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi, Loading, ErrorBox, fmtWhen, Empty } from '../ui.jsx';

export default function Notifications() {
  const { refresh } = useAuth();
  const { data, loading, error } = useApi('/notifications');
  useEffect(() => {
    if (data?.notifications?.some((n) => !n.read_at)) api.post('/notifications/read').then(refresh).catch(() => {});
  }, [data, refresh]);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  return (
    <>
      <div className="head">
        <div>
          <h1>Notifications</h1>
        </div>
      </div>
      <div className="panel">
        {!data.notifications.length && <Empty title="You're all caught up">Assignments, reviews and comments show up here.</Empty>}
        <div className="divide">
          {data.notifications.map((n) => (
            <div key={n.id} className="pb" style={{ background: n.read_at ? undefined : 'var(--amber-tint)' }}>
              <div className="gap8" style={{ justifyContent: 'space-between' }}>
                {n.link ? (
                  <Link to={n.link} style={{ fontWeight: 600 }}>
                    {n.title}
                  </Link>
                ) : (
                  <strong>{n.title}</strong>
                )}
                <span className="tiny muted">{fmtWhen(n.created_at)}</span>
              </div>
              {n.body && <div className="small muted">{n.body}</div>}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
