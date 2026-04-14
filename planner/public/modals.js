'use strict';

// ── Modal helpers ─────────────────────────────────────────────────────────────
function showModal(id) {
  document.getElementById('modal-overlay').style.display = 'flex';
  document.getElementById(id).style.display = 'flex';
  document.getElementById(id).style.flexDirection = 'column';
}
function closeModal() {
  document.getElementById('modal-overlay').style.display = 'none';
  ['modal-project','modal-table','modal-field','modal-confirm'].forEach(id => {
    document.getElementById(id).style.display = 'none';
  });
  state.modal = { type: null, editId: null, tableId: null, confirmCb: null };
  state.choices = [];
}
function overlayClick(e) {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
}

// ── Project Modal ─────────────────────────────────────────────────────────────
function openProjectModal(edit = false) {
  const p = edit ? state.current : null;
  state.modal.type = 'project';
  state.modal.editId = p ? p.id : null;
  document.getElementById('modal-project-title').textContent = p ? 'Projekt bearbeiten' : 'Neues Projekt';
  document.getElementById('fp-name').value = p ? p.name : '';
  document.getElementById('fp-client').value = p ? (p.client || '') : '';
  document.getElementById('fp-desc').value = p ? (p.description || '') : '';
  document.getElementById('fp-name-err').textContent = '';
  document.getElementById('fp-name').classList.remove('invalid');
  showModal('modal-project');
  setTimeout(() => document.getElementById('fp-name').focus(), 50);
}

async function saveProject() {
  const name = document.getElementById('fp-name').value.trim();
  if (!name) {
    document.getElementById('fp-name').classList.add('invalid');
    document.getElementById('fp-name-err').textContent = 'Name ist erforderlich.';
    return;
  }
  const body = {
    name,
    client: document.getElementById('fp-client').value.trim(),
    description: document.getElementById('fp-desc').value.trim(),
  };
  try {
    if (state.modal.editId) {
      Object.assign(state.current, body);
      await saveCurrentProject();
      renderProjectView();
      showToast('Projekt gespeichert.', 'success');
    } else {
      const created = await apiPost('/api/projects', body);
      const summary = { ...created, tableCount: 0, fieldCount: 0 };
      state.projects.unshift(summary);
      renderSidebar();
      await selectProject(created.id);
      showToast('Projekt erstellt.', 'success');
    }
    closeModal();
  } catch (e) {
    showToast('Fehler: ' + e.message, 'error');
  }
}

function confirmDeleteProject() {
  openConfirmModal(
    'Projekt löschen',
    `Projekt &ldquo;<strong>${esc(state.current.name)}</strong>&rdquo; und alle Tabellen wirklich löschen?`,
    async () => {
      try {
        await apiDelete(`/api/projects/${state.current.id}`);
        state.projects = state.projects.filter(p => p.id !== state.current.id);
        state.current = null;
        renderSidebar();
        document.getElementById('project-view').style.display = 'none';
        document.getElementById('empty-state').style.display = '';
        showToast('Projekt gelöscht.', 'success');
      } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
    }
  );
}

// ── Table Modal ───────────────────────────────────────────────────────────────
function openTableModal(tableId = null) {
  const t = tableId ? state.current.tables.find(x => x.id === tableId) : null;
  state.modal.type = 'table';
  state.modal.editId = tableId;
  document.getElementById('modal-table-title').textContent = t ? 'Tabelle bearbeiten' : 'Neue Tabelle';
  document.getElementById('ft-name').value = t ? t.name : '';
  document.getElementById('ft-name-err').textContent = '';
  document.getElementById('ft-name').classList.remove('invalid');
  document.getElementById('ft-desc').value = t ? (t.description || '') : '';

  // Render color swatches
  const selectedColor = t ? t.color : TABLE_COLORS[0];
  document.getElementById('ft-color').value = selectedColor;
  const wrap = document.getElementById('ft-colors');
  wrap.innerHTML = TABLE_COLORS.map(c => `
    <div class="color-swatch ${c === selectedColor ? 'selected' : ''}"
         style="background:${c}" title="${c}"
         onclick="selectColor('${c}')"></div>`).join('');

  showModal('modal-table');
  setTimeout(() => document.getElementById('ft-name').focus(), 50);
}

function selectColor(c) {
  document.getElementById('ft-color').value = c;
  document.querySelectorAll('.color-swatch').forEach(el => {
    el.classList.toggle('selected', el.title === c);
  });
}

async function saveTable() {
  const name = document.getElementById('ft-name').value.trim();
  if (!name) {
    document.getElementById('ft-name').classList.add('invalid');
    document.getElementById('ft-name-err').textContent = 'Name ist erforderlich.';
    return;
  }
  const data = {
    name,
    color: document.getElementById('ft-color').value || TABLE_COLORS[0],
    description: document.getElementById('ft-desc').value.trim(),
  };
  if (state.modal.editId) {
    const t = state.current.tables.find(x => x.id === state.modal.editId);
    Object.assign(t, data);
  } else {
    state.current.tables.push({ id: uid(), fields: [], ...data });
  }
  await saveCurrentProject();
  renderTablesTab();
  renderDiagram();
  renderEstimateTab();
  closeModal();
  showToast('Tabelle gespeichert.', 'success');
}

function confirmDeleteTable(tableId) {
  const t = state.current.tables.find(x => x.id === tableId);
  openConfirmModal('Tabelle löschen',
    `Tabelle &ldquo;<strong>${esc(t.name)}</strong>&rdquo; und alle ${t.fields.length} Felder wirklich löschen?`,
    async () => {
      state.current.tables = state.current.tables.filter(x => x.id !== tableId);
      await saveCurrentProject();
      renderTablesTab();
      renderDiagram();
      renderEstimateTab();
      showToast('Tabelle gelöscht.', 'success');
    }
  );
}

