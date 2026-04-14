'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const { v4: uuidv4 } = require('uuid');

const app       = express();
const PORT      = parseInt(process.env.PORT || '3001', 10);
const DATA_FILE = path.join(__dirname, 'data', 'projects.json');

// Ensure data directory and file exist
fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]', 'utf8');

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Helpers ───────────────────────────────────────────────────────────────────
function readProjects () {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return []; }
}

function writeProjects (projects) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(projects, null, 2), 'utf8');
}

// ── API: Projects ─────────────────────────────────────────────────────────────

// GET /api/projects  → summary list
app.get('/api/projects', (_req, res) => {
  const projects = readProjects();
  res.json(projects.map(p => ({
    id:          p.id,
    name:        p.name,
    client:      p.client,
    description: p.description,
    createdAt:   p.createdAt,
    updatedAt:   p.updatedAt,
    tableCount:  (p.tables || []).length,
    fieldCount:  (p.tables || []).reduce((s, t) => s + (t.fields || []).length, 0),
  })));
});

// POST /api/projects  → create
app.post('/api/projects', (req, res) => {
  const projects = readProjects();
  const now = new Date().toISOString();
  const project = {
    id:            uuidv4(),
    name:          (req.body.name || 'Neues Projekt').trim(),
    client:        (req.body.client || '').trim(),
    description:   (req.body.description || '').trim(),
    createdAt:     now,
    updatedAt:     now,
    tables:        [],
    diagramLayout: {},
  };
  projects.push(project);
  writeProjects(projects);
  res.status(201).json(project);
});

// GET /api/projects/:id  → full project
app.get('/api/projects/:id', (req, res) => {
  const project = readProjects().find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Projekt nicht gefunden.' });
  res.json(project);
});

// PUT /api/projects/:id  → full update
app.put('/api/projects/:id', (req, res) => {
  const projects = readProjects();
  const idx = projects.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Projekt nicht gefunden.' });
  projects[idx] = {
    ...projects[idx],
    ...req.body,
    id:        req.params.id,
    updatedAt: new Date().toISOString(),
  };
  writeProjects(projects);
  res.json(projects[idx]);
});

// DELETE /api/projects/:id
app.delete('/api/projects/:id', (req, res) => {
  const projects = readProjects();
  const filtered = projects.filter(p => p.id !== req.params.id);
  if (filtered.length === projects.length)
    return res.status(404).json({ error: 'Projekt nicht gefunden.' });
  writeProjects(filtered);
  res.json({ success: true });
});

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  const projects = readProjects();
  res.json({ status: 'ok', projects: projects.length });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Ninox DB Planer → http://localhost:${PORT}`);
});
