import { useEffect, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell, LineChart, Line } from 'recharts';
import { analyze, getHistory, getRecent, getReport, deleteReport } from './api';

const NAVY = '#0d1b3e', ORANGE = '#ff5421';
const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(2)} MB` : `${Math.round(n / 1024)} KB`);
const ms = (n) => (n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${Math.round(n)} ms`);
const tone = (s) => (s >= 90 ? 'good' : s >= 50 ? 'ok' : 'bad');
const CAT_LABELS = { speed: 'Speed', weight: 'Page weight', requests: 'Requests', compression: 'Compression', caching: 'Caching', practices: 'Best practices' };
const TABS = ['Overview', 'Resources', 'Fixes', 'History'];
const short = (u) => { try { const x = new URL(u); return (x.pathname.split('/').pop() || x.hostname).slice(0, 28) + (x.hostname !== location.hostname ? '' : ''); } catch { return u.slice(0, 28); } };

function Ring({ score, grade }) {
  const r = 54, c = 2 * Math.PI * r;
  return (
    <div className={`ring ${tone(score)}`} role="img" aria-label={`Score ${score} out of 100, grade ${grade}`}>
      <svg viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={r} className="ring-bg" />
        <circle cx="60" cy="60" r={r} className="ring-fg" strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} transform="rotate(-90 60 60)" />
      </svg>
      <div className="ring-in"><b>{score}</b><span>Grade {grade}</span></div>
    </div>
  );
}

function Vital({ label, value, good, poor, fmt }) {
  if (value == null) return null;
  const t = value <= good ? 'good' : value <= poor ? 'ok' : 'bad';
  return <div className={`vital ${t}`}><span>{label}</span><b>{fmt(value)}</b></div>;
}

