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

// Speech-to-Text Transcription Config
let transcriptionConfig = {
  baseUrl: 'https://api.groq.com/openai/v1',
  model: 'whisper-large-v3',
  apiKey: ''
};

// Translation Providers Fallback Chain (Priority Order)
let translationProviders = [
  {
    id: 'prov_groq',
    name: 'Groq LPU (Primary)',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'qwen/qwen3.8-27b',
    apiKey: ''
  },
  {
    id: 'prov_toptools',
    name: 'top-tools-ai.com',
    baseUrl: 'https://top-tools-ai.com/api/v1',
    model: 'Top-Tools-Ai',
    apiKey: ''
  }
];

// Translation Pipeline Mode: 'fallback' (v1) | 'ensemble' (v2)
let currentTranslationMode = 'fallback';

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

// Translation Mode Elements
const translationModeRadios = document.querySelectorAll('input[name="translationMode"]');
const settingsTranslationModeRadios = document.querySelectorAll('input[name="settingsTranslationMode"]');
const modeDescIcon = document.getElementById('modeDescIcon');
const modeDescText = document.getElementById('modeDescText');
const modeTagBadge = document.getElementById('modeTagBadge');

// Candidate Inspector Modal Elements
const candidateInspectorModal = document.getElementById('candidateInspectorModal');
const closeInspectorBtn = document.getElementById('closeInspectorBtn');
const closeInspectorFooterBtn = document.getElementById('closeInspectorFooterBtn');
const inspectorSegmentIdBadge = document.getElementById('inspectorSegmentIdBadge');
const inspectorTimeSlot = document.getElementById('inspectorTimeSlot');
const inspectorJaText = document.getElementById('inspectorJaText');
const inspectorAcousticRow = document.getElementById('inspectorAcousticRow');
const inspectorAcousticText = document.getElementById('inspectorAcousticText');
const inspectorConsensusBadge = document.getElementById('inspectorConsensusBadge');
const candidatesListContainer = document.getElementById('candidatesListContainer');
let inspectingSegment = null;
let inspectingSegmentIndex = -1;

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

// Settings Modal Elements
const apiKeyStatus = document.getElementById('apiKeyStatus');
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const closeSettingsFooterBtn = document.getElementById('closeSettingsFooterBtn');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const resetDefaultsBtn = document.getElementById('resetDefaultsBtn');
const settingsMessage = document.getElementById('settingsMessage');

// Settings Navigation Tabs
const tabBtnTranscription = document.getElementById('tabBtnTranscription');
const tabBtnTranslation = document.getElementById('tabBtnTranslation');
const tabPaneTranscription = document.getElementById('tabPaneTranscription');
const tabPaneTranslation = document.getElementById('tabPaneTranslation');
const tabProviderCount = document.getElementById('tabProviderCount');

// Transcription Tab Elements
const transcriptionEndpointInput = document.getElementById('transcriptionEndpointInput');
const transcriptionModelInput = document.getElementById('transcriptionModelInput');
const transcriptionApiKeyInput = document.getElementById('transcriptionApiKeyInput');
const toggleTransKeyEye = document.getElementById('toggleTransKeyEye');
const testTranscriptionBtn = document.getElementById('testTranscriptionBtn');
const transcriptionTestStatus = document.getElementById('transcriptionTestStatus');
const presetGroqWhisperBtn = document.getElementById('presetGroqWhisperBtn');
const presetOpenAIWhisperBtn = document.getElementById('presetOpenAIWhisperBtn');
const presetLocalWhisperBtn = document.getElementById('presetLocalWhisperBtn');

// Translation Fallback Chain Elements
const translationProvidersContainer = document.getElementById('translationProvidersContainer');
const addCustomProviderBtn = document.getElementById('addCustomProviderBtn');
const addGroqProviderBtn = document.getElementById('addGroqProviderBtn');
const addTopToolsProviderBtn = document.getElementById('addTopToolsProviderBtn');
const addOpenRouterProviderBtn = document.getElementById('addOpenRouterProviderBtn');
const addOllamaProviderBtn = document.getElementById('addOllamaProviderBtn');

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
  loadStoredSettings();
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

// Load settings from localStorage
function loadStoredSettings() {
  try {
    const raw = localStorage.getItem('nihonsub_settings_v3');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.transcriptionConfig) {
        transcriptionConfig = { ...transcriptionConfig, ...parsed.transcriptionConfig };
      }
      if (Array.isArray(parsed.translationProviders) && parsed.translationProviders.length > 0) {
        translationProviders = parsed.translationProviders;
      }
      if (parsed.translationMode) {
        currentTranslationMode = parsed.translationMode;
      }
    } else {
      // Legacy migration
      const legacyKey = localStorage.getItem('nihonsub_custom_api_key') || '';
      const legacyEndpoint = localStorage.getItem('nihonsub_custom_endpoint') || '';
      const legacyModel = localStorage.getItem('nihonsub_custom_model') || '';
      if (legacyEndpoint || legacyKey) {
        const topToolsProv = translationProviders.find(p => p.id === 'prov_toptools');
        if (topToolsProv) {
          topToolsProv.baseUrl = legacyEndpoint || 'https://top-tools-ai.com/api/v1';
          topToolsProv.model = legacyModel || 'Top-Tools-Ai';
          topToolsProv.apiKey = legacyKey;
        }
      }
    }
  } catch (err) {
    console.warn('Failed to parse local settings:', err);
  }
}

