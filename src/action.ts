import { getInput, info, warning, setFailed } from '@actions/core';
import { exec } from '@actions/exec';
import { downloadTool, extractZip, extractTar } from '@actions/tool-cache';
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

    switch (runnerPlatform) {
      case 'linux':
        downloadUrl = 'https://code.visualstudio.com/sha/download?build=stable&os=linux-x64';
        fileName = 'code-cli.tar.gz';
        extractPath = join(homedir(), 'vscode-cli');
        break;
      case 'darwin':
        downloadUrl = 'https://code.visualstudio.com/sha/download?build=stable&os=darwin-x64';
        fileName = 'code-cli.zip';
        extractPath = join(homedir(), 'vscode-cli');
        break;
      case 'win32':
        downloadUrl = 'https://code.visualstudio.com/sha/download?build=stable&os=win32-x64';
        fileName = 'code-cli.zip';
        extractPath = join('C:\\', 'vscode-cli');
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
      const codePath = join(extractPath, 'code');
      chmodSync(codePath, '755');
    }

    // Get version
    info('Getting VS Code CLI version...');
    let codeExe = '';
    if (runnerPlatform === 'win32') {
      codeExe = join(extractPath, 'code.exe');
    } else {
      codeExe = join(extractPath, 'code');
    }

    try {
      await exec(codeExe, ['--version']);
    } catch (error) {
      warning(`Failed to get version: ${error}`);
    }

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
