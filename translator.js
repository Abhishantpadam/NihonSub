import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Normalizes translation providers from either an array or legacy parameters.
 * Returns an ordered array of provider objects: [{ id, name, baseUrl, model, apiKey }]
 */
export function normalizeTranslationProviders(providersOrKey, openRouterKey, customEndpoint, customModel, customApiKey) {
  if (Array.isArray(providersOrKey) && providersOrKey.length > 0) {
    return providersOrKey
      .filter(p => p && p.apiKey && p.apiKey.trim())
      .map((p, idx) => ({
        id: p.id || `prov_${idx + 1}`,
        name: p.name || `Provider #${idx + 1}`,
        baseUrl: (p.baseUrl && p.baseUrl.trim()) || 'https://api.groq.com/openai/v1',
        model: (p.model && p.model.trim()) || 'qwen/qwen3.8-27b',
        apiKey: p.apiKey.trim()
      }));
  }

  const list = [];
  // 1. If customEndpoint & customApiKey provided (e.g. top-tools-ai.com)
  if (customApiKey && customApiKey.trim()) {
    list.push({
      id: 'custom',
      name: 'Custom Provider (top-tools-ai / Custom)',
      baseUrl: (customEndpoint && customEndpoint.trim()) || 'https://top-tools-ai.com/api/v1',
      model: (customModel && customModel.trim()) || 'Top-Tools-Ai',
      apiKey: customApiKey.trim()
    });
  }

  // 2. Groq primary
  const groqKey = typeof providersOrKey === 'string' ? providersOrKey : (process.env.GROQ_API_KEY || '');
  if (groqKey && groqKey.trim()) {
    list.push({
      id: 'groq',
      name: 'Groq LPU (Qwen 3.8)',
      baseUrl: 'https://api.groq.com/openai/v1',
      model: process.env.TRANSLATION_MODEL || 'qwen/qwen3.8-27b',
      apiKey: groqKey.trim()
    });
  }

  // 3. OpenRouter fallback
  const orKey = openRouterKey || process.env.OPENROUTER_API_KEY || '';
  if (orKey && orKey.trim()) {
    list.push({
      id: 'openrouter',
      name: 'OpenRouter (DeepSeek)',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'deepseek/deepseek-chat',
      apiKey: orKey.trim()
    });
  }

  return list;
}

/**
 * Pass 1: Generates a Global Narrative & Character Dossier from the full episode transcript
 * and acoustic audio translations before line-by-line translation starts.
 * Tries providers in priority sequence with automatic fallback.
 */
export async function generateGlobalContextDossier(
  segments,
  providersOrKey,
  openRouterKey,
  customEndpoint,
  customModel,
  customApiKey
) {
  if (!segments || segments.length === 0) {
    return null;
  }

  const providers = normalizeTranslationProviders(
    providersOrKey,
    openRouterKey,
    customEndpoint,
    customModel,
    customApiKey
  );

  if (providers.length === 0) {
    return null;
  }

  // Sample up to 60 segments across the video to capture premise, characters, and progression
  const sampled = segments.length <= 60
    ? segments
    : [
        ...segments.slice(0, 30),
        ...segments.slice(Math.floor(segments.length / 2) - 10, Math.floor(segments.length / 2) + 10),
        ...segments.slice(-10)
      ];

  const dialogueSample = sampled.map(s => {
    let line = `[${s.start.toFixed(1)}s] JP: "${s.text}"`;
    if (s.acousticAudioTranslation) {
      line += ` | Audio EN: "${s.acousticAudioTranslation}"`;
    }
    return line;
  }).join('\n');

  const systemPrompt = `You are a world-class anime localization director and narrative dramaturg.
Analyze this raw dialogue stream (Japanese transcription + direct acoustic audio translation) and produce a concise, authoritative SCENE & CHARACTER DOSSIER to guide subtitle translation.

Extract:
1. SCENE PREMISE & SETTING (1-2 sentences on what is occurring).
2. CHARACTER IDENTIFICATION & SOCIAL HIERARCHY:
   - Identify distinct speakers (names, gender hints, age/vibe).
   - Who is in charge / dominant / aggressive / rude?
   - Who is polite / submissive / respectful / casual?
   - Explicit pronoun/speech markers observed (e.g. ore vs watashi, omae vs anata, -zo/-ze vs -desu/-masu).
3. KEY THEMATIC TERMINOLOGY & JARGON (Crucial recurring proper nouns, terms, or motifs).
4. EMOTIONAL ARC & TONE (e.g. "Tense standoff transitioning to comedic relief", "Quiet melancholic confession").

Format as a concise, structured bulleted brief (under 180 words).`;

  for (let idx = 0; idx < providers.length; idx++) {
    const provider = providers[idx];
    try {
      let endpointUrl = provider.baseUrl.replace(/\/+$/, '');
      if (!endpointUrl.endsWith('/chat/completions')) {
        endpointUrl += '/chat/completions';
      }

      const res = await fetch(endpointUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${provider.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: provider.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: dialogueSample }
          ],
          temperature: 0.2
        })
      });

      if (res.ok) {
        const data = await res.json();
        let content = data.choices?.[0]?.message?.content || data.text || '';
        if (content) {
          content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
          return content;
        }
      } else {
        const errText = await res.text().catch(() => '');
        console.warn(`[Dossier] Provider #${idx + 1} (${provider.name}) failed (${res.status}): ${errText}`);
      }
    } catch (err) {
      console.warn(`[Dossier] Provider #${idx + 1} (${provider.name}) error: ${err.message}`);
    }
  }

  return null;
}

