import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import 'dotenv/config';

import crypto from "crypto";

function stripHttpOptions(val: any): any {
  if (!val || typeof val !== "object") return val;
  if (Array.isArray(val)) return val.map(stripHttpOptions);
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(val)) {
    if (
      k === "httpOptions" ||
      k === "http_options" ||
      k === "__proto__" ||
      k === "constructor" ||
      k === "prototype" ||
      k === "cachedContent" ||
      k === "cached_content" ||
      k === "fileSearch" ||
      k === "file_search" ||
      k === "corpora" ||
      k === "semanticRetriever" ||
      k === "semantic_retriever"
    ) continue;
    if ((k === "fileData" || k === "file_data") && v && typeof v === "object") {
      const rawU = (v as any).fileUri ?? (v as any).file_uri;
      const u = typeof rawU === "string" ? rawU.trim() : "";
      if (!/^https:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\//i.test(u)) continue;
    }
    out[k] = stripHttpOptions(v);
  }
  return out;
}



// EAP fields discovered:
// - Upscaling: No dedicated upscale parameters for video in interactions.create.
// - Resolution: No global resolution parameter in generation_config. Found `resolution` on `VideoContent` input part.
// - Scene Extension: Found `duration` in `VideoResponseFormat_2` (response_format). No specific `extend` flag.
// - Reference Videos: No dedicated reference field in `interactions.create` input.

function mapResolution(qualityOrTarget?: string): 'low' | 'medium' | 'high' | 'ultra_high' {
  if (qualityOrTarget === 'draft' || qualityOrTarget === '360p' || qualityOrTarget === 'low') {
    return 'low';
  }
  if (qualityOrTarget === '720p' || qualityOrTarget === 'medium') {
    return 'medium';
  }
  if (qualityOrTarget === '4k' || qualityOrTarget === '4K' || qualityOrTarget === 'ultra_high') {
    return 'ultra_high';
  }
  return 'high';
}

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

