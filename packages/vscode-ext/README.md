<div align="center">
  <img src="https://raw.githubusercontent.com/jimseiwert/conduit/main/assets/logo-mark.png" alt="conduit" width="80" />
  <br/><br/>
  <p><strong>Live request inspection and replay for your local server — directly in VS Code.</strong></p>
</div>

---

Conduit streams every HTTP request that hits your tunnel straight into a VS Code sidebar panel. Watch traffic arrive in real time, inspect full headers and body, and replay any past request with one click — without leaving the editor.

## What it does

**Live request stream.** A sidebar panel shows every incoming request as it arrives: method, path, status code, and timing. No browser tab to switch to. No separate terminal window.

**One-click replay.** Select any request and hit Replay. Conduit re-fires it against your local server exactly as it came in — same headers, same body. Useful for iterating on webhook handlers without waiting for the real event to fire again.

**Team observation.** If your team shares the same slug and token, everyone's VS Code panel shows the same live traffic simultaneously.

**Auto-connect.** When VS Code opens a workspace that has a `.conduit` config file, the extension connects automatically. Nothing to configure.

## Requirements

You need a Conduit relay to connect to. Options:

- **Use the hosted relay** at `wss://debug.tunnel.digital` — works out of the box, no setup
- **Self-host** on Kubernetes or Docker — see the [Conduit repo](https://github.com/jimseiwert/conduit) for the Helm chart and Docker Compose file

You also need the **Conduit CLI** to register a slug and start your tunnel:

```bash
# macOS / Linux
curl -fsSL https://get.tunnel.digital/conduit | bash

# Then register and start
conduit start --slug myapp --port 3000
```

Once the CLI is running, the VS Code extension connects to the same relay and shows traffic in the sidebar.

## Getting started

1. Install this extension
2. Install the [Conduit CLI](https://github.com/jimseiwert/conduit#install)
3. In your project directory, run `conduit start --slug myapp --port 3000`
4. Open the Conduit panel in the VS Code activity bar
5. Send a request to your tunnel URL — it appears in the panel instantly

If your project has a `.conduit` file, the extension connects automatically when VS Code opens.

## Commands

| Command | What it does |
|---------|-------------|
| `Conduit: Connect` | Connect to the relay using your `.conduit` config |
| `Conduit: Disconnect` | Disconnect from the relay |
| `Conduit: Login` | Authenticate via OIDC (required on relays with auth enabled) |
| `Conduit: Replay Request` | Replay the selected request |
| `Conduit: Refresh` | Reload the request list |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `conduit.relayUrl` | `wss://debug.tunnel.digital` | WebSocket URL of your relay server |
| `conduit.configFile` | `.conduit` | Path to the conduit config file (relative to workspace root) |
| `conduit.autoConnect` | `true` | Auto-connect when a `.conduit` file is found in the workspace |

## Self-hosting

If your team runs its own relay, point the extension at it:

```json
// .vscode/settings.json
{
  "conduit.relayUrl": "wss://relay.yourdomain.com"
}
```

The relay runs as a single Kubernetes pod or Docker container. Full setup docs and the Helm chart are in the [Conduit repository](https://github.com/jimseiwert/conduit).

## More

- [GitHub](https://github.com/jimseiwert/conduit) — source, issues, CLI docs
- [CLI installer](https://github.com/jimseiwert/conduit#install) — macOS, Linux, Windows
