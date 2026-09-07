import test from 'node:test';
import assert from 'node:assert';
import { buildFfmpegArgs, RESOLUTION_PRESETS, COMPRESSION_PRESETS } from '../server/converter.js';

test('buildFfmpegArgs constructs valid arguments for 1080p web conversion', () => {
  const args = buildFfmpegArgs({
    inputPath: '/path/to/test.mov',
    outputPath: '/path/to/output.mp4',
    resolution: '1080p',
    compression: 'lossless_web',
    stripMetadata: true,
    fastStart: true
  });

  assert.ok(args.includes('-i'));
  assert.ok(args.includes('/path/to/test.mov'));
  assert.ok(args.includes('-c:v'));
  assert.ok(args.includes('libx264'));
  assert.ok(args.includes('-vf'));
  assert.ok(args.includes('scale=-2:1080'));
  assert.ok(args.includes('-map_metadata'));
  assert.ok(args.includes('-movflags'));
  assert.ok(args.includes('+faststart'));
  assert.strictEqual(args[args.length - 1], '/path/to/output.mp4');
});

test('buildFfmpegArgs respects disabled metadata stripping', () => {
  const args = buildFfmpegArgs({
    inputPath: '/path/to/test.mov',
    outputPath: '/path/to/output.mp4',
    resolution: 'original',
    compression: 'compact_web',
    stripMetadata: false,
    fastStart: false
  });

  assert.strictEqual(args.includes('-map_metadata'), false);
  assert.strictEqual(args.includes('+faststart'), false);
});

test('buildFfmpegArgs constructs valid arguments for audio conversion (M4A/AAC)', () => {
  const args = buildFfmpegArgs({
    inputPath: '/path/to/voice.wav',
    outputPath: '/path/to/voice.m4a',
    mediaType: 'audio',
    audioFormat: 'm4a',
    audioQuality: 'high',
    stripMetadata: true,
    fastStart: true
  });

  assert.ok(args.includes('-vn'));
  assert.ok(args.includes('-c:a'));
  assert.ok(args.includes('aac'));
  assert.ok(args.includes('-b:a'));
  assert.ok(args.includes('320k'));
  assert.ok(args.includes('-map_metadata'));
  assert.ok(args.includes('+faststart'));
  assert.strictEqual(args[args.length - 1], '/path/to/voice.m4a');
});

test('buildFfmpegArgs constructs valid arguments for MP3 conversion without faststart', () => {
  const args = buildFfmpegArgs({
    inputPath: '/path/to/audio.flac',
    outputPath: '/path/to/audio.mp3',
    mediaType: 'audio',
    audioFormat: 'mp3',
    audioQuality: 'compact',
    stripMetadata: true,
    fastStart: false
  });

  assert.ok(args.includes('-vn'));
  assert.ok(args.includes('libmp3lame'));
  assert.ok(args.includes('128k'));
  assert.strictEqual(args.includes('+faststart'), false);
});
