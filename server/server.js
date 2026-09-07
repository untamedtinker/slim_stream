import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getSystemStatus, ensureBinariesInstalled } from './binary-manager.js';
import { probeMedia } from './probe.js';
import { startConversionJob, RESOLUTION_PRESETS, COMPRESSION_PRESETS } from './converter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// Storage directory locations for temporary uploads and processed output media
const UPLOADS_DIR = path.join(ROOT_DIR, 'uploads');
const OUTPUTS_DIR = path.join(ROOT_DIR, 'outputs');

// Automatically ensure uploads and outputs directories exist upon startup
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(OUTPUTS_DIR)) fs.mkdirSync(OUTPUTS_DIR, { recursive: true });

// Automatically ensure required FFmpeg and FFprobe binaries are provisioned if absent
ensureBinariesInstalled().catch(err => {
  console.warn('Binary self-check notice:', err.message);
});

const app = express();
const DEFAULT_PORT = parseInt(process.env.PORT, 10) || 3000;

// Enable CORS and JSON body parsing for API endpoints
app.use(cors());
app.use(express.json());

// Serve static frontend assets
app.use('/css', express.static(path.join(ROOT_DIR, 'css')));
app.use('/js', express.static(path.join(ROOT_DIR, 'js')));

// Deliver root application dashboard interface
app.get('/', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'index.html'));
});