/**
 * Translates Japanese subtitle segments into English or Hindi while preserving
 * emotional vocalizations, grunts, moans, sighs, humming, and exact timestamps.
 * Supports:
 * - 'fallback' mode (v1): Sequential provider execution with real-time failover on rate limits.
 * - 'ensemble' mode (v2): Parallel multi-model dispatch, semantic clustering to prune hallucinations,
 *                         and best-fit subtitle scoring.
 */
export async function translateSegments(
  segments,
  targetLang,
  providersOrKey,
  openRouterKey,
  onProgress,
  customEndpoint,
  customModel,
  scriptOption = 'devanagari',
  customApiKey = null,
  cachedGlobalDossier = null,
  translationMode = 'fallback'
) {
  if (!segments || segments.length === 0) {
    return [];
  }

  const providers = normalizeTranslationProviders(
    providersOrKey,
    openRouterKey,
    customEndpoint,
    customModel,
    customApiKey
  );

  if (providers.length === 0) {
    throw new Error('No valid translation providers configured with API keys.');
  }

  const isHinglish = targetLang === 'hi' && scriptOption === 'hinglish';
  const langName = targetLang === 'hi'
    ? (isHinglish ? 'Hinglish (Hindi in conversational Roman alphabet script, e.g. "Kya kar rahe ho?", "Sach mein?")' : 'Hindi (हिन्दी in standard Devanagari script)')
    : 'English';

  // Pass 1: Build Global Narrative & Character Dossier if not already cached
  let globalDossier = cachedGlobalDossier;
  if (!globalDossier && segments.length > 2) {
    if (onProgress) {
      onProgress({
        lang: targetLang,
        batch: 0,
        totalBatches: 1,
        completedSegments: 0,
        totalSegments: segments.length,
        status: `🧠 [Pass 1] Ingesting full audio & transcript to construct Global Scene & Character Dossier...`
      });
    }

    globalDossier = await generateGlobalContextDossier(
      segments,
      providers
    );
  }

  const BATCH_SIZE = 25; // Balanced batch size for prompt quality & rate limits
  const totalBatches = Math.ceil(segments.length / BATCH_SIZE);
  const results = [];

  for (let i = 0; i < segments.length; i += BATCH_SIZE) {
    const batchIndex = Math.floor(i / BATCH_SIZE) + 1;
    const chunk = segments.slice(i, i + BATCH_SIZE);

    if (onProgress) {
      const modeLabel = translationMode === 'ensemble' ? '🏆 Ensemble Multi-Model' : 'Context-aware';
      onProgress({
        lang: targetLang,
        batch: batchIndex,
        totalBatches,
        completedSegments: results.length,
        totalSegments: segments.length,
        status: `Translating batch ${batchIndex}/${totalBatches} (${chunk.length} segments with ${modeLabel})...`
      });
    }

    const previousContext = i > 0 ? segments.slice(Math.max(0, i - 4), i) : [];

    let translatedChunk;
    if (translationMode === 'ensemble') {
      translatedChunk = await translateBatchEnsemble(
        chunk,
        langName,
        targetLang,
        providers,
        onProgress,
        scriptOption,
        previousContext,
        globalDossier
      );
    } else {
      translatedChunk = await translateBatchWithFallback(
        chunk,
        langName,
        targetLang,
        providers,
        onProgress,
        scriptOption,
        previousContext,
        globalDossier
      );
    }

    results.push(...translatedChunk);

    if (onProgress) {
      onProgress({
        lang: targetLang,
        batch: batchIndex,
        totalBatches,
        completedSegments: results.length,
        totalSegments: segments.length,
        status: `Completed batch ${batchIndex}/${totalBatches} (${results.length}/${segments.length} segments)`
      });
    }
  }

  return results;
}

