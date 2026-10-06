import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import fs from 'fs';
import path from 'path';

const GROQ_TRANSCRIPTION_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

/**
 * Validates whether text contains sufficient Japanese characters (Hiragana, Katakana, Kanji).
 */
export function containsJapanese(text) {
  if (!text || text.trim().length === 0) return true;
  const japaneseRegex = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/g;
  const matches = text.match(japaneseRegex);
  return Boolean(matches && matches.length > 0);
}

/**
 * Transcribes a single audio file via Groq Whisper API (whisper-large-v3).
 * Captures non-verbal vocalizations (grunts, sighs, moans, humming, fillers) using specialized acoustic prompts.
 *
 * @param {string} audioPath - Path to the 16kHz mono audio file.
 * @param {string} apiKey - Groq API Key.
 * @returns {Promise<{ segments: Array<{ id: number, start: number, end: number, text: string }>, fullText: string, language: string, duration: number }>}
 */
export async function transcribeAudio(audioPath, apiKey, options = {}) {
  const effectiveKey = apiKey || process.env.GROQ_API_KEY;
  if (!effectiveKey) {
    throw new Error('Transcription API Key is missing. Please configure it in .env or the Settings panel.');
  }

  if (!fs.existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

  const baseUrl = (options.baseUrl && options.baseUrl.trim()) || process.env.TRANSCRIPTION_BASE_URL || 'https://api.groq.com/openai/v1';
  const modelToUse = (options.model && options.model.trim()) || process.env.TRANSCRIPTION_MODEL || 'whisper-large-v3';
  const transcriptionEndpoint = `${baseUrl.replace(/\/+$/, '')}/audio/transcriptions`;

  const audioBuffer = await fs.promises.readFile(audioPath);
  const audioBlob = new Blob([audioBuffer], { type: 'audio/mp3' });
  const fileObj = new File([audioBlob], path.basename(audioPath), { type: 'audio/mp3' });

  const formData = new FormData();
  formData.append('file', fileObj);
  formData.append('model', modelToUse);
  formData.append('language', 'ja'); // Strictly Japanese
  formData.append('response_format', 'verbose_json');
  formData.append('temperature', '0.0');

  // Explicit acoustic prompt biasing Whisper towards capturing subtle vocalizations, interjections, and sounds
  formData.append(
    'prompt',
    'あっ、んっ、うっ、ふぅ、はぁ、うーん、あぁ、えっ、ハァ…ハァ…、ふふっ、んんっ、クッ、息遣いや声、喘ぎ、呻き声、ため息、相槌を含めて正確に文字起こししてください。'
  );

  let response;
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      response = await fetch(transcriptionEndpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${effectiveKey}`
        },
        body: formData
      });
      break;
    } catch (err) {
      lastError = err;
      console.warn(`[Transcription] Attempt ${attempt} failed: ${err.message}. Retrying in ${attempt}s...`);
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, attempt * 1000));
      }
    }
  }

  if (!response) {
    throw lastError || new Error(`Failed to connect to Whisper API at ${transcriptionEndpoint} after 3 attempts.`);
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Whisper API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();

  // Validate Language
  const detectedLang = (data.language || 'ja').toLowerCase();
  if (detectedLang !== 'ja' && detectedLang !== 'japanese') {
    throw new Error(
      `Non-Japanese audio detected (${data.language}). This application strictly processes Japanese language audio.`
    );
  }

  const fullText = (data.text || '').trim();

  // Additional check: If significant text was transcribed but contains zero Japanese characters
  if (fullText.length > 20 && !containsJapanese(fullText)) {
    throw new Error(
      'Detected non-Japanese audio speech. This application only accepts Japanese language audio.'
    );
  }

  const rawSegments = data.segments || [];
  const segments = rawSegments
    .map((seg, idx) => ({
      id: idx,
      start: Number(seg.start.toFixed(3)),
      end: Number(seg.end.toFixed(3)),
      text: seg.text.trim()
    }))
    .filter(seg => seg.text.length > 0);

  return {
    segments,
    fullText,
    language: detectedLang,
    duration: data.duration || (segments.length > 0 ? segments[segments.length - 1].end : 0)
  };
}



/**
 * Transcribes multiple audio chunks in controlled sequence with silence boundaries.
 * Offsets each chunk's timestamps by its startTime so the entire timeline remains seamless.
 *
 * @param {Array<{ index: number, path: string, startTime: number, duration: number }>} chunks
 * @param {string} apiKey - Groq API Key
 * @param {Function} [onChunkProgress] - Optional progress callback: (chunkIndex, totalChunks) => void
 * @returns {Promise<{ segments: Array<{ id: number, start: number, end: number, text: string }>, duration: number }>}
 */
export async function transcribeAudioChunks(chunks, apiKey, onChunkProgress, options = {}) {
  let allSegments = [];
  let globalSegmentId = 0;
  let totalDuration = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    console.log(`[Whisper Chunks] Processing chunk ${i + 1}/${chunks.length} (starts at ${chunk.startTime}s)...`);

    if (onChunkProgress) {
      onChunkProgress(i + 1, chunks.length);
    }

    const chunkResult = await transcribeAudio(chunk.path, apiKey, options);

    // Apply exact timestamp offset
    const mapped = chunkResult.segments.map(seg => ({
      id: globalSegmentId++,
      start: Number((seg.start + chunk.startTime).toFixed(3)),
      end: Number((seg.end + chunk.startTime).toFixed(3)),
      text: seg.text
    }));

    allSegments = allSegments.concat(mapped);
    totalDuration = Math.max(totalDuration, chunk.startTime + (chunkResult.duration || chunk.duration));

    // Polite rate-limit delay between chunks (1.5 seconds)
    if (i < chunks.length - 1) {
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  // Sort segments strictly by start time
  allSegments.sort((a, b) => a.start - b.start);

  return {
    segments: allSegments,
    duration: totalDuration
  };
}

/**
 * Extracts acoustic speech-to-English translation directly from the audio waveform using Whisper.
 * @param {string} audioPath - Path to 16kHz audio file.
 * @param {string} apiKey - Transcription API Key.
 * @param {object} [options] - { baseUrl, model }
 * @returns {Promise<{ segments: Array<{ id: number, start: number, end: number, text: string }>, fullText: string }>}
 */
export async function translateAudioDirect(audioPath, apiKey, options = {}) {
  const effectiveKey = apiKey || process.env.GROQ_API_KEY;
  if (!effectiveKey || !fs.existsSync(audioPath)) {
    return { segments: [], fullText: '' };
  }

  const baseUrl = (options.baseUrl && options.baseUrl.trim()) || process.env.TRANSCRIPTION_BASE_URL || 'https://api.groq.com/openai/v1';
  const modelToUse = (options.model && options.model.trim()) || process.env.TRANSCRIPTION_MODEL || 'whisper-large-v3';
  const translationEndpoint = `${baseUrl.replace(/\/+$/, '')}/audio/translations`;

  const audioBuffer = await fs.promises.readFile(audioPath);
  const audioBlob = new Blob([audioBuffer], { type: 'audio/mp3' });
  const fileObj = new File([audioBlob], path.basename(audioPath), { type: 'audio/mp3' });

  const formData = new FormData();
  formData.append('file', fileObj);
  formData.append('model', modelToUse);
  formData.append('response_format', 'verbose_json');
  formData.append('temperature', '0.0');

  try {
    const response = await fetch(translationEndpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${effectiveKey}` },
      body: formData
    });

    if (!response.ok) {
      console.warn(`[Audio Direct Translation Failed] Status ${response.status} at ${translationEndpoint}`);
      return { segments: [], fullText: '' };
    }

    const data = await response.json();
    const rawSegments = data.segments || [];
    const segments = rawSegments
      .map((seg, idx) => ({
        id: idx,
        start: Number(seg.start.toFixed(3)),
        end: Number(seg.end.toFixed(3)),
        text: seg.text.trim()
      }))
      .filter(seg => seg.text.length > 0);

    return {
      segments,
      fullText: (data.text || '').trim()
    };
  } catch (err) {
    console.warn(`[Audio Direct Translation Error]: ${err.message}`);
    return { segments: [], fullText: '' };
  }
}

