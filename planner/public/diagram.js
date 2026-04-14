'use strict';

// ── ER Diagram ────────────────────────────────────────────────────────────────
const diag = {
  zoom: 1, panX: 40, panY: 40,
  dragging: null,   // { tableId, startX, startY, origX, origY }
  panning: false,
  panStart: null,
  saveTimer: null,
};

const TABLE_W = 220;
const ROW_H   = 24;
const HDR_H   = 36;

function renderDiagram() {
  const tab = document.getElementById('tab-diagram');
  const p = state.current;
  if (!p) { tab.innerHTML = '<div class="diagram-empty">Kein Projekt geladen.</div>'; return; }
  if (!p.tables.length) {
    tab.innerHTML = '<div class="diagram-empty">Noch keine Tabellen vorhanden.</div>'; return;
  }

  tab.innerHTML = `
    <div class="diagram-toolbar">
      <button onclick="diagAutoLayout()">Auto-Layout</button>
      <button onclick="diagZoom(1.2)">＋</button>
      <button onclick="diagZoom(0.8)">－</button>
      <button onclick="diagFit()">Fit</button>
      <button onclick="diagExportSVG()">SVG ↓</button>
    </div>
    <svg id="diagram-svg" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <marker id="arrow" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" fill="#0038D6" opacity=".8"/>
        </marker>
      </defs>
      <g id="er-root">
        <g id="er-connections"></g>
        <g id="er-tables"></g>
      </g>
    </svg>`;

  ensureLayout(p);
  drawTables(p);
  drawConnections(p);
  applyTransform();
  bindDiagramEvents();
}

function ensureLayout(p) {
  if (!p.diagramLayout) p.diagramLayout = {};
  const cols = 3, colW = 280, rowH = 320;
  p.tables.forEach((t, i) => {
    if (!p.diagramLayout[t.id]) {
      p.diagramLayout[t.id] = {
        x: 40 + (i % cols) * colW,
        y: 40 + Math.floor(i / cols) * rowH,
      };
    }
  });
}

function tableHeight(t) {
  return HDR_H + Math.max(1, t.fields.length) * ROW_H + 8;
}

function drawTables(p) {
  const g = document.getElementById('er-tables');
  g.innerHTML = '';
  p.tables.forEach(t => {
    const pos = p.diagramLayout[t.id] || { x: 40, y: 40 };
    const h = tableHeight(t);
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    el.setAttribute('data-table-id', t.id);
    el.setAttribute('transform', `translate(${pos.x},${pos.y})`);
    el.style.cursor = 'grab';

    // Shadow
    el.innerHTML = `
      <rect x="3" y="3" width="${TABLE_W}" height="${h}" rx="8" fill="rgba(0,0,0,.08)"/>
      <rect width="${TABLE_W}" height="${h}" rx="8" fill="white" stroke="#DDE5F8" stroke-width="1.5"/>
      <rect width="${TABLE_W}" height="${HDR_H}" rx="8" fill="${t.color}"/>
      <rect y="${HDR_H - 8}" width="${TABLE_W}" height="8" fill="${t.color}"/>
      <text x="12" y="23" font-family="-apple-system,sans-serif" font-size="13" font-weight="700" fill="white">
        ${escSvg(t.name)}
      </text>`;

    // Fields
    t.fields.forEach((f, i) => {
      const ft = FIELD_TYPE_MAP[f.type] || { badge: '?', color: '#999' };
      const fy = HDR_H + 4 + i * ROW_H;
      el.innerHTML += `
        <rect x="10" y="${fy + 4}" width="28" height="16" rx="3" fill="${ft.color}"/>
        <text x="24" y="${fy + 15}" font-size="8" font-weight="700" fill="white"
              text-anchor="middle" font-family="monospace">${escSvg(ft.badge)}</text>
        <text x="46" y="${fy + 15}" font-size="11" fill="#0F1A3E"
              font-family="-apple-system,sans-serif">${escSvg(f.name)}</text>`;
    });

    if (!t.fields.length) {
      el.innerHTML += `<text x="${TABLE_W/2}" y="${HDR_H + 20}" font-size="11" fill="#9CA3AF"
        text-anchor="middle" font-family="-apple-system,sans-serif">Noch keine Felder</text>`;
    }

    g.appendChild(el);
  });
}