// Configure streaming disk storage for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const cleanExt = path.extname(file.originalname).toLowerCase() || '.mov';
    cb(null, `input-${uniqueSuffix}${cleanExt}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 4 * 1024 * 1024 * 1024 } // 4 GB maximum payload ceiling
});

// In-memory data store for active conversion jobs and Server-Sent Event (SSE) clients
const activeJobs = new Map();
const sseClients = new Map();

/**
 * Broadcasts JSON job status updates to all active SSE subscribers for a specific job ID.
 *
 * @param {string} jobId Unique identifier for the conversion job.
 * @param {Object} data Job status payload transmitted over the event stream.
 */
function broadcastJobUpdate(jobId, data) {
  const clients = sseClients.get(jobId) || [];
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  clients.forEach(res => {
    try {
      res.write(payload);
    } catch {
      // Client connection closed or unreachable
    }
  });
}

/**
 * System Status endpoint: Checks host environment readiness and returns preset dictionaries.
 */
app.get('/api/status', async (req, res) => {
  try {
    const status = await getSystemStatus();
    res.json({
      success: true,
      ...status,
      resolutionPresets: RESOLUTION_PRESETS,
      compressionPresets: COMPRESSION_PRESETS
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Media Probe endpoint: Uploads incoming media into the staging directory
 * and runs FFprobe to inspect container structure and embedded metadata tags.
 */
app.post('/api/probe', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No media file provided.' });
    }

    const probeResult = await probeMedia(req.file.path);
    res.json({
      success: true,
      fileId: path.basename(req.file.path),
      originalName: req.file.originalname,
      tempPath: req.file.path,
      probe: probeResult
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Start Conversion endpoint: Creates a tracked conversion job, formats a deterministic
 * output filename matching quality/privacy specs, and kicks off asynchronous transcoding.
 */
app.post('/api/convert', async (req, res) => {
  try {
    const {
      fileId,
      originalName = 'media.file',
      mediaType = 'video',
      audioFormat = 'm4a',
      audioQuality = 'high',
      resolution = 'original',
      compression = 'lossless_web',
      stripMetadata = true,
      fastStart = true
    } = req.body;

    if (!fileId) {
      return res.status(400).json({ success: false, error: 'Missing fileId.' });
    }

    const inputPath = path.join(UPLOADS_DIR, fileId);
    if (!fs.existsSync(inputPath)) {
      return res.status(404).json({ success: false, error: 'Uploaded source file was not found.' });
    }

    const jobId = 'job-' + Date.now() + '-' + Math.round(Math.random() * 1000);
    const baseName = path.parse(originalName).name.replace(/[^a-zA-Z0-9_-]/g, '_');
    
    // Construct standardized, descriptive output naming scheme
    let descriptiveSuffix = '';
    let outExt = 'mp4';
    const metaSlug = stripMetadata ? '_no-metadata' : '_with-metadata';

    if (mediaType === 'audio') {
      outExt = audioFormat || 'm4a';
      const qualSlug = audioQuality || '320k';
      descriptiveSuffix = `_${outExt.toUpperCase()}_${qualSlug}${metaSlug}`;
    } else {
      outExt = 'mp4';
      const resSlug = resolution === 'original' ? 'source' : resolution;
      const compSlugMap = {
        lossless_web: 'lossless',
        compact_web: 'compact',
        maximum_quality: 'archival'
      };
      const compSlug = compSlugMap[compression] || 'web';
      const fastStartSlug = fastStart ? '_faststart' : '_standard';
      descriptiveSuffix = `_${resSlug}_${compSlug}${metaSlug}${fastStartSlug}`;
    }

    const outputFilename = `${baseName}${descriptiveSuffix}.${outExt}`;
    const outputPath = path.join(OUTPUTS_DIR, outputFilename);

    const jobData = {
      id: jobId,
      inputPath,
      outputPath,
      outputFilename,
      originalName,
      mediaType,
      audioFormat,
      audioQuality,
      resolution,
      compression,
      stripMetadata,
      fastStart,
      status: 'queued',
      percent: 0,
      friendlyMessage: 'Job queued and ready to start...',
      createdAt: new Date().toISOString(),
      completedAt: null,
      result: null,
      error: null
    };

    activeJobs.set(jobId, jobData);

    // Dispatch background FFmpeg conversion process
    startConversionJob(
      jobData,
      progress => {
        jobData.status = 'processing';
        jobData.percent = progress.percent;
        jobData.friendlyMessage = progress.friendlyMessage;
        broadcastJobUpdate(jobId, { ...jobData, ...progress });
      },
      result => {
        jobData.status = 'completed';
        jobData.percent = 100;
        jobData.completedAt = new Date().toISOString();
        jobData.friendlyMessage = result.friendlyMessage;
        jobData.result = result;
        broadcastJobUpdate(jobId, { ...jobData, result });
      },
      error => {
        jobData.status = 'failed';
        jobData.friendlyMessage = 'Conversion error: ' + error.message;
        jobData.error = error.message;
        broadcastJobUpdate(jobId, { ...jobData, error: error.message });
      }
    );

    res.json({
      success: true,
      jobId,
      job: jobData
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Server-Sent Events (SSE) stream endpoint for real-time conversion progress updates.
 */
app.get('/api/progress/:jobId', (req, res) => {
  const { jobId } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  if (!sseClients.has(jobId)) {
    sseClients.set(jobId, []);
  }
  sseClients.get(jobId).push(res);

  // Send current state immediately upon client connection
  const job = activeJobs.get(jobId);
  if (job) {
    res.write(`data: ${JSON.stringify(job)}\n\n`);
  }

  req.on('close', () => {
    const clients = sseClients.get(jobId) || [];
    sseClients.set(jobId, clients.filter(c => c !== res));
  });
});

/**
 * Job Status Query endpoint: Returns details for a specific conversion job.
 */
app.get('/api/jobs/:jobId', (req, res) => {
  const job = activeJobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ success: false, error: 'Job not found' });
  }
  res.json({ success: true, job });
});

/**
 * List all jobs endpoint: Returns all historical and active jobs for dashboard queue restore.
 */
app.get('/api/jobs', (req, res) => {
  const jobsList = Array.from(activeJobs.values()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ success: true, jobs: jobsList });
});

/**
 * Download Converted File endpoint: Sends processed media with proper content headers.
 */
app.get('/api/download/:jobId', (req, res) => {
  const job = activeJobs.get(req.params.jobId);
  if (!job || !job.result || !fs.existsSync(job.outputPath)) {
    return res.status(404).send('File not found or conversion not completed yet.');
  }
  res.download(job.outputPath, job.outputFilename);
});

/**
 * Resilient HTTP listener that gracefully increments port if default is in use.
 *
 * @param {number} port Starting port number.
 */
function startServer(port) {
  const server = app.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log(`\n========================================================`);
    console.log(`SlimStream Dashboard running at: ${url}`);
    console.log(`========================================================\n`);

    // Auto-open web browser on launch
    if (process.env.NODE_ENV !== 'test') {
      import('node:child_process').then(({ exec }) => {
        const cmd = process.platform === 'darwin' ? `open ${url}` : `xdg-open ${url}`;
        exec(cmd, () => {});
      }).catch(() => {});
    }
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`Port ${port} is currently busy. Trying next port http://localhost:${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('Server error:', err);
    }
  });
}

startServer(DEFAULT_PORT);
