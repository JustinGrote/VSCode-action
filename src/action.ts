import { getInput, info, warning, setFailed } from '@actions/core';
import { exec } from '@actions/exec';
import { downloadTool, extractZip, extractTar, cacheFile } from '@actions/tool-cache';
import { existsSync, mkdirSync, chmodSync } from 'node:fs';
import { platform, arch, homedir } from 'node:os';
import { join } from 'node:path';
import { exit } from 'node:process';
import { spawn, SpawnOptions } from 'node:child_process';

async function main() {
  try {
    const tunnelName = getInput('tunnel-name');
    const keepAliveDuration = parseInt(getInput('keep-alive-duration'), 10);

    info(`Starting VS Code Tunnel: ${tunnelName}`);

    // Determine platform
    const runnerPlatform = platform();
    const runnerArch = arch();
    let downloadUrl = '';
    let fileName = '';
    let extractPath = '';

    // Check if architecture is supported
    if (runnerArch !== 'x64') {
      throw new Error(`Unsupported architecture: ${runnerArch}. Only x64 is supported yet.`);
    }

    switch (runnerPlatform) {
      case 'linux':
        downloadUrl = 'https://code.visualstudio.com/sha/download?build=stable&os=cli-alpine-x64';
        fileName = 'code-cli.tar.gz';
        extractPath = join(homedir(), 'vscode-cli');
        break;
      case 'darwin':
        downloadUrl = 'https://code.visualstudio.com/sha/download?build=stable&os=cli-darwin-x64';
        fileName = 'code-cli.zip';
        extractPath = join(homedir(), 'vscode-cli');
        break;
      case 'win32':
        downloadUrl = 'https://code.visualstudio.com/sha/download?build=stable&os=cli-win32-x64';
        fileName = 'code-cli.zip';
        extractPath = join(homedir(), 'vscode-cli');
        break;
      default:
        throw new Error(`Unsupported platform: ${runnerPlatform}`);
    }

    info(`Platform: ${runnerPlatform}, Architecture: ${runnerArch}`);
    info(`Download URL: ${downloadUrl}`);

    // Create extraction directory
    if (!existsSync(extractPath)) {
      mkdirSync(extractPath, { recursive: true });
    }

    // Download VS Code CLI
    info('Downloading VS Code CLI...');
    const downloadPath = await downloadTool(downloadUrl, join(extractPath, fileName));
    info(`Downloaded to: ${downloadPath}`);

    // Extract based on platform
    info('Extracting VS Code CLI...');

    if (runnerPlatform === 'win32') {
      await extractZip(downloadPath, extractPath);
    } else if (runnerPlatform === 'darwin' || runnerPlatform === 'linux') {
      if (runnerPlatform === 'darwin') {
        await extractZip(downloadPath, extractPath);
      } else {
        await extractTar(downloadPath, extractPath);
      }
    }

    // Make code executable on Unix
    if (runnerPlatform !== 'win32') {

    }

    // Determine path to `code` executable and get version
    info('Getting VS Code CLI version...');
    let codeExe = '';
    if (runnerPlatform === 'win32') {
      codeExe = join(extractPath, 'code.exe');
    } else {
      codeExe = join(extractPath, 'code');

      info('Making code CLI executable...');
      chmodSync(codeExe, '755');
    }

    // Capture stdout from --version
    async function getCodeVersion(exePath: string): Promise<string> {
      try {
        let output = '';
        const options = {
          listeners: {
            stdout: (data: Buffer) => {
              output += data.toString();
            }
          }
        } as any;
        await exec(exePath, ['--version'], options);
        const firstLine = output.split(/\r?\n/)[0]?.trim() || 'unknown';
        return firstLine;
      } catch (err) {
        warning(`Failed to get version: ${err}`);
        return 'unknown';
      }
    }

    const version = await getCodeVersion(codeExe);
    info(`Detected VS Code CLI version: ${version}`);

    // Create CLI data directory
    let cliDataDir = '';
    if (runnerPlatform === 'win32') {
      cliDataDir = join('C:\\', 'vscode-cli-data');
    } else {
      cliDataDir = join(homedir(), 'vscode-cli-data');
    }

    if (!existsSync(cliDataDir)) {
      mkdirSync(cliDataDir, { recursive: true });
    }

    // Cache just the `code` executable to the runner tool cache for reuse
    try {
      info('Caching VS Code CLI executable to tool cache...');
      const cachedFile = await cacheFile(codeExe, 'vscode', version, runnerArch);
      info(`VS Code CLI executable cached at: ${cachedFile}`);
    } catch (err) {
      warning(`Failed to cache VS Code CLI executable: ${err}`);
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

    const child = spawn(codeExe, tunnelArgs, options);

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
