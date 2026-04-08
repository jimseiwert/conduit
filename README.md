<div align="center">
  <img src="./assets/logo.svg" alt="conduit" width="300" />
  <br/><br/>
  <p><strong>Self-hosted developer tunnel with live request inspection, replay, and time-travel diff.</strong></p>
  <p>
    <a href="https://github.com/jimseiwert/conduit/releases/latest"><img src="https://img.shields.io/github/v/release/jimseiwert/conduit?style=flat-square&color=38BDF8&label=release" alt="Latest Release"/></a>
    <a href="https://github.com/jimseiwert/conduit/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/jimseiwert/conduit/ci.yml?style=flat-square&color=6366F1&label=CI" alt="CI"/></a>
    <a href="https://marketplace.visualstudio.com/items?itemName=jimseiwert.conduit-relay"><img src="https://img.shields.io/badge/VS%20Code-extension-A78BFA?style=flat-square" alt="VS Code Extension"/></a>
    <a href="LICENSE"><img src="https://img.shields.io/github/license/jimseiwert/conduit?style=flat-square&color=38BDF8" alt="License"/></a>
  </p>
</div>

---

Conduit routes public HTTPS traffic to your localhost and gives you a full debugging environment to watch, replay, and diff every request in real time. Your data never leaves your infrastructure.

**The key difference from ngrok:** data stays in your cluster, your whole team shares the same live request stream, and you can go back in time to see exactly what changed between any two requests — field by field.

## Features

**Time-travel debugging.** The relay stores a ring buffer of up to 1,000 requests per slug. `conduit diff <id1> <id2>` gives you a field-level JSON diff between any two of them. Find the exact moment something broke without re-triggering it.

**Request replay.** Hit `r` in the TUI to re-fire any past request against your local server. No copying curl commands, no re-sending from Postman.

**Team observation mode.** Share your slug and token. Your whole team sees the same live traffic stream in their own TUI or VS Code panel simultaneously.

**Full observation plane.** A terminal UI built with Ink, a VS Code sidebar panel, and a persistent storage layer — not just a URL forwarder.

**Self-hosted relay.** Runs as a Kubernetes pod or Docker container on your infrastructure. OIDC and Azure AD (MSAL) auth layers available. No third-party servers in the data path.

## Install

**macOS / Linux**
```bash
curl -fsSL https://get.conduitrelay.com/conduit | bash
```

**Windows (PowerShell)**
```powershell
irm https://get.conduitrelay.com/conduit/install.ps1 | iex
```

**VS Code** — Install [Conduit Relay](https://marketplace.visualstudio.com/items?itemName=jimseiwert.conduit-relay) from the Marketplace.

## Quickstart

```bash
# Register a slug and start forwarding to localhost:3000
conduit start --slug myapp --port 3000
```

Your public URL appears in the TUI header. Send a request to it — it shows up immediately.

```
https://myapp.conduitrelay.com
```

On your next run, conduit reads `.conduit` and reconnects automatically. No flags needed.

## TUI Controls

| Key | Action |
|-----|--------|
| `↑` `↓` | Navigate requests |
| `r` | Replay selected request against localhost |
| `d` | Mark as diff base — press again on a second request to compare |
| `Esc` | Clear diff selection |
| `q` | Quit |

## CLI Reference

```
conduit start               Start the tunnel and open the TUI dashboard
conduit auth                Authenticate with the relay server
conduit diff <id1> <id2>    Field-level diff between two requests in the ring buffer
conduit history             List recent requests (default: last 50)
conduit replay <id>         Replay a stored request
conduit token refresh       Refresh your slug token before it expires

Options (start):
  --slug <slug>             Tunnel slug / subdomain
  --port <port>             Local port to forward to (default: 3000)
  --http                    Accept HTTP in addition to HTTPS
  --relay <url>             Custom relay WebSocket URL
  --config <path>           Path to .conduit config file
```

## Config

Two files keep shareable config and credentials separate.

**.conduit** (commit or share with your team):
```json
{
  "slug": "myapp",
  "port": 3000,
  "httpEnabled": false
}
```

**.env** (gitignored — never commit this):
```
CONDUIT_TOKEN=eyJhbGci...
```

On first run with `--slug`, conduit registers the slug with the relay and writes both files for you. Subsequent runs use them automatically.

If your token doesn't match the slug in `.conduit`, the CLI tells you exactly what's wrong and how to fix it — no silent failures.

## Self-Hosting

The relay is a Fastify WebSocket server. It proxies requests to the owner's CLI, persists a request ring buffer, and broadcasts live traffic to all connected watchers.

### Docker Compose

```bash
cp .env.example .env
# Edit .env and set CONDUIT_JWT_SECRET to a strong random string
docker compose up
```

### Kubernetes (Helm)

```bash
helm install conduit-relay oci://ghcr.io/jimseiwert/charts/conduit-relay \
  --set env.CONDUIT_JWT_SECRET=<secret> \
  --set ingress.enabled=true \
  --set ingress.host=relay.yourdomain.com
```

> **Keep `replicaCount: 1`.** The relay holds an in-memory WebSocket registry. Horizontal scaling via Redis pub/sub is planned for v1.1.

### Storage Adapters

| Adapter | When to use |
|---------|-------------|
| `memory` | Development and ephemeral environments |
| `sqlite` | Single-pod production — persistent, zero-dependency |
| `postgres` | Production with an external database |

```bash
STORAGE_ADAPTER=sqlite SQLITE_PATH=/data/conduit.db
# or
STORAGE_ADAPTER=postgres DATABASE_URL=postgres://...
```

### Auth (optional)

Set `AUTH_PROVIDER=oidc` or `AUTH_PROVIDER=msal` (Azure AD) on the relay to require user authentication on top of token-bound slugs. See `.env.example` for the full variable list.

## Architecture

```
External HTTP request
        │
        ▼
  Relay pod (Fastify + WebSocket)
  ├── /conduit/:slug/*          ← HTTP proxy — all methods
  ├── WS /conduit/:slug         ← Owner (CLI)
  └── WS /conduit/:slug/watch   ← Watchers (teammates, VS Code)
        │
        ▼
  ConduitClient (CLI or VS Code ext)
  ├── Forwards request to localhost:PORT
  ├── Streams response back via binary WebSocket frames
  └── Ink TUI / VS Code panel shows live traffic
```

**Packages:**

| Package | Role |
|---------|------|
| `packages/types` | Shared Zod schemas for the WebSocket wire protocol |
| `packages/relay` | Fastify relay server, JWT auth, ring buffer, storage adapters |
| `packages/cli` | Ink TUI, WebSocket client, `diff` / `history` / `replay` commands |
| `packages/vscode-ext` | VS Code sidebar panel with live request list and replay |
| `apps/relay-chart` | Helm chart for Kubernetes |

## Contributing

```bash
bun install
bun run build        # Build all packages (types → relay → cli)
bun run dev:relay    # Start relay in watch mode
bun test             # Run the full test suite
```

The wire protocol is defined in `packages/types/src/`. All messages are Zod-validated JSON over WebSocket. If you're adding a new message type, start there.
