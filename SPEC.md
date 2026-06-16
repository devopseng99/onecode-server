# onecode-server — tRPC Backend for 1code Web UI

## Overview

Backend API server that replaces Electron's main process for the self-hosted 1code web app. The 1code React SPA (already deployed at https://onecode.istayintek.com) currently uses noop shims for Electron IPC — this server provides real implementations over HTTP/WebSocket.

## Architecture

```
1code React SPA (nginx, port 3000)
    ↓ tRPC over HTTP + WebSocket
onecode-server (Node.js, port 4000)
    ├── Claude CLI subprocess (streaming chat)
    ├── File system API (project browsing/editing)
    ├── Git operations (simple-git)
    └── Terminal/PTY (node-pty + WebSocket)
```

## Tech Stack

- **Runtime:** Node.js 20 LTS
- **Language:** TypeScript 5.x
- **Framework:** Fastify 4.x + `@trpc/server` + `@fastify/websocket`
- **tRPC Version:** Match 1code's `@trpc/client` version (check onecode's package.json)
- **Port:** 4000
- **Package Manager:** npm

## Core Routers (MVP — Phase 1)

### 1. Health Router
```typescript
health.check → { status: "ok", version: string, uptime: number }
```

### 2. Claude Router (THE CORE)
```typescript
claude.chat → subscription (WebSocket)
  Input: { prompt: string, sessionId?: string, projectDir: string }
  Output: stream of { type: "text" | "tool_use" | "cost" | "done", data: any }

  Implementation:
  - Spawn: /var/lib/rancher/1apps/node-v24.13.0-linux-x64/bin/claude
  - Args: -p <prompt> --output-format stream-json --verbose
  - If sessionId: add --resume <sessionId>
  - CWD: projectDir
  - Parse stream-json lines → emit via tRPC subscription
  - Track cost from total_cost_usd events

claude.cancel → mutation
  Input: { sessionId: string }
  Kill active Claude subprocess (SIGTERM, then SIGKILL after 5s)

claude.isActive → query
  Output: { active: boolean, sessionId?: string }
```

### 3. Files Router
```typescript
files.readFile → query
  Input: { path: string, projectDir: string }
  Output: { content: string, encoding: string }
  Validation: path must be within projectDir (prevent traversal)

files.writeFile → mutation
  Input: { path: string, content: string, projectDir: string }

files.listDirectory → query
  Input: { path: string, projectDir: string, recursive?: boolean }
  Output: Array<{ name: string, type: "file" | "dir", size: number }>
  Ignore: node_modules, .git, dist, build, __pycache__

files.search → query
  Input: { query: string, projectDir: string, glob?: string }
  Output: Array<{ path: string, line: number, content: string }>
```

### 4. Git Router
```typescript
git.status → query
  Input: { projectDir: string }
  Output: { branch: string, staged: string[], modified: string[], untracked: string[] }

git.commit → mutation
  Input: { message: string, projectDir: string }

git.log → query
  Input: { projectDir: string, limit?: number }
  Output: Array<{ hash: string, message: string, author: string, date: string }>

git.diff → query
  Input: { projectDir: string, file?: string }
  Output: { diff: string }
```

## Phase 2 Routers (Add Later)

### Terminal Router
```typescript
terminal.create → mutation → { sessionId: string }
terminal.stream → subscription (WebSocket) → chunks of terminal output
terminal.write → mutation (send input to PTY)
terminal.resize → mutation ({ cols, rows })
terminal.kill → mutation
```

### Projects Router
```typescript
projects.list → query (scan /var/lib/rancher/ansible/db/ for project dirs)
projects.get → query (project metadata)
projects.create → mutation (mkdir + git init)
```

### Chat Persistence Router
```typescript
chats.list → query
chats.get → query
chats.create → mutation
chats.delete → mutation
// Store in PostgreSQL via Drizzle ORM
```

## Environment Variables

| Var | Default | Description |
|-----|---------|-------------|
| PORT | 4000 | Server port |
| CLAUDE_BIN | /var/lib/rancher/1apps/node-v24.13.0-linux-x64/bin/claude | Path to Claude CLI |
| PROJECTS_ROOT | /var/lib/rancher/ansible/db | Root directory for projects |
| LOG_LEVEL | warn | Pino log level |
| CORS_ORIGIN | https://onecode.istayintek.com | Allowed CORS origin |
| NODE_ENV | production | Environment |

## Dependencies

```json
{
  "dependencies": {
    "@trpc/server": "^10.45.0",
    "@fastify/websocket": "^10.0.0",
    "@fastify/cors": "^9.0.0",
    "fastify": "^4.28.0",
    "simple-git": "^3.25.0",
    "zod": "^3.23.0",
    "pino": "^8.0.0",
    "glob": "^10.0.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "@types/node": "^20.0.0",
    "tsx": "^4.0.0"
  }
}
```

## Dockerfile

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
RUN apk add --no-cache git python3 make g++
WORKDIR /app
COPY --from=builder /app/dist/ ./dist/
COPY --from=builder /app/package.json ./
RUN npm ci --production
# node-pty needs native compilation (for Phase 2 terminal)
USER node
EXPOSE 4000
CMD ["node", "dist/server.js"]
```

**IMPORTANT:** This container needs access to:
- Claude CLI binary (mount or install)
- Project directories (mount /var/lib/rancher/ansible/db as volume)
- Git binary (apk add git)

## Kubernetes Deployment

- **Namespace:** onecode (same as the SPA)
- **Service:** onecode-server.onecode.svc:4000 (ClusterIP)
- **Volume mounts:**
  - `/var/lib/rancher/ansible/db` → hostPath (project files)
  - `/var/lib/rancher/1apps` → hostPath (Claude CLI binary)
  - `/home/hr1/.claude` → hostPath (Claude config/auth)
- **nodeSelector:** `kubernetes.io/hostname: mgplcb03` (where SPA runs)
- **Resources:** 200m CPU request, 512Mi memory request, 1 CPU limit, 1Gi memory limit
- **dnsConfig:** ndots: 2

## CF Tunnel Route

- Hostname: `onecode-api.istayintek.com`
- Service: `http://onecode-server.onecode.svc:4000`
- Must be added BEFORE the wildcard `*.istayintek.com` rule

## Security Considerations

- Path traversal prevention: ALL file/git operations validate paths against PROJECTS_ROOT
- CORS: Only allow requests from CORS_ORIGIN
- No auth in Phase 1 (single-user self-host) — add in Phase 2
- Claude CLI runs with user's existing auth tokens (mounted from host)

## Integration with 1code SPA

After onecode-server is deployed, the SPA's tRPC client needs to be reconfigured to point to `https://onecode-api.istayintek.com` instead of using the noop IPC shim. This requires:

1. Modify `src/web-shims/trpc-electron-shim.ts` to export `httpBatchLink` + `wsLink` pointing to onecode-server
2. Or create a new `src/web-shims/trpc-web-client.ts` that replaces the shim
3. Rebuild the SPA container with the new tRPC client config

## Success Criteria

1. `GET https://onecode-api.istayintek.com/health` → HTTP 200
2. tRPC panel at `https://onecode-api.istayintek.com/panel` (dev only)
3. Claude chat streaming works via WebSocket subscription
4. File listing of project directories works
5. Git status for a project works
