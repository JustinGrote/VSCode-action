import { debug, getInput, info, setFailed, warning, error } from '@actions/core';
import { cacheFile, downloadTool, extractTar, extractZip, find } from '@actions/tool-cache';
import { saveCache, restoreCache } from '@actions/cache';
import { spawn, SpawnOptions } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import https from 'node:https';
import { arch, homedir, platform } from 'node:os';
import { join } from 'node:path';
import { exit } from 'node:process';

async function main() {
  try {
    let tunnelName = getInput('tunnel-name');

    info(`Starting VS Code Tunnel: ${tunnelName}. Enable Debug logging to see more detail on the process.`);

    // Timeouts (in minutes) configurable via action inputs
    const connectionTimeoutMinutes = (() => {
      const v = getInput('connection-timeout');
      const n = parseInt(v, 10);
      return Number.isFinite(n) && n > 0 ? n : 5; // default 5 minutes
    })();

    const sessionTimeoutMinutes = (() => {
      const v = getInput('session-timeout');
      const n = parseInt(v, 10);
      return Number.isFinite(n) && n > 0 ? n : 60; // default 60 minutes
    })();

    const connectionTimeoutMs = connectionTimeoutMinutes * 60 * 1000;
    const sessionTimeoutMs = sessionTimeoutMinutes * 60 * 1000;

    debug(`Connection timeout: ${connectionTimeoutMinutes} minutes, session timeout: ${sessionTimeoutMinutes} minutes`);

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

    debug(`Platform: ${runnerPlatform}, Architecture: ${runnerArch}`);
    debug(`Download URL: ${downloadUrl}`);

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
    debug('Checking stable releases API for version...');
    const stableVersion = await fetchStableReleaseVersion(releasesApi);
    if (!stableVersion) {
      throw new Error(`Failed to determine stable VS Code version from ${releasesApi}`);
    }

    debug(`Stable VS Code version: ${stableVersion}`);

    // Create extraction directory
    if (!existsSync(extractPath)) {
      mkdirSync(extractPath, { recursive: true });
    }

    // If we were able to determine a stable version, check the tool cache
    let cliPath = '';
    try {
      debug(`Checking runner tool cache for cached VS Code CLI ${cliToolCacheName} version ${stableVersion}...`);
      const found = find(cliToolCacheName, stableVersion);
      if (found) {
        cliPath = found;
        debug(`Found cached VS Code CLI ${stableVersion} in tool cache: ${cliPath}`);
      } else {
        debug(`No cached VS Code CLI found for version ${stableVersion} and architecture ${runnerArch}.`);
      }
    } catch (err) {
      warning(`Tool cache check failed: ${err}`);
    }

    if (!cliPath) {
      const cliName = runnerPlatform === 'win32' ? 'code.exe' : 'code';
      debug('Downloading VS Code CLI...');
      const downloadPath = await downloadTool(downloadUrl, join(extractPath, downloadFileName));
      debug(`Downloaded to: ${downloadPath}`);
      debug('Extracting VS Code CLI...');
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
        debug(`Making ${extractCliPath} executable...`);
        chmodSync(extractCliPath, 0o755);
      }

      debug(`Caching VS Code CLI ${extractCliPath} ${cliName} to ${cliToolCacheName} version ${stableVersion}...`);
      const cacheDir = await cacheFile(extractCliPath, cliName, cliToolCacheName, stableVersion);
      debug(`Cached VS Code CLI to: ${cacheDir}`);

      cliPath = join(cacheDir, cliName);
    }

    if (!cliPath) {
      throw new Error('Failed to download and extract VS Code CLI');
    }

    // Create CLI data directory (allow reuse from GitHub Actions tool cache keyed by actor)
    let cliDataDir = join(homedir(), 'vscode-cli-data');

    const githubActor = process.env.GITHUB_ACTOR || '';
    if (githubActor) {
      const dataCacheName = `vscode-cli-data-${githubActor}`;
      const cacheKey = await restoreCache([cliDataDir], dataCacheName)
      if (cacheKey) {
        debug(`Restored CLI data dir from cache: ${cacheKey}`);
      } else {
        debug(`No cached CLI data dir found for path ${cliDataDir} and key: ${dataCacheName}`);
      }
    } else {
      debug('GITHUB_ACTOR not set; skipping cached cli data dir check');
    }

    if (!existsSync(cliDataDir)) {
      mkdirSync(cliDataDir, { recursive: true });
    }

    // Start tunnel
    debug('Starting VS Code tunnel...');
    const tunnelArgs = [
      'tunnel',
      '--accept-server-license-terms',
      '--verbose',
      '--cli-data-dir',
      cliDataDir
    ];

    if (tunnelName) {
      tunnelArgs.push('--name', tunnelName);
    }

    // Start tunnel in foreground and capture output so we can forward it
    const options: SpawnOptions = {
      stdio: 'pipe'
    };

    debug(`Starting: ${cliPath} ${tunnelArgs.join(' ')}`);
    const child = spawn(cliPath, tunnelArgs, options);

    debug('VS Code tunnel started (foreground) - capturing output');

    // Track connection state and timers. If no connection is detected within
    // `connectionTimeoutMs`, terminate. Once a connection is detected, start
    // a session timeout of `sessionTimeoutMs` and terminate when it elapses.
    let connected = false;
    let connectionTimer: NodeJS.Timeout | null = null;
    let sessionTimer: NodeJS.Timeout | null = null;
    // TODO: Track this as a timer after login
    // const readyIndicator = 'Visual Studio Code Server is listening for incoming connections';
    const connectionIndicator = '[tunnels::connections::relay_tunnel_host] Opened new client';

    if (child.stdout) {
      child.stdout.on('data', (chunk: Buffer) => {
        const text = String(chunk);
        const lines = text.split(/\r?\n/).filter(l => l.length > 0);
        for (const line of lines) {
          debug(line);
          // Show instructions to the user
          if (line.startsWith('Open this link') || line.startsWith('To grant access')) {
            info(line)
          }
          if (!connected && line.includes(connectionIndicator)) {
            connected = true;
            debug('Connection detected; switching to session timeout');
            if (connectionTimer) { clearTimeout(connectionTimer); connectionTimer = null; }
            sessionTimer = setTimeout(() => {
              error(`Session timeout after ${sessionTimeoutMinutes} minutes reached; terminating tunnel`);
              try { child.kill(); } catch (_) {}
            }, sessionTimeoutMs);
          }
        }
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (chunk: Buffer) => {
        const text = String(chunk);
        const lines = text.split(/\r?\n/).filter(l => l.length > 0);
        for (const line of lines) {
          error(line);
        }
      });
    }

    // Start the connection timeout
    connectionTimer = setTimeout(() => {
      if (!connected) {
        error(`Connection timeout after ${connectionTimeoutMinutes} minutes reached; terminating tunnel`);
        try { child.kill(); } catch (_) {}
      }
    }, connectionTimeoutMs);

    // Wait for the tunnel process to exit and forward its exit code
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        if (connectionTimer) { clearTimeout(connectionTimer); connectionTimer = null; }
        if (sessionTimer) { clearTimeout(sessionTimer); sessionTimer = null; }
      };

      child.on('error', err => {
        cleanup();
        reject(err);
      });

      child.on('close', (code) => {
        cleanup();
        info(`VS Code tunnel exited with code ${code}`);
        if (code && code !== 0) {
          reject(new Error(`VS Code tunnel exited with code ${code}`));
        } else {
          resolve();
        }
      });
    });

    if (githubActor) {
      const dataCacheName = `vscode-cli-data-${githubActor}`;
      try {
        debug('Saving CLI data dir to cache...');
        const cacheId = await saveCache([cliDataDir], dataCacheName);
        debug(`Saved CLI data dir to cache: ${cacheId}`);
      } catch (err) {
        warning(`Failed to save CLI data dir to cache: ${err}`);
      }
    }
  } catch (error) {
    setFailed(`Action failed with error: ${error instanceof Error ? error.message : String(error)}`);
    exit(1);
  }
}

main();
