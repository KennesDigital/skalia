'use strict';

// ── Tab navigation ────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tabName = btn.dataset.tab;
    ['tables','diagram','estimate'].forEach(name => {
      const pane = document.getElementById('tab-' + name);
      pane.style.display = name === tabName ? '' : 'none';
      if (name === tabName) pane.classList.add('active');
      else pane.classList.remove('active');
    });
    if (tabName === 'diagram') renderDiagram();
  });
});

// ── Project loading ───────────────────────────────────────────────────────────
async function selectProject(id) {
  try {
    const project = await apiGet(`/api/projects/${id}`);
    state.current = project;
    renderSidebar();
    renderProjectView();
    // Reset to first tab
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === 'tables');
    });
    ['tables','diagram','estimate'].forEach(name => {
      const p = document.getElementById('tab-' + name);
      p.style.display = name === 'tables' ? '' : 'none';
    });
    diag.zoom = 1; diag.panX = 40; diag.panY = 40;
  } catch (e) {
    showToast('Fehler beim Laden: ' + e.message, 'error');
  }
}

// ── Keyboard ──────────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  try {
    state.projects = await apiGet('/api/projects');
    renderSidebar();
  } catch (e) {
    showToast('Server nicht erreichbar: ' + e.message, 'error');
  }
}

init();
