import fs from 'fs';
import path from 'path';

/**
 * Formats seconds into WebVTT timestamp: HH:MM:SS.mmm
 */
export function formatVttTime(seconds) {
  const totalMs = Math.max(0, Math.floor(seconds * 1000));
  const hrs = Math.floor(totalMs / 3600000);
  const mins = Math.floor((totalMs % 3600000) / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;

  const hh = String(hrs).padStart(2, '0');
  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  const mmm = String(ms).padStart(3, '0');

  return `${hh}:${mm}:${ss}.${mmm}`;
}

/**
 * Formats seconds into SRT timestamp: HH:MM:SS,mmm
 */
export function formatSrtTime(seconds) {
  const vtt = formatVttTime(seconds);
  return vtt.replace('.', ',');
}

/**
 * Generates WebVTT text from segments array.
 */
export function generateWebVTT(segments) {
  let vtt = 'WEBVTT\n\n';

  segments.forEach((seg, idx) => {
    const start = formatVttTime(seg.start);
    const end = formatVttTime(seg.end);
    vtt += `${idx + 1}\n`;
    vtt += `${start} --> ${end}\n`;
    vtt += `${seg.text}\n\n`;
  });

  return vtt;
}

/**
 * Generates SubRip (.srt) text from segments array.
 */
export function generateSRT(segments) {
  let srt = '';

  segments.forEach((seg, idx) => {
    const start = formatSrtTime(seg.start);
    const end = formatSrtTime(seg.end);
    srt += `${idx + 1}\n`;
    srt += `${start} --> ${end}\n`;
    srt += `${seg.text}\n\n`;
  });

  return srt;
}

/**
 * Generates bilingual segments (combines Japanese and target translation).
 */
export function generateBilingualSegments(jaSegments, translatedSegments) {
  return translatedSegments.map(trans => {
    const orig = jaSegments.find(j => j.id === trans.id);
    const origText = orig ? orig.text : '';
    return {
      id: trans.id,
      start: trans.start,
      end: trans.end,
      text: `${trans.text}\n${origText}`.trim()
    };
  });
}

/**
 * Saves subtitle files (.vtt and .srt) to the subtitles directory.
 */
export async function saveSubtitles(outputDir, jobId, lang, segments) {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const vttContent = generateWebVTT(segments);
  const srtContent = generateSRT(segments);

  const vttPath = path.join(outputDir, `${jobId}_${lang}.vtt`);
  const srtPath = path.join(outputDir, `${jobId}_${lang}.srt`);

  await fs.promises.writeFile(vttPath, vttContent, 'utf-8');
  await fs.promises.writeFile(srtPath, srtContent, 'utf-8');

  return { vttPath, srtPath, vttContent, srtContent };
}