async function startServer() {
  const app = express();
  app.set("trust proxy", 2);
  const PORT = Number(process.env.PORT) || 3000;

  interface JobEntry {
    status: 'pending' | 'done' | 'error';
    ownerKey: string;
    mimeType?: string;
    data?: Buffer;
    error?: string;
    createdAt: number;
  }

  const jobs = new Map<string, JobEntry>();
  const MAX_PENDING_PER_CLIENT = 2;
  const MAX_PENDING_GLOBAL = 12;
  const MAX_VIDEO_BUFFERS = 10;
  const MAX_VIDEO_CACHE_BYTES = 150 * 1024 * 1024;
  const MAX_JOB_RECORDS = 40;
  const STALE_PENDING_MS = 10 * 60 * 1000;

  function safeVideoMimeType(mime?: unknown): string {
    if (typeof mime === 'string') {
      const normalized = mime.split(';')[0].trim().toLowerCase();
      if (/^video\/(mp4|webm)$/i.test(normalized)) return normalized;
    }
    return 'video/mp4';
  }

  function getClientKey(req: express.Request): string {
    const raw = req.headers['x-client-id'];
    const cid = typeof raw === 'string' ? raw.trim() : '';
    if (cid && /^[a-zA-Z0-9._-]{8,128}$/.test(cid)) {
      return `cid:${cid}`;
    }
    return `ip:${req.ip || req.socket?.remoteAddress || 'unknown'}`;
  }

  function cleanupJobs() {
    const now = Date.now();
    for (const [id, job] of jobs.entries()) {
      if (job.status === 'pending' && now - job.createdAt > STALE_PENDING_MS) {
        job.status = 'error';
        job.error = 'Video generation timed out.';
      } else if (job.status !== 'pending' && now - job.createdAt > 30 * 60 * 1000) {
        jobs.delete(id);
      }
    }
  }

  function countPendingJobs(ownerKey?: string): number {
    cleanupJobs();
    let n = 0;
    for (const j of jobs.values()) {
      if (j.status === 'pending' && (!ownerKey || j.ownerKey === ownerKey)) n += 1;
    }
    return n;
  }

  function storeJobBounded(id: string, entry: JobEntry) {
    if (entry.data) {
      let bufferedCount = 0;
      let bufferedBytes = 0;
      for (const [k, j] of jobs.entries()) {
        if (k !== id && j.data) {
          bufferedCount++;
          bufferedBytes += j.data.length;
        }
      }
      for (const [k, j] of jobs.entries()) {
        if (k === id || !j.data) continue;
        if (bufferedCount < MAX_VIDEO_BUFFERS && bufferedBytes + entry.data.length <= MAX_VIDEO_CACHE_BYTES) {
          break;
        }
        bufferedCount--;
        bufferedBytes -= j.data.length;
        jobs.delete(k);
      }
    }
    if (jobs.has(id)) {
      jobs.delete(id);
    } else if (jobs.size >= MAX_JOB_RECORDS) {
      let evicted = false;
      for (const [k, j] of jobs.entries()) {
        if (j.status !== 'pending') {
          jobs.delete(k);
          evicted = true;
          break;
        }
      }
      if (!evicted) {
        const oldest = jobs.keys().next().value;
        if (oldest) jobs.delete(oldest);
      }
    }
    jobs.set(id, entry);
  }

  setInterval(cleanupJobs, 60 * 1000).unref();

  // Cap payload limit at 50mb (max 35MB raw media -> fits inside 50mb base64 JSON)
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));
  app.use((req, _res, next) => {
    if (req.body && typeof req.body === "object") {
      req.body = stripHttpOptions(req.body);
    }
    next();
  });

  // Handle body parser errors
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Files too large. Please upload smaller videos.' });
    }
    next(err);
  });

  // API health route
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.post('/api/upscale', async (req, res) => {
    try {
      const { video, mimeType, target } = req.body;
      if (!video) return res.status(400).json({ error: 'Video is required' });
      
      const inputParts: any[] = [];
      inputParts.push({ type: 'video', data: video, mime_type: mimeType || 'video/mp4' });
      // FALLBACK (no API field found): No dedicated upscale request parameter
      inputParts.push({ type: 'text', text: `Task: Upscale this video to ${target === '4k' ? '4K (ultra high)' : '1080p (high)'} resolution. Maintain exact content.` });
      
      const ownerKey = getClientKey(req);
      if (countPendingJobs(ownerKey) >= MAX_PENDING_PER_CLIENT) {
        return res.status(429).json({ error: 'Too many concurrent video jobs for your session. Please wait for current jobs to finish.' });
      }
      if (countPendingJobs() >= MAX_PENDING_GLOBAL) {
        return res.status(429).json({ error: 'Too many concurrent video jobs on server. Please wait for current jobs to finish.' });
      }
      const jobId = crypto.randomUUID();
      const createdAt = Date.now();
      storeJobBounded(jobId, { status: 'pending', ownerKey, createdAt });
      res.json({ jobId });

      (async () => {
        try {
          const interaction = await ai.interactions.create(
            {
              model: 'gemini-omni-1.1-flash',
              input: [{ type: 'user_input', content: inputParts }],
              system_instruction: "You are an AI video upscaler. Do not change the visual content, motion, or meaning. Simply increase the resolution and clarify details.",
              background: false,
              store: false,
              stream: false,
              response_format: { type: 'video' },
            },
            { timeout: 600000 }
          );
          
          const videoPart = interaction.output_video;
          if (videoPart && videoPart.data) {
            const buf = Buffer.from(videoPart.data, 'base64');
            if (buf.length > MAX_VIDEO_CACHE_BYTES) {
              storeJobBounded(jobId, { status: 'error', ownerKey, error: 'Generated video exceeds maximum allowed size.', createdAt });
            } else {
              storeJobBounded(jobId, { status: 'done', ownerKey, mimeType: safeVideoMimeType(videoPart.mime_type), data: buf, createdAt });
            }
          } else {
            let text = interaction.output_text;
            if (!text) {
              for (const step of interaction.steps) {
                if (step.type === 'model_output') {
                  const t = step.content?.find((c) => c.type === 'text');
                  if (t?.text) text = (text || '') + t.text;
                }
              }
            }
            storeJobBounded(jobId, { status: 'error', ownerKey, error: text || 'No video output received.', createdAt });
          }
        } catch (err: any) {
          storeJobBounded(jobId, { status: 'error', ownerKey, error: err.message || 'Generation failed.', createdAt });
        }
      })();
    } catch (error: any) {
      console.error('Error generating Upscale:', error);
      if (!res.headersSent) res.status(500).json({ error: error.message || 'An error occurred' });
    }
  });

  app.post('/api/omni', async (req, res) => {
    try {
      const { prompt, format, media, references, mode, video, mimeType, sourceMedia } = req.body;
      const inputParts: any[] = [];
      
      // Scene Extension mode
      if (mode === 'extend') {
        if (sourceMedia && Array.isArray(sourceMedia)) {
          sourceMedia.forEach((m) => {
            if (m.data && m.mimeType) {
              if (m.mimeType.startsWith('image/')) {
                inputParts.push({ type: 'image', data: m.data, mime_type: m.mimeType });
              } else if (m.mimeType.startsWith('video/')) {
                inputParts.push({ type: 'video', data: m.data, mime_type: m.mimeType });
              }
            }
          });
        }
        inputParts.push({ type: 'text', text: 'Original source context above. Latest generated segment below:' });
        inputParts.push({ type: 'video', data: video, mime_type: mimeType || 'video/mp4' });
        // FALLBACK (no API field found): No source-video/extension flag, using prompt text
        inputParts.push({ type: 'text', text: `Extend this scene by 10 seconds, continuing the exact same shot, motion, lighting, subjects, and ambient audio. Use ALL provided footage — the original source media and the latest segment — as full context so layout, objects, and light remain consistent. ${prompt || ''}` });
      } 
      // Transition mode
      else {
        if (media && Array.isArray(media)) {
          media.forEach((m, index) => {
            if (m.data && m.mimeType) {
              if (index === 0) {
                inputParts.push({ type: 'text', text: 'First frame:' });
              } else if (index === 1) {
                inputParts.push({ type: 'text', text: 'Last frame:' });
              }
              if (m.mimeType.startsWith('image/')) {
                inputParts.push({ type: 'image', data: m.data, mime_type: m.mimeType });
              } else if (m.mimeType.startsWith('video/')) {
                inputParts.push({ type: 'video', data: m.data, mime_type: m.mimeType });
              }
            }
          });
        }
        
        if (references && Array.isArray(references)) {
          references.forEach((r: any) => {
            if (r.data && r.mimeType) {
              // FALLBACK (no API field found): No dedicated reference-video field on the request
              inputParts.push({ type: 'text', text: 'Style reference (do not copy content, match look/character/environment):' });
              inputParts.push({ type: 'video', data: r.data, mime_type: r.mimeType });
            }
          });
        }
        
        if (prompt) {
          inputParts.push({ type: 'text', text: prompt });
        }
      }

      if (inputParts.length === 0) {
        return res.status(400).json({ error: 'Prompt or media is required' });
      }

      // Format can be 'video', 'image', 'audio', or 'text'
      const ALLOWED_FORMATS = new Set(['video', 'image', 'audio', 'text']);
      const safeFormat = typeof format === 'string' && ALLOWED_FORMATS.has(format) ? format : 'video';
      const responseFormat: any = { type: safeFormat };
      if (mode === 'extend' && responseFormat.type === 'video') {
        responseFormat.duration = '10s';
      }
      
      const ownerKey = getClientKey(req);
      if (countPendingJobs(ownerKey) >= MAX_PENDING_PER_CLIENT) {
        return res.status(429).json({ error: 'Too many concurrent video jobs for your session. Please wait for current jobs to finish.' });
      }
      if (countPendingJobs() >= MAX_PENDING_GLOBAL) {
        return res.status(429).json({ error: 'Too many concurrent video jobs on server. Please wait for current jobs to finish.' });
      }
      const jobId = crypto.randomUUID();
      const createdAt = Date.now();
      storeJobBounded(jobId, { status: 'pending', ownerKey, createdAt });
      res.json({ jobId });

      (async () => {
        try {
          const interaction = await ai.interactions.create(
            {
              model: 'gemini-omni-1.1-flash',
              input: [{ type: 'user_input', content: inputParts }],
              system_instruction: "You are a world-class visual effects AI specializing in seamless frame interpolation, scene extension, and continuous camera movements. You generate high-quality video that starts exactly on the First frame and ends exactly on the Last frame in a single, continuous, uncut shot. NEVER use hard cuts. NEVER hallucinate new characters. Maintain strict temporal consistency. You execute named transition techniques — object portals, whip pans, match morphs, sky drops, foreground wipes, and time-lapse transformations — boldly and completely. The technique specified in the prompt is the creative priority.",
              background: false,
              store: false,
              stream: false,
              response_format: responseFormat,
            },
            { timeout: 600000 } // 10 minutes timeout for video generation
          );
          const videoPart = interaction.output_video;
          if (videoPart && videoPart.data) {
            const buf = Buffer.from(videoPart.data, 'base64');
            if (buf.length > MAX_VIDEO_CACHE_BYTES) {
              storeJobBounded(jobId, { status: 'error', ownerKey, error: 'Generated video exceeds maximum allowed size.', createdAt });
            } else {
              storeJobBounded(jobId, { status: 'done', ownerKey, mimeType: safeVideoMimeType(videoPart.mime_type), data: buf, createdAt });
            }
          } else {
            let text = interaction.output_text;
            if (!text) {
              for (const step of interaction.steps) {
                if (step.type === 'model_output') {
                  const t = step.content?.find((c) => c.type === 'text');
                  if (t?.text) text = (text || '') + t.text;
                }
              }
            }
            storeJobBounded(jobId, { status: 'error', ownerKey, error: text || 'No video output received.', createdAt });
          }
        } catch (err: any) {
          storeJobBounded(jobId, { status: 'error', ownerKey, error: err.message || 'Generation failed.', createdAt });
        }
      })();
    } catch (error: any) {
      console.error('Error generating Omni output:', error);
      if (!res.headersSent) res.status(500).json({ error: error.message || 'An error occurred' });
    }
  });

  app.get('/api/job/:id', (req, res) => {
    cleanupJobs();
    const job = jobs.get(req.params.id);
    if (!job || job.ownerKey !== getClientKey(req)) return res.status(404).json({ error: 'Unknown job' });
    res.json({ status: job.status, error: job.error });
  });

  const sendJobVideo = (req: express.Request, res: express.Response) => {
    cleanupJobs();
    const job = jobs.get(req.params.id);
    if (!job || job.status !== 'done' || !job.data) return res.status(404).json({ error: 'Result not ready' });
    if (job.ownerKey !== getClientKey(req)) {
      return res.status(404).json({ error: 'Result not ready' });
    }
    res.setHeader('Content-Type', safeVideoMimeType(job.mimeType));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; media-src 'self'; sandbox");
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(job.data);
  };

  app.get('/api/job/:id/result', sendJobVideo);
  app.get('/api/videos/:id', sendJobVideo);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(["/server.cjs", "/server.cjs.map"], (_req: any, res: any) => res.status(404).end());
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