/**
 * Calculates semantic text similarity between two strings using a hybrid of
 * token Jaccard similarity and character 3-gram Dice coefficient.
 * Returns a value between 0.0 (completely dissimilar) and 1.0 (identical).
 */
export function computeTextSimilarity(textA, textB) {
  const normA = (textA || '').trim().toLowerCase();
  const normB = (textB || '').trim().toLowerCase();

  if (normA === normB) return 1.0;
  if (!normA || !normB) return 0.0;

  // 1. Token Jaccard Similarity (Unicode-safe word boundary parsing)
  const tokensA = new Set(normA.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean));
  const tokensB = new Set(normB.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean));
  let tokenInter = 0;
  tokensA.forEach(t => { if (tokensB.has(t)) tokenInter++; });
  const tokenUnion = new Set([...tokensA, ...tokensB]).size;
  const tokenSim = tokenUnion > 0 ? tokenInter / tokenUnion : 0;

  // 2. Character 3-Gram Dice Similarity (handles spelling variations, slang, punctuation differences)
  const ngramsA = new Set();
  for (let i = 0; i <= normA.length - 3; i++) ngramsA.add(normA.substring(i, i + 3));
  const ngramsB = new Set();
  for (let i = 0; i <= normB.length - 3; i++) ngramsB.add(normB.substring(i, i + 3));
  let ngramInter = 0;
  ngramsA.forEach(g => { if (ngramsB.has(g)) ngramInter++; });
  const ngramTotal = ngramsA.size + ngramsB.size;
  const ngramSim = ngramTotal > 0 ? (2 * ngramInter) / ngramTotal : 0;

  return (tokenSim * 0.55) + (ngramSim * 0.45);
}

/**
 * Stage 1: Clusters candidate translations by semantic meaning.
 * Identifies majority consensus and flags outlier hallucinations.
 */
export function clusterCandidates(candidates, threshold = 0.22) {
  const clusters = [];
  for (const cand of candidates) {
    let placed = false;
    for (const cluster of clusters) {
      const sim = computeTextSimilarity(cand.text, cluster.representative.text);
      if (sim >= threshold) {
        cluster.members.push(cand);
        placed = true;
        break;
      }
    }
    if (!placed) {
      clusters.push({
        representative: cand,
        members: [cand]
      });
    }
  }
  // Sort clusters by member count descending (largest consensus cluster first)
  clusters.sort((a, b) => b.members.length - a.members.length);
  return clusters;
}

/**
 * Stage 2: Evaluates and scores candidate translations based on:
 * - CPS (Characters per second) subtitle readability
 * - Agreement with direct acoustic audio translation (Channel B)
 * - Preservation of emotional vocalizations and expressive punctuation
 */
export function scoreCandidate(cand, seg) {
  let score = 50.0;
  const duration = Math.max(0.6, (seg.end - seg.start));
  const len = cand.text.length;
  const cps = len / duration;

  // 1. Reading Speed (CPS) optimization for subtitle cinema
  if (cps >= 9 && cps <= 23) {
    score += 25.0; // Sweet spot for anime subtitle readability
  } else if (cps < 9 && cps >= 3) {
    score += 15.0; // Acceptable brief subtitle
  } else if (cps > 23 && cps <= 29) {
    score += 8.0; // Slightly fast but readable
  } else if (cps > 32) {
    score -= 22.0; // Excessive text bloat for timestamp interval
  }

  // 2. Channel B Acoustic Agreement
  if (seg.acousticAudioTranslation) {
    const acousticSim = computeTextSimilarity(cand.text, seg.acousticAudioTranslation);
    score += (acousticSim * 25.0);
  }

  // 3. Emotion / Vocalization cues
  const ja = seg.text || '';
  if ((ja.includes('！') || ja.includes('!')) && (cand.text.includes('!') || cand.text.includes('！'))) score += 5.0;
  if ((ja.includes('？') || ja.includes('?')) && (cand.text.includes('?') || cand.text.includes('？'))) score += 5.0;
  if ((ja.includes('…') || ja.includes('...')) && (cand.text.includes('...') || cand.text.includes('…'))) score += 5.0;

  // 4. Cleanliness check (no markdown or JSON leakage)
  if (cand.text.includes('```') || cand.text.includes('{') || cand.text.includes('}')) {
    score -= 40.0;
  }

  return Math.round(score * 10) / 10;
}

