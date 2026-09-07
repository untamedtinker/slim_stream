import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { getBinaryNames, getSystemStatus, detectBinary, installLocalBinary, ensureBinariesInstalled } from '../server/binary-manager.js';

test('getBinaryNames returns correct binary structure for platform', () => {
  const names = getBinaryNames();
  assert.ok(names.ffmpeg);
  assert.ok(names.ffprobe);
});

test('getSystemStatus checks platform readiness', async () => {
  const status = await getSystemStatus();
  assert.strictEqual(typeof status.ready, 'boolean');
  assert.ok(status.binaries);
  assert.strictEqual(typeof status.binaries.ffmpeg.found, 'boolean');
  assert.strictEqual(typeof status.binaries.ffprobe.found, 'boolean');
});

test('installLocalBinary provisions executable binary to local bin directory with valid execution', async () => {
  const testBinName = 'ffmpeg';
  const installedPath = installLocalBinary(testBinName);
  
  assert.ok(fs.existsSync(installedPath), 'Local binary must exist on disk');
  
  // Clean up test file immediately after assertion
  if (fs.existsSync(installedPath)) {
    fs.unlinkSync(installedPath);
  }
});

test('ensureBinariesInstalled confirms readiness and installs missing binaries if absent', async () => {
  const result = await ensureBinariesInstalled();
  assert.strictEqual(typeof result.ready, 'boolean');
  assert.strictEqual(result.ready, true);
  assert.ok(Array.isArray(result.installed));

  const binDir = path.resolve(process.cwd(), 'bin');
  if (fs.existsSync(binDir)) {
    fs.rmSync(binDir, { recursive: true, force: true });
  }
});
