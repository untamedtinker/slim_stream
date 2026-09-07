/**
 * SlimStream API Client Module
 * Provides promise-based HTTP and Server-Sent Events interfaces for communicating
 * with the media conversion and stream probing backend service.
 */

/**
 * Queries backend system readiness and FFmpeg/FFprobe availability status.
 *
 * @returns {Promise<Object>} Status payload including detected binaries and presets.
 */
export async function fetchSystemStatus() {
  try {
    const res = await fetch('/api/status');
    return await res.json();
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Uploads a user-selected media file with progress tracking and triggers FFprobe stream inspection.
 *
 * @param {File} file Raw file object selected from input or drag-and-drop.
 * @param {Function} onProgress Callback function receiving upload completion percentage (0-100).
 * @returns {Promise<Object>} Probe result including video/audio stream properties and sensitive tags.
 */
export async function uploadAndProbeFile(file, onProgress) {
  const formData = new FormData();
  formData.append('file', file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/probe');

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        const percent = Math.round((e.loaded / e.total) * 100);
        onProgress(percent);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const res = JSON.parse(xhr.responseText);
          resolve(res);
        } catch {
          reject(new Error('Invalid JSON server response during probe.'));
        }
      } else {
        reject(new Error('Probe failed with status ' + xhr.status));
      }
    };

    xhr.onerror = () => reject(new Error('Network error uploading file.'));
    xhr.send(formData);
  });
}

/**
 * Dispatches a request to initiate media transcoding with specified tuning parameters.
 *
 * @param {Object} options Conversion settings (resolution, compression, format, metadata).
 * @returns {Promise<Object>} Job submission response including unique jobId.
 */
export async function startConversion(options) {
  const res = await fetch('/api/convert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options)
  });
  return await res.json();
}

/**
 * Subscribes to real-time Server-Sent Events (SSE) stream for conversion progress updates.
 *
 * @param {string} jobId Unique identifier for active conversion job.
 * @param {Function} onUpdate Callback invoked with each progress status packet.
 * @returns {EventSource} Active EventSource instance for lifecycle management.
 */
export function subscribeToJobProgress(jobId, onUpdate) {
  const eventSource = new EventSource(`/api/progress/${jobId}`);
  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      onUpdate(data);
      if (data.status === 'completed' || data.status === 'failed') {
        eventSource.close();
      }
    } catch {
      // Ignore unparseable frames
    }
  };
  eventSource.onerror = () => {
    eventSource.close();
  };
  return eventSource;
}

/**
 * Retrieves full list of historical and active conversion jobs to restore dashboard state.
 *
 * @returns {Promise<Object>} List of queued, processing, and completed jobs.
 */
export async function fetchAllJobs() {
  try {
    const res = await fetch('/api/jobs');
    return await res.json();
  } catch {
    return { success: false, jobs: [] };
  }
}