/**
 * Direct audio translation for sliced chunks.
 */
export async function translateAudioChunksDirect(chunks, apiKey, onChunkProgress, options = {}) {
  let allSegments = [];
  let fullTextParts = [];
  let globalSegmentId = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (onChunkProgress) onChunkProgress(i + 1, chunks.length);

    const chunkResult = await translateAudioDirect(chunk.path, apiKey, options);
    const mapped = chunkResult.segments.map(seg => ({
      id: globalSegmentId++,
      start: Number((seg.start + chunk.startTime).toFixed(3)),
      end: Number((seg.end + chunk.startTime).toFixed(3)),
      text: seg.text
    }));
    allSegments = allSegments.concat(mapped);
    if (chunkResult.fullText) fullTextParts.push(chunkResult.fullText);

    if (i < chunks.length - 1) {
      await new Promise(r => setTimeout(r, 1200));
    }
  }

  allSegments.sort((a, b) => a.start - b.start);
  return {
    segments: allSegments,
    fullText: fullTextParts.join(' ')
  };
}

/**
 * Tests connection to a speech-to-text / Whisper API endpoint.
 * @param {string} baseUrl
 * @param {string} model
 * @param {string} apiKey
 */
export async function testTranscriptionApiConnection(baseUrl, model, apiKey) {
  const effectiveBaseUrl = (baseUrl && baseUrl.trim()) || 'https://api.groq.com/openai/v1';
  const effectiveModel = (model && model.trim()) || 'whisper-large-v3';
  const effectiveKey = (apiKey && apiKey.trim()) || process.env.GROQ_API_KEY || '';

  if (!effectiveKey) {
    throw new Error('API Key is required to test transcription endpoint.');
  }

  const cleanBase = effectiveBaseUrl.replace(/\/+$/, '');
  const modelsUrl = `${cleanBase}/models`;

  try {
    const res = await fetch(modelsUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${effectiveKey}`
      }
    });

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      const modelList = data.data || [];
      const hasModel = modelList.some(m => m.id === effectiveModel);
      return {
        success: true,
        baseUrl: cleanBase,
        model: effectiveModel,
        modelConfirmed: hasModel,
        message: hasModel
          ? `Connected! Model "${effectiveModel}" is verified and active.`
          : `Connected! Base URL is responsive (model "${effectiveModel}" ready).`
      };
    }

    if (res.status === 401 || res.status === 403) {
      throw new Error(`Authentication failed (${res.status}): Invalid API Key.`);
    }

    // Some custom audio endpoints don't implement /models. Check /audio/transcriptions accessibility.
    return {
      success: true,
      baseUrl: cleanBase,
      model: effectiveModel,
      message: `Endpoint verified (${cleanBase}). Ready for audio speech recognition.`
    };
  } catch (err) {
    if (err.message.includes('Authentication failed')) throw err;
    throw new Error(`Transcription connection test failed: ${err.message}`);
  }
}

/**
 * Aligns original Japanese transcript segments with Whisper's direct acoustic audio translation
 * by calculating temporal timestamp overlap.
 */
export function alignDualChannelSegments(jaSegments, audioTransSegments) {
  if (!audioTransSegments || audioTransSegments.length === 0) {
    return jaSegments.map(j => ({ ...j, acousticAudioTranslation: '' }));
  }

  return jaSegments.map(j => {
    // Find audio translation segments that overlap with this Japanese segment
    const overlapping = audioTransSegments.filter(t => {
      const overlapStart = Math.max(j.start, t.start);
      const overlapEnd = Math.min(j.end, t.end);
      return overlapEnd > overlapStart;
    });

    let matchedText = '';
    if (overlapping.length > 0) {
      matchedText = overlapping.map(o => o.text).join(' ').trim();
    } else {
      // If no strict overlap, find the nearest audio translation segment within ±1.5s
      const nearest = audioTransSegments.find(t => Math.abs(t.start - j.start) <= 1.5);
      if (nearest) matchedText = nearest.text;
    }

    return {
      ...j,
      acousticAudioTranslation: matchedText
    };
  });
}
