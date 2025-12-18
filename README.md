# VS Code Tunnel Action

A GitHub Action that downloads the VS Code CLI for the current runner's OS and starts a code tunnel.

## Usage

```yaml
name: Start Tunnel
on: workflow_dispatch

jobs:
  tunnel:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    steps:
      - uses: actions/checkout@v4
      
      - name: Start VS Code Tunnel
        uses: ./
        with:
          tunnel-name: 'my-tunnel'
          keep-alive-duration: '3600'
```

## Built-in Test Workflow

- File: [.github/workflows/test-tunnel.yml](.github/workflows/test-tunnel.yml)
- Trigger: `workflow_dispatch` (manual run from the Actions tab)
- Inputs: `tunnel-name`, `keep-alive-duration`
- Output surfaced in the job logs and the workflow summary as `tunnel-url`.

### How to run

1. Push this repository to GitHub.
2. Open the Actions tab → Select "Test Tunnel".
3. Click "Run workflow" → Optionally customize inputs → Run.
4. After the job completes, check the summary for the tunnel URL.

## Inputs

- `tunnel-name` (optional): Name for the tunnel. Default: `github-actions-tunnel`
- `keep-alive-duration` (optional): How long to keep the tunnel alive in seconds. Default: `3600`

## Outputs

- `tunnel-url`: The URL for accessing the tunnel

## Development

This project uses **pnpm** for package management.

### Setup

```bash
pnpm install
```

### Build

```bash
pnpm run build
```

### Package for distribution

```bash
pnpm run package
```

Or run both build and package:

```bash
pnpm run prepare
```

## Features

- ✅ Cross-platform support (Linux, macOS, Windows)
- ✅ Automatic OS detection
- ✅ Downloads stable VS Code CLI
- ✅ Starts code tunnel with customizable name
- ✅ Configurable keep-alive duration
- ✅ Bundled as ESM via Rolldown

## License

MIT
