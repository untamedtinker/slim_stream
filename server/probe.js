import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import { detectBinary } from './binary-manager.js';

const execFileAsync = promisify(execFile);

/**
 * Executes FFprobe to inspect stream properties, duration, codec tags,
 * container formats, and identify embedded personal/privacy metadata.
 *
 * @param {string} filePath Absolute or relative path to media file.
 * @returns {Promise<Object>} Structured stream metadata and detected sensitive tags.
 */
export async function probeMedia(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error('File not found: ' + filePath);
  }

  const ffprobe = await detectBinary('ffprobe');
  if (!ffprobe.found) {
    throw new Error('FFprobe binary is not available. Please install FFprobe.');
  }

  // Request JSON format output containing all format and stream descriptors
  const args = [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath
  ];

  try {
    const { stdout } = await execFileAsync(ffprobe.path, args);
    const data = JSON.parse(stdout);

    const videoStream = (data.streams || []).find(s => s.codec_type === 'video');
    const audioStream = (data.streams || []).find(s => s.codec_type === 'audio');
    const format = data.format || {};

    const durationSeconds = parseFloat(format.duration || '0');
    const sizeBytes = parseInt(format.size || '0', 10);
    const bitRate = parseInt(format.bit_rate || '0', 10);

    // Aggregate tags across format and stream scopes to discover sensitive metadata
    const formatTags = format.tags || {};
    const videoTags = videoStream?.tags || {};
    const audioTags = audioStream?.tags || {};

    const combinedTags = { ...formatTags, ...videoTags, ...audioTags };
    const sensitiveKeys = Object.keys(combinedTags).filter(key => {
      const lower = key.toLowerCase();
      return (
        lower.includes('location') ||
        lower.includes('make') ||
        lower.includes('model') ||
        lower.includes('gps') ||
        lower.includes('date') ||
        lower.includes('creation') ||
        lower.includes('serial') ||
        lower.includes('software') ||
        lower.includes('encoder') ||
        lower.includes('artist') ||
        lower.includes('author') ||
        lower.includes('comment')
      );
    });

    const humanTags = sensitiveKeys.map(k => ({
      key: k,
      value: String(combinedTags[k]).substring(0, 80)
    }));

    return {
      success: true,
      filename: filePath.split('/').pop()?.split('\\').pop() || 'media',
      durationSeconds,
      formattedDuration: formatDuration(durationSeconds),
      sizeBytes,
      formattedSize: formatBytes(sizeBytes),
      bitRate,
      formatName: format.format_long_name || format.format_name || 'QuickTime / MP4',
      video: videoStream ? {
        codec: videoStream.codec_name,
        codecLong: videoStream.codec_long_name,
        width: videoStream.width,
        height: videoStream.height,
        fps: parseFps(videoStream.r_frame_rate || videoStream.avg_frame_rate),
        aspectRatio: videoStream.display_aspect_ratio || `${videoStream.width}:${videoStream.height}`,
        pixFmt: videoStream.pix_fmt
      } : null,
      audio: audioStream ? {
        codec: audioStream.codec_name,
        codecLong: audioStream.codec_long_name,
        channels: audioStream.channels,
        sampleRate: audioStream.sample_rate
      } : null,
      metadata: {
        totalTagsCount: Object.keys(combinedTags).length,
        sensitiveTagsCount: sensitiveKeys.length,
        sensitiveTags: humanTags
      }
    };
  } catch (error) {
    throw new Error('Failed to analyze media file: ' + error.message);
  }
}

/**
 * Parses frame rate fraction strings (e.g., "60000/1001" or "30/1") into decimal numbers.
 *
 * @param {string} rateStr Fraction or decimal string from FFprobe stream definition.
 * @returns {number} Rounded frames per second value.
 */
function parseFps(rateStr) {
  if (!rateStr) return 30;
  const parts = rateStr.split('/');
  if (parts.length === 2 && parseInt(parts[1], 10) > 0) {
    return Math.round((parseInt(parts[0], 10) / parseInt(parts[1], 10)) * 100) / 100;
  }
  return parseFloat(rateStr) || 30;
}

/**
 * Formats byte values into human-readable binary unit strings (B, KB, MB, GB).
 *
 * @param {number} bytes Integer byte count.
 * @returns {string} Formatted decimal string with unit.
 */
export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Formats duration in seconds into clock representation string (M:SS or H:MM:SS).
 *
 * @param {number} seconds Total duration in floating-point or integer seconds.
 * @returns {string} Zero-padded formatted time string.
 */
export function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const hours = Math.floor(mins / 60);
  if (hours > 0) {
    return `${hours}:${String(mins % 60).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}