/**
 * Generates unified system and user prompts with full contextual awareness,
 * vocalization mappings, and Global Character Dossier.
 */
function buildTranslationPrompts(
  batch,
  langName,
  targetLangCode,
  scriptOption = 'devanagari',
  previousContext = [],
  globalDossier = null
) {
  const isHindi = targetLangCode === 'hi';
  const isHinglish = isHindi && scriptOption === 'hinglish';

  let scriptInstruction = '';
  if (isHindi) {
    if (isHinglish) {
      scriptInstruction = `
SCRIPT REQUIREMENT: MANDATORY HINGLISH (ROMAN ALPHABET).
Write modern, conversational everyday Hindi using the English Roman alphabet (casual texting style).
DO NOT use Devanagari characters (like क, ख, ग).
Examples:
* "Mujhe yeh bahut pasand hai!" (Not: "मुझे यह बहुत पसंद है!")
* "Arre, tum yahan kya kar rahe ho?"
* "Sach mein? Yakeen nahi hota!"
* "Kripya meri madad karo."`;
    } else {
      scriptInstruction = `
SCRIPT REQUIREMENT: MANDATORY STANDARD DEVANAGARI (देवनागरी).
Write in clear, standard Hindi written exclusively in the Devanagari script.
Examples:
* "मुझे यह बहुत पसंद है!"
* "अरे, तुम यहाँ क्या कर रहे हो?"
* "सच में? यकीन नहीं होता!"`;
    }
  }

  let vocalizationExamples = '';
  if (isHindi) {
    if (isHinglish) {
      vocalizationExamples = `
* Japanese: "あっ…" -> Hinglish: "Ah..." or "Aah..."
* Japanese: "うっ…" / "くっ…" -> Hinglish: "Ugh..." or "Khh..."
* Japanese: "ふぅ…" / "はぁ…" -> Hinglish: "Phew..." or "Haa..." (sigh)
* Japanese: "えっ？" -> Hinglish: "Eh?!" or "Hein?!"
* Japanese: "うん" -> Hinglish: "Haan" or "Hmm"`;
    } else {
      vocalizationExamples = `
* Japanese: "あっ…" -> Hindi: "आह..." or "अरे..."
* Japanese: "うっ…" / "くっ…" -> Hindi: "उफ़्फ़..." or "उह..."
* Japanese: "ふぅ…" / "はぁ…" -> Hindi: "हूँ..." or "हाह..." (sigh)
* Japanese: "えっ？" -> Hindi: "एह?!" or "हैं?!"
* Japanese: "うん" -> Hindi: "हाँ" or "हम्म"`;
    }
  } else {
    vocalizationExamples = `
* Japanese: "あっ…" -> English: "Ah..."
* Japanese: "うっ…" / "くっ…" -> English: "Ugh..." / "Ghk..."
* Japanese: "ふぅ…" / "はぁ…" -> English: "Phew..." / "Haa..." (sigh/breathing)
* Japanese: "えっ？" -> English: "Eh?!" / "What?!"
* Japanese: "うん" / "ふうん" -> English: "Yeah" / "Hmm" / "Uh-huh"
* Japanese: "きゃっ！" -> English: "Kyaa!" / "Eek!"`;
  }

  let contextSnippet = '';
  if (previousContext.length > 0) {
    contextSnippet = 'IMMEDIATELY PRECEDING DIALOGUE (for conversational flow only):\n' +
      previousContext.map(s => `[${s.start.toFixed(1)}s]: "${s.text}"`).join('\n') + '\n\n';
  }

  let dossierSection = '';
  if (globalDossier) {
    dossierSection = `\n=======================================================\nGLOBAL EPISODE CONTEXT & CHARACTER DOSSIER:\n${globalDossier}\nUse this scene hierarchy, speaker relationship context, and tone to inform pronoun choices (e.g. tu vs tum vs aap in Hindi, or casual vs rude vs respectful in English) and ensure consistent terminology.\n=======================================================\n`;
  }

  const systemPrompt = `You are a professional anime subtitle translator specializing in natural, context-aware Japanese-to-${langName} localization.
${dossierSection}
Your mission is to translate subtitle segments from Japanese into ${langName} while strictly adhering to these rules:

1. PRESERVE EVERY EMOTIONAL SOUND, VOCALIZATION, AND BREATH:
Anime dialogue relies heavily on non-verbal expressions. You must NEVER omit, silence, or ignore:
- Sighs, gasps, heavy panting, moans, grunts, whimpers, screams, giggles, chuckles, hums, and hesitation sounds.
- If a segment contains only a sound (e.g., "あっ…", "ふぅ…", "うーん"), translate it into the corresponding natural localized sound:
${vocalizationExamples}

2. DUAL-CHANNEL AUDIO CONSENSUS:
Each segment may include "audio_acoustic_translation" (a direct English acoustic interpretation captured directly from the raw audio waveform).
- Cross-reference the Japanese text with this acoustic translation to resolve homophones, mumbled words, or dropped subjects.
- Synthesize both channels into the most fluent, punchy subtitle.

3. MAINTAIN SEGMENT INTEGRITY & TIMESTAMPS:
- You will receive a JSON array of segments, each with an "id", "start", "end", and "japanese_text".
- You MUST return a JSON array containing the exact same number of items with the exact same "id", "start", and "end".
- Output field name for the translation must be "text".

4. CONVERSATIONAL TONE & SLANG:
- Adapt Japanese honorifics, sentence endings (zo, ze, wa, yo, ne), and character quirks into natural spoken dialogue.
${scriptInstruction}

OUTPUT FORMAT:
Return ONLY a valid JSON array of objects.
[
  { "id": 0, "start": 0.0, "end": 1.5, "text": "Translated subtitle text here" }
]
Do NOT enclose the output in markdown codeblocks or add any extra conversational text. Return only the raw JSON array.`;

  const userPrompt = `${contextSnippet}JSON SEGMENTS TO TRANSLATE:\n` + JSON.stringify(
    batch.map(s => {
      const item = { id: s.id, start: s.start, end: s.end, japanese_text: s.text };
      if (s.acousticAudioTranslation) {
        item.audio_acoustic_translation = s.acousticAudioTranslation;
      }
      return item;
    })
  );

  return { systemPrompt, userPrompt };
}

