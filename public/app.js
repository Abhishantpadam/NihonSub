// NihonSub - Japanese AI Video Subtitler & Synchronized Player
// 2-Step Interactive Pipeline: Step 1 Upload & Language -> Processing -> Step 2 Cinema Player

let selectedFile = null;
let currentPipelineData = null; // Store subtitles & streams
let activeSubtitlesData = null; // Subtitles mapping: { en, hi, ja, bi_en, bi_hi }
let activeSegments = []; // Currently displayed segments
let activeSegmentIndex = -1;
let timeOffset = 0.0;
let autoScrollEnabled = true;
let userScrollTimeout = null;
let activeSubtitleStyle = localStorage.getItem('nihonsub_sub_style') || localStorage.getItem('koesub_sub_style') || 'transparent';

// Custom Translation API settings (stored in localStorage)
let customTranslationApiKey = localStorage.getItem('nihonsub_custom_api_key') || localStorage.getItem('koesub_custom_api_key') || '';
let customTranslationEndpoint = localStorage.getItem('nihonsub_custom_endpoint') || localStorage.getItem('koesub_custom_endpoint') || '';
let customTranslationModel = localStorage.getItem('nihonsub_custom_model') || localStorage.getItem('koesub_custom_model') || '';

// Containers
const step1Section = document.getElementById('step1Section');
const processingCard = document.getElementById('processingCard');
const step2PlayerSection = document.getElementById('step2PlayerSection');

// DOM Elements - Step 1
const videoFileInput = document.getElementById('videoFileInput');
const browseBtn = document.getElementById('browseBtn');
const dropZone = document.getElementById('dropZone');
const fileInfoBox = document.getElementById('fileInfoBox');
const fileNameDisplay = document.getElementById('fileNameDisplay');
const fileSizeDisplay = document.getElementById('fileSizeDisplay');
const clearFileBtn = document.getElementById('clearFileBtn');
const generateBtn = document.getElementById('generateBtn');
const activeTranslatorNotice = document.getElementById('activeTranslatorNotice');
const configureTranslatorLink = document.getElementById('configureTranslatorLink');
const hindiScriptRow = document.getElementById('hindiScriptRow');

// DOM Elements - Processing State
const processingTitle = document.getElementById('processingTitle');
const processingSubtitle = document.getElementById('processingSubtitle');
const progressStatusText = document.getElementById('progressStatusText');
const progressPercentText = document.getElementById('progressPercentText');
const mainProgressBar = document.getElementById('mainProgressBar');
const transcriptionBadge = document.getElementById('transcriptionBadge');
const activityLogBody = document.getElementById('activityLogBody');
const clearLogBtn = document.getElementById('clearLogBtn');

// DOM Elements - Step 2 (Cinema Player & Subtitles)
const mainVideoPlayer = document.getElementById('mainVideoPlayer');
const customSubtitleOverlay = document.getElementById('customSubtitleOverlay');
const subLangSelect = document.getElementById('subLangSelect');
const subStyleSelect = document.getElementById('subStyleSelect');
const offsetMinusBig = document.getElementById('offsetMinusBig');
const offsetMinusSmall = document.getElementById('offsetMinusSmall');
const offsetPlusSmall = document.getElementById('offsetPlusSmall');
const offsetPlusBig = document.getElementById('offsetPlusBig');
const offsetValue = document.getElementById('offsetValue');
const downloadSrtBtn = document.getElementById('downloadSrtBtn');
const downloadVttBtn = document.getElementById('downloadVttBtn');
const sendToTranslatorBtn = document.getElementById('sendToTranslatorBtn');
const startOverBtn = document.getElementById('startOverBtn');

const transcriptList = document.getElementById('transcriptList');
const transcriptSearch = document.getElementById('transcriptSearch');
const segmentCountBadge = document.getElementById('segmentCountBadge');
const resumeAutoScrollBtn = document.getElementById('resumeAutoScrollBtn');

// Settings Modal & Global Activity Log Elements
const apiKeyStatus = document.getElementById('apiKeyStatus');
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const testCustomApiBtn = document.getElementById('testCustomApiBtn');
const presetTopToolsBtn = document.getElementById('presetTopToolsBtn');
const presetLocalOllamaBtn = document.getElementById('presetLocalOllamaBtn');
const presetClearCustomBtn = document.getElementById('presetClearCustomBtn');
const groqApiKeyInput = document.getElementById('groqApiKeyInput');
const openRouterApiKeyInput = document.getElementById('openRouterApiKeyInput');
const customApiKeyInput = document.getElementById('customApiKeyInput');
const customEndpointInput = document.getElementById('customEndpointInput');
const customModelInput = document.getElementById('customModelInput');
const settingsMessage = document.getElementById('settingsMessage');