// Check Server Configuration / API Key
async function checkConfig() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();

    if (data.translationMode) {
      currentTranslationMode = data.translationMode;
    }

    if (data.transcription) {
      if (data.transcription.baseUrl) transcriptionConfig.baseUrl = data.transcription.baseUrl;
      if (data.transcription.model) transcriptionConfig.model = data.transcription.model;
      if (!transcriptionConfig.apiKey && data.transcription.maskedKey) {
        transcriptionConfig.apiKey = data.transcription.maskedKey;
      }
    }

    if (Array.isArray(data.translationProviders) && data.translationProviders.length > 0) {
      data.translationProviders.forEach(srvProv => {
        const localProv = translationProviders.find(p => p.id === srvProv.id);
        if (localProv) {
          if (!localProv.apiKey && srvProv.maskedKey) {
            localProv.apiKey = srvProv.maskedKey;
          }
        } else if (srvProv.hasKey) {
          translationProviders.push({
            id: srvProv.id,
            name: srvProv.name,
            baseUrl: srvProv.baseUrl,
            model: srvProv.model,
            apiKey: srvProv.maskedKey || ''
          });
        }
      });
    }

    if (apiKeyStatus) {
      if (data.groqConfigured) {
        apiKeyStatus.className = 'status-chip ready';
        apiKeyStatus.querySelector('.text').textContent = `Speech: ${data.transcription?.model || 'Whisper'}`;
      } else {
        apiKeyStatus.className = 'status-chip missing';
        apiKeyStatus.querySelector('.text').textContent = 'Key Missing';
      }
    }

    setTranslationMode(currentTranslationMode);
    renderSettingsUI();
    updateCustomTranslatorUI();
  } catch {
    if (apiKeyStatus) {
      apiKeyStatus.className = 'status-chip missing';
      apiKeyStatus.querySelector('.text').textContent = 'Server Offline';
    }
    setTranslationMode(currentTranslationMode);
  }
}

function setTranslationMode(mode) {
  if (mode !== 'fallback' && mode !== 'ensemble') return;
  currentTranslationMode = mode;

  // Sync Step 1 Radios
  translationModeRadios.forEach(r => {
    r.checked = (r.value === mode);
  });

  // Sync Settings Radios
  settingsTranslationModeRadios.forEach(r => {
    r.checked = (r.value === mode);
  });

  if (modeDescIcon && modeDescText) {
    if (mode === 'ensemble') {
      modeDescIcon.textContent = '🏆';
      modeDescText.innerHTML = '<strong>Multi-Model Ensemble Voting (v2):</strong> Queries all configured AI models in parallel, eliminates hallucinations via semantic clustering, and crowns the best-fit subtitle for each line.';
      if (modeTagBadge) {
        modeTagBadge.textContent = 'v2 Ensemble Active';
        modeTagBadge.style.background = 'linear-gradient(135deg, rgba(245, 158, 11, 0.2), rgba(217, 119, 6, 0.2))';
        modeTagBadge.style.borderColor = 'rgba(245, 158, 11, 0.4)';
        modeTagBadge.style.color = '#fbbf24';
      }
    } else {
      modeDescIcon.textContent = '⚡';
      modeDescText.innerHTML = '<strong>Fast Fallback (v1):</strong> Uses your primary translation model and automatically fails over in real-time to backup models if rate limits (429) or timeouts occur.';
      if (modeTagBadge) {
        modeTagBadge.textContent = 'v1 Fast Fallback';
        modeTagBadge.style.background = 'linear-gradient(135deg, rgba(225, 29, 72, 0.2), rgba(168, 85, 247, 0.2))';
        modeTagBadge.style.borderColor = 'rgba(225, 29, 72, 0.35)';
        modeTagBadge.style.color = '#f43f5e';
      }
    }
  }

  updateCustomTranslatorUI();
}

