'use strict';

require('dotenv').config();

const express    = require('express');
const multer     = require('multer');
const sharp      = require('sharp');
const archiver   = require('archiver');
const axios      = require('axios');
const { Dropbox } = require('dropbox');
const path       = require('path');
const fs         = require('fs');
const os         = require('os');
const { v4: uuidv4 } = require('uuid');
const EventEmitter   = require('events');
const rateLimit  = require('express-rate-limit');

// ── Config ────────────────────────────────────────────────────────────────────
const PORT         = parseInt(process.env.PORT || '3000', 10);
const TARGET_WIDTH = 885;
const TEMP_BASE    = path.join(os.tmpdir(), 'img-processor');
const JOB_TTL_MS   = 60 * 60 * 1000;   // ZIP kept for 1 h after completion
const ERROR_TTL_MS =  5 * 60 * 1000;   // failed jobs cleaned after 5 min

// Image MIME types accepted for upload
const ALLOWED_MIMES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/gif',
  'image/webp', 'image/tiff', 'image/bmp',
  'image/heic', 'image/heif', 'image/x-tiff',
]);

// Output format per input extension
const FORMAT_MAP = {
  '.jpg':  { fmt: 'jpeg', ext: '.jpg' },
  '.jpeg': { fmt: 'jpeg', ext: '.jpg' },
  '.png':  { fmt: 'png',  ext: '.png' },
  '.webp': { fmt: 'webp', ext: '.webp' },
  // everything else → JPEG
};

fs.mkdirSync(TEMP_BASE, { recursive: true });

// ── Job model ─────────────────────────────────────────────────────────────────
class Job {
  constructor (id) {
    this.id          = id;
    this.status      = 'pending';   // pending | processing | complete | error
    this.orderNumber = null;
    this.outputZip   = null;
    this.events      = [];          // replay buffer for late SSE connects
    this.emitter     = new EventEmitter();
    this.emitter.setMaxListeners(10);
    this.dir         = path.join(TEMP_BASE, id);
    this.originalsDir = path.join(this.dir, 'originals');
    this.resizedDir   = path.join(this.dir, 'resized');
    fs.mkdirSync(this.originalsDir, { recursive: true });
    fs.mkdirSync(this.resizedDir,   { recursive: true });
  }

  _push (evt) {
    this.events.push(evt);
    this.emitter.emit('event', evt);
  }

  progress (step, message, percent) {
    this._push({ type: 'progress', step, message, percent });
  }

  complete () {
    this.status = 'complete';
    this._push({ type: 'complete', downloadUrl: `/api/download/${this.id}` });
    setTimeout(() => this.cleanup(), JOB_TTL_MS);
  }

  fail (step, message) {
    this.status = 'error';
    this._push({ type: 'error', step, message });
    setTimeout(() => this.cleanup(), ERROR_TTL_MS);
  }

  cleanup () {
    jobs.delete(this.id);
    try { fs.rmSync(this.dir, { recursive: true, force: true }); } catch (_) {}
  }
}

const jobs = new Map();   // jobId → Job

// ── Express app ───────────────────────────────────────────────────────────────
const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Anfragen – bitte 15 Minuten warten.' },
});