const activityLogToggleBtn = document.getElementById('activityLogToggleBtn');
const activityLogModal = document.getElementById('activityLogModal');
const closeLogModalBtn = document.getElementById('closeLogModalBtn');
const closeLogModalFooterBtn = document.getElementById('closeLogModalFooterBtn');
const clearAllLogsBtn = document.getElementById('clearAllLogsBtn');
const globalLogHistory = document.getElementById('globalLogHistory');
const logBadgeCount = document.getElementById('logBadgeCount');
const modalLogCount = document.getElementById('modalLogCount');

let globalLogCounter = 0;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  checkConfig();
  setupEventListeners();
  setupKeyboardShortcuts();
  updateCustomTranslatorUI();

  if (subStyleSelect) {
    subStyleSelect.value = activeSubtitleStyle;
    updateSubtitleOverlayStyle();
  }

  if (transcriptSearch) {
    transcriptSearch.value = '';
  }
});

// Check Server Configuration / API Key
async function checkConfig() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    if (apiKeyStatus) {
      if (data.groqConfigured) {
        apiKeyStatus.className = 'status-chip ready';
        apiKeyStatus.querySelector('.text').textContent = `Groq: ${data.maskedKey}`;
      } else {
        apiKeyStatus.className = 'status-chip missing';
        apiKeyStatus.querySelector('.text').textContent = 'Groq Key Missing';
      }
    }
  } catch {
    if (apiKeyStatus) {
      apiKeyStatus.className = 'status-chip missing';
      apiKeyStatus.querySelector('.text').textContent = 'Server Offline';
    }
  }
}

function updateCustomTranslatorUI() {
  if (customTranslationEndpoint) {
    activeTranslatorNotice.textContent = `Using Custom Translation API: ${customTranslationEndpoint} (${customTranslationModel || 'Top-Tools-Ai'})`;
    activeTranslatorNotice.style.color = 'var(--cyan)';
  } else {
    activeTranslatorNotice.textContent = `Using Built-in AI Translator (Whisper Large-v3 + Contextual LLM)`;
    activeTranslatorNotice.style.color = 'var(--text-muted)';
  }

  if (customApiKeyInput) customApiKeyInput.value = customTranslationApiKey;
  if (customEndpointInput) customEndpointInput.value = customTranslationEndpoint;
  if (customModelInput) customModelInput.value = customTranslationModel;
}

