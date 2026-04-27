# KK Sync Server

> Cloud sync backend for [Knowledge Keeper MCP](https://github.com/zsc-glitch/knowledge-keeper-mcp) Pro & Team plans

## Features

- 🔐 **End-to-end encrypted** — Server never sees plaintext user data
- 🔄 **Incremental sync** — Only changed items are transferred
- ⚔️ **Conflict detection** — Version tracking prevents silent overwrites
- 🔑 **API key auth** — Secure per-user authentication
- 📊 **Admin API** — User management & revenue stats
- 🪶 **Zero-compile** — Pure JS, no native dependencies
- 🐳 **Docker ready** — One-command deploy

## Quick Start

### Docker (Recommended)

```bash
# Clone and start
git clone https://github.com/zsc-glitch/kk-sync-server.git
cd kk-sync-server

# Set admin key
export ADMIN_KEY=your-secret-admin-key

# Start
docker compose up -d
```

### Direct

```bash
git clone https://github.com/zsc-glitch/kk-sync-server.git
cd kk-sync-server
npm install
ADMIN_KEY=your-secret PORT=3100 node src/index.js
```

## API

### Health Check
```
GET /health
→ {"status":"ok","version":"0.1.0"}
```

### License Check
```
GET /v1/license
Authorization: Bearer <api_key>
→ {"tier":"pro","features":["cloud-sync",...]}
```

### Push Changes
```
POST /api/sync/push
Authorization: Bearer <api_key>
X-Device-Id: <device_id>
Body: {
  "items": [{ "id": "...", "data": {encrypted}, "hash": "...", "expectedVersion": 1 }],
  "deleted": ["old-item-id"]
}
```

### Pull Changes
```
POST /api/sync/pull
Authorization: Bearer <api_key>
Body: {
  "since": "2026-04-27T00:00:00Z",
  "knownVersions": { "item-id": 3 }
}
```

### Admin: Create User
```
POST /admin/users
Authorization: Bearer <admin_key>
Body: { "email": "user@example.com", "tier": "pro" }
→ { "id": "...", "apiKey": "kk_..." }  // API key shown only once!
```

### Admin: Stats
```
GET /admin/stats
Authorization: Bearer <admin_key>
→ { "users": 42, "proUsers": 30, "teamUsers": 5, "monthlyRevenue": 395 }
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3100 | Server port |
| `ADMIN_KEY` | - | Admin API key (required for /admin/*) |
| `DATA_DIR` | ./data | Data storage directory |

## Pricing Integration

This server supports the Knowledge Keeper MCP pricing tiers:

| Tier | Price | Features |
|------|-------|---------|
| Free | $0 | Local storage only (no sync) |
| Pro | $9/mo | Cloud sync + multi-device |
| Team | $29/mo | Shared knowledge + roles |

To create a paid user:
1. Process payment via Stripe/LemonSqueezy
2. Call `POST /admin/users` with the user's email and tier
3. Deliver the API key to the user

## Architecture

```
Client (k-k-mcp)                Server (this)
┌─────────────────┐            ┌─────────────────┐
│ Knowledge data   │            │ JSON file store  │
│ ↓ AES-256-GCM   │  HTTPS     │ (encrypted blobs)│
│ Encrypted blob   │ ────────→ │                  │
│                  │            │ Version tracking │
│ Sync manifest    │  ←──────── │ Conflict detect  │
└─────────────────┘            └─────────────────┘
```

Server **cannot decrypt** user data. All encryption/decryption happens client-side.

## License

MIT © [小影](https://github.com/zsc-glitch)