/**
 * Translates a single batch using the Multi-Model Ensemble Consensus & Voting Engine (v2):
 * 1. Dispatches the batch to all configured providers concurrently.
 * 2. Stage 1: Clusters candidate outputs semantically to prune hallucinations.
 * 3. Stage 2: Evaluates remaining candidates on CPS, acoustic agreement, and emotion.
 * 4. Synthesizes winning subtitle with candidate inspection metadata.
 */
async function translateBatchEnsemble(
  batch,
  langName,
  targetLangCode,
  providers,
  onProgress,
  scriptOption = 'devanagari',
  previousContext = [],
  globalDossier = null
) {
  const { systemPrompt, userPrompt } = buildTranslationPrompts(
    batch,
    langName,
    targetLangCode,
    scriptOption,
    previousContext,
    globalDossier
  );

  // Parallel dispatch across all configured providers
  const dispatchPromises = providers.map(async (provider) => {
    try {
      const result = await callProviderChat(provider, systemPrompt, userPrompt, batch);
      return { provider, result, error: null };
    } catch (err) {
      console.warn(`[Ensemble Model Failed]: ${provider.name} (${provider.model}): ${err.message}`);
      return { provider, result: null, error: err };
    }
  });

  const settled = await Promise.all(dispatchPromises);
  const successful = settled.filter(s => s.result && s.result.length > 0);

  if (successful.length === 0) {
    console.warn('[Ensemble] All parallel dispatches failed. Falling back to sequential chain...');
    return translateBatchWithFallback(
      batch,
      langName,
      targetLangCode,
      providers,
      onProgress,
      scriptOption,
      previousContext,
      globalDossier
    );
  }

  // Synthesize consensus and best-fit winner for each segment
  const results = batch.map(seg => {
    const candidates = [];
    successful.forEach(s => {
      const match = s.result.find(r => r.id === seg.id);
      if (match && match.text && match.text.trim()) {
        candidates.push({
          providerId: s.provider.id,
          providerName: s.provider.name,
          providerModel: s.provider.model,
          text: match.text.trim()
        });
      }
    });

    if (candidates.length === 0) {
      return {
        id: seg.id,
        start: seg.start,
        end: seg.end,
        text: seg.text
      };
    }

    if (candidates.length === 1) {
      const only = candidates[0];
      const singleScore = scoreCandidate(only, seg);
      return {
        id: seg.id,
        start: seg.start,
        end: seg.end,
        text: only.text,
        ensemble: {
          winner: only.providerName,
          winnerModel: only.providerModel,
          winnerScore: singleScore,
          consensusCount: 1,
          totalVotes: 1,
          candidates: [{
            provider: only.providerName,
            model: only.providerModel,
            text: only.text,
            isWinner: true,
            score: singleScore,
            clusterVotes: 1,
            cps: Number((only.text.length / Math.max(0.6, seg.end - seg.start)).toFixed(1)),
            isOutlier: false
          }]
        }
      };
    }

    // Stage 1: Semantic Clustering
    const clusters = clusterCandidates(candidates);
    const winningCluster = clusters[0];

    // Score all members of winning cluster
    winningCluster.members.forEach(c => {
      c.score = scoreCandidate(c, seg);
      c.clusterVotes = winningCluster.members.length;
      c.isOutlier = false;
    });

    // Score outliers from non-majority clusters (marked as hallucination/outlier)
    clusters.slice(1).forEach(c => {
      c.members.forEach(outlier => {
        outlier.score = Math.max(5.0, scoreCandidate(outlier, seg) - 35.0);
        outlier.clusterVotes = c.members.length;
        outlier.isOutlier = true;
      });
    });

    // Sort winning cluster by best-fit score descending
    winningCluster.members.sort((a, b) => b.score - a.score);
    const winner = winningCluster.members[0];

    const allCandidateRecords = candidates.map(c => ({
      provider: c.providerName,
      model: c.providerModel,
      text: c.text,
      isWinner: c.text === winner.text && c.providerName === winner.providerName,
      score: c.score || 45.0,
      clusterVotes: c.clusterVotes || 1,
      cps: Number((c.text.length / Math.max(0.6, seg.end - seg.start)).toFixed(1)),
      isOutlier: Boolean(c.isOutlier)
    }));

    return {
      id: seg.id,
      start: seg.start,
      end: seg.end,
      text: winner.text,
      ensemble: {
        winner: winner.providerName,
        winnerModel: winner.providerModel,
        winnerScore: winner.score,
        consensusCount: winningCluster.members.length,
        totalVotes: candidates.length,
        candidates: allCandidateRecords
      }
    };
  });

  return results;
}