function setupEventListeners() {
  // Dropzone & Browse triggers
  browseBtn.addEventListener('click', () => videoFileInput.click());
  dropZone.addEventListener('click', (e) => {
    if (e.target !== browseBtn && e.target !== clearFileBtn && !clearFileBtn.contains(e.target)) {
      videoFileInput.click();
    }
  });

  videoFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFileSelection(e.target.files[0]);
    }
  });

  // Drag and Drop
  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('drag-active');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('drag-active');
    }, false);
  });

  dropZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0 && files[0].type.startsWith('video/')) {
      handleFileSelection(files[0]);
    } else if (files.length > 0) {
      alert('Please upload a valid video file (MP4, MKV, WebM, MOV, AVI).');
    }
  });

  clearFileBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    resetFileSelection();
  });

  // Target Language Switcher (Reveal Devanagari vs Hinglish when Hindi or Both is picked)
  document.querySelectorAll('input[name="targetLang"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      const val = e.target.value;
      if (val === 'hi' || val === 'both') {
        hindiScriptRow.classList.remove('hidden');
      } else {
        hindiScriptRow.classList.add('hidden');
      }
    });
  });

  // Primary Action Button: Generate Subtitles & Play
  generateBtn.addEventListener('click', handleStartPipeline);

  // Configure custom translator link
  configureTranslatorLink.addEventListener('click', () => {
    settingsModal.classList.remove('hidden');
  });

  // Start Over Button
  startOverBtn.addEventListener('click', handleStartOver);

  // Re-translate with custom API
  sendToTranslatorBtn.addEventListener('click', async () => {
    if (!currentPipelineData || !currentPipelineData.jobId) {
      settingsModal.classList.remove('hidden');
      return;
    }

    if (!customTranslationEndpoint) {
      settingsModal.classList.remove('hidden');
      settingsMessage.textContent = 'Please configure your Custom Translation API URL and API Key first.';
      settingsMessage.className = 'settings-msg error';
      settingsMessage.classList.remove('hidden');
      return;
    }

    const targetLangToUse = currentPipelineData.targetLang || 'both';
    const modelToUse = customTranslationModel || 'Top-Tools-Ai';

    const confirmed = confirm(
      `Re-translate this video with Custom Translation API?\n\n` +
      `• Endpoint: ${customTranslationEndpoint}\n` +
      `• Model: ${modelToUse}\n` +
      `• Target Language: ${targetLangToUse.toUpperCase()}\n\n` +
      `This will run your transcript through your Custom API immediately without re-uploading or re-extracting audio!`
    );

    if (!confirmed) return;

    sendToTranslatorBtn.disabled = true;
    const origBtnText = sendToTranslatorBtn.innerHTML;
    sendToTranslatorBtn.innerHTML = '⏳ Translating...';
    appendActivityLog(`[Custom API] Requesting re-translation via ${customTranslationEndpoint} (${modelToUse})...`, 'system');

    try {
      const res = await fetch('/api/retranslate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: currentPipelineData.jobId,
          targetLang: targetLangToUse,
          hindiScript: (document.querySelector('input[name="hindiScript"]:checked') || {}).value || 'devanagari',
          customEndpoint: customTranslationEndpoint,
          customModel: customTranslationModel,
          customApiKey: customTranslationApiKey
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Re-translation failed.');
      }

      // Merge new subtitles into activeSubtitlesData
      if (!activeSubtitlesData) activeSubtitlesData = {};
      Object.assign(activeSubtitlesData, data.subtitles);

      populateSubtitleSelect(targetLangToUse);

      // Switch to translated track
      const preferredTrack = (targetLangToUse === 'hi') ? 'hi' : 'en';
      subLangSelect.value = activeSubtitlesData[preferredTrack] ? preferredTrack : Object.keys(data.subtitles)[0];
      switchSubtitleLanguage(subLangSelect.value);

      appendActivityLog(`[Custom API] Re-translation successful! Subtitles updated in player.`, 'system');
      alert(`🎉 Re-translation completed via Custom API (${modelToUse})!\nSubtitles and transcript have been updated.`);
    } catch (err) {
      appendActivityLog(`[Custom API Error] ${err.message}`, 'error');
      alert(`Re-translation failed: ${err.message}`);
    } finally {
      sendToTranslatorBtn.disabled = false;
      sendToTranslatorBtn.innerHTML = origBtnText;
    }
  });

  // Subtitle Language Switcher
  subLangSelect.addEventListener('change', (e) => {
    switchSubtitleLanguage(e.target.value);
  });

  // Subtitle Style Switcher
  subStyleSelect.addEventListener('change', (e) => {
    activeSubtitleStyle = e.target.value;
    localStorage.setItem('nihonsub_sub_style', activeSubtitleStyle);
    updateSubtitleOverlayStyle();
  });

  // Subtitle Time Offset Controls
  offsetMinusBig.addEventListener('click', () => adjustOffset(-0.5));
  offsetMinusSmall.addEventListener('click', () => adjustOffset(-0.1));
  offsetPlusSmall.addEventListener('click', () => adjustOffset(0.1));
  offsetPlusBig.addEventListener('click', () => adjustOffset(0.5));

  // Transcript Search Filter
  transcriptSearch.addEventListener('input', (e) => {
    filterTranscript(e.target.value);
  });

  // Transcript Auto-scroll Detection: Only pause auto-scroll if user actually scrolled manually
  let isProgrammaticScroll = false;

  transcriptList.addEventListener('wheel', () => {
    autoScrollEnabled = false;
    resumeAutoScrollBtn.classList.remove('hidden');
  }, { passive: true });

  transcriptList.addEventListener('touchmove', () => {
    autoScrollEnabled = false;
    resumeAutoScrollBtn.classList.remove('hidden');
  }, { passive: true });

  resumeAutoScrollBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    autoScrollEnabled = true;
    resumeAutoScrollBtn.classList.add('hidden');
    scrollToActiveSegment();
  });

  // Video Time Update for Synchronized Subtitles
  mainVideoPlayer.addEventListener('timeupdate', onVideoTimeUpdate);

  // Sync track visibility on fullscreen changes to prevent duplicate subtitles
  document.addEventListener('fullscreenchange', syncNativeTrackMode);
  document.addEventListener('webkitfullscreenchange', syncNativeTrackMode);
  mainVideoPlayer.addEventListener('webkitbeginfullscreen', () => {
    if (mainVideoPlayer.textTracks && mainVideoPlayer.textTracks.length > 0) {
      for (let i = 0; i < mainVideoPlayer.textTracks.length; i++) {
        mainVideoPlayer.textTracks[i].mode = 'showing';
      }
    }
  });
  mainVideoPlayer.addEventListener('webkitendfullscreen', syncNativeTrackMode);

  // Activity Log Console Clear
  if (clearLogBtn) {
    clearLogBtn.addEventListener('click', () => {
      activityLogBody.innerHTML = '<div class="log-entry system">[Cleared] Console wiped.</div>';
    });
  }

  // Global Activity Log Modal
  activityLogToggleBtn.addEventListener('click', () => {
    activityLogModal.classList.remove('hidden');
    globalLogHistory.scrollTop = globalLogHistory.scrollHeight;
  });

  closeLogModalBtn.addEventListener('click', () => activityLogModal.classList.add('hidden'));
  closeLogModalFooterBtn.addEventListener('click', () => activityLogModal.classList.add('hidden'));

  clearAllLogsBtn.addEventListener('click', () => {
    globalLogHistory.innerHTML = '<div class="log-entry system"><span class="log-time">[System]</span> <span class="log-text">Log history wiped.</span></div>';
    globalLogCounter = 0;
    updateLogBadges();
  });

  // Settings Modal
  settingsBtn.addEventListener('click', () => settingsModal.classList.remove('hidden'));
  closeSettingsBtn.addEventListener('click', () => settingsModal.classList.add('hidden'));

  saveSettingsBtn.addEventListener('click', async () => {
    const groqKey = groqApiKeyInput.value.trim();
    const openRouterKey = openRouterApiKeyInput.value.trim();
    customTranslationApiKey = customApiKeyInput ? customApiKeyInput.value.trim() : '';
    customTranslationEndpoint = customEndpointInput.value.trim();
    customTranslationModel = customModelInput.value.trim();

    localStorage.setItem('nihonsub_custom_api_key', customTranslationApiKey);
    localStorage.setItem('nihonsub_custom_endpoint', customTranslationEndpoint);
    localStorage.setItem('nihonsub_custom_model', customTranslationModel);
    updateCustomTranslatorUI();

    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groqApiKey: groqKey,
          openRouterApiKey: openRouterKey,
          customApiKey: customTranslationApiKey,
          customEndpoint: customTranslationEndpoint,
          customModel: customTranslationModel
        })
      });
      const data = await res.json();
      if (data.success) {
        settingsMessage.textContent = 'Settings and custom translation configuration saved!';
        settingsMessage.className = 'settings-msg success';
        settingsMessage.classList.remove('hidden');
        checkConfig();
        setTimeout(() => settingsModal.classList.add('hidden'), 1200);
      }
    } catch {
      settingsMessage.textContent = 'Failed to save settings to server.';
      settingsMessage.className = 'settings-msg error';
      settingsMessage.classList.remove('hidden');
    }
  });

  // Preset: top-tools-ai.com
  if (presetTopToolsBtn) {
    presetTopToolsBtn.addEventListener('click', () => {
      customEndpointInput.value = 'https://top-tools-ai.com/api/v1';
      customModelInput.value = 'Top-Tools-Ai';
      settingsMessage.textContent = '⚡ Preset applied: top-tools-ai.com (Model: Top-Tools-Ai). Enter your API Key and click Test or Save.';
      settingsMessage.className = 'settings-msg success';
      settingsMessage.classList.remove('hidden');
    });
  }

  // Preset: Local Ollama
  if (presetLocalOllamaBtn) {
    presetLocalOllamaBtn.addEventListener('click', () => {
      customEndpointInput.value = 'http://localhost:11434/v1';
      customModelInput.value = 'qwen2.5:7b';
      if (customApiKeyInput) customApiKeyInput.value = 'ollama';
      settingsMessage.textContent = '🦙 Preset applied: Local Ollama (qwen2.5:7b).';
      settingsMessage.className = 'settings-msg success';
      settingsMessage.classList.remove('hidden');
    });
  }

  // Preset: Clear
  if (presetClearCustomBtn) {
    presetClearCustomBtn.addEventListener('click', () => {
      if (customApiKeyInput) customApiKeyInput.value = '';
      customEndpointInput.value = '';
      customModelInput.value = '';
      settingsMessage.textContent = 'Cleared custom translation endpoint. Will use default built-in translator.';
      settingsMessage.className = 'settings-msg success';
      settingsMessage.classList.remove('hidden');
    });
  }

  // Test Custom Connection Button
  if (testCustomApiBtn) {
    testCustomApiBtn.addEventListener('click', async () => {
      const endpoint = customEndpointInput.value.trim();
      const model = customModelInput.value.trim() || 'Top-Tools-Ai';
      const apiKey = customApiKeyInput ? customApiKeyInput.value.trim() : '';

      if (!endpoint) {
        settingsMessage.textContent = 'Please enter a custom translation API URL.';
        settingsMessage.className = 'settings-msg error';
        settingsMessage.classList.remove('hidden');
        return;
      }

      if (!apiKey) {
        settingsMessage.textContent = 'Please enter your Custom API Key (from top-tools-ai.com) to test.';
        settingsMessage.className = 'settings-msg error';
        settingsMessage.classList.remove('hidden');
        return;
      }

      settingsMessage.textContent = `⏳ Testing connection to ${endpoint} (${model})...`;
      settingsMessage.className = 'settings-msg';
      settingsMessage.classList.remove('hidden');
      testCustomApiBtn.disabled = true;

      try {
        const res = await fetch('/api/test-custom-api', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint, model, apiKey })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          settingsMessage.innerHTML = `✅ <strong>Connected successfully!</strong><br>Model: <code>${data.model}</code><br>Test Translation: <em>"${data.reply}"</em>`;
          settingsMessage.className = 'settings-msg success';
        } else {
          settingsMessage.textContent = `❌ Test failed: ${data.error || 'Unknown error'}`;
          settingsMessage.className = 'settings-msg error';
        }
      } catch (err) {
        settingsMessage.textContent = `❌ Network error: ${err.message}`;
        settingsMessage.className = 'settings-msg error';
      } finally {
        testCustomApiBtn.disabled = false;
      }
    });
  }
}

