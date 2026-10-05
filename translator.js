import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Translates Japanese subtitle segments into English or Hindi while preserving
 * emotional vocalizations, grunts, moans, sighs, humming, and exact timestamps.
 *
 * @param {Array<{ id: number, start: number, end: number, text: string }>} segments
 * @param {'en' | 'hi'} targetLang - 'en' for English, 'hi' for Hindi
 * @param {string} apiKey - Groq API Key
 * @param {string} [openRouterKey] - Optional OpenRouter API Key for fallback
 * @param {Function} [onProgress] - Callback for real-time progress updates
 * @returns {Promise<Array<{ id: number, start: number, end: number, text: string }>>}
 */
export async function translateSegments(
  segments,
  targetLang,
  apiKey,
  openRouterKey,
  onProgress,
  customEndpoint,
  customModel,
  scriptOption = 'devanagari',
  customApiKey = null
) {
  if (!segments || segments.length === 0) {
    return [];
  }

  const isHinglish = targetLang === 'hi' && scriptOption === 'hinglish';
  const langName = targetLang === 'hi'
    ? (isHinglish ? 'Hinglish (Hindi in conversational Roman alphabet script, e.g. "Kya kar rahe ho?", "Sach mein?")' : 'Hindi (हिन्दी in standard Devanagari script)')
    : 'English';
  const BATCH_SIZE = 25; // Balanced batch size for prompt quality & rate limits
  const totalBatches = Math.ceil(segments.length / BATCH_SIZE);
  const results = [];

  for (let i = 0; i < segments.length; i += BATCH_SIZE) {
    const batchIndex = Math.floor(i / BATCH_SIZE) + 1;
    const chunk = segments.slice(i, i + BATCH_SIZE);

    if (onProgress) {
      onProgress({
        lang: targetLang,
        batch: batchIndex,
        totalBatches,
        completedSegments: results.length,
        totalSegments: segments.length,
        status: `Translating batch ${batchIndex}/${totalBatches} (${chunk.length} segments)...`
      });
    }

    const translatedChunk = await translateBatchWithFallback(
      chunk,
      langName,
      targetLang,
      apiKey,
      openRouterKey,
      onProgress,
      customEndpoint,
      customModel,
      scriptOption,
      customApiKey
    );

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
 * Translates a single batch. If Groq hits a 429 rate limit:
 * 1. Checks if OpenRouter or Custom API is available for instant translation.
 * 2. Or parses wait time from Groq's error, sleeps, and retries.
 */
async function translateBatchWithFallback(
  batch,
  langName,
  targetLangCode,
  groqKey,
  openRouterKey,
  onProgress,
  customEndpoint,
  customModel,
  scriptOption = 'devanagari',
  customApiKey = null
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
      vocalizationExamples = `* For grunts / strain: "*grunts*", "*karah*", "*karahate hue*", "*uff*"
   * For moans / pleasure / sighs: "*moans*", "*siskari*", "*aah...*", "*sighs*", "*madhosh aawaaz*"
   * For panting / breath: "*hanfte hue*", "*heavy breathing*", "*tez saansein*"
   * For humming / thinking: "*hmm...*", "*gungunate hue*"
   * For sudden surprises / gasps: "*gasps*", "*arre!*", "*oh!*"`;
    } else {
      vocalizationExamples = `* For grunts / strain: "*कराह*", "*कराहते हुए*", "*उफ़्फ़*"
   * For moans / pleasure / sighs: "*सिसकारी*", "*आह...*", "*गहरी सांस*", "*मदहोश आवाज*"
   * For panting / breath: "*हांफते हुए*", "*तेज सांसें*"
   * For humming / thinking: "*हम्म...*", "*गुनगुनाते हुए*"
   * For sudden surprises / gasps: "*सांस रुकते हुए*", "*अरे!*", "*ओह!*"`;
    }
  } else {
    vocalizationExamples = `* For grunts / strain: "*grunts*", "*groans*", "*ugh*"
   * For moans / pleasure / sighs: "*moans*", "*ah...*", "*sighs*", "*whimpers*"
   * For panting / breath: "*pant*", "*heavy breathing*", "*huff*"
   * For humming / thinking: "*humming*", "*hmm...*"
   * For sudden surprises / gasps: "*gasps*", "*cries out*"`;
  }

  const systemPrompt = `You are a master subtitle translator specializing in Japanese to ${langName}.
You translate Japanese dialogue and audio with extreme precision, natural conversational flow, and complete emotional fidelity.
${scriptInstruction}

CRITICAL INSTRUCTIONS:
1. Context & Implicit Subjects: Japanese regularly drops subjects (I, you, he, she). Infer the correct context and natural conversational phrasing.
2. VOCALIZATIONS & SOUND EFFECTS (MANDATORY):
   Do NOT delete, ignore, or censor non-verbal sounds, grunts, sighing, humming, moaning, breathing, gasps, or pleasing sounds.
   Translate them faithfully into expressive subtitle sound markers:
   ${vocalizationExamples}
3. OUTPUT FORMAT:
   Return ONLY a valid JSON array of objects with the exact same 'id', 'start', 'end', and the translated 'text'.
   Example JSON:
   [
     { "id": 0, "start": 1.25, "end": 3.40, "text": "Translated text..." }
   ]
Do NOT enclose the output in markdown codeblocks or add any extra conversational text. Return only the raw JSON array.`;

  const userPrompt = JSON.stringify(
    batch.map(s => ({ id: s.id, start: s.start, end: s.end, text: s.text }))
  );

  // If user provided a Custom Translation API / Agent endpoint (OpenAI compatible)
  if (customEndpoint && customEndpoint.trim().startsWith('http')) {
    try {
      let endpointUrl = customEndpoint.trim();
      // Auto-append /chat/completions if base URL is provided
      if (!endpointUrl.endsWith('/chat/completions')) {
        endpointUrl = endpointUrl.replace(/\/+$/, '') + '/chat/completions';
      }

      const modelToUse = (customModel && customModel.trim()) ? customModel.trim() : 'Top-Tools-Ai';
      const effectiveKey = (customApiKey && customApiKey.trim())
        || process.env.CUSTOM_TRANSLATION_API_KEY
        || openRouterKey
        || groqKey;

      if (onProgress) onProgress({ status: `Routing batch to Custom API (${modelToUse} @ ${endpointUrl})...` });
      
      const customResponse = await fetch(endpointUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${effectiveKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: modelToUse,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.2
        })
      });

      if (customResponse.ok) {
        const cData = await customResponse.json();
        const content = cData.choices?.[0]?.message?.content || cData.text;
        const parsed = parseTranslatedContent(content, batch);
        if (parsed && parsed.length > 0) {
          return parsed;
        }
      } else {
        const errText = await customResponse.text().catch(() => '');
        console.warn(`[Custom API Error ${customResponse.status}]: ${errText}`);
        if (onProgress) onProgress({ status: `Custom API returned status ${customResponse.status}. Falling back to default engine...` });
      }
    } catch (cErr) {
      console.warn(`[Custom API Failed]: ${cErr.message}. Falling back to default engine...`);
    }
  }

  // Attempt Groq first
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const modelToUse = process.env.TRANSLATION_MODEL || 'qwen/qwen3.8-27b';

      const response = await fetch(GROQ_CHAT_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${groqKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: modelToUse,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.2
        })
      });

      if (response.status === 429) {
        const errJson = await response.json().catch(() => ({}));
        const errMsg = errJson?.error?.message || '';

        // If OpenRouter is available, immediately route to OpenRouter to bypass Groq rate limit
        if (openRouterKey && openRouterKey.startsWith('sk-or-')) {
          if (onProgress) {
            onProgress({
              status: `[Groq 429] Switching to OpenRouter (DeepSeek) to bypass rate limit immediately...`
            });
          }
          return await translateViaOpenRouter(batch, systemPrompt, userPrompt, openRouterKey);
        }

        // Parse wait duration from Groq: "Please try again in X.Xs"
        let waitSec = 6.5;
        const match = errMsg.match(/try again in ([0-9.]+)s/i);
        if (match && match[1]) {
          waitSec = parseFloat(match[1]) + 0.5;
        }

        if (onProgress) {
          onProgress({
            status: `[Rate Limit] Token quota cool-down: waiting ${waitSec.toFixed(1)}s before retry ${attempt}/4...`
          });
        }
        console.warn(`[Groq Rate Limit] Waiting ${waitSec}s before retrying...`);
        await new Promise(r => setTimeout(r, waitSec * 1000));
        continue;
      }

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Groq API error (${response.status}): ${errText}`);
      }

      const data = await response.json();
      return parseTranslatedContent(data.choices?.[0]?.message?.content, batch);
    } catch (err) {
      lastError = err;
      console.warn(`[Translation] Attempt ${attempt} failed: ${err.message}`);
      if (attempt < 4) {
        await new Promise(r => setTimeout(r, 2000 * attempt));
      }
    }
  }

  // Final fallback to OpenRouter if Groq exhausted
  if (openRouterKey) {
    try {
      if (onProgress) onProgress({ status: 'Falling back to OpenRouter...' });
      return await translateViaOpenRouter(batch, systemPrompt, userPrompt, openRouterKey);
    } catch (orErr) {
      console.error('OpenRouter fallback also failed:', orErr);
    }
  }

  throw lastError || new Error('Translation failed after multiple retries.');
}

/**
 * OpenRouter Fallback using DeepSeek
 */
async function translateViaOpenRouter(batch, systemPrompt, userPrompt, openRouterKey) {
  const response = await fetch(OPENROUTER_CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openRouterKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'deepseek/deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.2
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenRouter API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return parseTranslatedContent(data.choices?.[0]?.message?.content, batch);
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
        return {
          id: orig.id,
          start: orig.start,
          end: orig.end,
          text: (found && found.text) ? found.text.trim() : orig.text
        };
      });
    }
  } catch (e) {
    console.error('JSON parsing error:', e, 'Raw content:', content);
  }

  return batch;
}

/**
 * Tests connection to a custom OpenAI-compatible endpoint (like top-tools-ai.com)
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