function updateCustomTranslatorUI() {
  if (!activeTranslatorNotice) return;
  const activeCount = translationProviders.length;
  const primary = translationProviders[0] || { name: 'Groq LPU', model: 'qwen3.8-27b' };

  if (currentTranslationMode === 'ensemble') {
    activeTranslatorNotice.textContent = `🏆 Ensemble Engine Active: ${activeCount} model${activeCount === 1 ? '' : 's'} running in parallel with consensus voting`;
    activeTranslatorNotice.style.color = '#fbbf24';
  } else if (activeCount > 1) {
    const secondary = translationProviders[1];
    activeTranslatorNotice.textContent = `⚡ Fast Fallback: ${primary.name} ➔ ${secondary.name} (+${activeCount - 1} failover)`;
    activeTranslatorNotice.style.color = 'var(--cyan)';
  } else if (primary) {
    activeTranslatorNotice.textContent = `Using Translator: ${primary.name} (${primary.model})`;
    activeTranslatorNotice.style.color = 'var(--text-main)';
  } else {
    activeTranslatorNotice.textContent = `Using Built-in AI Translator`;
    activeTranslatorNotice.style.color = 'var(--text-muted)';
  }
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

  // Translation Engine Mode Switcher (Step 1)
  translationModeRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      setTranslationMode(e.target.value);
    });
  });

  // Translation Engine Mode Switcher (Settings Modal)
  settingsTranslationModeRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      setTranslationMode(e.target.value);
    });
  });

  // Candidate Inspector Modal Close Events
  if (closeInspectorBtn) {
    closeInspectorBtn.addEventListener('click', closeCandidateInspector);
  }
  if (closeInspectorFooterBtn) {
    closeInspectorFooterBtn.addEventListener('click', closeCandidateInspector);
  }
  if (candidateInspectorModal) {
    candidateInspectorModal.addEventListener('click', (e) => {
      if (e.target === candidateInspectorModal) closeCandidateInspector();
    });
  }

  // Primary Action Button: Generate Subtitles & Play
  generateBtn.addEventListener('click', handleStartPipeline);

  // Configure custom translator link
  configureTranslatorLink.addEventListener('click', () => {
    settingsModal.classList.remove('hidden');
  });

  // Start Over Button
  startOverBtn.addEventListener('click', handleStartOver);

  // Configure Translator Link on Main Screen
  if (configureTranslatorLink) {
    configureTranslatorLink.addEventListener('click', () => {
      settingsModal.classList.remove('hidden');
      switchSettingsTab('translation');
    });
  }

  // Re-translate with AI Fallback Chain or Ensemble
  sendToTranslatorBtn.addEventListener('click', async () => {
    if (!currentPipelineData || !currentPipelineData.jobId) {
      settingsModal.classList.remove('hidden');
      return;
    }

    const primaryProv = translationProviders[0] || { name: 'Primary AI', model: 'qwen3.8-27b' };
    const fallbackCount = Math.max(0, translationProviders.length - 1);
    const targetLangToUse = currentPipelineData.targetLang || 'both';
    const isEnsemble = currentTranslationMode === 'ensemble' && translationProviders.length > 1;

    const modeSummary = isEnsemble
      ? `• Mode: 🏆 Multi-Model Ensemble Voting (${translationProviders.length} models in parallel)`
      : `• Mode: ⚡ Fast Fallback (${primaryProv.name} with ${fallbackCount} failover)`;

    const confirmed = confirm(
      `Re-translate this video?\n\n` +
      `${modeSummary}\n` +
      `• Target Language: ${targetLangToUse.toUpperCase()}\n\n` +
      `This will run your Japanese transcript through the translation engine immediately without re-extracting audio!`
    );

    if (!confirmed) return;

    sendToTranslatorBtn.disabled = true;
    const origBtnText = sendToTranslatorBtn.innerHTML;
    sendToTranslatorBtn.innerHTML = '⏳ Translating...';
    appendActivityLog(`[Re-translation] Dispatched via ${isEnsemble ? 'Multi-Model Ensemble Voting' : primaryProv.name}...`, 'system');

    try {
      const res = await fetch('/api/retranslate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: currentPipelineData.jobId,
          targetLang: targetLangToUse,
          translationMode: currentTranslationMode,
          hindiScript: (document.querySelector('input[name="hindiScript"]:checked') || {}).value || 'devanagari',
          translationProviders: translationProviders
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

      appendActivityLog(`[Re-translation] Subtitles updated successfully in cinema player!`, 'system');
      alert(`🎉 Re-translation completed via ${primaryProv.name}!\nSubtitles and interactive transcript have been refreshed.`);
    } catch (err) {
      appendActivityLog(`[Re-translation Error] ${err.message}`, 'error');
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

  // ==========================================
  // SETTINGS MODAL INTERACTION & TABS
  // ==========================================
  settingsBtn.addEventListener('click', () => {
    renderSettingsUI();
    settingsModal.classList.remove('hidden');
  });

  closeSettingsBtn.addEventListener('click', () => settingsModal.classList.add('hidden'));
  if (closeSettingsFooterBtn) {
    closeSettingsFooterBtn.addEventListener('click', () => settingsModal.classList.add('hidden'));
  }

  // Settings Tabs Switcher
  if (tabBtnTranscription) {
    tabBtnTranscription.addEventListener('click', () => switchSettingsTab('transcription'));
  }
  if (tabBtnTranslation) {
    tabBtnTranslation.addEventListener('click', () => switchSettingsTab('translation'));
  }

  // Toggle Transcription API Key Eye
  if (toggleTransKeyEye && transcriptionApiKeyInput) {
    toggleTransKeyEye.addEventListener('click', () => {
      const isPass = transcriptionApiKeyInput.type === 'password';
      transcriptionApiKeyInput.type = isPass ? 'text' : 'password';
      toggleTransKeyEye.textContent = isPass ? '🙈' : '👁️';
    });
  }

  // Transcription Presets
  if (presetGroqWhisperBtn) {
    presetGroqWhisperBtn.addEventListener('click', () => {
      transcriptionEndpointInput.value = 'https://api.groq.com/openai/v1';
      transcriptionModelInput.value = 'whisper-large-v3';
      showSettingsNotice('⚡ Preset applied: Groq Whisper Large-v3 (Default / High Speed). Enter your API Key.');
    });
  }
  if (presetOpenAIWhisperBtn) {
    presetOpenAIWhisperBtn.addEventListener('click', () => {
      transcriptionEndpointInput.value = 'https://api.openai.com/v1';
      transcriptionModelInput.value = 'whisper-1';
      showSettingsNotice('🌐 Preset applied: OpenAI Whisper-1. Enter your OpenAI API Key.');
    });
  }
  if (presetLocalWhisperBtn) {
    presetLocalWhisperBtn.addEventListener('click', () => {
      transcriptionEndpointInput.value = 'http://localhost:8000/v1';
      transcriptionModelInput.value = 'whisper-1';
      showSettingsNotice('💻 Preset applied: Local Whisper Endpoint (http://localhost:8000/v1).');
    });
  }

  // Test Transcription Connection
  if (testTranscriptionBtn) {
    testTranscriptionBtn.addEventListener('click', async () => {
      const baseUrl = transcriptionEndpointInput.value.trim();
      const model = transcriptionModelInput.value.trim() || 'whisper-large-v3';
      const apiKey = transcriptionApiKeyInput.value.trim();

      if (!apiKey) {
        showTranscriptionTestStatus('error', 'Please enter your Transcription API Key to test.');
        return;
      }

      showTranscriptionTestStatus('testing', `Testing connection to ${baseUrl}...`);
      testTranscriptionBtn.disabled = true;

      try {
        const res = await fetch('/api/test-transcription-api', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ baseUrl, model, apiKey })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          showTranscriptionTestStatus('success', `✅ ${data.message || 'Connected successfully!'}`);
        } else {
          showTranscriptionTestStatus('error', `❌ ${data.error || 'Connection failed'}`);
        }
      } catch (err) {
        showTranscriptionTestStatus('error', `❌ Network error: ${err.message}`);
      } finally {
        testTranscriptionBtn.disabled = false;
      }
    });
  }

  // Translation Preset: Add Groq
  if (addGroqProviderBtn) {
    addGroqProviderBtn.addEventListener('click', () => {
      translationProviders.push({
        id: 'prov_' + Date.now(),
        name: 'Groq LPU (Qwen 3.8)',
        baseUrl: 'https://api.groq.com/openai/v1',
        model: 'qwen/qwen3.8-27b',
        apiKey: ''
      });
      renderTranslationProviders();
      showSettingsNotice('Added Groq (Qwen 3.8) to translation fallback chain.');
    });
  }

  // Translation Preset: Add top-tools-ai.com
  if (addTopToolsProviderBtn) {
    addTopToolsProviderBtn.addEventListener('click', () => {
      translationProviders.push({
        id: 'prov_' + Date.now(),
        name: 'top-tools-ai.com',
        baseUrl: 'https://top-tools-ai.com/api/v1',
        model: 'Top-Tools-Ai',
        apiKey: ''
      });
      renderTranslationProviders();
      showSettingsNotice('Added top-tools-ai.com to translation fallback chain. Enter your API Key.');
    });
  }

  // Translation Preset: Add OpenRouter
  if (addOpenRouterProviderBtn) {
    addOpenRouterProviderBtn.addEventListener('click', () => {
      translationProviders.push({
        id: 'prov_' + Date.now(),
        name: 'OpenRouter (DeepSeek)',
        baseUrl: 'https://openrouter.ai/api/v1',
        model: 'deepseek/deepseek-chat',
        apiKey: ''
      });
      renderTranslationProviders();
      showSettingsNotice('Added OpenRouter (DeepSeek) to translation fallback chain.');
    });
  }

  // Translation Preset: Add Local Ollama
  if (addOllamaProviderBtn) {
    addOllamaProviderBtn.addEventListener('click', () => {
      translationProviders.push({
        id: 'prov_' + Date.now(),
        name: 'Local Ollama',
        baseUrl: 'http://localhost:11434/v1',
        model: 'qwen2.5:7b',
        apiKey: 'ollama'
      });
      renderTranslationProviders();
      showSettingsNotice('Added Local Ollama (qwen2.5:7b) to translation chain.');
    });
  }

  // Add Custom Blank Provider Button
  if (addCustomProviderBtn) {
    addCustomProviderBtn.addEventListener('click', () => {
      const newIndex = translationProviders.length + 1;
      translationProviders.push({
        id: 'prov_' + Date.now(),
        name: `Custom Provider #${newIndex}`,
        baseUrl: 'https://top-tools-ai.com/api/v1',
        model: 'Top-Tools-Ai',
        apiKey: ''
      });
      renderTranslationProviders();
      showSettingsNotice(`Added new Translation Provider slot #${newIndex}. Fill in the details and save.`);
    });
  }

  // Reset Defaults
  if (resetDefaultsBtn) {
    resetDefaultsBtn.addEventListener('click', () => {
      if (!confirm('Reset all settings to recommended defaults?')) return;
      transcriptionConfig = {
        baseUrl: 'https://api.groq.com/openai/v1',
        model: 'whisper-large-v3',
        apiKey: ''
      };
      translationProviders = [
        {
          id: 'prov_groq',
          name: 'Groq LPU (Primary)',
          baseUrl: 'https://api.groq.com/openai/v1',
          model: 'qwen/qwen3.8-27b',
          apiKey: ''
        },
        {
          id: 'prov_toptools',
          name: 'top-tools-ai.com',
          baseUrl: 'https://top-tools-ai.com/api/v1',
          model: 'Top-Tools-Ai',
          apiKey: ''
        }
      ];
      renderSettingsUI();
      showSettingsNotice('Settings reset to defaults. Remember to click Save.');
    });
  }

  // Save Settings
  saveSettingsBtn.addEventListener('click', async () => {
    // 1. Read transcription inputs
    transcriptionConfig.baseUrl = transcriptionEndpointInput.value.trim() || 'https://api.groq.com/openai/v1';
    transcriptionConfig.model = transcriptionModelInput.value.trim() || 'whisper-large-v3';
    transcriptionConfig.apiKey = transcriptionApiKeyInput.value.trim();

    // 2. Read each translation provider from rendered DOM cards
    translationProviders.forEach(prov => {
      const card = document.getElementById(`card_${prov.id}`);
      if (card) {
        const nameInput = card.querySelector('.provider-name-input');
        const baseInput = card.querySelector('.provider-baseurl-input');
        const modelInput = card.querySelector('.provider-model-input');
        const keyInput = card.querySelector('.provider-apikey-input');

        if (nameInput) prov.name = nameInput.value.trim() || prov.name;
        if (baseInput) prov.baseUrl = baseInput.value.trim() || prov.baseUrl;
        if (modelInput) prov.model = modelInput.value.trim() || prov.model;
        if (keyInput) prov.apiKey = keyInput.value.trim();
      }
    });

    // 3. Read translationMode from settings radio
    const checkedSettingsMode = (document.querySelector('input[name="settingsTranslationMode"]:checked') || {}).value;
    if (checkedSettingsMode) {
      setTranslationMode(checkedSettingsMode);
    }

    // 4. Persist to localStorage
    localStorage.setItem('nihonsub_settings_v3', JSON.stringify({
      transcriptionConfig,
      translationProviders,
      translationMode: currentTranslationMode
    }));

    updateCustomTranslatorUI();

    // 5. Send to server
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          translationMode: currentTranslationMode,
          transcription: transcriptionConfig,
          translationProviders: translationProviders
        })
      });
      const data = await res.json();
      if (data.success) {
        settingsMessage.textContent = '✅ All settings and translation fallback providers saved successfully!';
        settingsMessage.className = 'settings-msg success';
        settingsMessage.classList.remove('hidden');
        checkConfig();
        setTimeout(() => settingsModal.classList.add('hidden'), 1200);
      } else {
        throw new Error(data.error || 'Server rejected settings.');
      }
    } catch (err) {
      settingsMessage.textContent = `❌ Failed to save to server: ${err.message}`;
      settingsMessage.className = 'settings-msg error';
      settingsMessage.classList.remove('hidden');
    }
  });
}

