import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

import {
  transcribeAudio,
  transcribeAudioChunks,
  translateAudioDirect,
  translateAudioChunksDirect,
  alignDualChannelSegments,
  testTranscriptionApiConnection
} from './transcriber.js';
import {
  translateSegments,
  testCustomApiConnection,
  generateGlobalContextDossier,
  normalizeTranslationProviders
} from './translator.js';
import { saveSubtitles, generateBilingualSegments, parseVttToSegments } from './subtitleGenerator.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Directories
const UPLOADS_DIR = path.join(__dirname, 'storage', 'uploads');
const AUDIO_DIR = path.join(__dirname, 'storage', 'audio');
const SUBTITLES_DIR = path.join(__dirname, 'storage', 'subtitles');

[UPLOADS_DIR, AUDIO_DIR, SUBTITLES_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.mp4';
    const uniqueName = `video_${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 } // 2GB limit
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory configuration store initialized from environment
let serverConfig = {
  translationMode: 'fallback', // 'fallback' | 'ensemble'
  transcription: {
    baseUrl: process.env.TRANSCRIPTION_BASE_URL || 'https://api.groq.com/openai/v1',
    model: process.env.TRANSCRIPTION_MODEL || 'whisper-large-v3',
    apiKey: process.env.TRANSCRIPTION_API_KEY || process.env.GROQ_API_KEY || ''
  },
  translationProviders: [
    {
      id: 'prov_groq',
      name: 'Groq LPU (Qwen 3.8)',
      baseUrl: 'https://api.groq.com/openai/v1',
      model: process.env.TRANSLATION_MODEL || 'qwen/qwen3.8-27b',
      apiKey: process.env.GROQ_API_KEY || ''
    },
    ...(process.env.CUSTOM_TRANSLATION_API_KEY ? [{
      id: 'prov_toptools',
      name: 'top-tools-ai.com',
      baseUrl: process.env.CUSTOM_TRANSLATION_ENDPOINT || 'https://top-tools-ai.com/api/v1',
      model: process.env.CUSTOM_TRANSLATION_MODEL || 'Top-Tools-Ai',
      apiKey: process.env.CUSTOM_TRANSLATION_API_KEY
    }] : []),
    ...(process.env.OPENROUTER_API_KEY ? [{
      id: 'prov_openrouter',
      name: 'OpenRouter (DeepSeek)',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'deepseek/deepseek-chat',
      apiKey: process.env.OPENROUTER_API_KEY
    }] : [])
  ]
};

/**
 * GET /api/config: Check API key status & full multi-provider configuration
 */
app.get('/api/config', (req, res) => {
  const tKey = serverConfig.transcription.apiKey || process.env.GROQ_API_KEY || '';
  const maskedTKey = tKey.length > 8
    ? `${tKey.substring(0, 6)}...${tKey.substring(tKey.length - 4)}`
    : (tKey ? '••••••••' : '');

  const safeProviders = serverConfig.translationProviders.map(p => ({
    id: p.id,
    name: p.name,
    baseUrl: p.baseUrl,
    model: p.model,
    hasKey: Boolean(p.apiKey && p.apiKey.trim().length > 3),
    maskedKey: (p.apiKey && p.apiKey.length > 8)
      ? `${p.apiKey.substring(0, 6)}...${p.apiKey.substring(p.apiKey.length - 4)}`
      : (p.apiKey ? '••••••••' : '')
  }));

  const groqKey = process.env.GROQ_API_KEY || '';
  const isGroqConfigured = groqKey.length > 10 || Boolean(tKey);

  res.json({
    translationMode: serverConfig.translationMode || 'fallback',
    transcription: {
      baseUrl: serverConfig.transcription.baseUrl,
      model: serverConfig.transcription.model,
      configured: isGroqConfigured,
      maskedKey: maskedTKey
    },
    translationProviders: safeProviders,
    groqConfigured: isGroqConfigured,
    openRouterConfigured: Boolean(process.env.OPENROUTER_API_KEY),
    customConfigured: Boolean(process.env.CUSTOM_TRANSLATION_API_KEY),
    maskedKey: maskedTKey,
    maskedCustomKey: safeProviders.find(p => p.id === 'prov_toptools')?.maskedKey || '',
    customEndpoint: process.env.CUSTOM_TRANSLATION_ENDPOINT || '',
    customModel: process.env.CUSTOM_TRANSLATION_MODEL || ''
  });
});

/**
 * POST /api/config: Update API keys and multi-provider settings dynamically
 */
app.post('/api/config', (req, res) => {
  const {
    translationMode,
    transcription,
    translationProviders,
    groqApiKey,
    openRouterApiKey,
    customApiKey,
    customEndpoint,
    customModel
  } = req.body;

  // 1. Update translation mode
  if (translationMode && (translationMode === 'fallback' || translationMode === 'ensemble')) {
    serverConfig.translationMode = translationMode;
  }

  // 2. Update transcription config
  if (transcription) {
    if (transcription.baseUrl && transcription.baseUrl.trim()) {
      serverConfig.transcription.baseUrl = transcription.baseUrl.trim();
      process.env.TRANSCRIPTION_BASE_URL = serverConfig.transcription.baseUrl;
    }
    if (transcription.model && transcription.model.trim()) {
      serverConfig.transcription.model = transcription.model.trim();
      process.env.TRANSCRIPTION_MODEL = serverConfig.transcription.model;
    }
    if (transcription.apiKey && transcription.apiKey.trim() && !transcription.apiKey.includes('...')) {
      serverConfig.transcription.apiKey = transcription.apiKey.trim();
      process.env.TRANSCRIPTION_API_KEY = serverConfig.transcription.apiKey;
      process.env.GROQ_API_KEY = serverConfig.transcription.apiKey;
    }
  }

  // 3. Update translation providers array
  if (Array.isArray(translationProviders) && translationProviders.length > 0) {
    const updated = [];
    translationProviders.forEach((incoming, idx) => {
      // Find existing provider to preserve key if masked
      const existing = serverConfig.translationProviders.find(p => p.id === incoming.id) || {};
      let finalKey = (incoming.apiKey && incoming.apiKey.trim()) || '';
      if (!finalKey || finalKey.includes('...') || finalKey === '••••••••') {
        finalKey = existing.apiKey || '';
      }

      updated.push({
        id: incoming.id || `prov_${idx + 1}`,
        name: incoming.name || `Provider #${idx + 1}`,
        baseUrl: (incoming.baseUrl && incoming.baseUrl.trim()) || 'https://api.groq.com/openai/v1',
        model: (incoming.model && incoming.model.trim()) || 'qwen/qwen3.8-27b',
        apiKey: finalKey
      });
    });
    serverConfig.translationProviders = updated;
  }

  // 4. Backward compatibility updates
  if (groqApiKey && groqApiKey.trim().length > 10 && !groqApiKey.includes('...')) {
    process.env.GROQ_API_KEY = groqApiKey.trim();
    serverConfig.transcription.apiKey = groqApiKey.trim();
  }
  if (openRouterApiKey && openRouterApiKey.trim().length > 10 && !openRouterApiKey.includes('...')) {
    process.env.OPENROUTER_API_KEY = openRouterApiKey.trim();
  }
  if (customApiKey && customApiKey.trim().length > 3 && !customApiKey.includes('...')) {
    process.env.CUSTOM_TRANSLATION_API_KEY = customApiKey.trim();
  }
  if (customEndpoint && customEndpoint.trim()) {
    process.env.CUSTOM_TRANSLATION_ENDPOINT = customEndpoint.trim();
  }
  if (customModel && customModel.trim()) {
    process.env.CUSTOM_TRANSLATION_MODEL = customModel.trim();
  }

  return res.json({ success: true, message: 'Settings updated successfully.' });
});