function handleFileSelection(file) {
  selectedFile = file;
  fileNameDisplay.textContent = file.name;
  fileSizeDisplay.textContent = formatBytes(file.size);
  fileInfoBox.classList.remove('hidden');
  generateBtn.disabled = false;
  appendActivityLog(`[Video Selected] "${file.name}" (${formatBytes(file.size)})`, 'system');
}

function resetFileSelection() {
  selectedFile = null;
  videoFileInput.value = '';
  fileInfoBox.classList.add('hidden');
  generateBtn.disabled = true;
  appendActivityLog(`[Reset] Video selection cleared.`, 'system');
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatSeconds(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 10);
  return `${m}:${s < 10 ? '0' : ''}${s}.${ms}`;
}

function updateLogBadges() {
  if (logBadgeCount) logBadgeCount.textContent = globalLogCounter;
  if (modalLogCount) modalLogCount.textContent = `${globalLogCounter} entries`;
}

function appendActivityLog(msg, type = 'normal', timestamp = '') {
  const timeStr = timestamp || new Date().toLocaleTimeString();
  globalLogCounter++;
  updateLogBadges();

  if (globalLogHistory) {
    const globalEntry = document.createElement('div');
    globalEntry.className = `log-entry ${type}`;
    globalEntry.innerHTML = `<span class="log-time">[${timeStr}]</span> <span class="log-text">${escapeHtml(msg)}</span>`;
    globalLogHistory.appendChild(globalEntry);
    globalLogHistory.scrollTop = globalLogHistory.scrollHeight;
  }

  if (activityLogBody) {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.innerHTML = `<span class="log-time">[${timeStr}]</span> <span class="log-text">${escapeHtml(msg)}</span>`;
    activityLogBody.appendChild(entry);
    activityLogBody.scrollTop = activityLogBody.scrollHeight;
  }
}