function switchSettingsTab(tabName) {
  if (tabName === 'transcription') {
    tabBtnTranscription.classList.add('active');
    tabBtnTranslation.classList.remove('active');
    tabPaneTranscription.classList.remove('hidden');
    tabPaneTranslation.classList.add('hidden');
  } else {
    tabBtnTranslation.classList.add('active');
    tabBtnTranscription.classList.remove('active');
    tabPaneTranslation.classList.remove('hidden');
    tabPaneTranscription.classList.add('hidden');
  }
}

function showSettingsNotice(msg) {
  if (!settingsMessage) return;
  settingsMessage.textContent = msg;
  settingsMessage.className = 'settings-msg success';
  settingsMessage.classList.remove('hidden');
  setTimeout(() => settingsMessage.classList.add('hidden'), 4000);
}

function showTranscriptionTestStatus(type, msg) {
  if (!transcriptionTestStatus) return;
  transcriptionTestStatus.className = `provider-test-status ${type}`;
  transcriptionTestStatus.textContent = msg;
  transcriptionTestStatus.classList.remove('hidden');
}

function renderSettingsUI() {
  if (transcriptionEndpointInput) transcriptionEndpointInput.value = transcriptionConfig.baseUrl || 'https://api.groq.com/openai/v1';
  if (transcriptionModelInput) transcriptionModelInput.value = transcriptionConfig.model || 'whisper-large-v3';
  if (transcriptionApiKeyInput) transcriptionApiKeyInput.value = transcriptionConfig.apiKey || '';

  renderTranslationProviders();
}