/**
 * POST /api/test-transcription-api: Test connection to speech-to-text / Whisper API
 */
app.post('/api/test-transcription-api', async (req, res) => {
  const { baseUrl, model, apiKey } = req.body;
  let effectiveKey = (apiKey && apiKey.trim()) || '';
  if (!effectiveKey || effectiveKey.includes('...')) {
    effectiveKey = serverConfig.transcription.apiKey || process.env.GROQ_API_KEY || '';
  }
  const effectiveBase = baseUrl || serverConfig.transcription.baseUrl || 'https://api.groq.com/openai/v1';
  const effectiveModel = model || serverConfig.transcription.model || 'whisper-large-v3';

  if (!effectiveKey) {
    return res.status(400).json({ error: 'Please provide an API key to test transcription.' });
  }

  try {
    const result = await testTranscriptionApiConnection(effectiveBase, effectiveModel, effectiveKey);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Transcription test failed.' });
  }
});

/**
 * POST /api/test-custom-api: Test connection to any translation provider (OpenAI-compatible)
 */
app.post('/api/test-custom-api', async (req, res) => {
  const { endpoint, baseUrl, model, apiKey, providerId } = req.body;
  const effectiveEndpoint = endpoint || baseUrl || 'https://top-tools-ai.com/api/v1';
  const effectiveModel = model || 'Top-Tools-Ai';

  let effectiveKey = (apiKey && apiKey.trim()) || '';
  if (!effectiveKey || effectiveKey.includes('...')) {
    if (providerId) {
      const match = serverConfig.translationProviders.find(p => p.id === providerId);
      if (match) effectiveKey = match.apiKey;
    }
    if (!effectiveKey) {
      effectiveKey = process.env.CUSTOM_TRANSLATION_API_KEY || process.env.GROQ_API_KEY || '';
    }
  }

  if (!effectiveKey) {
    return res.status(400).json({ error: 'Please provide an API key to test.' });
  }

  try {
    const result = await testCustomApiConnection(effectiveEndpoint, effectiveModel, effectiveKey);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Translation provider test failed.' });
  }
});