/**
 * Translates a single batch using a multi-provider fallback chain (v1):
 * If Provider #1 hits a 429 rate limit, 5xx, or network failure:
 * Automatically falls over in real-time to Provider #2, then Provider #3.
 */
async function translateBatchWithFallback(
  batch,
  langName,
  targetLangCode,
  providers,
  onProgress,
  scriptOption = 'devanagari',
  previousContext = [],
  globalDossier = null
) {
  const { systemPrompt, userPrompt } = buildTranslationPrompts(
    batch,
    langName,
    targetLangCode,
    scriptOption,
    previousContext,
    globalDossier
  );

  let lastError = null;

  for (let pIdx = 0; pIdx < providers.length; pIdx++) {
    const provider = providers[pIdx];
    const nextProvider = providers[pIdx + 1];

    try {
      if (onProgress && pIdx > 0) {
        onProgress({ status: `Routing batch to Provider #${pIdx + 1} (${provider.name} - ${provider.model})...` });
      }

      const result = await callProviderChat(provider, systemPrompt, userPrompt, batch);
      if (result && result.length > 0) {
        return result; // Successful translation!
      }
      throw new Error(`Provider returned empty or unparseable translation.`);
    } catch (err) {
      lastError = err;
      console.warn(`[Translator Failover] Provider #${pIdx + 1} (${provider.name}) failed:`, err.message);

      if (nextProvider) {
        const reason = err.status === 429 ? 'Rate limit (HTTP 429)' : err.message;
        if (onProgress) {
          onProgress({
            status: `⚠️ [Failover] Provider #${pIdx + 1} (${provider.name}) hit ${reason}. Seamlessly switching to Provider #${pIdx + 2} (${nextProvider.name} - ${nextProvider.model})...`
          });
        }
        // Immediately try next provider in chain
        continue;
      }

      // If this was the last provider and it failed due to 429 rate limit on Groq, wait and retry
      if (err.status === 429 && provider.baseUrl.includes('groq.com')) {
        let waitSec = 6.5;
        const match = (err.message || '').match(/try again in ([0-9.]+)s/i);
        if (match && match[1]) waitSec = parseFloat(match[1]) + 0.5;
        if (onProgress) onProgress({ status: `[Rate Limit] Cooldown: waiting ${waitSec.toFixed(1)}s before retrying ${provider.name}...` });
        await new Promise(r => setTimeout(r, waitSec * 1000));
        try {
          const retryRes = await callProviderChat(provider, systemPrompt, userPrompt, batch);
          if (retryRes && retryRes.length > 0) return retryRes;
        } catch (retryErr) {
          lastError = retryErr;
        }
      }
    }
  }

  throw lastError || new Error('All translation providers failed.');
}