function renderTranslationProviders() {
  if (!translationProvidersContainer) return;
  if (tabProviderCount) tabProviderCount.textContent = translationProviders.length;

  translationProvidersContainer.innerHTML = '';

  translationProviders.forEach((prov, idx) => {
    const isPrimary = idx === 0;
    const priorityLabel = isPrimary ? '🟢 #1 PRIMARY' : `🟡 #${idx + 1} FALLBACK`;
    const priorityClass = isPrimary ? 'primary' : 'fallback';
    const cardClass = isPrimary ? 'is-primary' : 'is-fallback';

    const card = document.createElement('div');
    card.className = `provider-card ${cardClass}`;
    card.id = `card_${prov.id}`;

    card.innerHTML = `
      <div class="provider-card-header">
        <div class="provider-title-group">
          <span class="priority-badge ${priorityClass}">${priorityLabel}</span>
          <input type="text" class="provider-name-input" value="${escapeHtml(prov.name)}" placeholder="Provider Name" title="Edit provider name">
        </div>
        <div class="provider-actions">
          <button type="button" class="btn-icon-tiny btn-move-up" data-idx="${idx}" title="Move Up (Increase Priority)" ${isPrimary ? 'disabled' : ''}>▲</button>
          <button type="button" class="btn-icon-tiny btn-move-down" data-idx="${idx}" title="Move Down (Decrease Priority)" ${idx === translationProviders.length - 1 ? 'disabled' : ''}>▼</button>
          <button type="button" class="btn-icon-tiny danger btn-delete-provider" data-idx="${idx}" title="Remove this provider" ${translationProviders.length <= 1 ? 'disabled' : ''}>🗑️</button>
        </div>
      </div>

      <div class="settings-grid-2col">
        <div class="input-group">
          <label>API Base URL (or /chat/completions)</label>
          <input type="url" class="styled-input provider-baseurl-input" value="${escapeHtml(prov.baseUrl)}" placeholder="https://api.groq.com/openai/v1">
        </div>
        <div class="input-group">
          <label>Model Name</label>
          <input type="text" class="styled-input provider-model-input" value="${escapeHtml(prov.model)}" placeholder="e.g. qwen/qwen3.8-27b or Top-Tools-Ai">
        </div>
      </div>

      <div class="input-group">
        <label>API Key</label>
        <div class="password-input-wrap">
          <input type="password" class="styled-input provider-apikey-input" value="${escapeHtml(prov.apiKey || '')}" placeholder="API key (gsk_..., sk-..., etc.)">
          <button type="button" class="btn-toggle-eye btn-toggle-prov-eye" title="Show/Hide Key">👁️</button>
        </div>
      </div>

      <div class="provider-card-footer">
        <button type="button" class="btn btn-secondary btn-sm btn-test-prov" data-id="${prov.id}">
          🧪 Test Connection
        </button>
        <div class="provider-test-status hidden" id="status_${prov.id}"></div>
      </div>
    `;

    // Event bindings inside this card
    const nameInput = card.querySelector('.provider-name-input');
    const baseInput = card.querySelector('.provider-baseurl-input');
    const modelInput = card.querySelector('.provider-model-input');
    const keyInput = card.querySelector('.provider-apikey-input');
    const eyeBtn = card.querySelector('.btn-toggle-prov-eye');
    const testBtn = card.querySelector('.btn-test-prov');
    const statusDiv = card.querySelector(`#status_${prov.id}`);

    nameInput.addEventListener('input', (e) => { prov.name = e.target.value.trim(); });
    baseInput.addEventListener('input', (e) => { prov.baseUrl = e.target.value.trim(); });
    modelInput.addEventListener('input', (e) => { prov.model = e.target.value.trim(); });
    keyInput.addEventListener('input', (e) => { prov.apiKey = e.target.value.trim(); });

    eyeBtn.addEventListener('click', () => {
      const isPass = keyInput.type === 'password';
      keyInput.type = isPass ? 'text' : 'password';
      eyeBtn.textContent = isPass ? '🙈' : '👁️';
    });

    testBtn.addEventListener('click', async () => {
      const endpoint = prov.baseUrl;
      const model = prov.model;
      const apiKey = prov.apiKey;

      if (!apiKey) {
        statusDiv.className = 'provider-test-status error';
        statusDiv.textContent = '❌ Please enter an API key to test.';
        statusDiv.classList.remove('hidden');
        return;
      }

      statusDiv.className = 'provider-test-status testing';
      statusDiv.textContent = `Testing ${model}...`;
      statusDiv.classList.remove('hidden');
      testBtn.disabled = true;

      try {
        const res = await fetch('/api/test-custom-api', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint, model, apiKey, providerId: prov.id })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          statusDiv.className = 'provider-test-status success';
          statusDiv.innerHTML = `✅ <strong>Connected!</strong> Reply: <em>"${escapeHtml(data.reply)}"</em>`;
        } else {
          statusDiv.className = 'provider-test-status error';
          statusDiv.textContent = `❌ ${data.error || 'Connection failed'}`;
        }
      } catch (err) {
        statusDiv.className = 'provider-test-status error';
        statusDiv.textContent = `❌ Network error: ${err.message}`;
      } finally {
        testBtn.disabled = false;
      }
    });

    // Move Up
    const moveUpBtn = card.querySelector('.btn-move-up');
    if (moveUpBtn && !isPrimary) {
      moveUpBtn.addEventListener('click', () => {
        const temp = translationProviders[idx];
        translationProviders[idx] = translationProviders[idx - 1];
        translationProviders[idx - 1] = temp;
        renderTranslationProviders();
      });
    }

    // Move Down
    const moveDownBtn = card.querySelector('.btn-move-down');
    if (moveDownBtn && idx < translationProviders.length - 1) {
      moveDownBtn.addEventListener('click', () => {
        const temp = translationProviders[idx];
        translationProviders[idx] = translationProviders[idx + 1];
        translationProviders[idx + 1] = temp;
        renderTranslationProviders();
      });
    }

    // Remove
    const delBtn = card.querySelector('.btn-delete-provider');
    if (delBtn && translationProviders.length > 1) {
      delBtn.addEventListener('click', () => {
        if (confirm(`Remove "${prov.name}" from translation providers?`)) {
          translationProviders.splice(idx, 1);
          renderTranslationProviders();
        }
      });
    }

    translationProvidersContainer.appendChild(card);
  });
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

  // Append Speech-to-Text, Translation Mode, & Translation Providers configurations
  formData.append('translationMode', currentTranslationMode);
  formData.append('transcriptionConfig', JSON.stringify(transcriptionConfig));
  formData.append('translationProviders', JSON.stringify(translationProviders));

  const primaryProv = translationProviders[0] || { name: 'Groq LPU', model: 'qwen3.8-27b' };
  const fallbackProvCount = Math.max(0, translationProviders.length - 1);
  if (currentTranslationMode === 'ensemble' && translationProviders.length > 1) {
    appendActivityLog(`[Engine Pipeline] Speech-to-Text: ${transcriptionConfig.model} | 🏆 Ensemble: Dispatching to ${translationProviders.length} models in parallel with consensus clustering & voting`, 'system');
  } else {
    appendActivityLog(`[Engine Pipeline] Speech-to-Text: ${transcriptionConfig.model} | Translation: ${primaryProv.name} (${fallbackProvCount} fallback${fallbackProvCount === 1 ? '' : 's'})`, 'system');
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

    let ensembleBadgeHtml = '';
    if (seg.ensemble && seg.ensemble.candidates && seg.ensemble.candidates.length > 0) {
      const votes = seg.ensemble.consensusCount || 1;
      const total = seg.ensemble.totalVotes || seg.ensemble.candidates.length;
      ensembleBadgeHtml = `<button type="button" class="ensemble-badge-btn" title="Inspect model candidates & consensus votes" data-index="${index}">🏆 ${votes}/${total} Consensus</button>`;
    }

    item.innerHTML = `
      <div class="item-meta">
        <span class="time-stamp">${formatSeconds(seg.start)} ➔ ${formatSeconds(seg.end)}</span>
        ${ensembleBadgeHtml}
      </div>
      <div class="item-text-ja">${formattedText}</div>
    `;

    const badgeBtn = item.querySelector('.ensemble-badge-btn');
    if (badgeBtn) {
      badgeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openCandidateInspector(seg, index);
      });
    }

    item.addEventListener('click', () => {
      mainVideoPlayer.currentTime = Math.max(0, seg.start - timeOffset);
      mainVideoPlayer.play();
    });

    fragment.appendChild(item);
  });

  transcriptList.appendChild(fragment);
}