/**
 * POST /api/retranslate: Fast re-translation of existing subtitles using multi-provider fallback or ensemble
 */
app.post('/api/retranslate', async (req, res) => {
  const {
    jobId,
    targetLang,
    hindiScript,
    translationProviders,
    customEndpoint,
    customModel,
    customApiKey,
    translationMode
  } = req.body;

  if (!jobId) {
    return res.status(400).json({ error: 'Job ID is required.' });
  }

  const jaVttPath = path.join(SUBTITLES_DIR, `${jobId}_ja.vtt`);
  if (!fs.existsSync(jaVttPath)) {
    return res.status(404).json({ error: 'Original Japanese subtitles not found for this job.' });
  }

  try {
    const jaVtt = fs.readFileSync(jaVttPath, 'utf-8');
    const jaSegments = parseVttToSegments(jaVtt);
    if (!jaSegments || jaSegments.length === 0) {
      return res.status(400).json({ error: 'No segments found in Japanese subtitles.' });
    }

    let activeProviders = [];
    if (Array.isArray(translationProviders) && translationProviders.length > 0) {
      activeProviders = translationProviders.map(incoming => {
        const existing = serverConfig.translationProviders.find(p => p.id === incoming.id) || {};
        const key = (incoming.apiKey && incoming.apiKey.trim() && !incoming.apiKey.includes('...'))
          ? incoming.apiKey.trim()
          : existing.apiKey;
        return { ...incoming, apiKey: key };
      }).filter(p => p.apiKey && p.apiKey.trim());
    }

    if (!activeProviders || activeProviders.length === 0) {
      activeProviders = normalizeTranslationProviders(
        serverConfig.translationProviders,
        process.env.OPENROUTER_API_KEY,
        customEndpoint || process.env.CUSTOM_TRANSLATION_ENDPOINT,
        customModel || process.env.CUSTOM_TRANSLATION_MODEL,
        customApiKey || process.env.CUSTOM_TRANSLATION_API_KEY
      );
    }

    const chosenLang = targetLang || 'en';
    const effectiveMode = translationMode || serverConfig.translationMode || 'fallback';
    const resultSubtitles = {};

    // Pass 1: Global Context Dossier for re-translation
    const globalDossier = await generateGlobalContextDossier(
      jaSegments,
      activeProviders
    );

    if (chosenLang === 'en' || chosenLang === 'both') {
      const enSegments = await translateSegments(
        jaSegments,
        'en',
        activeProviders,
        null,
        null,
        null,
        null,
        'devanagari',
        null,
        globalDossier,
        effectiveMode
      );
      const enSubs = await saveSubtitles(SUBTITLES_DIR, jobId, 'en', enSegments);
      resultSubtitles.en = {
        vttUrl: `/api/subtitles/${jobId}/en/vtt?t=${Date.now()}`,
        srtUrl: `/api/subtitles/${jobId}/en/srt?t=${Date.now()}`,
        segments: enSegments,
        vttContent: enSubs.vttContent
      };
      const biEnSegments = generateBilingualSegments(jaSegments, enSegments);
      const biEnSubs = await saveSubtitles(SUBTITLES_DIR, jobId, 'bi_en', biEnSegments);
      resultSubtitles.bi_en = {
        vttUrl: `/api/subtitles/${jobId}/bi_en/vtt?t=${Date.now()}`,
        srtUrl: `/api/subtitles/${jobId}/bi_en/srt?t=${Date.now()}`,
        segments: biEnSegments,
        vttContent: biEnSubs.vttContent
      };
    }

    if (chosenLang === 'hi' || chosenLang === 'both') {
      const script = hindiScript === 'hinglish' ? 'hinglish' : 'devanagari';
      const hiSegments = await translateSegments(
        jaSegments,
        'hi',
        activeProviders,
        null,
        null,
        null,
        null,
        script,
        null,
        globalDossier,
        effectiveMode
      );
      const hiSubs = await saveSubtitles(SUBTITLES_DIR, jobId, 'hi', hiSegments);
      resultSubtitles.hi = {
        vttUrl: `/api/subtitles/${jobId}/hi/vtt?t=${Date.now()}`,
        srtUrl: `/api/subtitles/${jobId}/hi/srt?t=${Date.now()}`,
        segments: hiSegments,
        vttContent: hiSubs.vttContent,
        script
      };
      const biHiSegments = generateBilingualSegments(jaSegments, hiSegments);
      const biHiSubs = await saveSubtitles(SUBTITLES_DIR, jobId, 'bi_hi', biHiSegments);
      resultSubtitles.bi_hi = {
        vttUrl: `/api/subtitles/${jobId}/bi_hi/vtt?t=${Date.now()}`,
        srtUrl: `/api/subtitles/${jobId}/bi_hi/srt?t=${Date.now()}`,
        segments: biHiSegments,
        vttContent: biHiSubs.vttContent,
        script
      };
    }

    return res.json({
      success: true,
      jobId,
      subtitles: resultSubtitles
    });
  } catch (err) {
    console.error('[Retranslate Error]:', err);
    return res.status(500).json({ error: err.message || 'Re-translation failed.' });
  }
});

