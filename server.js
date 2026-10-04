import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

import { extractOriginalAudio, prepareTranscriptionAudio, getAudioMetadata, splitAudioAtSilence } from './audioExtractor.js';
import { transcribeAudio, transcribeAudioChunks } from './transcriber.js';
import { translateSegments } from './translator.js';
import { saveSubtitles, generateBilingualSegments } from './subtitleGenerator.js';

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

/**
 * GET /api/config: Check API key status
 */
app.get('/api/config', (req, res) => {
  const groqKey = process.env.GROQ_API_KEY || '';
  const orKey = process.env.OPENROUTER_API_KEY || '';
  const isGroqConfigured = groqKey.length > 10;
  const isOrConfigured = orKey.length > 10;

  const maskedGroq = isGroqConfigured
    ? `${groqKey.substring(0, 6)}...${groqKey.substring(groqKey.length - 4)}`
    : 'Not configured';

  res.json({
    groqConfigured: isGroqConfigured,
    openRouterConfigured: isOrConfigured,
    maskedKey: maskedGroq
  });
});

/**
 * POST /api/config: Update API keys dynamically
 */
app.post('/api/config', (req, res) => {
  const { groqApiKey, openRouterApiKey } = req.body;
  if (groqApiKey && groqApiKey.trim().length > 10) {
    process.env.GROQ_API_KEY = groqApiKey.trim();
  }
  if (openRouterApiKey && openRouterApiKey.trim().length > 10) {
    process.env.OPENROUTER_API_KEY = openRouterApiKey.trim();
  }
  return res.json({ success: true, message: 'Settings updated successfully.' });
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

  const groqKey = (req.body.customApiKey && req.body.customApiKey.trim()) || process.env.GROQ_API_KEY;
  const openRouterKey = process.env.OPENROUTER_API_KEY || '';

  if (!groqKey) {
    sendEvent({
      type: 'error',
      error: 'Groq API key is missing. Please set it in .env or the Settings panel.'
    });
    return res.end();
  }

  const targetLang = req.body.targetLang || 'en'; // 'en', 'hi', or 'both'
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

    // 2. Transcribe Japanese Audio with Vocalization Capture & Silence Chunking
    sendEvent({
      type: 'progress',
      step: 'transcribe',
      percent: 40,
      message: 'Transcribing Japanese dialogue & vocalizations with Whisper Large-v3...'
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
        message: `Split into ${chunks.length} seamless chunks at natural silence pauses. Transcribing in sequence...`
      });

      const chunkResult = await transcribeAudioChunks(chunks, groqKey, (curr, tot) => {
        sendEvent({
          type: 'progress',
          step: 'transcribe',
          percent: 50 + Math.round((curr / tot) * 10),
          message: `Transcribing chunk ${curr} of ${tot}...`
        });
      });

      jaSegments = chunkResult.segments;
      duration = chunkResult.duration;
    } else {
      const transcription = await transcribeAudio(audioPath, groqKey);
      jaSegments = transcription.segments;
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
      message: `✅ Transcribed ${jaSegments.length} Japanese dialogue segments (${durationMin} mins of audio)`,
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

    // 3. Translation
    const customEndpoint = req.body.customTranslationEndpoint || '';
    const customModel = req.body.customTranslationModel || '';

    sendEvent({
      type: 'progress',
      step: 'translate',
      percent: 65,
      message: `Beginning contextual translation to ${targetLang.toUpperCase()}...`
    });

    // English Translation (Two-Step Contextual LLM Pipeline)
    if (targetLang === 'en' || targetLang === 'both') {
      sendEvent({
        type: 'progress',
        step: 'translate',
        percent: 65,
        message: 'Translating to English (preserving sighs, moans, grunts, fillers)...'
      });

      const enSegments = await translateSegments(
        jaSegments,
        'en',
        groqKey,
        openRouterKey,
        (prog) => {
          sendEvent({
            type: 'progress',
            step: 'translate',
            percent: Math.min(85, 65 + Math.round((prog.completedSegments / prog.totalSegments) * 20)),
            message: `[English] ${prog.status}`
          });
        },
        customEndpoint,
        customModel
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

    // Hindi Translation
    if (targetLang === 'hi' || targetLang === 'both') {
      sendEvent({
        type: 'progress',
        step: 'translate',
        percent: 70,
        message: 'Translating to Hindi (हिन्दी) with expressive vocal markers...'
      });

      const hiSegments = await translateSegments(
        jaSegments,
        'hi',
        groqKey,
        openRouterKey,
        (prog) => {
          sendEvent({
            type: 'progress',
            step: 'translate',
            percent: Math.min(92, 70 + Math.round((prog.completedSegments / prog.totalSegments) * 22)),
            message: `[Hindi] ${prog.status}`
          });
        },
        customEndpoint,
        customModel
      );

      const hiSubs = await saveSubtitles(SUBTITLES_DIR, jobId, 'hi', hiSegments);
      resultSubtitles.hi = {
        vttUrl: `/api/subtitles/${jobId}/hi/vtt`,
        srtUrl: `/api/subtitles/${jobId}/hi/srt`,
        segments: hiSegments,
        vttContent: hiSubs.vttContent
      };

      // Bilingual Hindi + Japanese
      const biHiSegments = generateBilingualSegments(jaSegments, hiSegments);
      const biHiSubs = await saveSubtitles(SUBTITLES_DIR, jobId, 'bi_hi', biHiSegments);
      resultSubtitles.bi_hi = {
        vttUrl: `/api/subtitles/${jobId}/bi_hi/vtt`,
        srtUrl: `/api/subtitles/${jobId}/bi_hi/srt`,
        segments: biHiSegments,
        vttContent: biHiSubs.vttContent
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
  console.log(`  🎌 Japanese Video Subtitler Server Running!`);
  console.log(`  🌐 URL: http://localhost:${PORT}`);
  console.log(`  📁 Workspace: ${__dirname}`);
  console.log(`====================================================`);
});
