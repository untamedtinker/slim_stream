import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { detectBinary } from './binary-manager.js';
import { probeMedia, formatBytes } from './probe.js';

/**
 * Standard fixed resolution target configurations.
 * Dimensions conform to 16:9 aspect ratios for web display standards.
 * When height is null, the original source geometry is preserved without scaling.
 */
export const RESOLUTION_PRESETS = {
  original: { label: 'Original Source', height: null, width: null },
  '4k': { label: '4K Ultra HD (2160p)', height: 2160, width: 3840 },
  '1440p': { label: '2K Quad HD (1440p)', height: 1440, width: 2560 },
  '1080p': { label: '1080p Full HD', height: 1080, width: 1920 },
  '720p': { label: '720p HD', height: 720, width: 1280 }
};

/**
 * Video compression tuning profiles using Constant Rate Factor (CRF).
 * CRF 18 to 22 delivers visually lossless quality for H.264 while minimizing byte size.
 * Preset speeds determine compression efficiency versus CPU encoding time.
 */
export const COMPRESSION_PRESETS = {
  lossless_web: {
    label: 'Visually Lossless Web (Recommended)',
    crf: 22,
    preset: 'medium',
    audioBitrate: '192k',
    description: 'Crisp broadcast quality with up to 70-85% size reduction.'
  },
  compact_web: {
    label: 'Compact Web Transmission',
    crf: 26,
    preset: 'slow',
    audioBitrate: '128k',
    description: 'Smallest download size for rapid chat and web sharing.'
  },
  maximum_quality: {
    label: 'Ultra Quality Archival',
    crf: 18,
    preset: 'slower',
    audioBitrate: '320k',
    description: 'Near mathematical lossless master copy for creators.'
  }
};

/**
 * Supported target audio container specifications and corresponding FFmpeg encoders.
 */
export const AUDIO_FORMAT_PRESETS = {
  m4a: { label: 'Universal M4A (AAC)', ext: 'm4a', codec: 'aac' },
  mp3: { label: 'Universal MP3', ext: 'mp3', codec: 'libmp3lame' },
  flac: { label: 'Lossless FLAC', ext: 'flac', codec: 'flac' },
  wav: { label: 'Studio WAV', ext: 'wav', codec: 'pcm_s16le' }
};

/**
 * Standard audio bitrate presets applied during lossy audio transcode operations.
 */
export const AUDIO_QUALITY_PRESETS = {
  high: { label: '320 kbps (Studio Master)', bitrate: '320k' },
  medium: { label: '256 kbps (High Quality)', bitrate: '256k' },
  standard: { label: '192 kbps (Standard Audio)', bitrate: '192k' },
  compact: { label: '128 kbps (Voice / Podcast)', bitrate: '128k' }
};

/**
 * Constructs the deterministic command-line arguments array for FFmpeg execution.
 * Handles format-specific encoder selections, resolution scaling filters,
 * privacy metadata elimination, and faststart container index repositioning.
 *
 * @param {Object} options Configuration parameters for transcoding.
 * @returns {string[]} Ordered array of arguments passed to child_process.spawn.
 */
export function buildFfmpegArgs(options) {
  const {
    inputPath,
    outputPath,
    mediaType = 'video',
    audioFormat = 'm4a',
    audioQuality = 'high',
    resolution = 'original',
    compression = 'lossless_web',
    stripMetadata = true,
    fastStart = true
  } = options;

  // Overwrite output files without prompt and specify input source
  const args = ['-y', '-i', inputPath];

  if (mediaType === 'audio') {
    const fmt = AUDIO_FORMAT_PRESETS[audioFormat] || AUDIO_FORMAT_PRESETS.m4a;
    const qual = AUDIO_QUALITY_PRESETS[audioQuality] || AUDIO_QUALITY_PRESETS.high;

    // Discard any video tracks or album artwork to produce pure audio output
    args.push('-vn');
    args.push('-c:a', fmt.codec);

    // Apply specific sample rate and bitrate for compressed audio containers
    if (fmt.ext === 'm4a' || fmt.ext === 'mp3') {
      args.push('-b:a', qual.bitrate);
      args.push('-ar', '44100');
    }

    // Strip ID3, location, and hardware tags from audio container
    if (stripMetadata) {
      args.push(
        '-map_metadata', '-1',
        '-map_metadata:s:a', '-1',
        '-fflags', '+bitexact'
      );
    }

    // M4A MP4 container supports streaming moov atom placement
    if (fmt.ext === 'm4a' && fastStart) {
      args.push('-movflags', '+faststart');
    }
  } else {
    // Video Conversion Pipeline
    const presetConfig = COMPRESSION_PRESETS[compression] || COMPRESSION_PRESETS.lossless_web;

    // Encode video stream to universal H.264 standard
    args.push('-c:v', 'libx264');
    args.push('-preset', presetConfig.preset);
    args.push('-crf', String(presetConfig.crf));
    args.push('-pix_fmt', 'yuv420p'); // 4:2:0 chroma subsampling for legacy device compatibility

    // Apply proportional aspect-ratio preserving scaling filter if configured
    const resConfig = RESOLUTION_PRESETS[resolution];
    if (resConfig && resConfig.height) {
      args.push('-vf', `scale=-2:${resConfig.height}`);
    }

    // Standardize audio stream to AAC 48 kHz
    args.push('-c:a', 'aac');
    args.push('-b:a', presetConfig.audioBitrate);
    args.push('-ar', '48000');

    // Strip EXIF, camera, GPS, and creation timestamps
    if (stripMetadata) {
      args.push(
        '-map_metadata', '-1',
        '-map_metadata:s:v', '-1',
        '-map_metadata:s:a', '-1',
        '-fflags', '+bitexact'
      );
    }

    // Move moov atom to file beginning for instant progressive web playback
    if (fastStart) {
      args.push('-movflags', '+faststart');
    }
  }

  args.push(outputPath);
  return args;
}