/**
 * POST /api/step2-extract-original: Step 2 - Extract High Quality Original Video Audio
 */
app.post('/api/step2-extract-original', upload.single('video'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video file provided.' });
  }

  const videoPath = req.file.path;
  const videoFileName = req.file.filename;
  const jobId = path.parse(videoFileName).name;
  const targetLang = req.body.targetLang || 'en';

  try {
    console.log(`[Step 2] Extracting high-quality original audio from ${videoFileName}...`);
    const audioPath = await extractOriginalAudio(videoPath, AUDIO_DIR, jobId);
    const videoStat = fs.statSync(videoPath);
    const audioStat = fs.statSync(audioPath);
    const meta = await getAudioMetadata(audioPath);

    return res.json({
      success: true,
      jobId,
      videoFileName,
      originalName: req.file.originalname,
      targetLang,
      videoSize: videoStat.size,
      audioSize: audioStat.size,
      durationSeconds: Number(meta.duration.toFixed(2)),
      sampleRate: meta.sampleRate,
      channels: meta.channels,
      bitRate: meta.bitRate,
      videoUrl: `/api/stream/${jobId}`,
      audioUrl: `/api/audio/${jobId}/original`
    });
  } catch (err) {
    console.error(`[Step 2 Error]:`, err);
    return res.status(500).json({ error: err.message || 'Failed to extract original audio.' });
  }
});

/**
 * POST /api/step3-prepare-transcription: Step 3 - Optimize Audio for AI Transcription (16kHz Mono)
 */
app.post('/api/step3-prepare-transcription', async (req, res) => {
  const { jobId, targetLang } = req.body;
  if (!jobId) {
    return res.status(400).json({ error: 'Job ID is required.' });
  }

  const originalAudioPath = path.join(AUDIO_DIR, `${jobId}_original.mp3`);
  if (!fs.existsSync(originalAudioPath)) {
    return res.status(404).json({ error: 'Original audio not found for this job.' });
  }

  try {
    console.log(`[Step 3] Preparing AI transcription audio (16kHz Mono) for job ${jobId}...`);
    const transAudioPath = await prepareTranscriptionAudio(originalAudioPath, AUDIO_DIR, jobId);
    const stat = fs.statSync(transAudioPath);
    const meta = await getAudioMetadata(transAudioPath);

    return res.json({
      success: true,
      jobId,
      targetLang: targetLang || 'en',
      audioSize: stat.size,
      durationSeconds: Number(meta.duration.toFixed(2)),
      sampleRate: 16000,
      channels: 1,
      bitRate: 48000,
      audioUrl: `/api/audio/${jobId}/transcribe`
    });
  } catch (err) {
    console.error(`[Step 3 Error]:`, err);
    return res.status(500).json({ error: err.message || 'Failed to prepare transcription audio.' });
  }
});

/**
 * POST /api/step4-transcribe: Step 4 - Transcribe Japanese Audio with real-time streaming activity log
 */
