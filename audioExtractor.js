import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

function resolveBinary(envVar, defaultPaths, binaryName) {
  if (process.env[envVar] && fs.existsSync(process.env[envVar])) {
    return process.env[envVar];
  }
  for (const p of defaultPaths) {
    if (fs.existsSync(p)) return p;
  }
  return binaryName; // fallback to system PATH
}

const FFMPEG_PATH = resolveBinary('FFMPEG_PATH', ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'], 'ffmpeg');
const FFPROBE_PATH = resolveBinary('FFPROBE_PATH', ['/opt/homebrew/bin/ffprobe', '/usr/local/bin/ffprobe', '/usr/bin/ffprobe'], 'ffprobe');

/**
 * Extracts original audio from video with high fidelity (preserving stereo, original sample rate, high bitrate).
 * @param {string} videoPath - Path to the source video.
 * @param {string} outputDir - Directory to store extracted audio.
 * @param {string} jobId - Unique job identifier.
 * @returns {Promise<string>} - Resolves with original audio file path.
 */
export async function extractOriginalAudio(videoPath, outputDir, jobId) {
  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video file not found at: ${videoPath}`);
  }

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, `${jobId}_original.mp3`);

  return new Promise((resolve, reject) => {
    // Extract high fidelity stereo audio at 192k or original quality
    const args = [
      '-y',
      '-i', videoPath,
      '-vn',
      '-acodec', 'libmp3lame',
      '-b:a', '192k',
      outputPath
    ];

    const proc = spawn(FFMPEG_PATH, args);
    let stderrData = '';

    proc.stderr.on('data', (chunk) => {
      stderrData += chunk.toString();
    });

    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        resolve(outputPath);
      } else {
        reject(new Error(`FFmpeg exited with code ${code}. Error: ${stderrData.slice(-500)}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to start FFmpeg process: ${err.message}`));
    });
  });
}

/**
 * Prepares the audio specifically for AI Transcription (16kHz mono 48kbps Whisper optimized).
 * @param {string} inputAudioPath - Path to original audio (or video).
 * @param {string} outputDir - Directory to store transcription-ready audio.
 * @param {string} jobId - Unique job identifier.
 * @returns {Promise<string>} - Resolves with the optimized audio file path.
 */
export async function prepareTranscriptionAudio(inputAudioPath, outputDir, jobId) {
  if (!fs.existsSync(inputAudioPath)) {
    throw new Error(`Audio source file not found at: ${inputAudioPath}`);
  }

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, `${jobId}_transcribe.mp3`);

  return new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-i', inputAudioPath,
      '-vn',
      '-acodec', 'libmp3lame',
      '-ar', '16000',
      '-ac', '1',
      '-b:a', '48k',
      outputPath
    ];

    const proc = spawn(FFMPEG_PATH, args);
    let stderrData = '';

    proc.stderr.on('data', (chunk) => {
      stderrData += chunk.toString();
    });

    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        resolve(outputPath);
      } else {
        reject(new Error(`FFmpeg exited with code ${code}. Error: ${stderrData.slice(-500)}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to start FFmpeg process: ${err.message}`));
    });
  });
}

/**
 * Backward compatibility helper for legacy callers.
 */
export async function extractAudio(videoPath, outputDir, jobId) {
  return prepareTranscriptionAudio(videoPath, outputDir, jobId);
}

/**
 * Gets audio metadata (sample rate, channels, duration, bitrate) using ffprobe.
 */
export async function getAudioMetadata(filePath) {
  return new Promise((resolve) => {
    const proc = spawn(FFPROBE_PATH, [
      '-v', 'error',
      '-select_streams', 'a:0',
      '-show_entries', 'stream=sample_rate,channels,bit_rate:format=duration',
      '-of', 'json',
      filePath
    ]);

    let output = '';
    proc.stdout.on('data', (chunk) => { output += chunk.toString(); });
    proc.on('close', (code) => {
      if (code === 0 && output.trim()) {
        try {
          const parsed = JSON.parse(output);
          const stream = parsed.streams && parsed.streams[0] ? parsed.streams[0] : {};
          const format = parsed.format || {};
          resolve({
            duration: parseFloat(format.duration || 0),
            sampleRate: parseInt(stream.sample_rate || 44100, 10),
            channels: parseInt(stream.channels || 2, 10),
            bitRate: parseInt(stream.bit_rate || 192000, 10)
          });
          return;
        } catch {
          // fallback
        }
      }
      resolve({ duration: 0, sampleRate: 44100, channels: 2, bitRate: 192000 });
    });
    proc.on('error', () => {
      resolve({ duration: 0, sampleRate: 44100, channels: 2, bitRate: 192000 });
    });
  });
}

/**
 * Gets duration of media file in seconds using ffprobe.
 */
export async function getMediaDuration(filePath) {
  const meta = await getAudioMetadata(filePath);
  return meta.duration;
}

/**
 * Detects silent intervals in an audio file using FFmpeg silencedetect.
 * @param {string} audioPath - Path to audio file.
 * @param {number} noiseThresholdDb - Silence noise threshold in dB (e.g. -30dB or -35dB).
 * @param {number} minDurationSec - Minimum silence duration in seconds (e.g. 0.5s).
 * @returns {Promise<Array<{ start: number, end: number, midpoint: number }>>}
 */
export async function detectSilenceIntervals(audioPath, noiseThresholdDb = -30, minDurationSec = 0.5) {
  return new Promise((resolve) => {
    const args = [
      '-i', audioPath,
      '-af', `silencedetect=noise=${noiseThresholdDb}dB:d=${minDurationSec}`,
      '-f', 'null',
      '-'
    ];

    const proc = spawn(FFMPEG_PATH, args);
    let stderr = '';

    proc.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    proc.on('close', () => {
      const silences = [];
      const silenceStartRegex = /silence_start:\s*([0-9.]+)/g;
      const silenceEndRegex = /silence_end:\s*([0-9.]+)/g;

      const starts = [];
      let match;
      while ((match = silenceStartRegex.exec(stderr)) !== null) {
        starts.push(parseFloat(match[1]));
      }

      let endIdx = 0;
      while ((match = silenceEndRegex.exec(stderr)) !== null) {
        const endTime = parseFloat(match[1]);
        const startTime = starts[endIdx] !== undefined ? starts[endIdx] : Math.max(0, endTime - minDurationSec);
        silences.push({
          start: startTime,
          end: endTime,
          midpoint: Number(((startTime + endTime) / 2).toFixed(2))
        });
        endIdx++;
      }

      resolve(silences);
    });

    proc.on('error', () => resolve([]));
  });
}

/**
 * Splits a long audio file at natural silence points into chunks under a maximum target duration.
 * @param {string} audioPath - Source audio file path.
 * @param {string} chunksDir - Destination directory for chunks.
 * @param {string} jobId - Unique job identifier.
 * @param {number} maxChunkSeconds - Max duration per chunk (default: 600s = 10 minutes).
 * @returns {Promise<Array<{ index: number, path: string, startTime: number, duration: number }>>}
 */
export async function splitAudioAtSilence(audioPath, chunksDir, jobId, maxChunkSeconds = 600) {
  if (!fs.existsSync(chunksDir)) {
    fs.mkdirSync(chunksDir, { recursive: true });
  }

  const totalDuration = await getMediaDuration(audioPath);
  
  // If file is shorter than maxChunkSeconds, no splitting needed
  if (totalDuration <= maxChunkSeconds) {
    return [{
      index: 0,
      path: audioPath,
      startTime: 0,
      duration: totalDuration
    }];
  }

  console.log(`[Silence Split] Analyzing silence intervals for ${totalDuration.toFixed(1)}s audio...`);
  const silences = await detectSilenceIntervals(audioPath);

  // Calculate split points near natural silence boundaries
  const splitPoints = [0];
  let currentStart = 0;

  while (currentStart + maxChunkSeconds < totalDuration) {
    const targetTime = currentStart + maxChunkSeconds;
    // Look for a silence midpoint in a window of ±60s around the target time
    const searchWindowStart = targetTime - 60;
    const searchWindowEnd = Math.min(totalDuration, targetTime + 60);

    const candidateSilences = silences.filter(s => s.midpoint >= searchWindowStart && s.midpoint <= searchWindowEnd);

    let splitAt = targetTime;
    if (candidateSilences.length > 0) {
      // Pick silence closest to target
      candidateSilences.sort((a, b) => Math.abs(a.midpoint - targetTime) - Math.abs(b.midpoint - targetTime));
      splitAt = candidateSilences[0].midpoint;
    }

    splitPoints.push(splitAt);
    currentStart = splitAt;
  }

  splitPoints.push(totalDuration);

  // Extract individual chunks via FFmpeg
  const chunks = [];
  for (let i = 0; i < splitPoints.length - 1; i++) {
    const chunkStart = splitPoints[i];
    const chunkEnd = splitPoints[i + 1];
    const chunkDuration = chunkEnd - chunkStart;

    if (chunkDuration <= 0.5) continue; // Skip negligible edge slivers

    const chunkFileName = `${jobId}_part_${String(i).padStart(3, '0')}.mp3`;
    const chunkFilePath = path.join(chunksDir, chunkFileName);

    await new Promise((resolve, reject) => {
      const args = [
        '-y',
        '-ss', String(chunkStart),
        '-i', audioPath,
        '-t', String(chunkDuration),
        '-acodec', 'copy', // Stream copy for near-instant lossless cut
        chunkFilePath
      ];

      const proc = spawn(FFMPEG_PATH, args);
      proc.on('close', (code) => {
        if (code === 0 && fs.existsSync(chunkFilePath)) resolve();
        else reject(new Error(`Failed to create audio chunk ${i}`));
      });
      proc.on('error', reject);
    });

    chunks.push({
      index: i,
      path: chunkFilePath,
      startTime: Number(chunkStart.toFixed(2)),
      duration: Number(chunkDuration.toFixed(2))
    });
  }

  console.log(`[Silence Split] Created ${chunks.length} clean chunks split at silence boundaries.`);
  return chunks;
}