// ── POST /api/upload  ─────────────────────────────────────────────────────────
// Accepts multipart/form-data: orderNumber (text) + images[] (files)
// Returns { jobId } immediately; processing runs asynchronously.
app.post('/api/upload', apiLimiter, (req, res) => {
  const jobId = uuidv4();
  const job   = new Job(jobId);
  jobs.set(jobId, job);

  // Build per-request multer with the job's directory
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, job.originalsDir),
    filename:    (_req, file,  cb) => {
      // Repair latin1-encoded UTF-8 filenames (common in multipart uploads)
      let name = file.originalname;
      try {
        const decoded = Buffer.from(file.originalname, 'latin1').toString('utf8');
        if (/[^\x00-\x7F]/.test(decoded)) name = decoded;
      } catch (_) {}
      // Strip path separators and dangerous chars
      name = name.replace(/[/\\<>:"|?*\x00-\x1F]/g, '_');
      cb(null, name);
    },
  });

  const upload = multer({
    storage,
    fileFilter: (_req, file, cb) => {
      cb(null, ALLOWED_MIMES.has(file.mimetype.toLowerCase()));
    },
    limits: { fileSize: 200 * 1024 * 1024, files: 500 },
  }).array('images', 500);

  upload(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      job.cleanup();
      return res.status(400).json({ error: `Upload-Fehler: ${err.message}` });
    }
    if (err) {
      job.cleanup();
      return res.status(400).json({ error: err.message });
    }

    const orderNumber = (req.body.orderNumber || '').trim();

    if (!orderNumber) {
      job.cleanup();
      return res.status(400).json({ error: 'Auftragsnummer fehlt.' });
    }
    if (!/^A-\d+$/.test(orderNumber)) {
      job.cleanup();
      return res.status(400).json({
        error: 'Ungültiges Format – erwartet: A-XXXXXXXXX (z. B. A-202604629)',
      });
    }
    if (!req.files || req.files.length === 0) {
      job.cleanup();
      return res.status(400).json({ error: 'Keine Bilddateien hochgeladen.' });
    }

    job.orderNumber = orderNumber;

    // Fire-and-forget processing
    processJob(job, req.files, orderNumber).catch((err) => {
      console.error(`[Job ${jobId}] Uncaught error:`, err.message);
      if (job.status !== 'error') job.fail('unknown', `Interner Fehler: ${err.message}`);
    });

    res.json({ jobId });
  });
});

// ── GET /api/status/:jobId  ───────────────────────────────────────────────────
// Server-Sent Events stream – replays buffered events then subscribes live.
app.get('/api/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job nicht gefunden.' });

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');   // disable nginx buffering
  res.flushHeaders();

  const send = (evt) => res.write(`data: ${JSON.stringify(evt)}\n\n`);

  // Replay history for late-connecting clients
  job.events.forEach(send);

  if (job.status === 'complete' || job.status === 'error') {
    return res.end();
  }

  // Subscribe to future events
  const onEvent = (evt) => {
    send(evt);
    if (evt.type === 'complete' || evt.type === 'error') {
      cleanup();
      res.end();
    }
  };

  const heartbeat = setInterval(() => {
    if (res.writableEnded) return cleanup();
    res.write(': ping\n\n');
  }, 20_000);

  const cleanup = () => {
    clearInterval(heartbeat);
    job.emitter.removeListener('event', onEvent);
  };

  job.emitter.on('event', onEvent);
  req.on('close', cleanup);
});

