const j = async (res) => {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
};
export const analyze = (body) =>
  fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(j);
export const getHistory = (url) => fetch(`/api/reports/history?url=${encodeURIComponent(url)}`).then(j);
export const getRecent = () => fetch('/api/reports?limit=8').then(j);
export const getReport = (id) => fetch(`/api/reports/${id}`).then(j);
export const deleteReport = (id) => fetch(`/api/reports/${id}`, { method: 'DELETE' }).then(j);
