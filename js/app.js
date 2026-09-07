import { fetchSystemStatus, uploadAndProbeFile, startConversion, subscribeToJobProgress, fetchAllJobs } from './api.js';
import { createQueueItemElement, appendActivityLog, renderMetricValue } from './components.js';

/**
 * Application State Store
 * Manages active file selections, probe inspection payloads, user tuning preferences,
 * real-time conversion job status, and cumulative dashboard session statistics.
 */
const state = {
  selectedFile: null,
  fileId: null,
  probeData: null,
  mediaType: 'video', // 'video' | 'audio' (source media type)
  videoMode: 'video', // 'video' | 'extract_audio' (target mode when video is selected)
  activeJobId: null,
  isConverting: false,
  options: {
    resolution: 'original',
    compression: 'lossless_web',
    audioFormat: 'm4a',
    audioQuality: 'high',
    stripMetadata: true,
    fastStart: true
  },
  stats: {
    totalSavedBytes: 0,
    filesConverted: 0,
    tagsScrubbed: 0
  }
};

// DOM Elements
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const fileSelectedBanner = document.getElementById('fileSelectedBanner');
const selectedFileName = document.getElementById('selectedFileName');
const selectedFileSpecs = document.getElementById('selectedFileSpecs');
const fileTypeIcon = document.getElementById('fileTypeIcon');
const fileIconBox = document.getElementById('fileIconBox');
const stageSubtitle = document.getElementById('stageSubtitle');
const removeFileBtn = document.getElementById('removeFileBtn');
const convertBtn = document.getElementById('convertBtn');
const convertBtnLabel = document.getElementById('convertBtnLabel');
const progressCard = document.getElementById('progressCard');
const progressBar = document.getElementById('progressBar');
const progressPct = document.getElementById('progressPct');
const progressMsg = document.getElementById('progressMsg');
const queueList = document.getElementById('queueList');
const systemStatusPill = document.getElementById('systemStatusPill');
const privacyCheckbox = document.getElementById('privacyCheckbox');
const fastStartCheckbox = document.getElementById('fastStartCheckbox');
const fastStartRow = document.getElementById('fastStartRow');
const queueBadgeCount = document.getElementById('queueBadgeCount');
const tuningSection = document.getElementById('tuningSection');
const conversionModeBar = document.getElementById('conversionModeBar');
const modeVideoBtn = document.getElementById('modeVideoBtn');
const modeExtractAudioBtn = document.getElementById('modeExtractAudioBtn');
const videoControlsBar = document.getElementById('videoControlsBar');
const audioControlsBar = document.getElementById('audioControlsBar');
const uploadAnotherBtn = document.getElementById('uploadAnotherBtn');

// Summary Hero Card Elements
const summaryHeroCard = document.getElementById('summaryHeroCard');
const summaryOrigFormat = document.getElementById('summaryOrigFormat');
const summaryOrigSpecs = document.getElementById('summaryOrigSpecs');
const summaryOutFormat = document.getElementById('summaryOutFormat');
const summaryOutSpecs = document.getElementById('summaryOutSpecs');
const summarySpaceSaved = document.getElementById('summarySpaceSaved');
const summaryPrivacyStatus = document.getElementById('summaryPrivacyStatus');
const summaryFastStartStatus = document.getElementById('summaryFastStartStatus');
const prominentDownloadBtn = document.getElementById('prominentDownloadBtn');

// Tab switcher elements
const tabInspector = document.getElementById('tabInspector');
const tabQueue = document.getElementById('tabQueue');
const tabActivity = document.getElementById('tabActivity');
const viewInspector = document.getElementById('viewInspector');
const viewQueue = document.getElementById('viewQueue');
const viewActivity = document.getElementById('viewActivity');

// Media Inspector Spec elements
const specFormat = document.getElementById('specFormat');
const specResolution = document.getElementById('specResolution');
const specSizeComparison = document.getElementById('specSizeComparison');
const specMetadata = document.getElementById('specMetadata');
const discoveredTagsCount = document.getElementById('discoveredTagsCount');
const discoveredTagsList = document.getElementById('discoveredTagsList');

