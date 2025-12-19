import { getInput, info, setFailed, warning } from '@actions/core';
import { cacheFile, downloadTool, extractTar, extractZip, find } from '@actions/tool-cache';
import { spawn, SpawnOptions } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import https from 'node:https';
import { arch, homedir, platform } from 'node:os';
import { join } from 'node:path';
import { exit } from 'node:process';

async function main() {
  try {
    const tunnelName = getInput('tunnel-name');
    // validate tunnel name length
    if (tunnelName && tunnelName.trim().length > 20) {
      throw new Error('Tunnel name must be 20 characters or fewer.');
    }

    const keepAliveDuration = parseInt(getInput('keep-alive-duration'), 10);

    info(`Starting VS Code Tunnel: ${tunnelName}`);

    // Determine platform
    const runnerPlatform = platform();
    const runnerArch = arch();
    let downloadUrl = '';
    let downloadFileName = '';
    let extractPath = '';

    const cliToolCacheName = 'vscode-cli';

    // Check if architecture is supported
    if (runnerArch !== 'x64') {
      throw new Error(`Unsupported architecture: ${runnerArch}. Only x64 is supported yet.`);
    }

    switch (runnerPlatform) {
      case 'linux':
        downloadUrl = 'https://code.visualstudio.com/sha/download?build=stable&os=cli-alpine-x64';
        downloadFileName = 'code-cli.tar.gz';
        extractPath = join(homedir(), cliToolCacheName);
        break;
      case 'darwin':
        downloadUrl = 'https://code.visualstudio.com/sha/download?build=stable&os=cli-darwin-x64';
        downloadFileName = 'code-cli.zip';
        extractPath = join(homedir(), cliToolCacheName);
        break;
      case 'win32':
        downloadUrl = 'https://code.visualstudio.com/sha/download?build=stable&os=cli-win32-x64';
        downloadFileName = 'code-cli.zip';
        extractPath = join(homedir(), cliToolCacheName);
        break;
      default:
        throw new Error(`Unsupported platform: ${runnerPlatform}`);
    }

    info(`Platform: ${runnerPlatform}, Architecture: ${runnerArch}`);
    info(`Download URL: ${downloadUrl}`);

    // Try to get stable release version and check tool cache first
    async function fetchStableReleaseVersion(url: string): Promise<string> {
      return new Promise((resolve) => {
        try {
          https.get(url, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (d) => chunks.push(d));
            res.on('end', () => {
              try {
                const body = Buffer.concat(chunks).toString();
                let parsed: any = null;
                try {
                  parsed = JSON.parse(body);
                } catch {
                  // not JSON, use raw body
                  resolve(body.trim());
                  return;
                }

                if (Array.isArray(parsed) && parsed.length > 0) {
                  const first = parsed[0];
                  resolve((first && (first.version || first.name || String(first))) || '');
                } else if (typeof parsed === 'object' && parsed !== null) {
                  resolve((parsed.version || parsed.name || '') as string);
                } else if (typeof parsed === 'string') {
                  resolve(parsed);
                } else {
                  resolve('');
                }
              } catch (e) {
                resolve('');
              }
            });
          }).on('error', () => resolve(''));
        } catch (e) {
          resolve('');
        }
      });
    }

    const releasesApi = 'https://update.code.visualstudio.com/api/releases/stable';
    info('Checking stable releases API for version...');
    const stableVersion = await fetchStableReleaseVersion(releasesApi);
    if (!stableVersion) {
      throw new Error(`Failed to determine stable VS Code version from ${releasesApi}`);
    }

    info(`Stable VS Code version: ${stableVersion}`);

    // Create extraction directory
    if (!existsSync(extractPath)) {
      mkdirSync(extractPath, { recursive: true });
    }

    // If we were able to determine a stable version, check the tool cache
    let cliPath = '';
    try {
      info('Checking runner tool cache for cached VS Code CLI...');
      const found = find(cliToolCacheName, stableVersion);
      if (found) {
        cliPath = found;
        info(`Found cached VS Code CLI ${stableVersion} in tool cache: ${cliPath}`);
      } else {
        info('No cached VS Code CLI found for this version/arch.');
      }
    } catch (err) {
      warning(`Tool cache check failed: ${err}`);
    }

    if (!cliPath) {
      const cliName = runnerPlatform === 'win32' ? 'code.exe' : 'code';
      info('Downloading VS Code CLI...');
      const downloadPath = await downloadTool(downloadUrl, join(extractPath, downloadFileName));
      info(`Downloaded to: ${downloadPath}`);
      info('Extracting VS Code CLI...');
      if (runnerPlatform === 'win32') {
        extractPath = await extractZip(downloadPath, extractPath);
      } else {
        extractPath = await extractTar(downloadPath, extractPath);
      }

      const extractCliPath = join(extractPath, cliName);

      // Verify the CLI binary exists before attempting to use it
      if (!existsSync(extractCliPath)) {
        throw new Error(`VS Code CLI not found at expected path: ${extractCliPath}`);
      }

      if (runnerPlatform !== 'win32') {
        info(`Making ${extractCliPath} executable...`);
        chmodSync(extractCliPath, 0o755);
      }

      info('Caching VS Code CLI...');
      const cacheDir = await cacheFile(extractCliPath, cliName, cliToolCacheName, stableVersion);
      info(`Cached VS Code CLI to: ${cacheDir}`);

      cliPath = join(cacheDir, cliName);
    }

    if (!cliPath) {
      throw new Error('Failed to download and extract VS Code CLI');
    }

    // Create CLI data directory
    let cliDataDir = join(homedir(), 'vscode-cli-data');

    if (!existsSync(cliDataDir)) {
      mkdirSync(cliDataDir, { recursive: true });
    }

    // Start tunnel
    info('Starting VS Code tunnel...');
    const tunnelArgs = [
      'tunnel',
      '--accept-server-license-terms',
      '--cli-data-dir',
      cliDataDir
    ];

    if (tunnelName) {
      tunnelArgs.push('--name', tunnelName);
    }

    // Start tunnel in foreground and show output
    const options: SpawnOptions = {
      stdio: 'inherit'
    };

    info(`Starting: ${cliPath} ${tunnelArgs.join(' ')}`);
    const child = spawn(cliPath, tunnelArgs, options);

    info('VS Code tunnel started (foreground)');
    info(`Keeping tunnel alive for ${keepAliveDuration} seconds`);

    // Wait for the tunnel process to exit and forward its exit code
    await new Promise<void>((resolve, reject) => {
      child.on('error', err => reject(err));
      child.on('close', (code) => {
        info(`VS Code tunnel exited with code ${code}`);
        resolve();
      });
    });

    info('Keep-alive duration completed');
  } catch (error) {
    setFailed(`Action failed with error: ${error instanceof Error ? error.message : String(error)}`);
    exit(1);
  }
}

main();