function drawConnections(p) {
  const g = document.getElementById('er-connections');
  g.innerHTML = '';
  p.tables.forEach(t => {
    t.fields.forEach((f, fi) => {
      if (f.type !== 'reference' || !f.referenceTable) return;
      const target = p.tables.find(x => x.id === f.referenceTable);
      if (!target) return;
      const sp = p.diagramLayout[t.id] || { x: 0, y: 0 };
      const tp = p.diagramLayout[target.id] || { x: 300, y: 0 };
      const sy = sp.y + HDR_H + 4 + fi * ROW_H + 12;
      const ty = tp.y + HDR_H / 2;

      let sx, tx, cp1x, cp2x;
      if (tp.x >= sp.x) {
        sx = sp.x + TABLE_W; tx = tp.x;
      } else {
        sx = sp.x; tx = tp.x + TABLE_W;
      }
      const dx = Math.abs(tx - sx);
      cp1x = sx + (tx > sx ? dx * 0.5 : -dx * 0.5);
      cp2x = tx + (tx > sx ? -dx * 0.5 : dx * 0.5);

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M${sx},${sy} C${cp1x},${sy} ${cp2x},${ty} ${tx},${ty}`);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', '#0038D6');
      path.setAttribute('stroke-width', '1.5');
      path.setAttribute('stroke-opacity', '.6');
      path.setAttribute('marker-end', 'url(#arrow)');
      path.setAttribute('stroke-dasharray', '5,3');
      g.appendChild(path);
    });
  });
}

function applyTransform() {
  const root = document.getElementById('er-root');
  if (root) root.setAttribute('transform', `translate(${diag.panX},${diag.panY}) scale(${diag.zoom})`);
}

function bindDiagramEvents() {
  const svg = document.getElementById('diagram-svg');
  if (!svg) return;

  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const rect = svg.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    diag.panX = mx - (mx - diag.panX) * factor;
    diag.panY = my - (my - diag.panY) * factor;
    diag.zoom = Math.min(3, Math.max(0.3, diag.zoom * factor));
    applyTransform();
  }, { passive: false });

  svg.addEventListener('mousedown', e => {
    // Table drag
    const tg = e.target.closest('[data-table-id]');
    if (tg) {
      e.stopPropagation();
      const tableId = tg.getAttribute('data-table-id');
      const pos = state.current.diagramLayout[tableId] || { x: 0, y: 0 };
      diag.dragging = {
        tableId, el: tg,
        startX: e.clientX, startY: e.clientY,
        origX: pos.x, origY: pos.y,
      };
      tg.style.cursor = 'grabbing';
      return;
    }
    // Pan
    diag.panning = true;
    diag.panStart = { x: e.clientX - diag.panX, y: e.clientY - diag.panY };
    svg.style.cursor = 'grabbing';
  });

  window.addEventListener('mousemove', e => {
    if (diag.dragging) {
      const dx = (e.clientX - diag.dragging.startX) / diag.zoom;
      const dy = (e.clientY - diag.dragging.startY) / diag.zoom;
      const nx = diag.dragging.origX + dx;
      const ny = diag.dragging.origY + dy;
      state.current.diagramLayout[diag.dragging.tableId] = { x: nx, y: ny };
      diag.dragging.el.setAttribute('transform', `translate(${nx},${ny})`);
      drawConnections(state.current);
    } else if (diag.panning) {
      diag.panX = e.clientX - diag.panStart.x;
      diag.panY = e.clientY - diag.panStart.y;
      applyTransform();
    }
  });

  window.addEventListener('mouseup', () => {
    if (diag.dragging) {
      diag.dragging.el.style.cursor = 'grab';
      diag.dragging = null;
      // Debounced save
      clearTimeout(diag.saveTimer);
      diag.saveTimer = setTimeout(() => saveCurrentProject(), 600);
    }
    if (diag.panning) {
      diag.panning = false;
      const svg2 = document.getElementById('diagram-svg');
      if (svg2) svg2.style.cursor = 'grab';
    }
  });
}

function diagZoom(factor) {
  const svg = document.getElementById('diagram-svg');
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  const cx = rect.width / 2, cy = rect.height / 2;
  diag.panX = cx - (cx - diag.panX) * factor;
  diag.panY = cy - (cy - diag.panY) * factor;
  diag.zoom = Math.min(3, Math.max(0.3, diag.zoom * factor));
  applyTransform();
}

function diagFit() {
  const p = state.current;
  if (!p || !p.tables.length) return;
  const svg = document.getElementById('diagram-svg');
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  p.tables.forEach(t => {
    const pos = p.diagramLayout[t.id] || { x: 0, y: 0 };
    const h = tableHeight(t);
    minX = Math.min(minX, pos.x); minY = Math.min(minY, pos.y);
    maxX = Math.max(maxX, pos.x + TABLE_W); maxY = Math.max(maxY, pos.y + h);
  });
  const pad = 40;
  const scaleX = (rect.width - pad * 2) / (maxX - minX || 1);
  const scaleY = (rect.height - pad * 2) / (maxY - minY || 1);
  diag.zoom = Math.min(scaleX, scaleY, 1.5);
  diag.panX = pad - minX * diag.zoom;
  diag.panY = pad - minY * diag.zoom;
  applyTransform();
}

function diagAutoLayout() {
  const p = state.current;
  if (!p) return;
  const cols = 3, colW = 280, rowH = 320;
  p.tables.forEach((t, i) => {
    p.diagramLayout[t.id] = {
      x: 40 + (i % cols) * colW,
      y: 40 + Math.floor(i / cols) * rowH,
    };
  });
  drawTables(p);
  drawConnections(p);
  diagFit();
  saveCurrentProject();
}

function diagExportSVG() {
  const svg = document.getElementById('diagram-svg');
  if (!svg) return;
  const clone = svg.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const blob = new Blob([clone.outerHTML], { type: 'image/svg+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (state.current?.name || 'diagram') + '.svg';
  a.click();
  URL.revokeObjectURL(a.href);
}

function escSvg(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