/**
 * Initializes dashboard event listeners, validates backend engine status,
 * and restores queue history on page load.
 */
async function initDashboard() {
  bindEventListeners();
  appendActivityLog('SlimStream Studio initialized and ready.', 'info');
  
  const status = await fetchSystemStatus();
  if (status.ready) {
    systemStatusPill.innerHTML = `
      <span class="status-dot ready"></span>
      <span>Engine Ready</span>
    `;
  } else {
    systemStatusPill.innerHTML = `
      <span class="status-dot warning"></span>
      <span>Setup Required</span>
    `;
    appendActivityLog('FFmpeg binary was not found. Please install FFmpeg.', 'error');
  }

  // Load existing queue jobs if any
  loadQueueHistory();
}

/**
 * Switches the active sidebar view tab between Inspector, Queue, and Activity Feed.
 *
 * @param {'inspector' | 'queue' | 'activity'} tabName Target tab identifier.
 */
function switchSidebarTab(tabName) {
  const tabs = [tabInspector, tabQueue, tabActivity];
  const views = [viewInspector, viewQueue, viewActivity];

  tabs.forEach(t => t.classList.remove('active'));
  views.forEach(v => v.classList.remove('active'));

  if (tabName === 'queue') {
    tabQueue.classList.add('active');
    viewQueue.classList.add('active');
  } else if (tabName === 'activity') {
    tabActivity.classList.add('active');
    viewActivity.classList.add('active');
  } else {
    tabInspector.classList.add('active');
    viewInspector.classList.add('active');
  }
}

/**
 * Computes descriptive target resolution string based on active preset key.
 *
 * @param {string} key Preset resolution identifier (e.g. '4k', '1080p', 'original').
 * @param {number} [origWidth] Source video width in pixels.
 * @param {number} [origHeight] Source video height in pixels.
 * @returns {string} Human-readable resolution label.
 */
function getTargetResolutionLabel(key, origWidth, origHeight) {
  if (key === '4k') return '3840x2160 (4K)';
  if (key === '1440p') return '2560x1440 (1440p)';
  if (key === '1080p') return '1920x1080 (1080p)';
  if (key === '720p') return '1280x720 (720p)';
  return origWidth && origHeight ? `${origWidth}x${origHeight}` : 'Source';
}

/**
 * Returns formatted target audio specification label.
 *
 * @param {string} fmtKey Target format code ('mp3', 'flac', 'wav', 'm4a').
 * @returns {string} Formatted audio preset name.
 */
function getTargetAudioFormatLabel(fmtKey, qualKey) {
  const qualMap = { high: '320 kbps', medium: '256 kbps', standard: '192 kbps', compact: '128 kbps' };
  const bitrateStr = qualMap[qualKey] || '320 kbps';
  if (fmtKey === 'mp3') return `MP3 (${bitrateStr})`;
  if (fmtKey === 'flac') return 'Lossless FLAC';
  if (fmtKey === 'wav') return 'Studio WAV';
  return `M4A AAC (${bitrateStr})`;
}

/**
 * Updates sidebar Media Inspector values in real time based on active user configurations.
 */