/**
 * Spawns an asynchronous FFmpeg child process to transcode the source media.
 * Parses standard error stream for real-time progress calculations and reports milestones.
 *
 * @param {Object} job Active job descriptor including input and output paths.
 * @param {Function} onProgress Callback receiving percentage and milestone messages.
 * @param {Function} onComplete Callback invoked upon successful file writing.
 * @param {Function} onError Callback invoked if process fails or exits with non-zero code.
 */
export function startConversionJob(job, onProgress, onComplete, onError) {
  detectBinary('ffmpeg').then(ffmpeg => {
    if (!ffmpeg.found) {
      onError(new Error('FFmpeg binary is not available.'));
      return;
    }

    const {
      inputPath,
      outputPath,
      mediaType = 'video',
      audioFormat = 'm4a',
      audioQuality = 'high',
      resolution = 'original',
      compression = 'lossless_web',
      stripMetadata = true,
      fastStart = true
    } = job;

    probeMedia(inputPath)
      .then(probeData => {
        const totalDuration = probeData.durationSeconds || 0;
        const initialSize = probeData.sizeBytes || 0;

        const args = buildFfmpegArgs({
          inputPath,
          outputPath,
          mediaType,
          audioFormat,
          audioQuality,
          resolution,
          compression,
          stripMetadata,
          fastStart
        });

        onProgress({
          stage: 'preparing',
          friendlyMessage: 'Preparing conversion environment and verifying media streams...',
          percent: 5,
          rawProgress: null
        });

        const ffmpegProcess = spawn(ffmpeg.path, args);
        job.process = ffmpegProcess;

        let stderrBuffer = '';

        ffmpegProcess.stderr.on('data', chunk => {
          const text = chunk.toString();
          stderrBuffer += text;

          // Parse current encoded timestamp from stderr: time=00:01:23.45
          const timeMatch = text.match(/time=(\d+):(\d+):(\d+\.\d+)/);
          if (timeMatch && totalDuration > 0) {
            const hours = parseInt(timeMatch[1], 10);
            const minutes = parseInt(timeMatch[2], 10);
            const seconds = parseFloat(timeMatch[3]);
            const currentTime = hours * 3600 + minutes * 60 + seconds;

            // Map progress across a 5% to 95% range, reserving 100% for final disk flush
            const percentRaw = Math.min(95, Math.round((currentTime / totalDuration) * 90) + 5);
            
            let humanStep = 'Compressing media stream with visually lossless precision...';
            if (mediaType === 'audio') {
              if (percentRaw < 25) humanStep = 'Initializing audio stream and scrubbing private tags...';
              else if (percentRaw < 75) humanStep = `Re-encoding high-fidelity audio stream (${percentRaw}% complete)...`;
              else humanStep = 'Finalizing universal audio container...';
            } else {
              if (percentRaw < 25) humanStep = 'Initializing streams and scrubbing private metadata...';
              else if (percentRaw < 60) humanStep = `Optimizing video frames (${percentRaw}% complete)...`;
              else if (percentRaw < 85) humanStep = `Encoding high-efficiency audio track (${percentRaw}% complete)...`;
              else humanStep = 'Finalizing web faststart stream tables...';
            }

            onProgress({
              stage: 'converting',
              friendlyMessage: humanStep,
              percent: percentRaw,
              currentTime,
              totalDuration
            });
          }
        });

        ffmpegProcess.on('close', code => {
          if (code === 0 && fs.existsSync(outputPath)) {
            const outputStat = fs.statSync(outputPath);
            const outputSize = outputStat.size;
            const savingsBytes = Math.max(0, initialSize - outputSize);
            const savingsPercent = initialSize > 0 ? Math.round((savingsBytes / initialSize) * 100) : 0;

            onComplete({
              success: true,
              friendlyMessage: `Conversion complete! Reclaimed ${formatBytes(savingsBytes)} (${savingsPercent}% reduction).`,
              originalSize: initialSize,
              formattedOriginalSize: formatBytes(initialSize),
              outputSize: outputSize,
              formattedOutputSize: formatBytes(outputSize),
              savingsBytes,
              formattedSavings: formatBytes(savingsBytes),
              savingsPercent,
              metadataScrubbed: stripMetadata,
              outputPath
            });
          } else {
            onError(new Error(`Conversion process exited with code ${code}. Stderr: ${stderrBuffer.slice(-300)}`));
          }
        });

        ffmpegProcess.on('error', err => {
          onError(new Error(`Failed to run FFmpeg: ${err.message}`));
        });
      })
      .catch(err => {
        onError(err);
      });
  }).catch(onError);
}
