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
export async function transcribeAudio(audioPath, apiKey) {
  if (!apiKey) {
    throw new Error('Groq API Key is missing. Please configure it in .env or the Settings panel.');
  }

  if (!fs.existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

  const audioBuffer = await fs.promises.readFile(audioPath);
  const audioBlob = new Blob([audioBuffer], { type: 'audio/mp3' });
  const fileObj = new File([audioBlob], path.basename(audioPath), { type: 'audio/mp3' });

  const formData = new FormData();
  formData.append('file', fileObj);
  formData.append('model', 'whisper-large-v3');
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
      response = await fetch(GROQ_TRANSCRIPTION_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`
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
    throw lastError || new Error('Failed to connect to Groq Whisper API after 3 attempts.');
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq Whisper API error (${response.status}): ${errorText}`);
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
export async function transcribeAudioChunks(chunks, apiKey, onChunkProgress) {
  let allSegments = [];
  let globalSegmentId = 0;
  let totalDuration = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    console.log(`[Whisper Chunks] Processing chunk ${i + 1}/${chunks.length} (starts at ${chunk.startTime}s)...`);

    if (onChunkProgress) {
      onChunkProgress(i + 1, chunks.length);
    }

    const chunkResult = await transcribeAudio(chunk.path, apiKey);

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
