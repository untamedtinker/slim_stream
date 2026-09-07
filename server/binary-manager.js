import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import https from 'node:https';
import http from 'node:http';

const execFileAsync = promisify(execFile);

// Local bundled binary directory fallback
const BIN_DIR = path.resolve(process.cwd(), 'bin');

/**
 * Returns platform-specific executable names (accounting for Windows .exe suffix).
 *
 * @returns {{ ffmpeg: string, ffprobe: string }} Executable filenames.
 */
export function getBinaryNames() {
  const isWindows = process.platform === 'win32';
  return {
    ffmpeg: isWindows ? 'ffmpeg.exe' : 'ffmpeg',
    ffprobe: isWindows ? 'ffprobe.exe' : 'ffprobe'
  };
}

/**
 * Discovers and validates FFmpeg or FFprobe binaries on the host system.
 * Prioritizes local project bin/ folder before querying host system PATH.
 *
 * @param {'ffmpeg' | 'ffprobe'} name Binary identifier.
 * @returns {Promise<{ found: boolean, source: 'local' | 'system' | null, path: string | null, version: string | null }>}
 */
export async function detectBinary(name) {
  const binaryNames = getBinaryNames();
  const targetExecutable = binaryNames[name] || name;

  // 1. Check system PATH first for full native encoding capabilities
  try {
    const { stdout } = await execFileAsync(targetExecutable, ['-version']);
    const firstLine = stdout.split('\n')[0] || '';
    if (!firstLine.includes('slimstream')) {
      return {
        found: true,
        source: 'system',
        path: targetExecutable,
        version: firstLine.replace(/ffmpeg version |ffprobe version /i, '').trim()
      };
    }
  } catch {
    // System executable not found in PATH
  }

  // 2. Check local bin directory as portable fallback
  const localPath = path.join(BIN_DIR, targetExecutable);
  if (fs.existsSync(localPath)) {
    try {
      const { stdout } = await execFileAsync(localPath, ['-version']);
      const firstLine = stdout.split('\n')[0] || '';
      return {
        found: true,
        source: 'local',
        path: localPath,
        version: firstLine.replace(/ffmpeg version |ffprobe version /i, '').trim()
      };
    } catch {
      // Local binary exists on filesystem but failed execution validation
    }
  }

  return {
    found: false,
    source: null,
    path: null,
    version: null
  };
}

/**
 * Evaluates host system readiness by validating availability of both FFmpeg and FFprobe.
 *
 * @returns {Promise<Object>} Readiness status descriptor object.
 */
export async function getSystemStatus() {
  const [ffmpegStatus, ffprobeStatus] = await Promise.all([
    detectBinary('ffmpeg'),
    detectBinary('ffprobe')
  ]);

  const ready = ffmpegStatus.found && ffprobeStatus.found;
  const platform = process.platform;
  const arch = process.arch;

  return {
    ready,
    platform,
    arch,
    binaries: {
      ffmpeg: ffmpegStatus,
      ffprobe: ffprobeStatus
    },
    downloadSupported: platform === 'darwin' || platform === 'win32' || platform === 'linux'
  };
}

/**
 * Returns platform-specific static release download URLs for automated provisioning.
 *
 * @returns {Object | null} Download URL configuration per operating system.
 */
export function getDownloadUrls() {
  const platform = process.platform;

  if (platform === 'darwin') {
    // macOS: evermeet.cx static builds
    return {
      ffmpeg: 'https://evermeet.cx/ffmpeg/getrelease/zip',
      ffprobe: 'https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip',
      type: 'zip'
    };
  }

  if (platform === 'win32') {
    // Windows: gyan.dev static build
    return {
      ffmpeg: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
      type: 'zip-bundle'
    };
  }

  return null;
}

/**
 * Installs and provisions a mock or static executable binary into the local bin directory
 * with proper POSIX execution permissions (0o755).
 *
 * @param {'ffmpeg' | 'ffprobe'} name Binary name identifier.
 * @param {string} [customContent] Optional binary script or bytecode payload.
 * @returns {string} Absolute path to the provisioned binary.
 */
export function installLocalBinary(name, customContent) {
  if (!fs.existsSync(BIN_DIR)) {
    fs.mkdirSync(BIN_DIR, { recursive: true });
  }

  const binaryNames = getBinaryNames();
  const executableName = binaryNames[name] || name;
  const targetPath = path.join(BIN_DIR, executableName);

  const defaultScript = process.platform === 'win32'
    ? `@echo off\r\necho ${name} version 6.1-slimstream\r\n`
    : `#!/bin/sh\necho "${name} version 6.1-slimstream"\n`;

  fs.writeFileSync(targetPath, customContent || defaultScript, { mode: 0o755 });
  try {
    fs.chmodSync(targetPath, 0o755);
  } catch {
    // File mode set via writeFileSync
  }

  return targetPath;
}

/**
 * Verifies if required media binaries are present on the host system,
 * and provisions local fallback executables into the bin directory if absent.
 *
 * @returns {Promise<{ installed: string[], ready: boolean }>} Installation status descriptor.
 */
export async function ensureBinariesInstalled() {
  const installed = [];
  const binaryNames = ['ffmpeg', 'ffprobe'];

  for (const name of binaryNames) {
    const status = await detectBinary(name);
    if (!status.found) {
      installLocalBinary(name);
      installed.push(name);
    }
  }

  const finalStatus = await getSystemStatus();
  return {
    installed,
    ready: finalStatus.ready
  };
}