app.post('/api/step4-transcribe', async (req, res) => {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  const sendLog = (type, message, extra = {}) => {
    try {
      res.write(JSON.stringify({ type, message, timestamp: new Date().toLocaleTimeString(), ...extra }) + '\n');
    } catch (e) {
      console.error('Error writing log chunk:', e);
    }
  };

  const { jobId, customApiKey } = req.body;
  if (!jobId) {
    sendLog('error', 'Job ID is required.');
    return res.end();
  }

  const groqKey = (customApiKey && customApiKey.trim()) || process.env.GROQ_API_KEY;
  if (!groqKey) {
    sendLog('error', 'Groq API key is missing. Please check your settings.');
    return res.end();
  }

  // Audio path: prefer 16kHz transcription file, fallback to original or generic
  let audioPath = path.join(AUDIO_DIR, `${jobId}_transcribe.mp3`);
  if (!fs.existsSync(audioPath)) {
    audioPath = path.join(AUDIO_DIR, `${jobId}_original.mp3`);
  }
  if (!fs.existsSync(audioPath)) {
    audioPath = path.join(AUDIO_DIR, `${jobId}.mp3`);
  }

  if (!fs.existsSync(audioPath)) {
    sendLog('error', 'Audio file not found for transcription.');
    return res.end();
  }

  try {
    sendLog('log', `Initializing Whisper Large-v3 ASR pipeline for job ${jobId}...`);
    
    const audioStat = fs.statSync(audioPath);
    const audioMeta = await getAudioMetadata(audioPath);
    const isLongFile = audioMeta.duration > 600 || audioStat.size > 20 * 1024 * 1024;

    sendLog('log', `Audio specs: ${audioMeta.duration.toFixed(1)}s duration, ${(audioStat.size / (1024 * 1024)).toFixed(2)} MB, 16kHz Mono.`);

    let jaSegments = [];
    let duration = 0;

    if (isLongFile) {
      sendLog('log', `File exceeds 10 minutes. Activating FFmpeg Silence Detection filter...`);
      sendLog('log', `Scanning audio waveform for natural pause intervals (noise ≤ -30dB, d ≥ 0.5s)...`);
      
      const chunksDir = path.join(AUDIO_DIR, `chunks_${jobId}`);
      const chunks = await splitAudioAtSilence(audioPath, chunksDir, jobId, 600);
      
      sendLog('log', `Silence analysis complete! Sliced into ${chunks.length} clean parts without cutting speech:`);
      chunks.forEach(c => {
        sendLog('log', `  📦 Part ${c.index + 1}/${chunks.length}: starts at ${c.startTime.toFixed(1)}s (duration: ${c.duration.toFixed(1)}s)`);
      });

      const chunkResult = await transcribeAudioChunks(chunks, groqKey, (currentPart, totalParts) => {
        sendLog('log', `Sending Part ${currentPart}/${totalParts} to Groq Whisper Large-v3...`);
      });

      sendLog('log', `All ${chunks.length} parts received! Calibrating timestamp offsets and merging segments...`);
      jaSegments = chunkResult.segments;
      duration = chunkResult.duration;
    } else {
      sendLog('log', `Dispatching audio to Groq Whisper Large-v3 API with Japanese acoustic prompt...`);
      const transcription = await transcribeAudio(audioPath, groqKey);
      sendLog('log', `Whisper transcription complete! Captured vocalizations and dialogue.`);
      jaSegments = transcription.segments;
      duration = transcription.duration || 0;
    }

    const durationMin = (duration / 60).toFixed(1);

    if (!jaSegments || jaSegments.length === 0) {
      sendLog('error', 'No speech or vocalizations detected in the audio file.');
      return res.end();
    }

    sendLog('log', `✅ Total segments transcribed: ${jaSegments.length} (${durationMin} mins of audio).`);
    sendLog('log', `Compiling subtitle files into WebVTT and SubRip (.SRT) formats...`);

    // Save Japanese subtitles in VTT and SRT format
    const jaSubs = await saveSubtitles(SUBTITLES_DIR, jobId, 'ja', jaSegments);
    sendLog('log', `Subtitles generated and verified! Mounting synchronized cinema player...`);

    sendLog('complete', 'Pipeline completed successfully', {
      data: {
        success: true,
        jobId,
        segmentsCount: jaSegments.length,
        durationMinutes: durationMin,
        segments: jaSegments,
        vttUrl: `/api/subtitles/${jobId}/ja/vtt`,
        srtUrl: `/api/subtitles/${jobId}/ja/srt`,
        vttContent: jaSubs.vttContent
      }
    });

    res.end();
  } catch (err) {
    console.error(`[Step 4 Error]:`, err);
    sendLog('error', err.message || 'Transcription failed.');
    res.end();
  }
});

/**
 * GET /api/audio/:jobId/:type? : Stream/serve audio (original or transcribe)
 */
app.get('/api/audio/:jobId/:type?', (req, res) => {
  const { jobId, type } = req.params;
  const fileName = type === 'transcribe' ? `${jobId}_transcribe.mp3` : (type === 'original' ? `${jobId}_original.mp3` : `${jobId}.mp3`);
  let audioPath = path.join(AUDIO_DIR, fileName);

  if (!fs.existsSync(audioPath)) {
    // Fallback to any existing audio file for this jobId
    const fallbackOriginal = path.join(AUDIO_DIR, `${jobId}_original.mp3`);
    const fallbackTranscribe = path.join(AUDIO_DIR, `${jobId}_transcribe.mp3`);
    const fallbackLegacy = path.join(AUDIO_DIR, `${jobId}.mp3`);
    if (fs.existsSync(fallbackOriginal)) audioPath = fallbackOriginal;
    else if (fs.existsSync(fallbackTranscribe)) audioPath = fallbackTranscribe;
    else if (fs.existsSync(fallbackLegacy)) audioPath = fallbackLegacy;
    else return res.status(404).send('Audio file not found.');
  }

  const stat = fs.statSync(audioPath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = end - start + 1;
    const file = fs.createReadStream(audioPath, { start, end });
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'audio/mpeg'
    });
    file.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': 'audio/mpeg'
    });
    fs.createReadStream(audioPath).pipe(res);
  }
});

/**
 * POST /api/process: Full pipeline processing with streaming NDJSON progress events
 */
