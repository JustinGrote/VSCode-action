# VS Code Tunnel Action

Enables live debugging of a GitHub Action using an instance of Visual Studio Code Server running inside of the worker.

## Quick Start

```yaml
  - name: Start VS Code Tunnel
    if: failure()
    uses: justingrote/vscode-action
    with:
      #All these settings are optional
      tunnel-name: 'my-tunnel'
      connection-timeout: 5
      session-timeout: 60
      no-cache-cli-auth: false
```

## Inputs

- `tunnel-name` (optional): Name for the tunnel. Default: `github-actions-tunnel`
- `keep-alive-duration` (optional): How long to keep the tunnel alive in seconds. Default: `3600`

## License

MIT
