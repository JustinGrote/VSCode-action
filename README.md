# VS Code Tunnel Action

Enables live debugging of a GitHub Action using an instance of Visual Studio Code Server running inside of the worker.

## Usage Instructions

```yaml
  - name: Start VS Code Tunnel
    if: failure() || ${{ runner.debug == '1' }}
    uses: justingrote/vscode-action
    with:
      #All these settings are optional
      tunnel-name: 'my-tunnel'
      connection-timeout: 5
      session-timeout: 60
      no-cache-cli-auth: false
```

On first run, the action will provide you a link to log in via device code login to GitHub. After authorization, you will be presented with a link to access the VSCode instance in your browser. You should also be able to connect via the `Remote Tunnels: Connect to Tunnel` command palette option in your desktop VSCode.

Subsequent connections from the same user will have the token information cached so you will only occasionally need to perform a device token authorization if it expires. You can disable this convenience behavior for extra security with the `no-cache-cli-auth` option.

While optional, is strongly recommended to use the `if` line above to only run the debugging if any of the last steps failed, or if you are re-running the job in debug mode.

You can place this step anywhere in your actions file to stop at that point in the process, and disconnect and reconnect as many times as needed for as long as the session-timeout window is specified.

## Resuming the Action

If you wish to resume the action after making changes, simply create a `ghacontinue` file in the root or home directory directory via `touch /ghacontinue` or `touch ~/ghacontinue`, and the action will continue.

## Inputs

- `tunnel-name` (optional): Name for the tunnel. Default: `github-actions-tunnel`
- `keep-alive-duration` (optional): How long to keep the tunnel alive in seconds. Default: `3600`