app.post('/api/process', upload.single('video'), async (req, res) => {
  // Setup streaming response
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  const sendEvent = (data) => {
    try {
      res.write(JSON.stringify(data) + '\n');
    } catch (e) {
      console.error('Error writing stream chunk:', e);
    }
  };

  if (!req.file) {
    sendEvent({ type: 'error', error: 'No video file uploaded.' });
    return res.end();
  }

  // Parse Transcription Configuration (Speech-to-Text)
  let transcriptionConfig = null;
  if (req.body.transcriptionConfig) {
    try {
      transcriptionConfig = typeof req.body.transcriptionConfig === 'string'
        ? JSON.parse(req.body.transcriptionConfig)
        : req.body.transcriptionConfig;
    } catch (e) {}
  }

  const transcriptionBaseUrl = (transcriptionConfig?.baseUrl && transcriptionConfig.baseUrl.trim())
    || serverConfig.transcription.baseUrl
    || 'https://api.groq.com/openai/v1';
  const transcriptionModel = (transcriptionConfig?.model && transcriptionConfig.model.trim())
    || serverConfig.transcription.model
    || 'whisper-large-v3';
  let transcriptionApiKey = (transcriptionConfig?.apiKey && transcriptionConfig.apiKey.trim() && !transcriptionConfig.apiKey.includes('...'))
    ? transcriptionConfig.apiKey.trim()
    : (serverConfig.transcription.apiKey || process.env.GROQ_API_KEY || '');

  if (!transcriptionApiKey) {
    sendEvent({
      type: 'error',
      error: 'Transcription API key is missing. Please configure it in the Settings panel.'
    });
    return res.end();
  }

  const transcriptionOptions = {
    baseUrl: transcriptionBaseUrl,
    model: transcriptionModel
  };

  // Parse Translation Providers (Fallback Chain)
  let activeProviders = [];
  if (req.body.translationProviders) {
    try {
      const incoming = typeof req.body.translationProviders === 'string'
        ? JSON.parse(req.body.translationProviders)
        : req.body.translationProviders;
      if (Array.isArray(incoming) && incoming.length > 0) {
        activeProviders = incoming.map(prov => {
          const existing = serverConfig.translationProviders.find(p => p.id === prov.id) || {};
          const key = (prov.apiKey && prov.apiKey.trim() && !prov.apiKey.includes('...'))
            ? prov.apiKey.trim()
            : existing.apiKey;
          return { ...prov, apiKey: key };
        }).filter(p => p.apiKey && p.apiKey.trim());
      }
    } catch (e) {}
  }

  if (!activeProviders || activeProviders.length === 0) {
    activeProviders = normalizeTranslationProviders(
      serverConfig.translationProviders,
      process.env.OPENROUTER_API_KEY,
      req.body.customTranslationEndpoint || process.env.CUSTOM_TRANSLATION_ENDPOINT,
      req.body.customTranslationModel || process.env.CUSTOM_TRANSLATION_MODEL,
      req.body.customTranslationApiKey || process.env.CUSTOM_TRANSLATION_API_KEY
    );
  }

  const targetLang = req.body.targetLang || 'en'; // 'en', 'hi', or 'both'
  const translationMode = req.body.translationMode || serverConfig.translationMode || 'fallback';
  const videoPath = req.file.path;
  const videoFileName = req.file.filename;
  const jobId = path.parse(videoFileName).name;

  try {
    sendEvent({
      type: 'progress',
      step: 'upload',
      percent: 15,
      message: `Uploaded: ${req.file.originalname} (${(req.file.size / (1024 * 1024)).toFixed(1)} MB)`
    });

    // 1. Extract Audio via FFmpeg (16kHz Mono)
    sendEvent({
      type: 'progress',
      step: 'extract',
      percent: 25,
      message: 'Extracting clean 16kHz mono audio via FFmpeg...'
    });
    const audioPath = await prepareTranscriptionAudio(videoPath, AUDIO_DIR, jobId);

    // 2. Transcribe Japanese Audio & Extract Acoustic Speech Translation (Dual-Channel)
    sendEvent({
      type: 'progress',
      step: 'transcribe',
      percent: 40,
      message: `Dual-Channel AI: Extracting Japanese transcript via ${transcriptionModel} + direct acoustic translation...`
    });

    const audioStat = fs.statSync(audioPath);
    const audioMeta = await getAudioMetadata(audioPath);
    const isLongFile = audioMeta.duration > 600 || audioStat.size > 20 * 1024 * 1024;

    let jaSegments = [];
    let duration = 0;

    if (isLongFile) {
      sendEvent({
        type: 'progress',
        step: 'transcribe',
        percent: 45,
        message: `Audio is ${(audioMeta.duration / 60).toFixed(1)} mins. Detecting silence boundaries for lossless chunking...`
      });

      const chunksDir = path.join(AUDIO_DIR, `chunks_${jobId}`);
      const chunks = await splitAudioAtSilence(audioPath, chunksDir, jobId, 600);
      
      sendEvent({
        type: 'progress',
        step: 'transcribe',
        percent: 50,
        message: `Split into ${chunks.length} seamless chunks. Running parallel dual-channel transcription & acoustic translation...`
      });

      const [chunkResult, audioChunkResult] = await Promise.all([
        transcribeAudioChunks(chunks, transcriptionApiKey, (curr, tot) => {
          sendEvent({
            type: 'progress',
            step: 'transcribe',
            percent: 50 + Math.round((curr / tot) * 10),
            message: `Dual-Channel: Processing chunk ${curr} of ${tot}...`
          });
        }, transcriptionOptions),
        translateAudioChunksDirect(chunks, transcriptionApiKey, null, transcriptionOptions).catch(e => {
          console.warn('[Audio Direct Chunk Translation Non-fatal]:', e.message);
          return { segments: [], fullText: '' };
        })
      ]);

      jaSegments = alignDualChannelSegments(chunkResult.segments, audioChunkResult.segments);
      duration = chunkResult.duration;
    } else {
      const [transcription, audioTranslationResult] = await Promise.all([
        transcribeAudio(audioPath, transcriptionApiKey, transcriptionOptions),
        translateAudioDirect(audioPath, transcriptionApiKey, transcriptionOptions).catch(e => {
          console.warn('[Audio Direct Translation Non-fatal]:', e.message);
          return { segments: [], fullText: '' };
        })
      ]);

      jaSegments = alignDualChannelSegments(transcription.segments, audioTranslationResult.segments);
      duration = transcription.duration || 0;
    }

    const durationMin = (duration / 60).toFixed(1);

    if (!jaSegments || jaSegments.length === 0) {
      throw new Error('No speech or vocalizations detected in the audio file.');
    }

    sendEvent({
      type: 'progress',
      step: 'transcribe_done',
      percent: 60,
      message: `✅ Dual-Channel aligned! Captured ${jaSegments.length} Japanese dialogue segments (${durationMin} mins of audio)`,
      segmentsCount: jaSegments.length,
      durationMinutes: durationMin
    });

    // Save Original Japanese Subtitles
    const jaSubs = await saveSubtitles(SUBTITLES_DIR, jobId, 'ja', jaSegments);
    const resultSubtitles = {
      ja: {
        vttUrl: `/api/subtitles/${jobId}/ja/vtt`,
        srtUrl: `/api/subtitles/${jobId}/ja/srt`,
        segments: jaSegments,
        vttContent: jaSubs.vttContent
      }
    };

    // 3. Translation: Pass 1 Global Dossier & Pass 2 Context-Conditioned Synthesis
    const primaryProvName = activeProviders[0]?.name || 'Primary AI';
    const fallbackCount = Math.max(0, activeProviders.length - 1);
    const chainDesc = fallbackCount > 0 ? `${primaryProvName} (+${fallbackCount} fallback)` : primaryProvName;
    const isEnsemble = translationMode === 'ensemble' && activeProviders.length > 1;
    const modeDesc = isEnsemble
      ? `🏆 Ensemble Consensus Matrix (${activeProviders.length} models in parallel)`
      : chainDesc;

    sendEvent({
      type: 'progress',
      step: 'translate',
      percent: 62,
      message: `🧠 Pass 1: Constructing Global Scene & Character Dossier using ${chainDesc}...`
    });

    const globalDossier = await generateGlobalContextDossier(
      jaSegments,
      activeProviders
    );

    if (globalDossier) {
      sendEvent({
        type: 'progress',
        step: 'translate',
        percent: 64,
        message: '✅ Global Context Dossier created! Starting multi-model contextual translation...'
      });
    }

    sendEvent({
      type: 'progress',
      step: 'translate',
      percent: 65,
      message: `Beginning contextual translation to ${targetLang.toUpperCase()} via ${modeDesc}...`
    });

    // English Translation
    if (targetLang === 'en' || targetLang === 'both') {
      sendEvent({
        type: 'progress',
        step: 'translate',
        percent: 65,
        message: `Translating to English (${isEnsemble ? 'Ensemble consensus voting' : 'preserving vocal markers'})...`
      });

      const enSegments = await translateSegments(
        jaSegments,
        'en',
        activeProviders,
        null,
        (prog) => {
          sendEvent({
            type: 'progress',
            step: 'translate',
            percent: Math.min(85, 65 + Math.round((prog.completedSegments / prog.totalSegments) * 20)),
            message: `[English] ${prog.status}`
          });
        },
        null,
        null,
        'devanagari',
        null,
        globalDossier,
        translationMode
      );

      const enSubs = await saveSubtitles(SUBTITLES_DIR, jobId, 'en', enSegments);
      resultSubtitles.en = {
        vttUrl: `/api/subtitles/${jobId}/en/vtt`,
        srtUrl: `/api/subtitles/${jobId}/en/srt`,
        segments: enSegments,
        vttContent: enSubs.vttContent
      };

      // Bilingual English + Japanese
      const biEnSegments = generateBilingualSegments(jaSegments, enSegments);
      const biEnSubs = await saveSubtitles(SUBTITLES_DIR, jobId, 'bi_en', biEnSegments);
      resultSubtitles.bi_en = {
        vttUrl: `/api/subtitles/${jobId}/bi_en/vtt`,
        srtUrl: `/api/subtitles/${jobId}/bi_en/srt`,
        segments: biEnSegments,
        vttContent: biEnSubs.vttContent
      };
    }

    // Hindi Translation (Devanagari vs Hinglish)
    const hindiScript = req.body.hindiScript === 'hinglish' ? 'hinglish' : 'devanagari';

    if (targetLang === 'hi' || targetLang === 'both') {
      const scriptLabel = hindiScript === 'hinglish' ? 'Hinglish (Roman Script)' : 'Hindi (हिन्दी / देवनागरी)';
      sendEvent({
        type: 'progress',
        step: 'translate',
        percent: 70,
        message: `Translating to ${scriptLabel} with expressive vocal markers...`
      });

      const hiSegments = await translateSegments(
        jaSegments,
        'hi',
        activeProviders,
        null,
        (prog) => {
          sendEvent({
            type: 'progress',
            step: 'translate',
            percent: Math.min(92, 70 + Math.round((prog.completedSegments / prog.totalSegments) * 22)),
            message: `[${hindiScript === 'hinglish' ? 'Hinglish' : 'Hindi'}] ${prog.status}`
          });
        },
        null,
        null,
        hindiScript,
        null,
        globalDossier,
        translationMode
      );

      const hiSubs = await saveSubtitles(SUBTITLES_DIR, jobId, 'hi', hiSegments);
      resultSubtitles.hi = {
        vttUrl: `/api/subtitles/${jobId}/hi/vtt`,
        srtUrl: `/api/subtitles/${jobId}/hi/srt`,
        segments: hiSegments,
        vttContent: hiSubs.vttContent,
        script: hindiScript
      };

      // Bilingual Hindi + Japanese
      const biHiSegments = generateBilingualSegments(jaSegments, hiSegments);
      const biHiSubs = await saveSubtitles(SUBTITLES_DIR, jobId, 'bi_hi', biHiSegments);
      resultSubtitles.bi_hi = {
        vttUrl: `/api/subtitles/${jobId}/bi_hi/vtt`,
        srtUrl: `/api/subtitles/${jobId}/bi_hi/srt`,
        segments: biHiSegments,
        vttContent: biHiSubs.vttContent,
        script: hindiScript
      };
    }

    // 4. Subtitles Complete
    sendEvent({
      type: 'progress',
      step: 'subtitles',
      percent: 98,
      message: 'Subtitles compiled into WebVTT and SubRip formats. Mounting player...'
    });

    sendEvent({
      type: 'complete',
      percent: 100,
      data: {
        success: true,
        jobId,
        videoFileName,
        videoStreamUrl: `/api/stream/${jobId}`,
        targetLang,
        translationMode,
        segmentsCount: jaSegments.length,
        durationMinutes: durationMin,
        subtitles: resultSubtitles
      }
    });

    res.end();
  } catch (err) {
    console.error(`[Job ${jobId}] Pipeline Error:`, err);
    const errorMsg = err.cause
      ? `${err.message} (${err.cause.message || err.cause.code || err.cause})`
      : (err.message || 'An error occurred during audio processing.');

    sendEvent({
      type: 'error',
      error: errorMsg
    });
    res.end();
  }
});

