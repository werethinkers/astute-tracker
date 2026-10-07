import { useState } from 'react';
import { useApi, Loading, ErrorBox } from '../../ui.jsx';
import FlagList from './FlagList.jsx';

export default function Flags() {
  const [cleared, setCleared] = useState(false);
  const [type, setType] = useState('');
  const { data, loading, error, reload } = useApi(`/admin/flags${cleared ? '?cleared=1' : ''}`);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const types = [...new Set(data.flags.map((f) => f.flag_type))];
  const list = data.flags.filter((f) => !type || f.flag_type === type);
  return (
    <>
      <div className="head">
        <div>
          <h1>Flags</h1>
          <div className="sub">Raised automatically when work lags. Only admins see these. They clear themselves when the cause is fixed.</div>
        </div>
        <div className="actions">
          <div className="seg">
            <button className={!cleared ? 'on' : ''} onClick={() => setCleared(false)}>
              Open
            </button>
            <button className={cleared ? 'on' : ''} onClick={() => setCleared(true)}>
              Cleared
            </button>
          </div>
          <select className="input" style={{ width: 'auto' }} value={type} onChange={(e) => setType(e.target.value)} aria-label="Flag type">
            <option value="">All types</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {t.replace('_', ' ')}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="panel">
        <FlagList flags={list} onChange={reload} cleared={cleared} />
      </div>
    </>
  );
}