function openCandidateInspector(seg, index) {
  if (!candidateInspectorModal) return;
  inspectingSegment = seg;
  inspectingSegmentIndex = index;

  inspectorSegmentIdBadge.textContent = `Segment #${index + 1}`;
  inspectorTimeSlot.textContent = `${formatSeconds(seg.start)} ➔ ${formatSeconds(seg.end)} (${(seg.end - seg.start).toFixed(1)}s)`;

  // Find original Japanese dialogue
  let jaText = seg.japanese_text || seg.origText || '';
  if (!jaText && activeSubtitlesData && activeSubtitlesData.ja && activeSubtitlesData.ja.segments) {
    const origSeg = activeSubtitlesData.ja.segments.find(s => s.id === seg.id);
    if (origSeg) jaText = origSeg.text;
  }
  if (!jaText) jaText = seg.text;
  inspectorJaText.textContent = jaText;

  if (seg.acousticAudioTranslation) {
    inspectorAcousticRow.classList.remove('hidden');
    inspectorAcousticText.textContent = `"${seg.acousticAudioTranslation}"`;
  } else {
    inspectorAcousticRow.classList.add('hidden');
  }

  const consensusVotes = seg.ensemble?.consensusCount || 1;
  const totalVotes = seg.ensemble?.totalVotes || seg.ensemble?.candidates?.length || 1;
  inspectorConsensusBadge.textContent = `🗳️ ${consensusVotes} of ${totalVotes} Models in Agreement (${Math.round((consensusVotes / totalVotes) * 100)}% Consensus)`;

  renderCandidateList(seg, index);
  candidateInspectorModal.classList.remove('hidden');
}