// ── GET /api/download/:jobId  ─────────────────────────────────────────────────
app.get('/api/download/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || job.status !== 'complete') {
    return res.status(404).json({ error: 'Download nicht (mehr) verfügbar.' });
  }
  if (!job.outputZip || !fs.existsSync(job.outputZip)) {
    return res.status(404).json({ error: 'ZIP-Datei nicht gefunden.' });
  }

  const filename = `${job.orderNumber}_verkleinerte_bilder.zip`;
  res.setHeader('Content-Disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.setHeader('Content-Type', 'application/zip');

  const stream = fs.createReadStream(job.outputZip);
  stream.on('error', (err) => {
    console.error('Download stream error:', err.message);
    if (!res.headersSent) res.status(500).end();
  });
  stream.pipe(res);
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', jobs: jobs.size }));

// ── Processing pipeline ───────────────────────────────────────────────────────
async function processJob (job, files, orderNumber) {
  job.status = 'processing';

  // ── 1. Ninox lookup ────────────────────────────────────────────────────────
  job.progress('ninox', 'Suche Auftrag in Ninox…', 32);

  let dropboxPath;
  try {
    dropboxPath = await getNinoxDropboxPath(orderNumber);
  } catch (err) {
    return job.fail('ninox', `Ninox-Fehler: ${err.message}`);
  }
  job.progress('ninox', 'Ninox: Dropbox-Pfad gefunden ✓', 38);

  // ── 2. Originals → Dropbox ────────────────────────────────────────────────
  const skipDropbox = process.env.SKIP_DROPBOX === 'true';

  if (skipDropbox) {
    job.progress('dropbox', 'Dropbox-Upload übersprungen (SKIP_DROPBOX=true)', 70);
  } else {
    job.progress('dropbox', 'Lade Originale in Dropbox hoch…', 40);
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const pct  = 40 + Math.round(((i + 1) / files.length) * 28);
      job.progress('dropbox',
        `Dropbox: ${file.filename} (${i + 1}/${files.length})`, pct);
      try {
        await uploadToDropbox(dropboxPath, file.filename, file.path);
      } catch (err) {
        return job.fail('dropbox',
          `Dropbox-Upload fehlgeschlagen (${file.filename}): ${err.message}`);
      }
    }
    job.progress('dropbox', `${files.length} Original(e) in Dropbox gesichert ✓`, 70);
  }

  // ── 3. Resize images ───────────────────────────────────────────────────────
  job.progress('resize', 'Verkleinere Bilder auf 885 px…', 72);
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const pct  = 72 + Math.round(((i + 1) / files.length) * 15);
    job.progress('resize',
      `Verkleinere: ${file.filename} (${i + 1}/${files.length})`, pct);
    try {
      await resizeImage(file.path, file.filename, job.resizedDir);
    } catch (err) {
      console.error(`[Resize] ${file.filename}:`, err.message);
      // Fallback: copy original untouched
      try {
        fs.copyFileSync(file.path, path.join(job.resizedDir, file.filename));
      } catch (_) {}
    }
  }
  job.progress('resize', 'Alle Bilder verkleinert ✓', 88);

  // ── 4. Create ZIP ──────────────────────────────────────────────────────────
  job.progress('zip', 'Erstelle ZIP-Datei…', 90);
  const zipPath = path.join(job.dir, `${orderNumber}_verkleinerte_bilder.zip`);
  try {
    await createZip(job.resizedDir, zipPath);
  } catch (err) {
    return job.fail('zip', `ZIP-Fehler: ${err.message}`);
  }

  job.outputZip = zipPath;
  job.progress('zip', 'ZIP fertig ✓', 100);
  job.complete();
}

// ── Ninox API ─────────────────────────────────────────────────────────────────
async function getNinoxDropboxPath (orderNumber) {
  const apiKey = process.env.NINOX_API_KEY;
  const teamId = process.env.NINOX_TEAM_ID;
  const dbId   = process.env.NINOX_DATABASE_ID;

  if (!apiKey || !teamId || !dbId) {
    throw new Error(
      'Ninox-Konfiguration unvollständig – bitte NINOX_API_KEY, ' +
      'NINOX_TEAM_ID und NINOX_DATABASE_ID in .env setzen.'
    );
  }

  const tableName   = process.env.NINOX_TABLE_NAME   || 'Aufträge';
  const orderField  = process.env.NINOX_ORDER_FIELD  || 'Auftragsnummer';
  const dropboxField= process.env.NINOX_DROPBOX_FIELD|| 'Dropboxpfad';

  // NQL: find first matching record and return the Dropbox path field
  const nql = [
    `let r := first(select '${tableName}' where '${orderField}' = "${orderNumber}");`,
    `if r != null then r.'${dropboxField}' else null end`,
  ].join(' ');

  let response;
  try {
    response = await axios.post(
      `https://api.ninox.com/v1/teams/${teamId}/databases/${dbId}/query`,
      { query: nql },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 20_000,
      }
    );
  } catch (err) {
    if (err.response) {
      throw new Error(
        `Ninox API HTTP ${err.response.status}: ` +
        JSON.stringify(err.response.data)
      );
    }
    throw new Error(`Ninox nicht erreichbar: ${err.message}`);
  }

  const result = response.data;
  if (result === null || result === undefined || result === '') {
    throw new Error(
      `Auftragsnummer "${orderNumber}" nicht in Ninox gefunden ` +
      `oder kein Dropbox-Pfad hinterlegt.`
    );
  }

  return String(result).trim();
}