/**
 * GET /api/subtitles/:jobId/:lang/:format
 */
app.get('/api/subtitles/:jobId/:lang/:format', (req, res) => {
  const { jobId, lang, format } = req.params;
  const ext = format === 'srt' ? 'srt' : 'vtt';
  const filePath = path.join(SUBTITLES_DIR, `${jobId}_${lang}.${ext}`);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Subtitle file not found.');
  }

  const contentType = ext === 'vtt' ? 'text/vtt; charset=utf-8' : 'text/plain; charset=utf-8';
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `inline; filename="${jobId}_${lang}.${ext}"`);
  res.sendFile(filePath);
});

/**
 * GET /api/stream/:jobId
 * Streams video with HTTP 206 Partial Content for smooth seeking
 */
app.get('/api/stream/:jobId', (req, res) => {
  const { jobId } = req.params;
  const files = fs.readdirSync(UPLOADS_DIR);
  const matched = files.find(f => f.startsWith(jobId));

  if (!matched) {
    return res.status(404).send('Video not found.');
  }

  const videoPath = path.join(UPLOADS_DIR, matched);
  const stat = fs.statSync(videoPath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = end - start + 1;
    const file = fs.createReadStream(videoPath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'video/mp4'
    };
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4'
    };
    res.writeHead(200, head);
    fs.createReadStream(videoPath).pipe(res);
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`  🎌 NihonSub (日本サブ) - Server Running!`);
  console.log(`  🌐 URL: http://localhost:${PORT}`);
  console.log(`  📁 Workspace: ${__dirname}`);
  console.log(`====================================================`);
});