function renderCandidateList(seg, index) {
  candidatesListContainer.innerHTML = '';
  const cands = seg.ensemble?.candidates || [];

  if (cands.length === 0) {
    candidatesListContainer.innerHTML = '<div class="empty-state">No candidate history recorded for this segment.</div>';
    return;
  }

  cands.forEach((cand, cIdx) => {
    const isWinner = Boolean(cand.isWinner || cand.text === seg.text);
    const card = document.createElement('div');
    card.className = `candidate-item-card ${isWinner ? 'winner' : ''} ${cand.isOutlier ? 'outlier' : ''}`;

    card.innerHTML = `
      <div class="candidate-header">
        <div class="candidate-prov-info">
          <span class="candidate-prov-name">${escapeHtml(cand.provider)}</span>
          <span class="candidate-prov-model">(${escapeHtml(cand.model)})</span>
        </div>
        <div class="candidate-badges">
          ${isWinner ? '<span class="candidate-winner-tag">🏆 Active Subtitle</span>' : ''}
          ${cand.isOutlier ? '<span class="candidate-outlier-tag">⚠️ Discarded Outlier</span>' : `<span class="candidate-score-tag">Score: ${cand.score}/100</span>`}
          <span class="candidate-cps-tag">${cand.cps || (cand.text.length / Math.max(0.6, seg.end - seg.start)).toFixed(1)} CPS</span>
        </div>
      </div>
      <div class="candidate-body">
        <div class="candidate-text-content">${escapeHtml(cand.text)}</div>
        <div class="candidate-actions">
          <button type="button" class="btn-apply-cand ${isWinner ? 'active' : ''}" data-cand-idx="${cIdx}">
            ${isWinner ? '✓ Active' : 'Apply Translation'}
          </button>
        </div>
      </div>
    `;

    const applyBtn = card.querySelector('.btn-apply-cand');
    if (!isWinner && applyBtn) {
      applyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        applyCandidateAsWinner(seg, index, cand);
      });
    }

    candidatesListContainer.appendChild(card);
  });
}