// ==========================================
// FULL PIPELINE EXECUTION (STEP 1 -> STEP 2)
// ==========================================
async function handleStartPipeline() {
  if (!selectedFile) return;

  const targetLang = document.querySelector('input[name="targetLang"]:checked').value;

  // View transitions
  step1Section.classList.add('hidden');
  processingCard.classList.remove('hidden');
  step2PlayerSection.classList.add('hidden');

  // Reset Progress
  mainProgressBar.style.width = '0%';
  progressPercentText.textContent = '0%';
  progressStatusText.textContent = 'Uploading video and initiating pipeline...';
  activityLogBody.innerHTML = '';
  appendActivityLog(`Starting pipeline for target language: ${targetLang.toUpperCase()}`, 'system');

  const formData = new FormData();
  formData.append('video', selectedFile);
  formData.append('targetLang', targetLang);

  const hindiScript = (document.querySelector('input[name="hindiScript"]:checked') || {}).value || 'devanagari';
  formData.append('hindiScript', hindiScript);

  if (targetLang === 'hi' || targetLang === 'both') {
    appendActivityLog(`Hindi script style: ${hindiScript === 'hinglish' ? 'Hinglish (Roman Script)' : 'Devanagari (देवनागरी)'}`, 'system');
  }

  if (customTranslationEndpoint) {
    formData.append('customTranslationEndpoint', customTranslationEndpoint);
    formData.append('customTranslationModel', customTranslationModel);
    if (customTranslationApiKey) {
      formData.append('customTranslationApiKey', customTranslationApiKey);
    }
    appendActivityLog(`Using custom translation endpoint: ${customTranslationEndpoint} (${customTranslationModel || 'Top-Tools-Ai'})`, 'system');
  }

  try {
    const response = await fetch('/api/process', {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      let errMsg = 'Failed to process video.';
      try {
        const text = await response.text();
        errMsg = text.slice(0, 150) || errMsg;
      } catch {}
      throw new Error(errMsg);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let finalPayload = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line);

          if (evt.type === 'progress') {
            mainProgressBar.style.width = `${evt.percent}%`;
            progressPercentText.textContent = `${evt.percent}%`;
            progressStatusText.textContent = evt.message;
            appendActivityLog(evt.message, 'normal');

            if (evt.segmentsCount) {
              transcriptionBadge.textContent = `✅ ${evt.segmentsCount} segments (${evt.durationMinutes}m)`;
              transcriptionBadge.classList.remove('hidden');
            }
          } else if (evt.type === 'complete') {
            mainProgressBar.style.width = '100%';
            progressPercentText.textContent = '100%';
            progressStatusText.textContent = 'Subtitles generated successfully!';
            appendActivityLog('Pipeline completed successfully! Mounting Cinema Player...', 'success');
            finalPayload = evt.data;
          } else if (evt.type === 'error') {
            appendActivityLog(`❌ Error: ${evt.error}`, 'error');
            throw new Error(evt.error);
          }
        } catch (e) {
          if (e.message !== 'Unexpected end of JSON input') {
            console.error('NDJSON parsing error:', e);
          }
        }
      }
    }

    if (!finalPayload) {
      throw new Error('Pipeline finished without return data.');
    }

    currentPipelineData = finalPayload;
    activeSubtitlesData = finalPayload.subtitles;

    // Transition to Step 2 Player
    setTimeout(() => {
      processingCard.classList.add('hidden');
      step2PlayerSection.classList.remove('hidden');

      // Mount Local Video
      mainVideoPlayer.src = URL.createObjectURL(selectedFile);

      // Clear any search filter on player mount
      if (transcriptSearch) {
        transcriptSearch.value = '';
      }

      // Populate Subtitle Options
      populateSubtitleSelect(targetLang);

      // Select default subtitle track (English if present, else targetLang)
      const defaultTrack = activeSubtitlesData[targetLang] ? targetLang : (activeSubtitlesData.en ? 'en' : 'ja');
      subLangSelect.value = defaultTrack;
      switchSubtitleLanguage(defaultTrack);

    }, 800);

  } catch (err) {
    appendActivityLog(`Pipeline error: ${err.message}`, 'error');
    alert(`Processing Error: ${err.message}`);
    processingCard.classList.add('hidden');
    step1Section.classList.remove('hidden');
  }
}