function updateInspectorTargetPreview() {
  if (!state.probeData) return;
  const p = state.probeData;
  const isAudioMode = state.mediaType === 'audio' || state.videoMode === 'extract_audio';

  if (isAudioMode) {
    const targetFmt = getTargetAudioFormatLabel(state.options.audioFormat, state.options.audioQuality);
    const audioChannels = p.audio ? `${p.audio.channels} Channels (${p.audio.sampleRate} Hz)` : 'Audio Track';
    const sourceLabel = state.videoMode === 'extract_audio' ? 'Video Audio' : p.formatName.split(',')[0];
    
    specFormat.innerHTML = `<span style="color:var(--text-muted)">${sourceLabel}</span> <span style="color:#a855f7">→</span> <span style="color:#34d399;font-weight:700;">${state.options.audioFormat.toUpperCase()}</span>`;
    specResolution.innerHTML = `<span style="color:var(--text-muted)">${audioChannels}</span> <span style="color:#a855f7">→</span> <span style="color:#34d399;font-weight:700;">${targetFmt}</span>`;
    specSizeComparison.innerHTML = `<span style="color:var(--text-muted)">${p.formattedSize}</span> <span style="color:#a855f7">→</span> <span style="color:#34d399;font-weight:700;">Extracting</span>`;
  } else {
    const origRes = p.video ? `${p.video.width}x${p.video.height}` : 'Source';
    const targetRes = getTargetResolutionLabel(state.options.resolution, p.video?.width, p.video?.height);
    const shortFormat = state.options.fastStart ? 'FastStart MP4' : 'Universal MP4';
    
    specFormat.innerHTML = `<span style="color:var(--text-muted)">${p.formatName.split(',')[0]}</span> <span style="color:#a855f7">→</span> <span style="color:#34d399;font-weight:700;">${shortFormat}</span>`;
    specResolution.innerHTML = `<span style="color:var(--text-muted)">${origRes}</span> <span style="color:#a855f7">→</span> <span style="color:#34d399;font-weight:700;">${targetRes}</span>`;
    specSizeComparison.innerHTML = `<span style="color:var(--text-muted)">${p.formattedSize}</span> <span style="color:#a855f7">→</span> <span style="color:#34d399;font-weight:700;">Optimizing</span>`;
  }
}

