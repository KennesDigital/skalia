'use strict';

// ── Sidebar ───────────────────────────────────────────────────────────────────
function renderSidebar() {
  const el = document.getElementById('project-list');
  if (!state.projects.length) {
    el.innerHTML = '<div class="empty-list">Noch keine Projekte</div>';
    return;
  }
  el.innerHTML = state.projects.map(p => `
    <div class="project-item ${state.current && state.current.id === p.id ? 'active' : ''}"
         onclick="selectProject('${p.id}')">
      <div class="pi-name">${esc(p.name)}</div>
      <div class="pi-meta">
        ${p.client ? `<span>${esc(p.client)}</span> &middot; ` : ''}
        <span>${fmtDate(p.updatedAt)}</span>
        <span class="pi-badge">${p.tableCount} Tab.</span>
      </div>
    </div>`).join('');
}

// ── Project view ──────────────────────────────────────────────────────────────
function renderProjectView() {
  const p = state.current;
  if (!p) return;
  document.getElementById('ph-name').textContent = p.name;
  const cb = document.getElementById('ph-client');
  cb.textContent = p.client || '';
  cb.style.display = p.client ? '' : 'none';
  document.getElementById('empty-state').style.display = 'none';
  document.getElementById('project-view').style.display = 'flex';
  document.getElementById('project-view').style.flexDirection = 'column';
  document.getElementById('project-view').style.height = '100%';
  renderTablesTab();
  renderEstimateTab();
}

// ── Tables Tab ────────────────────────────────────────────────────────────────
function renderTablesTab() {
  const p = state.current;
  if (!p) return;
  const el = document.getElementById('tab-tables');
  const toolbar = `
    <div class="tables-toolbar">
      <h2>${p.tables.length} Tabelle${p.tables.length !== 1 ? 'n' : ''}</h2>
      <button class="btn-primary" onclick="openTableModal()">+ Tabelle hinzufügen</button>
    </div>`;
  if (!p.tables.length) {
    el.innerHTML = toolbar + `<div class="tables-empty">
      Noch keine Tabellen.<br>Klicke auf &ldquo;Tabelle hinzufügen&rdquo;.
    </div>`;
    return;
  }
  const cards = p.tables.map(t => renderTableCard(t)).join('');
  el.innerHTML = toolbar + `<div class="tables-grid">${cards}</div>`;
}

function renderTableCard(t) {
  const fields = (t.fields || []).map(f => renderFieldRow(t.id, f)).join('');
  return `
    <div class="table-card" id="tc-${t.id}">
      <div class="table-card-header" style="background:${t.color}">
        <span class="tc-name">${esc(t.name)}</span>
        <div class="tc-actions">
          <button class="btn-icon" title="Bearbeiten" onclick="openTableModal('${t.id}')">✎</button>
          <button class="btn-icon btn-danger" title="Löschen" onclick="confirmDeleteTable('${t.id}')">✕</button>
        </div>
      </div>
      <div class="table-fields">${fields || '<div style="padding:10px 14px;font-size:12px;color:var(--muted)">Noch keine Felder</div>'}</div>
      <div class="table-card-footer">
        <button class="btn-add-field" onclick="openFieldModal('${t.id}')">+ Feld hinzufügen</button>
      </div>
    </div>`;
}

function renderFieldRow(tableId, f) {
  const ft = FIELD_TYPE_MAP[f.type] || { badge: '?', color: '#999' };
  const refTable = f.type === 'reference' && f.referenceTable
    ? state.current.tables.find(t => t.id === f.referenceTable)
    : null;
  return `
    <div class="field-row">
      <span class="field-badge" style="background:${ft.color}">${ft.badge}</span>
      <span class="field-name" title="${esc(f.name)}">${esc(f.name)}</span>
      ${refTable ? `<span class="field-ref-hint">→ ${esc(refTable.name)}</span>` : ''}
      ${f.required ? '<span class="field-required-dot" title="Pflichtfeld"></span>' : ''}
      <div class="field-actions">
        <button class="btn-icon" title="Bearbeiten" onclick="openFieldModal('${tableId}','${f.id}')">✎</button>
        <button class="btn-icon btn-danger" title="Löschen" onclick="confirmDeleteField('${tableId}','${f.id}')">✕</button>
      </div>
    </div>`;
}