function populateSubtitleSelect(targetLang) {
  subLangSelect.innerHTML = '';

  const addOption = (val, text) => {
    if (activeSubtitlesData && activeSubtitlesData[val]) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = text;
      subLangSelect.appendChild(opt);
    }
  };

  const hindiLabel = (activeSubtitlesData && activeSubtitlesData.hi && activeSubtitlesData.hi.script === 'hinglish')
    ? '🇮🇳 Hindi (Hinglish / Roman Script)'
    : '🇮🇳 Hindi (हिन्दी / देवनागरी)';

  addOption('en', '🇬🇧 English (Translated)');
  addOption('hi', hindiLabel);
  addOption('bi_en', '🌐 Bilingual (English + Japanese)');
  addOption('bi_hi', `🌐 Bilingual (${activeSubtitlesData?.hi?.script === 'hinglish' ? 'Hinglish' : 'Hindi'} + Japanese)`);
  addOption('ja', '🇯🇵 Japanese (Original Dialogue)');
}

function switchSubtitleLanguage(langKey) {
  if (!activeSubtitlesData || !activeSubtitlesData[langKey]) return;

  const track = activeSubtitlesData[langKey];
  activeSegments = track.segments || [];

  // Set download links
  downloadSrtBtn.href = track.srtUrl;
  downloadVttBtn.href = track.vttUrl;
  downloadSrtBtn.setAttribute('download', `${currentPipelineData.jobId}_${langKey}.srt`);
  downloadVttBtn.setAttribute('download', `${currentPipelineData.jobId}_${langKey}.vtt`);

  // Mount native WebVTT track for native video fullscreen mode
  const existingTracks = mainVideoPlayer.querySelectorAll('track');
  existingTracks.forEach(t => t.remove());

  if (track.vttUrl) {
    const trackEl = document.createElement('track');
    trackEl.kind = 'subtitles';
    trackEl.label = langKey.toUpperCase();
    trackEl.srclang = langKey.split('_')[0];
    trackEl.src = track.vttUrl;
    mainVideoPlayer.appendChild(trackEl);

    // Keep native track HIDDEN in standard mode so customSubtitleOverlay handles rich styling without duplication
    // We only enable native textTracks if document.fullscreenElement is the video itself
    syncNativeTrackMode();
  }

  // Render Interactive Transcript
  renderTranscript(activeSegments);
  onVideoTimeUpdate();
}