// ── Dropbox upload ────────────────────────────────────────────────────────────
function buildDropbox () {
  const accessToken  = process.env.DROPBOX_ACCESS_TOKEN;
  const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;
  const clientId     = process.env.DROPBOX_APP_KEY;
  const clientSecret = process.env.DROPBOX_APP_SECRET;

  if (!accessToken && !refreshToken) {
    throw new Error(
      'Dropbox nicht konfiguriert – bitte DROPBOX_ACCESS_TOKEN ' +
      'oder DROPBOX_REFRESH_TOKEN + DROPBOX_APP_KEY + DROPBOX_APP_SECRET setzen.'
    );
  }

  if (refreshToken && clientId && clientSecret) {
    return new Dropbox({ refreshToken, clientId, clientSecret });
  }
  return new Dropbox({ accessToken });
}

const DROPBOX_DIRECT_MAX = 100 * 1024 * 1024; // 100 MB – use session above this
const CHUNK_SIZE          =   8 * 1024 * 1024; //   8 MB chunks

async function uploadToDropbox (dropboxPath, filename, localPath) {
  const dbx = buildDropbox();

  // Ensure the Dropbox base path is absolute and ends with /
  let base = dropboxPath.trim();
  if (!base.startsWith('/')) base = '/' + base;
  if (!base.endsWith('/'))   base += '/';

  const targetPath = base + 'Original_' + filename;
  const buffer     = fs.readFileSync(localPath);

  if (buffer.length <= DROPBOX_DIRECT_MAX) {
    await dbx.filesUpload({
      path:     targetPath,
      contents: buffer,
      mode:     { '.tag': 'overwrite' },
    });
  } else {
    await uploadLargeFileToDropbox(dbx, buffer, targetPath);
  }
}

async function uploadLargeFileToDropbox (dbx, buffer, targetPath) {
  // Start session
  const start = await dbx.filesUploadSessionStart({
    contents: buffer.slice(0, CHUNK_SIZE),
    close:    false,
  });
  const sessionId = start.result.session_id;
  let offset = CHUNK_SIZE;

  // Append middle chunks
  while (offset + CHUNK_SIZE < buffer.length) {
    await dbx.filesUploadSessionAppendV2({
      cursor:   { session_id: sessionId, offset },
      close:    false,
      contents: buffer.slice(offset, offset + CHUNK_SIZE),
    });
    offset += CHUNK_SIZE;
  }

  // Finish
  await dbx.filesUploadSessionFinish({
    cursor:   { session_id: sessionId, offset },
    commit:   { path: targetPath, mode: { '.tag': 'overwrite' } },
    contents: buffer.slice(offset),
  });
}

// ── Image resize ──────────────────────────────────────────────────────────────
async function resizeImage (inputPath, originalFilename, resizedDir) {
  const ext     = path.extname(originalFilename).toLowerCase();
  const base    = path.basename(originalFilename, ext);
  const mapping = FORMAT_MAP[ext] || { fmt: 'jpeg', ext: '.jpg' };

  // Find a unique output name (avoids collision when e.g. photo.tif & photo.jpg)
  let outName = base + mapping.ext;
  let outPath = path.join(resizedDir, outName);
  let counter = 1;
  while (fs.existsSync(outPath)) {
    outName = `${base}_${counter}${mapping.ext}`;
    outPath = path.join(resizedDir, outName);
    counter++;
  }

  const pipeline = sharp(inputPath, { failOnError: false })
    .rotate()                           // auto-orient from EXIF
    .resize(TARGET_WIDTH, null, {
      fit: 'inside',
      withoutEnlargement: true,         // don't upscale images that are already small
    });

  switch (mapping.fmt) {
    case 'png':
      await pipeline.png({ compressionLevel: 9 }).toFile(outPath);
      break;
    case 'webp':
      await pipeline.webp({ quality: 85 }).toFile(outPath);
      break;
    default:
      await pipeline.jpeg({ quality: 85, progressive: true }).toFile(outPath);
  }

  return outName;
}

// ── ZIP creation ──────────────────────────────────────────────────────────────
function createZip (sourceDir, zipPath) {
  return new Promise((resolve, reject) => {
    const output  = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourceDir, false);   // add all files flat (no subdir in ZIP)
    archive.finalize();
  });
}

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Bild-Verarbeitungsserver läuft → http://localhost:${PORT}`);
  if (process.env.SKIP_DROPBOX === 'true') {
    console.warn('⚠  SKIP_DROPBOX=true – Dropbox-Upload ist deaktiviert');
  }
});
