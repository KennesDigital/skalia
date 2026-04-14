'use strict';

async function apiGet(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
  return r.json();
}

async function apiPost(path, body) {
  const r = await fetch(path, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
  return r.json();
}

async function apiPut(path, body) {
  const r = await fetch(path, { method: 'PUT',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
  return r.json();
}

async function apiDelete(path) {
  const r = await fetch(path, { method: 'DELETE' });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
  return r.json();
}

// Save entire current project to backend
async function saveCurrentProject() {
  if (!state.current) return;
  try {
    const updated = await apiPut(`/api/projects/${state.current.id}`, state.current);
    state.current = updated;
    // Update summary in list
    const idx = state.projects.findIndex(p => p.id === updated.id);
    if (idx !== -1) {
      state.projects[idx] = {
        id: updated.id, name: updated.name, client: updated.client,
        description: updated.description, updatedAt: updated.updatedAt,
        tableCount: updated.tables.length,
        fieldCount: updated.tables.reduce((s, t) => s + t.fields.length, 0),
      };
    }
    renderSidebar();
  } catch (e) {
    showToast('Fehler beim Speichern: ' + e.message, 'error');
  }
}