function syncNativeTrackMode() {
  const isNativeVideoFullscreen = document.fullscreenElement === mainVideoPlayer;
  const isWrapperFullscreen = document.fullscreenElement && document.fullscreenElement.contains(customSubtitleOverlay);

  // If the customSubtitleOverlay is visible and active on screen, disable native track to prevent double subtitles
  if (mainVideoPlayer.textTracks && mainVideoPlayer.textTracks.length > 0) {
    for (let i = 0; i < mainVideoPlayer.textTracks.length; i++) {
      if (isNativeVideoFullscreen && !isWrapperFullscreen) {
        mainVideoPlayer.textTracks[i].mode = 'showing';
      } else {
        mainVideoPlayer.textTracks[i].mode = 'disabled';
      }
    }
  }
}

function updateSubtitleOverlayStyle() {
  customSubtitleOverlay.className = `custom-subtitle-overlay style-${activeSubtitleStyle}`;
}

function adjustOffset(delta) {
  timeOffset = parseFloat((timeOffset + delta).toFixed(2));
  offsetValue.textContent = `${timeOffset > 0 ? '+' : ''}${timeOffset.toFixed(1)}s`;
  onVideoTimeUpdate();
}

function onVideoTimeUpdate() {
  const currentTime = mainVideoPlayer.currentTime + timeOffset;

  let matchedSegment = null;
  let matchedIndex = -1;

  for (let i = 0; i < activeSegments.length; i++) {
    const seg = activeSegments[i];
    if (currentTime >= seg.start && currentTime <= seg.end) {
      matchedSegment = seg;
      matchedIndex = i;
      break;
    }
  }

  // Update on-screen subtitle overlay
  if (matchedSegment && activeSubtitleStyle !== 'off') {
    const formatted = escapeHtml(matchedSegment.text).replace(/\n/g, '<br>');
    customSubtitleOverlay.innerHTML = `<div class="sub-text-ja">${formatted}</div>`;
  } else {
    customSubtitleOverlay.innerHTML = '';
  }

  // Highlight transcript item in sidebar
  if (matchedIndex !== activeSegmentIndex) {
    activeSegmentIndex = matchedIndex;
    updateTranscriptActiveItem(matchedIndex);
  }
}