function formatTagValueHuman(key, val) {
  if (typeof val !== 'string') return String(val);
  if (key.toLowerCase().includes('date') || key.toLowerCase().includes('creation')) {
    const d = new Date(val);
    if (!isNaN(d.getTime())) {
      return d.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
  }
  return val;
}

function updateConvertButtonLabel() {
  if (!convertBtn) return;
  
  let label = '';
  if (state.mediaType === 'audio') {
    const fmt = state.options.audioFormat.toUpperCase();
    label = `Convert to Universal ${fmt}`;
  } else if (state.videoMode === 'extract_audio') {
    const fmt = state.options.audioFormat.toUpperCase();
    label = `Extract & Convert to ${fmt}`;
  } else {
    label = state.options.fastStart ? 'Convert to FastStart MP4' : 'Convert to Universal MP4';
  }

  const labelEl = document.getElementById('convertBtnLabel');
  if (labelEl) {
    labelEl.textContent = label;
  } else {
    convertBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
      <span id="convertBtnLabel">${label}</span>
    `;
  }
}

function bindEventListeners() {
  // Sidebar Tab Navigation
  tabInspector.addEventListener('click', () => switchSidebarTab('inspector'));
  tabQueue.addEventListener('click', () => switchSidebarTab('queue'));
  tabActivity.addEventListener('click', () => switchSidebarTab('activity'));

  // Dropzone drag-and-drop
  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('drag-over');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files.length > 0) handleFileSelection(files[0]);
  });

  dropzone.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleFileSelection(e.target.files[0]);
  });

  removeFileBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    resetFileSelection();
  });

  if (uploadAnotherBtn) {
    uploadAnotherBtn.addEventListener('click', () => {
      resetFileSelection();
      fileInput.click();
    });
  }

  // Video Output Mode Switcher (Universal Video vs Extract Audio Only)
  if (modeVideoBtn && modeExtractAudioBtn) {
    modeVideoBtn.addEventListener('click', () => {
      modeVideoBtn.classList.add('active');
      modeExtractAudioBtn.classList.remove('active');
      state.videoMode = 'video';
      videoControlsBar.style.display = 'flex';
      audioControlsBar.style.display = 'none';
      fastStartRow.style.display = 'flex';
      updateConvertButtonLabel();
      updateInspectorTargetPreview();
    });

    modeExtractAudioBtn.addEventListener('click', () => {
      modeExtractAudioBtn.classList.add('active');
      modeVideoBtn.classList.remove('active');
      state.videoMode = 'extract_audio';
      videoControlsBar.style.display = 'none';
      audioControlsBar.style.display = 'flex';
      fastStartRow.style.display = 'none';
      updateConvertButtonLabel();
      updateInspectorTargetPreview();
    });
  }

  // Segmented Switchers (Resolution)
  document.querySelectorAll('[data-res]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('[data-res]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.options.resolution = btn.getAttribute('data-res');
      updateInspectorTargetPreview();
    });
  });

  // Segmented Switchers (Video Compression)
  document.querySelectorAll('[data-comp]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('[data-comp]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.options.compression = btn.getAttribute('data-comp');
    });
  });

  // Segmented Switchers (Audio Format)
  document.querySelectorAll('[data-audio-fmt]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('[data-audio-fmt]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.options.audioFormat = btn.getAttribute('data-audio-fmt');
      updateConvertButtonLabel();
      updateInspectorTargetPreview();
    });
  });

  // Segmented Switchers (Audio Quality)
  document.querySelectorAll('[data-audio-qual]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('[data-audio-qual]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.options.audioQuality = btn.getAttribute('data-audio-qual');
      updateInspectorTargetPreview();
    });
  });

  // Privacy Checkbox Toggle
  if (privacyCheckbox) {
    privacyCheckbox.addEventListener('change', (e) => {
      state.options.stripMetadata = e.target.checked;
      specMetadata.textContent = e.target.checked ? 'Auto-Scrub Active' : 'Preserving Metadata';
      specMetadata.style.color = e.target.checked ? '#34d399' : '#f59e0b';
    });
  }

  // Web FastStart Checkbox Toggle
  if (fastStartCheckbox) {
    fastStartCheckbox.addEventListener('change', (e) => {
      state.options.fastStart = e.target.checked;
      updateConvertButtonLabel();
      updateInspectorTargetPreview();
    });
  }

  // Start Conversion Button
  convertBtn.addEventListener('click', handleStartConversion);
}

async function handleFileSelection(file) {
  state.selectedFile = file;
  dropzone.style.display = 'none';
  summaryHeroCard.style.display = 'none';
  fileSelectedBanner.style.display = 'flex';
  
  // Keep tuning controls hidden during initial probe to eliminate UI layout jumps
  tuningSection.style.display = 'none';
  convertBtn.style.display = 'none';
  convertBtn.disabled = true;

  // Pre-classify from file extension / mime to avoid flicker
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const audioExtensions = ['wav', 'm4a', 'mp3', 'flac', 'aac', 'ogg', 'aiff', 'wma'];
  const likelyAudio = audioExtensions.includes(ext) || file.type.startsWith('audio/');

  if (likelyAudio) {
    state.mediaType = 'audio';
    stageSubtitle.textContent = 'Universal Audio Converter';
    fileIconBox.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>`;
    fileIconBox.style.background = 'rgba(236, 72, 153, 0.15)';
    fileIconBox.style.borderColor = 'rgba(236, 72, 153, 0.3)';
    fileIconBox.style.color = '#f472b6';
    videoControlsBar.style.display = 'none';
    audioControlsBar.style.display = 'flex';
    fastStartRow.style.display = 'none';
  } else {
    state.mediaType = 'video';
    stageSubtitle.textContent = 'Universal Video Converter';
    fileIconBox.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>`;
    fileIconBox.style.background = 'rgba(59, 130, 246, 0.15)';
    fileIconBox.style.borderColor = 'rgba(59, 130, 246, 0.3)';
    fileIconBox.style.color = '#60a5fa';
    videoControlsBar.style.display = 'flex';
    audioControlsBar.style.display = 'none';
    fastStartRow.style.display = 'flex';
  }

  selectedFileName.textContent = file.name;
  selectedFileSpecs.textContent = `Analyzing media details... (${formatBytesClient(file.size)})`;

  // Focus Inspector Tab
  switchSidebarTab('inspector');

  try {
    const probeRes = await uploadAndProbeFile(file, (percent) => {
      selectedFileSpecs.textContent = `Uploading media for inspection (${percent}%)...`;
    });

    if (probeRes.success) {
      state.fileId = probeRes.fileId;
      state.probeData = probeRes.probe;

      const p = probeRes.probe;
      const isVideo = !!p.video;
      state.mediaType = isVideo ? 'video' : 'audio';

      // Finalize display states from exact stream analysis
      if (isVideo) {
        conversionModeBar.style.display = 'flex';
        state.videoMode = 'video';
        modeVideoBtn.classList.add('active');
        modeExtractAudioBtn.classList.remove('active');

        stageSubtitle.textContent = 'Universal Video Converter';
        fileIconBox.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>`;
        fileIconBox.style.background = 'rgba(59, 130, 246, 0.15)';
        fileIconBox.style.borderColor = 'rgba(59, 130, 246, 0.3)';
        fileIconBox.style.color = '#60a5fa';
        
        videoControlsBar.style.display = 'flex';
        audioControlsBar.style.display = 'none';
        fastStartRow.style.display = 'flex';

        const resText = `${p.video.width}x${p.video.height} (${p.video.fps} fps)`;
        selectedFileSpecs.textContent = `${p.formattedSize} • ${resText} • ${p.formattedDuration}`;
      } else {
        conversionModeBar.style.display = 'none';

        stageSubtitle.textContent = 'Universal Audio Converter';
        fileIconBox.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>`;
        fileIconBox.style.background = 'rgba(236, 72, 153, 0.15)';
        fileIconBox.style.borderColor = 'rgba(236, 72, 153, 0.3)';
        fileIconBox.style.color = '#f472b6';
        
        videoControlsBar.style.display = 'none';
        audioControlsBar.style.display = 'flex';
        fastStartRow.style.display = 'none';

        const audioInfo = p.audio ? `${p.audio.codec.toUpperCase()} (${p.audio.channels} ch, ${p.audio.sampleRate} Hz)` : 'Audio Stream';
        selectedFileSpecs.textContent = `${p.formattedSize} • ${audioInfo} • ${p.formattedDuration}`;
      }

      // Smoothly reveal configured tuning section and button without jumps
      tuningSection.style.display = 'flex';
      convertBtn.style.display = 'flex';
      convertBtn.disabled = false;
      updateConvertButtonLabel();
      updateInspectorTargetPreview();
      
      const sensitiveTags = p.metadata?.sensitiveTags || [];
      if (state.options.stripMetadata) {
        specMetadata.textContent = sensitiveTags.length > 0
          ? `${sensitiveTags.length} tags detected (ready to scrub)`
          : 'Clean (Ready)';
        specMetadata.style.color = '#34d399';
      }

      // Populate Discovered Metadata Tags List
      renderDiscoveredTags(sensitiveTags);

      appendActivityLog(`Loaded "${file.name}" (${p.formattedSize}, ${isVideo ? 'Video' : 'Audio'}). Ready to convert.`, 'info');
    }
  } catch (error) {
    selectedFileSpecs.textContent = 'Unable to analyze file. Please choose a valid media file.';
    appendActivityLog('Inspection error: ' + error.message, 'error');
  }
}

function renderDiscoveredTags(tags) {
  if (!discoveredTagsList) return;
  discoveredTagsList.innerHTML = '';

  if (!tags || tags.length === 0) {
    discoveredTagsCount.textContent = '0 Tags';
    discoveredTagsList.innerHTML = `<div class="no-tags-prompt">No private or tracking metadata tags found in this file.</div>`;
    return;
  }

  discoveredTagsCount.textContent = `${tags.length} Detected in File`;
  discoveredTagsCount.style.color = '#f87171';

  tags.forEach((tag, idx) => {
    const row = document.createElement('div');
    row.className = 'discovered-tag-row';
    row.id = `tag-row-${idx}`;
    
    let label = tag.key.replace(/_/g, ' ');
    if (tag.key.toLowerCase().includes('make') || tag.key.toLowerCase().includes('model')) label = 'Device Model';
    else if (tag.key.toLowerCase().includes('gps') || tag.key.toLowerCase().includes('location')) label = 'GPS Location';
    else if (tag.key.toLowerCase().includes('date') || tag.key.toLowerCase().includes('creation')) label = 'Capture Date';
    else if (tag.key.toLowerCase().includes('artist') || tag.key.toLowerCase().includes('author')) label = 'Author / Artist';
    else if (tag.key.toLowerCase().includes('encoder') || tag.key.toLowerCase().includes('software')) label = 'Encoder Tag';

    const formattedVal = formatTagValueHuman(tag.key, tag.value);

    row.innerHTML = `
      <div class="discovered-tag-key">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
        <span>${label}</span>
      </div>
      <div style="display:flex; align-items:center; gap:8px;">
        <div class="discovered-tag-val" title="${tag.value}">${formattedVal}</div>
        <span class="tag-status-badge">Found</span>
      </div>
    `;
    discoveredTagsList.appendChild(row);
  });
}

function animateTagsRemovalSequentially() {
  const rows = document.querySelectorAll('.discovered-tag-row');
  if (!rows || rows.length === 0) return;

  rows.forEach((row, index) => {
    setTimeout(() => {
      row.classList.add('scrubbed');
      const badge = row.querySelector('.tag-status-badge');
      if (badge) {
        badge.textContent = '✓ Removed';
      }
      const icon = row.querySelector('.discovered-tag-key svg');
      if (icon) {
        icon.setAttribute('stroke', '#34d399');
      }
    }, (index + 1) * 200);
  });

  setTimeout(() => {
    discoveredTagsCount.textContent = `All ${rows.length} Tags Cleaned ✓`;
    discoveredTagsCount.style.color = '#34d399';
    specMetadata.textContent = 'Cleaned & Scrubbed 100%';
    specMetadata.style.color = '#34d399';
  }, (rows.length + 1) * 200);
}

function resetFileSelection() {
  state.selectedFile = null;
  state.fileId = null;
  state.probeData = null;
  state.mediaType = 'video';
  state.videoMode = 'video';
  state.isConverting = false;
  fileInput.value = '';
  
  stageSubtitle.textContent = 'Smart Media Converter';
  dropzone.style.display = 'flex';
  fileSelectedBanner.style.display = 'none';
  summaryHeroCard.style.display = 'none';
  progressCard.style.display = 'none';
  conversionModeBar.style.display = 'none';
  
  videoControlsBar.style.display = 'flex';
  audioControlsBar.style.display = 'none';
  fastStartRow.style.display = 'flex';

  tuningSection.style.display = 'none';
  convertBtn.style.display = 'none';
  convertBtn.disabled = true;
  updateConvertButtonLabel();

  specFormat.textContent = 'None';
  specResolution.textContent = 'None';
  specSizeComparison.textContent = 'None';
  specMetadata.textContent = 'Auto-Scrub Active';
  specMetadata.style.color = '#34d399';

  if (discoveredTagsList) {
    discoveredTagsCount.textContent = '0 Tags';
    discoveredTagsList.innerHTML = `<div class="no-tags-prompt">Select a media file to inspect embedded metadata tags.</div>`;
  }
}

async function handleStartConversion() {
  if (!state.fileId || state.isConverting) return;

  const targetMediaType = (state.mediaType === 'video' && state.videoMode === 'extract_audio') ? 'audio' : state.mediaType;
  const isAudio = targetMediaType === 'audio';
  state.isConverting = true;
  convertBtn.disabled = true;
  summaryHeroCard.style.display = 'none';
  convertBtn.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin-icon"><circle cx="12" cy="12" r="10"></circle><path d="M12 2a10 10 0 0 1 10 10"></path></svg>
    <span>${state.videoMode === 'extract_audio' ? 'Extracting Audio...' : `Converting ${isAudio ? 'Audio' : 'Video'}...`}</span>
  `;
  
  progressCard.style.display = 'flex';
  progressBar.style.width = '5%';
  progressPct.textContent = '5%';
  progressMsg.textContent = state.videoMode === 'extract_audio' ? 'Extracting high-fidelity audio stream...' : 'Preparing conversion environment...';

  const fileName = state.selectedFile.name;
  const targetSpec = isAudio ? state.options.audioFormat.toUpperCase() : state.options.resolution.toUpperCase();
  appendActivityLog(`Started conversion of "${fileName}" to ${targetSpec}.`, 'process');

  const convertRes = await startConversion({
    fileId: state.fileId,
    originalName: fileName,
    mediaType: targetMediaType,
    audioFormat: state.options.audioFormat,
    audioQuality: state.options.audioQuality,
    resolution: state.options.resolution,
    compression: state.options.compression,
    stripMetadata: state.options.stripMetadata,
    fastStart: state.options.fastStart
  });

  if (!convertRes.success) {
    progressMsg.textContent = 'Error: ' + convertRes.error;
    convertBtn.disabled = false;
    updateConvertButtonLabel();
    state.isConverting = false;
    appendActivityLog(`Conversion failed for "${fileName}": ${convertRes.error}`, 'error');
    return;
  }

  const jobId = convertRes.jobId;
  state.activeJobId = jobId;

  updateQueueWithJob(convertRes.job);

  // Subscribe to realtime progress
  subscribeToJobProgress(jobId, (update) => {
    progressBar.style.width = `${update.percent || 0}%`;
    progressPct.textContent = `${update.percent || 0}%`;
    progressMsg.textContent = update.friendlyMessage || `Processing ${isAudio ? 'audio' : 'video'} stream...`;

    if (update.status === 'completed') {
      const origSize = update.result?.formattedOriginalSize || '';
      const newSize = update.result?.formattedOutputSize || '';
      const pctSaved = update.result?.savingsPercent || 0;
      const savedBytes = update.result?.formattedSavings || '';

      const completionMessage = `Successfully converted "${fileName}": Size reduced from ${origSize} to ${newSize} (${pctSaved}% smaller).`;
      appendActivityLog(completionMessage, 'success');
      
      // Animate metadata tags removal one by one
      if (state.options.stripMetadata) {
        animateTagsRemovalSequentially();
      }

      // Smoothly hide banner, tuning section, progress bar and convert button, then reveal the Hero Completion Card
      fileSelectedBanner.style.display = 'none';
      tuningSection.style.display = 'none';
      progressCard.style.display = 'none';
      convertBtn.style.display = 'none';

      // Populate All-In-One Transformation Summary Card & Inspector
      if (isAudio) {
        const audioInfo = state.probeData?.audio ? `${state.probeData.audio.channels} ch` : 'Audio';
        summaryOrigFormat.textContent = state.probeData?.formatName?.split(',')[0] || 'Original Audio';
        summaryOrigSpecs.textContent = `${origSize} • ${audioInfo}`;

        const outFmt = state.options.audioFormat.toUpperCase();
        summaryOutFormat.textContent = `Universal ${outFmt}`;
        summaryOutSpecs.textContent = `${newSize} • ${getTargetAudioFormatLabel(state.options.audioFormat)}`;

        specFormat.innerHTML = `<span style="color:var(--text-muted)">${summaryOrigFormat.textContent}</span> <span style="color:#a855f7">→</span> <span style="color:#34d399;font-weight:700;">${outFmt}</span>`;
        specResolution.innerHTML = `<span style="color:var(--text-muted)">${audioInfo}</span> <span style="color:#a855f7">→</span> <span style="color:#34d399;font-weight:700;">${outFmt} (Clean)</span>`;
        specSizeComparison.innerHTML = `<span style="color:var(--text-muted)">${origSize}</span> <span style="color:#a855f7">→</span> <span style="color:#34d399;font-weight:700;">${newSize} (${pctSaved}% saved)</span>`;
      } else {
        const origW = state.probeData?.video?.width || '';
        const origH = state.probeData?.video?.height || '';
        const origResLabel = origW ? `${origW}x${origH}` : 'Source';
        const outResLabel = getTargetResolutionLabel(state.options.resolution, origW, origH);

        summaryOrigFormat.textContent = state.probeData?.formatName?.split(',')[0] || 'QuickTime MOV';
        summaryOrigSpecs.textContent = `${origSize} • ${origResLabel}`;

        const formatLabel = state.options.fastStart ? 'FastStart MP4 (H.264 / AAC)' : 'Universal MP4 (H.264 / AAC)';
        const shortFormatLabel = state.options.fastStart ? 'FastStart MP4' : 'Universal MP4';

        summaryOutFormat.textContent = formatLabel;
        summaryOutSpecs.textContent = `${newSize} • ${outResLabel}`;

        specFormat.innerHTML = `<span style="color:var(--text-muted)">${summaryOrigFormat.textContent}</span> <span style="color:#a855f7">→</span> <span style="color:#34d399;font-weight:700;">${shortFormatLabel}</span>`;
        specResolution.innerHTML = `<span style="color:var(--text-muted)">${origResLabel}</span> <span style="color:#a855f7">→</span> <span style="color:#34d399;font-weight:700;">${outResLabel}</span>`;
        specSizeComparison.innerHTML = `<span style="color:var(--text-muted)">${origSize}</span> <span style="color:#a855f7">→</span> <span style="color:#34d399;font-weight:700;">${newSize} (${pctSaved}% saved)</span>`;
      }

      summarySpaceSaved.textContent = `Reclaimed ${savedBytes} (${pctSaved}% smaller)`;

      const tagCount = state.probeData?.metadata?.sensitiveTagsCount || 0;
      if (state.options.stripMetadata && tagCount > 0) {
        summaryPrivacyStatus.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
          <span>All ${tagCount} Private Metadata Tags Scrubbed</span>
        `;
        summaryPrivacyStatus.style.display = 'inline-flex';
      } else {
        summaryPrivacyStatus.style.display = 'none';
      }

      if (!isAudio && state.options.fastStart) {
        summaryFastStartStatus.style.display = 'inline-flex';
      } else {
        summaryFastStartStatus.style.display = 'none';
      }

      const outExt = isAudio ? state.options.audioFormat : 'mp4';
      prominentDownloadBtn.href = `/api/download/${jobId}`;
      prominentDownloadBtn.setAttribute('download', update.outputFilename || `media-slim.${outExt}`);
      
      const downloadBtnText = prominentDownloadBtn.querySelector('span');
      if (downloadBtnText) {
        downloadBtnText.textContent = `Download Converted ${outExt.toUpperCase()}`;
      }

      summaryHeroCard.style.display = 'flex';

      state.isConverting = false;
      
      // Update global dashboard metrics
      state.stats.filesConverted += 1;
      state.stats.totalSavedBytes += (update.result?.savingsBytes || 0);
      if (state.options.stripMetadata) {
        state.stats.tagsScrubbed += (state.probeData?.metadata?.sensitiveTagsCount || 6);
      }

      renderMetricValue('metricConverted', `${state.stats.filesConverted}`);
      renderMetricValue('metricSaved', formatBytesClient(state.stats.totalSavedBytes));
      renderMetricValue('metricTags', `${state.stats.tagsScrubbed} Scrubbed`);

      updateQueueWithJob(update);
    } else if (update.status === 'failed') {
      state.isConverting = false;
      convertBtn.disabled = false;
      updateConvertButtonLabel();
      appendActivityLog(`Error during conversion: ${update.error}`, 'error');
      updateQueueWithJob(update);
    }
  });
}

function updateQueueWithJob(job) {
  const emptyState = document.getElementById('queueEmptyState');
  if (emptyState) emptyState.remove();

  const existing = document.getElementById(`queue-${job.id}`);
  const newEl = createQueueItemElement(job);
  if (existing) {
    existing.replaceWith(newEl);
  } else {
    queueList.insertBefore(newEl, queueList.firstChild);
  }

  updateQueueBadge();
}

function updateQueueBadge() {
  const count = queueList.querySelectorAll('.queue-item').length;
  if (queueBadgeCount) queueBadgeCount.textContent = count;
}

async function loadQueueHistory() {
  const res = await fetchAllJobs();
  if (res.success && res.jobs.length > 0) {
    const emptyState = document.getElementById('queueEmptyState');
    if (emptyState) emptyState.remove();
    res.jobs.forEach(job => {
      const el = createQueueItemElement(job);
      queueList.appendChild(el);
    });
    updateQueueBadge();
  }
}

function formatBytesClient(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Start app on DOM ready
document.addEventListener('DOMContentLoaded', initDashboard);
