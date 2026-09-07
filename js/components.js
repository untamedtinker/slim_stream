/**
 * SlimStream UI Components and DOM State Renderers
 * Responsible for constructing isolated DOM nodes for queue items,
 * rendering real-time activity stream logs, and updating dashboard metric counters.
 */

/**
 * Updates the text content of a specified metric counter node safely if it exists.
 *
 * @param {string} elementId DOM element identifier.
 * @param {string} value Formatted metric value string.
 */
export function renderMetricValue(elementId, value) {
  const el = document.getElementById(elementId);
  if (el) el.textContent = value;
}

/**
 * Constructs a fully interactive queue item DOM card representing a media conversion job.
 * Renders status badges, before/after storage reduction tags, and secure direct download anchors.
 *
 * @param {Object} job Conversion job descriptor returned by backend API.
 * @returns {HTMLElement} Populated queue item container element.
 */
export function createQueueItemElement(job) {
  const item = document.createElement('div');
  item.className = 'queue-item';
  item.id = `queue-${job.id}`;

  const isComplete = job.status === 'completed';
  const isFailed = job.status === 'failed';
  const badgeClass = isComplete ? 'completed' : (isFailed ? 'failed' : 'processing');
  const badgeText = isComplete ? 'Ready' : (isFailed ? 'Failed' : `${job.percent || 0}%`);

  const originalSizeText = job.result?.formattedOriginalSize || '';
  const outputSizeText = job.result?.formattedOutputSize || '';
  const savingsPct = job.result?.savingsPercent || 0;

  // Format: "Original: 8.68 MB -> 2.52 MB (71% smaller)"
  let sizeComparisonText = '';
  if (isComplete && originalSizeText && outputSizeText) {
    sizeComparisonText = `• Original: ${originalSizeText} → ${outputSizeText} (${savingsPct}% smaller)`;
  }

  const isAudio = job.mediaType === 'audio';
  const tagLabel = isAudio ? (job.audioFormat?.toUpperCase() || 'M4A') : (job.resolution?.toUpperCase() || 'MP4');
  const downloadLabel = isAudio ? `Download ${job.audioFormat?.toUpperCase() || 'M4A'}` : 'Download MP4';

  item.innerHTML = `
    <div class="queue-item-left">
      <div class="queue-item-name" title="${job.originalName}">${job.originalName}</div>
      <div class="queue-item-meta">
        <span class="resolution-badge">${tagLabel}</span>
        ${isComplete ? `<span class="size-comparison-tag">${sizeComparisonText}</span>` : `<span>Optimizing ${isAudio ? 'audio' : 'video'}...</span>`}
      </div>
    </div>
    <div class="queue-item-actions">
      <span class="queue-badge ${badgeClass}">${badgeText}</span>
      ${isComplete ? `
        <a href="/api/download/${job.id}" class="download-pill-btn" download="${job.outputFilename}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          ${downloadLabel}
        </a>
      ` : ''}
    </div>
  `;
  return item;
}

/**
 * Appends a timestamped log entry to the real-time activity feed in the sidebar.
 *
 * @param {string} message Text description of the event or milestone.
 * @param {'info' | 'process' | 'success' | 'error'} type Visual category for log styling.
 */
export function appendActivityLog(message, type = 'info') {
  const feed = document.getElementById('activityFeed');
  if (!feed) return;

  const now = new Date();
  const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const entry = document.createElement('div');
  entry.className = `activity-entry ${type}`;

  let iconSvg = '';
  let badgeLabel = 'Status';

  if (type === 'success') {
    badgeLabel = 'Success';
    iconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
  } else if (type === 'process') {
    badgeLabel = 'Working';
    iconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
  } else if (type === 'error') {
    badgeLabel = 'Error';
    iconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
  } else {
    badgeLabel = 'Info';
    iconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
  }

  entry.innerHTML = `
    <div class="activity-icon-col">${iconSvg}</div>
    <div class="activity-body">
      <div class="activity-header">
        <span class="activity-tag ${type}">${badgeLabel}</span>
        <span class="activity-time">${timeString}</span>
      </div>
      <div class="activity-text">${message}</div>
    </div>
  `;

  feed.insertBefore(entry, feed.firstChild);

  // Keep feed tidy at maximum 12 items
  while (feed.children.length > 12) {
    feed.removeChild(feed.lastChild);
  }
}