function renderTranscript(segments) {
  transcriptList.innerHTML = '';
  segmentCountBadge.textContent = `${segments.length} segments`;

  if (!segments || segments.length === 0) {
    transcriptList.innerHTML = '<div class="empty-state">No subtitles available.</div>';
    return;
  }

  const fragment = document.createDocumentFragment();

  segments.forEach((seg, index) => {
    const item = document.createElement('div');
    item.className = 'transcript-item';
    item.dataset.index = index;
    item.dataset.start = seg.start;

    const formattedText = escapeHtml(seg.text).replace(/\n/g, '<br>');

    item.innerHTML = `
      <div class="item-meta">
        <span class="time-stamp">${formatSeconds(seg.start)} ➔ ${formatSeconds(seg.end)}</span>
      </div>
      <div class="item-text-ja">${formattedText}</div>
    `;

    item.addEventListener('click', () => {
      mainVideoPlayer.currentTime = Math.max(0, seg.start - timeOffset);
      mainVideoPlayer.play();
    });

    fragment.appendChild(item);
  });

  transcriptList.appendChild(fragment);
}

function updateTranscriptActiveItem(index) {
  const items = transcriptList.querySelectorAll('.transcript-item');
  items.forEach(el => el.classList.remove('active'));

  if (index >= 0 && index < items.length) {
    const activeEl = items[index];
    activeEl.classList.add('active');

    if (autoScrollEnabled) {
      scrollToActiveSegment(activeEl);
    }
  }
}

function scrollToActiveSegment(element) {
  const activeEl = element || transcriptList.querySelector('.transcript-item.active');
  if (activeEl && transcriptList) {
    const listRect = transcriptList.getBoundingClientRect();
    const itemRect = activeEl.getBoundingClientRect();
    const relativeTop = itemRect.top - listRect.top + transcriptList.scrollTop;
    const targetScroll = relativeTop - (listRect.height / 2) + (itemRect.height / 2);

    transcriptList.scrollTo({
      top: Math.max(0, targetScroll),
      behavior: 'smooth'
    });
  }
}

function filterTranscript(query) {
  const q = query.trim().toLowerCase();
  const items = transcriptList.querySelectorAll('.transcript-item');
  let matchCount = 0;

  items.forEach(item => {
    const text = item.textContent.toLowerCase();
    if (!q || text.includes(q)) {
      item.style.display = 'flex';
      matchCount++;
    } else {
      item.style.display = 'none';
    }
  });

  segmentCountBadge.textContent = q ? `${matchCount} matches` : `${activeSegments.length} segments`;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
    if (step2PlayerSection.classList.contains('hidden')) return;

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        mainVideoPlayer.paused ? mainVideoPlayer.play() : mainVideoPlayer.pause();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        mainVideoPlayer.currentTime = Math.max(0, mainVideoPlayer.currentTime - 5);
        break;
      case 'ArrowRight':
        e.preventDefault();
        mainVideoPlayer.currentTime = Math.min(mainVideoPlayer.duration, mainVideoPlayer.currentTime + 5);
        break;
      case 'ArrowUp':
        e.preventDefault();
        mainVideoPlayer.volume = Math.min(1, mainVideoPlayer.volume + 0.1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        mainVideoPlayer.volume = Math.max(0, mainVideoPlayer.volume - 0.1);
        break;
      case 'KeyF':
        e.preventDefault();
        if (document.fullscreenElement) {
          document.exitFullscreen();
        } else {
          document.getElementById('videoWrapper').requestFullscreen();
        }
        break;
      case 'KeyC':
        e.preventDefault();
        activeSubtitleStyle = activeSubtitleStyle === 'off' ? 'transparent' : 'off';
        subStyleSelect.value = activeSubtitleStyle;
        updateSubtitleOverlayStyle();
        break;
    }
  });
}

function handleStartOver() {
  if (mainVideoPlayer) {
    mainVideoPlayer.pause();
    mainVideoPlayer.src = '';
  }

  step2PlayerSection.classList.add('hidden');
  processingCard.classList.add('hidden');
  step1Section.classList.remove('hidden');

  currentPipelineData = null;
  activeSubtitlesData = null;
  activeSegments = [];
  activeSegmentIndex = -1;
  timeOffset = 0.0;
  offsetValue.textContent = '0.0s';
  if (transcriptSearch) {
    transcriptSearch.value = '';
  }
  resetFileSelection();
}