// ── Field Modal ───────────────────────────────────────────────────────────────
function openFieldModal(tableId, fieldId = null) {
  const f = fieldId
    ? state.current.tables.find(t => t.id === tableId).fields.find(x => x.id === fieldId)
    : null;
  state.modal.type = 'field';
  state.modal.editId = fieldId;
  state.modal.tableId = tableId;
  state.choices = f ? [...(f.choices || [])] : [];

  document.getElementById('modal-field-title').textContent = f ? 'Feld bearbeiten' : 'Neues Feld';
  document.getElementById('ff-name').value = f ? f.name : '';
  document.getElementById('ff-name-err').textContent = '';
  document.getElementById('ff-name').classList.remove('invalid');
  document.getElementById('ff-required').checked = f ? !!f.required : false;
  document.getElementById('ff-desc').value = f ? (f.description || '') : '';
  document.getElementById('ff-default').value = f ? (f.defaultValue || '') : '';
  document.getElementById('ff-formula').value = f ? (f.formula || '') : '';
  document.getElementById('ff-condition').value = f ? (f.displayCondition || '') : '';
  document.getElementById('ff-trigger').value = f ? (f.triggerOnChange || '') : '';

  // Populate type dropdown
  const sel = document.getElementById('ff-type');
  sel.innerHTML = FIELD_TYPES.map(t =>
    `<option value="${t.value}" ${f && f.type === t.value ? 'selected' : ''}>${t.label}</option>`
  ).join('');

  // Populate reference table dropdown
  const refSel = document.getElementById('ff-ref-table');
  const otherTables = state.current.tables.filter(t => t.id !== tableId);
  refSel.innerHTML = '<option value="">-- Tabelle wählen --</option>' +
    otherTables.map(t => `<option value="${t.id}" ${f && f.referenceTable === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('');

  renderChoiceTags();
  onFieldTypeChange();
  showModal('modal-field');
  setTimeout(() => document.getElementById('ff-name').focus(), 50);
}

function onFieldTypeChange() {
  const type = document.getElementById('ff-type').value;
  document.getElementById('ff-choices-wrap').style.display = SHOW_CHOICES.has(type) ? '' : 'none';
  document.getElementById('ff-ref-wrap').style.display = type === 'reference' ? '' : 'none';
  document.getElementById('ff-formula-wrap').style.display = SHOW_FORMULA.has(type) ? '' : 'none';
  document.getElementById('ff-default-wrap').style.display = HIDE_DEFAULT.has(type) ? 'none' : '';
}

function addChoiceOnEnter(e) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const input = document.getElementById('ff-choice-input');
  const val = input.value.trim();
  if (val && !state.choices.includes(val)) {
    state.choices.push(val);
    renderChoiceTags();
  }
  input.value = '';
}

function removeChoice(val) {
  state.choices = state.choices.filter(c => c !== val);
  renderChoiceTags();
}

function renderChoiceTags() {
  document.getElementById('ff-choice-tags').innerHTML = state.choices.map(c =>
    `<span class="tag">${esc(c)}<span class="tag-remove" onclick="removeChoice('${esc(c)}')">✕</span></span>`
  ).join('');
}

async function saveField() {
  const name = document.getElementById('ff-name').value.trim();
  if (!name) {
    document.getElementById('ff-name').classList.add('invalid');
    document.getElementById('ff-name-err').textContent = 'Feldname ist erforderlich.';
    return;
  }
  const type = document.getElementById('ff-type').value;
  const refTable = document.getElementById('ff-ref-table').value;
  if (type === 'reference' && !refTable) {
    showToast('Bitte eine Ziel-Tabelle wählen.', 'error'); return;
  }
  const fieldData = {
    name, type,
    required: document.getElementById('ff-required').checked,
    description: document.getElementById('ff-desc').value.trim(),
    defaultValue: document.getElementById('ff-default').value.trim(),
    choices: [...state.choices],
    referenceTable: type === 'reference' ? refTable : null,
    formula: document.getElementById('ff-formula').value.trim(),
    displayCondition: document.getElementById('ff-condition').value.trim(),
    triggerOnChange: document.getElementById('ff-trigger').value.trim(),
  };
  const table = state.current.tables.find(t => t.id === state.modal.tableId);
  if (state.modal.editId) {
    const idx = table.fields.findIndex(f => f.id === state.modal.editId);
    table.fields[idx] = { ...table.fields[idx], ...fieldData };
  } else {
    table.fields.push({ id: uid(), ...fieldData });
  }
  await saveCurrentProject();
  renderTablesTab();
  renderDiagram();
  renderEstimateTab();
  closeModal();
  showToast('Feld gespeichert.', 'success');
}

function confirmDeleteField(tableId, fieldId) {
  const t = state.current.tables.find(x => x.id === tableId);
  const f = t.fields.find(x => x.id === fieldId);
  openConfirmModal('Feld löschen',
    `Feld &ldquo;<strong>${esc(f.name)}</strong>&rdquo; wirklich löschen?`,
    async () => {
      t.fields = t.fields.filter(x => x.id !== fieldId);
      await saveCurrentProject();
      renderTablesTab();
      renderDiagram();
      renderEstimateTab();
      showToast('Feld gelöscht.', 'success');
    }
  );
}

// ── Confirm Modal ─────────────────────────────────────────────────────────────
function openConfirmModal(title, msg, cb) {
  document.getElementById('modal-confirm-title').textContent = title;
  document.getElementById('modal-confirm-msg').innerHTML = msg;
  state.modal.confirmCb = cb;
  const btn = document.getElementById('modal-confirm-btn');
  btn.onclick = async () => { closeModal(); await cb(); };
  showModal('modal-confirm');
}