/**
 * Invokes an OpenAI-compatible /chat/completions endpoint for a specific provider.
 */
async function callProviderChat(provider, systemPrompt, userPrompt, batch) {
  let endpointUrl = provider.baseUrl.replace(/\/+$/, '');
  if (!endpointUrl.endsWith('/chat/completions')) {
    endpointUrl += '/chat/completions';
  }

  const response = await fetch(endpointUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: provider.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.2
    })
  });

  if (response.status === 429) {
    const errJson = await response.json().catch(() => ({}));
    const errMsg = errJson?.error?.message || 'Rate limit reached (429)';
    const err = new Error(errMsg);
    err.status = 429;
    throw err;
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    const err = new Error(`API error (${response.status}): ${errText}`);
    err.status = response.status;
    throw err;
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || data.text;
  return parseTranslatedContent(content, batch);
}

/**
 * Parses and validates LLM JSON response matching segment timestamps
 */
function parseTranslatedContent(rawContent, batch) {
  let content = (rawContent || '[]').trim();

  // Strip thinking / reasoning tags (e.g. DeepSeek R1 <think>...</think>)
  if (content.includes('</think>')) {
    content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  }

  // Strip markdown fences
  if (content.startsWith('```')) {
    content = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }

  try {
    let parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) {
      const keys = Object.keys(parsed);
      for (const k of keys) {
        if (Array.isArray(parsed[k])) {
          parsed = parsed[k];
          break;
        }
      }
    }

    if (Array.isArray(parsed) && parsed.length > 0) {
      return batch.map(orig => {
        const found = parsed.find(p => p.id === orig.id);
        const transText = found ? (found.text || found.translated_text || '') : '';
        return {
          id: orig.id,
          start: orig.start,
          end: orig.end,
          text: (transText && transText.trim()) ? transText.trim() : orig.text
        };
      });
    }
  } catch (e) {
    console.error('JSON parsing error:', e, 'Raw content:', content);
  }

  return batch;
}

/**
 * Tests connection to any OpenAI-compatible endpoint (Groq, top-tools-ai.com, OpenRouter, Ollama, etc.)
 */
export async function testCustomApiConnection(endpoint, model, apiKey) {
  if (!endpoint || !endpoint.startsWith('http')) {
    throw new Error('Please enter a valid HTTP/HTTPS endpoint URL.');
  }

  let endpointUrl = endpoint.trim();
  if (!endpointUrl.endsWith('/chat/completions')) {
    endpointUrl = endpointUrl.replace(/\/+$/, '') + '/chat/completions';
  }

  const modelToUse = (model && model.trim()) ? model.trim() : 'Top-Tools-Ai';
  const effectiveKey = (apiKey && apiKey.trim()) || process.env.CUSTOM_TRANSLATION_API_KEY || '';

  const response = await fetch(endpointUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${effectiveKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: modelToUse,
      messages: [
        { role: 'system', content: 'You are a Japanese to English translator. Return only the translated English text.' },
        { role: 'user', content: 'こんにちは、世界！' }
      ],
      temperature: 0.2
    })
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || data.text || 'Success';
  return { success: true, model: modelToUse, reply: text.trim() };
}