// ── Estimate Tab ──────────────────────────────────────────────────────────────
function renderEstimateTab() {
  const p = state.current;
  if (!p) return;
  const est = calcEstimate(p);
  const el = document.getElementById('tab-estimate');

  const cxLabel = est.complexity === 'high' ? 'Komplex'
    : est.complexity === 'medium' ? 'Mittel' : 'Einfach';
  const cxClass = `complexity-${est.complexity}`;

  const rows = p.tables.map(t => {
    const te = calcTableEstimate(t);
    return `<tr>
      <td>${esc(t.name)}</td>
      <td>${t.fields.length}</td>
      <td>${t.fields.filter(f => f.triggerOnChange && f.triggerOnChange.trim()).length}</td>
      <td>${t.fields.filter(f => f.displayCondition && f.displayCondition.trim()).length}</td>
      <td><strong>${te.toFixed(1)} Std.</strong></td>
    </tr>`;
  }).join('');

  el.innerHTML = `
    <div class="estimate-grid">
      <div class="stat-card"><div class="stat-val">${p.tables.length}</div><div class="stat-lbl">Tabellen</div></div>
      <div class="stat-card"><div class="stat-val">${est.totalFields}</div><div class="stat-lbl">Felder gesamt</div></div>
      <div class="stat-card"><div class="stat-val">${est.refCount}</div><div class="stat-lbl">Verknüpfungen</div></div>
      <div class="stat-card"><div class="stat-val">${est.triggerCount}</div><div class="stat-lbl">Trigger</div></div>
    </div>
    <div class="estimate-main">
      <div>
        <div class="estimate-hours">ca. ${est.minH}–${est.maxH} Std.</div>
        <div class="estimate-label">Geschätzter Aufwand (inkl. ${Math.round((TIME.buffer-1)*100)}% Puffer)</div>
      </div>
      <div>
        <span class="complexity-badge ${cxClass}">${cxLabel}</span>
        <div style="font-size:12px;color:var(--muted);margin-top:6px">${est.baseH.toFixed(1)} Basisstunden</div>
      </div>
    </div>
    ${p.tables.length ? `
    <div class="estimate-detail">
      <table>
        <thead><tr>
          <th>Tabelle</th><th>Felder</th><th>Trigger</th><th>Bedingungen</th><th>Aufwand</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr class="total-row">
            <td colspan="4">Gesamt (mit Puffer &amp; Komplexität)</td>
            <td>${est.minH}–${est.maxH} Std.</td>
          </tr>
        </tfoot>
      </table>
    </div>` : ''}`;
}

function calcTableEstimate(t) {
  let h = TIME.perTable;
  for (const f of t.fields) {
    h += TIME.field[f.type] || .2;
    if (f.triggerOnChange && f.triggerOnChange.trim()) h += TIME.trigger;
    if (f.displayCondition && f.displayCondition.trim()) h += TIME.condition;
  }
  return h;
}

function calcEstimate(p) {
  const allFields = p.tables.flatMap(t => t.fields);
  const totalFields = allFields.length;
  const refCount = allFields.filter(f => f.type === 'reference').length;
  const triggerCount = allFields.filter(f => f.triggerOnChange && f.triggerOnChange.trim()).length;

  let baseH = TIME.setup;
  for (const t of p.tables) baseH += calcTableEstimate(t);

  const cx = (p.tables.length > 20 || totalFields > 100 || triggerCount > 20) ? 'high'
    : (p.tables.length > 10 || totalFields > 50 || triggerCount > 10) ? 'medium' : 'low';
  const cxMult = cx === 'high' ? 1.4 : cx === 'medium' ? 1.2 : 1.0;

  const final = baseH * TIME.buffer * cxMult;
  const minH = Math.ceil(final * 0.85);
  const maxH = Math.ceil(final * 1.15);

  return { baseH, minH, maxH, totalFields, refCount, triggerCount, complexity: cx };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (type ? ' ' + type : '');
  t.classList.add('show');
  clearTimeout(t._tid);
  t._tid = setTimeout(() => t.classList.remove('show'), 3000);
}