function applyCandidateAsWinner(seg, index, chosenCand) {
  seg.text = chosenCand.text;
  if (seg.ensemble && seg.ensemble.candidates) {
    seg.ensemble.candidates.forEach(c => {
      c.isWinner = (c.text === chosenCand.text && c.provider === chosenCand.provider);
    });
    seg.ensemble.winner = chosenCand.provider;
    seg.ensemble.winnerModel = chosenCand.model;
    seg.ensemble.winnerScore = chosenCand.score;
  }

  // Update in activeSubtitlesData if present
  const currentTrackKey = subLangSelect.value;
  if (activeSubtitlesData && activeSubtitlesData[currentTrackKey] && activeSubtitlesData[currentTrackKey].segments) {
    const match = activeSubtitlesData[currentTrackKey].segments.find(s => s.id === seg.id);
    if (match) {
      match.text = chosenCand.text;
      match.ensemble = seg.ensemble;
    }
  }

  // Re-render transcript & active item
  renderTranscript(activeSegments);
  updateTranscriptActiveItem(activeSegmentIndex);
  onVideoTimeUpdate();

  // Re-render candidates list to reflect new winner
  renderCandidateList(seg, index);
  appendActivityLog(`[Candidate Override] Segment #${index + 1} updated to: "${chosenCand.text}" (${chosenCand.provider})`, 'system');
}

function closeCandidateInspector() {
  if (candidateInspectorModal) {
    candidateInspectorModal.classList.add('hidden');
  }
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