export default function App() {
  const [url, setUrl] = useState('');
  const [strategy, setStrategy] = useState('mobile');
  const [usePsi, setUsePsi] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState(null);
  const [tab, setTab] = useState('Overview');
  const [history, setHistory] = useState([]);
  const [recent, setRecent] = useState([]);

  const loadExtras = async (u) => {
    try { const [h, r] = await Promise.all([getHistory(u), getRecent()]); setHistory(h); setRecent(r); } catch { /* optional */ }
  };
  useEffect(() => { getRecent().then(setRecent).catch(() => {}); }, []);

  const run = async (e) => {
    e?.preventDefault();
    if (!url.trim() || busy) return;
    setBusy(true); setError('');
    try {
      const r = await analyze({ url, strategy, usePsi });
      setReport(r); setTab('Overview'); await loadExtras(r.url);
    } catch (err) { setError(err.message); }
    setBusy(false);
  };
  const open = async (id) => {
    try { const r = await getReport(id); setReport(r); setUrl(r.url); setTab('Overview'); loadExtras(r.url); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    catch (err) { setError(err.message); }
  };
  const remove = async (id) => { await deleteReport(id); if (report?._id === id) setReport(null); setRecent(await getRecent()); };

  const m = report?.metrics;
  const typeData = m ? Object.entries(m.byType).map(([name, bytes]) => ({ name, kb: Math.round(bytes / 1024) })).sort((a, b) => b.kb - a.kb) : [];
  const slowest = report ? [...report.resources].filter((r) => !r.error).sort((a, b) => b.ms - a.ms).slice(0, 8).map((r) => ({ name: short(r.url), ms: r.ms })) : [];
  const trend = history.map((h) => ({ date: new Date(h.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' }), score: h.score }));
  return (
    <>
      <header className="top">
        <h1>Speed<span>Scope</span></h1>
        <p>Website performance analyzer</p>
      </header>
      <section className="hero">
        <h2>How fast is your website, really?</h2>
        <p>Paste a URL. Get a score, the numbers behind it, and a list of fixes.</p>
        <form className="bar" onSubmit={run}>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="example.com" aria-label="Website URL" inputMode="url" />
          <button className="btn pri" disabled={busy}>{busy ? 'Analyzing…' : 'Analyze'}</button>
        </form>
        <div className="opts">
          <label><input type="checkbox" checked={usePsi} onChange={(e) => setUsePsi(e.target.checked)} /> Include Google PageSpeed (Core Web Vitals, slower)</label>
          {usePsi && (
            <select value={strategy} onChange={(e) => setStrategy(e.target.value)} aria-label="Device">
              <option value="mobile">Mobile</option><option value="desktop">Desktop</option>
            </select>
          )}
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        {busy && <div className="note">Fetching the page and its assets{usePsi ? ' and running PageSpeed' : ''}. This takes 5-30 seconds.</div>}
      </section>

      <main className="page">
        {!report && recent.length === 0 && <p className="empty">No analyses yet. Try your own site above.</p>}

        {report && (
          <div className="layout">
            <aside className="card side">
              <Ring score={report.score} grade={report.grade} />
              <h3 className="host">{report.host}</h3>
              <p className="muted">{new Date(report.createdAt).toLocaleString()}</p>
              <ul className="cats">
                {Object.entries(report.categories).map(([k, v]) => (
                  <li key={k}>
                    <span>{CAT_LABELS[k]}</span>
                    <div className="track"><i className={tone(v)} style={{ width: `${v}%` }} /></div>
                    <b>{v}</b>
                  </li>
                ))}
              </ul>
            </aside>

            <section className="content">
              <div className="tabs" role="tablist">
                {TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}{t === 'Fixes' ? ` (${report.findings.length})` : ''}</button>)}
              </div>

              {tab === 'Overview' && (
                <>
                  <div className="tiles">
                    <div className="card tile"><span>Server response (TTFB)</span><b className={m.ttfbMs <= 600 ? 'good' : m.ttfbMs <= 1800 ? 'ok' : 'bad'}>{ms(m.ttfbMs)}</b></div>
                    <div className="card tile"><span>Total load time</span><b>{ms(m.loadMs)}</b></div>
                    <div className="card tile"><span>Page weight</span><b>{kb(m.weightBytes)}</b></div>
                    <div className="card tile"><span>Requests</span><b>{m.requests}</b></div>
                  </div>

                  {report.psi && (
                    <div className="card">
                      <h3>Core Web Vitals (Google PageSpeed, {report.psi.strategy})</h3>
                      {report.psi.error ? <p className="error">{report.psi.error}</p> : (
                        <div className="vitals">
                          <div className={`vital ${tone(report.psi.score)}`}><span>Lighthouse score</span><b>{report.psi.score}</b></div>
                          <Vital label="LCP" value={report.psi.lcp} good={2500} poor={4000} fmt={ms} />
                          <Vital label="FCP" value={report.psi.fcp} good={1800} poor={3000} fmt={ms} />
                          <Vital label="TBT" value={report.psi.tbt} good={200} poor={600} fmt={ms} />
                          <Vital label="CLS" value={report.psi.cls} good={0.1} poor={0.25} fmt={(v) => v.toFixed(3)} />
                          <Vital label="Speed Index" value={report.psi.si} good={3400} poor={5800} fmt={ms} />
                        </div>
                      )}
                    </div>
                  )}

                  <div className="two">
                    <div className="card">
                      <h3>Weight by type (KB)</h3>
                      <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={typeData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e9ebf1" vertical={false} />
                          <XAxis dataKey="name" tick={{ fontSize: 12 }} /><YAxis tick={{ fontSize: 11 }} width={40} />
                          <Tooltip formatter={(v) => [`${v} KB`, 'Transfer']} />
                          <Bar dataKey="kb" fill={ORANGE} radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="card">
                      <h3>Quick facts</h3>
                      <ul className="facts">
                        <li><span>HTTPS</span><b className={m.https ? 'good' : 'bad'}>{m.https ? 'Yes' : 'No'}</b></li>
                        <li><span>Redirects</span><b>{m.redirects}</b></li>
                        <li><span>HTML size</span><b>{kb(m.htmlBytes)}</b></li>
                        <li><span>DOM elements</span><b>{m.domNodes}</b></li>
                        <li><span>Third-party requests</span><b>{m.thirdParty}</b></li>
                        <li><span>Failed assets</span><b className={m.failed ? 'bad' : ''}>{m.failed}</b></li>
                      </ul>
                    </div>
                  </div>
                </>
              )}

              {tab === 'Resources' && (
                <>
                  <div className="card">
                    <h3>Slowest assets (ms)</h3>
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={slowest} layout="vertical" margin={{ left: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e9ebf1" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(v) => [`${v} ms`, 'Time']} />
                        <Bar dataKey="ms" radius={[0, 4, 4, 0]}>{slowest.map((s, i) => <Cell key={i} fill={i === 0 ? ORANGE : NAVY} />)}</Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="card tw">
                    <table>
                      <thead><tr><th>Asset</th><th>Type</th><th>Size</th><th>Time</th><th>Gzip</th><th>Cached</th></tr></thead>
                      <tbody>
                        {[...report.resources].sort((a, b) => b.transfer - a.transfer).map((r) => (
                          <tr key={r.url} className={r.error ? 'rowbad' : ''}>
                            <td title={r.url}>{short(r.url)}{r.thirdParty && <em> 3rd</em>}</td>
                            <td>{r.type}</td>
                            <td>{r.error ? 'failed' : kb(r.transfer)}</td>
                            <td>{r.error ? '-' : ms(r.ms)}</td>
                            <td>{r.compressed ? 'Yes' : 'No'}</td>
                            <td>{r.cached ? 'Yes' : 'No'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {tab === 'Fixes' && (
                <ul className="fixes">
                  {report.findings.map((f) => (
                    <li key={f.id} className={`card ${f.severity}`}>
                      <span className={`sev ${f.severity}`}>{f.severity}</span>
                      <h3>{f.title}</h3>
                      <p>{f.detail}</p>
                    </li>
                  ))}
                </ul>
              )}

              {tab === 'History' && (
                <div className="card">
                  <h3>Score over time for this URL</h3>
                  {trend.length < 2 ? <p className="muted">Run the analysis again later (for example after a deploy) to see a trend.</p> : (
                    <ResponsiveContainer width="100%" height={240}>
                      <LineChart data={trend}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e9ebf1" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} /><YAxis domain={[0, 100]} tick={{ fontSize: 11 }} width={30} />
                        <Tooltip /><Line dataKey="score" stroke={ORANGE} strokeWidth={3} dot={{ r: 4 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              )}
            </section>
          </div>
        )}

        {recent.length > 0 && (
          <section className="card recent">
            <h3>Recent analyses</h3>
            <ul>
              {recent.map((r) => (
                <li key={r._id}>
                  <button className="link" onClick={() => open(r._id)}>{r.url.replace(/^https?:\/\//, '')}</button>
                  <span className={`pill ${tone(r.score)}`}>{r.score} · {r.grade}</span>
                  <small>{new Date(r.createdAt).toLocaleDateString()}</small>
                  <button className="x" onClick={() => remove(r._id)} aria-label={`Delete report for ${r.host}`}>Delete</button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
