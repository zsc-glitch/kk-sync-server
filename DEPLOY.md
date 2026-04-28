# Deploy KK Sync Server

## One-Click Deploy Options

### Railway (Recommended)

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/kk-sync-server)

1. Click the button above
2. Set `ADMIN_KEY` environment variable
3. Railway auto-deploys from GitHub
4. Get your server URL: `https://your-app.up.railway.app`

### Fly.io

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Deploy
fly launch --image ghcr.io/zsc-glitch/kk-sync-server --env ADMIN_KEY=your-secret
fly deploy
```

### Render

1. Fork this repo
2. Go to https://render.com → New Web Service
3. Connect your fork
4. Set `ADMIN_KEY` env var
5. Deploy

### Docker (Self-Hosted)

```bash
# Clone and start
git clone https://github.com/zsc-glitch/kk-sync-server.git
cd kk-sync-server

# Set admin key
export ADMIN_KEY=your-secret-admin-key

# Start
docker compose up -d
```

### VPS (Manual)

```bash
git clone https://github.com/zsc-glitch/kk-sync-server.git
cd kk-sync-server
npm install --production

ADMIN_KEY=your-secret PORT=3100 node src/index.js
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ADMIN_KEY` | ✅ | - | Admin API key for user management |
| `PORT` | ❌ | 3100 | Server port |
| `DATA_DIR` | ❌ | ./data | Data storage directory |
| `STRIPE_SECRET_KEY` | ❌ | - | Stripe API key for payments |
| `STRIPE_WEBHOOK_SECRET` | ❌ | - | Stripe webhook verification |
| `STRIPE_PRICE_PRO` | ❌ | - | Stripe price ID for Pro plan |
| `STRIPE_PRICE_TEAM` | ❌ | - | Stripe price ID for Team plan |

## Setting Up Stripe (Pro/Team Payments)

1. Register at https://stripe.com
2. Create two products:
   - **Pro Plan**: $9/month recurring
   - **Team Plan**: $29/month recurring
3. Copy the Price IDs to `STRIPE_PRICE_PRO` and `STRIPE_PRICE_TEAM`
4. Set webhook endpoint: `https://your-server/api/webhooks/stripe`
5. Events to listen for: `checkout.session.completed`, `customer.subscription.deleted`

## Creating Users

### Via Stripe (Automatic)
Users who pay through the checkout flow are automatically provisioned.

### Via Admin API (Manual)
```bash
curl -X POST https://your-server/admin/users \
  -H "Authorization: Bearer your-admin-key" \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","tier":"pro"}'
```

Returns:
```json
{
  "success": true,
  "data": {
    "id": "...",
    "apiKey": "kk_..."  // ⚠️ Save this! Shown only once.
  }
}
```

## Monitoring

```bash
# Health check
curl https://your-server/health

# Stats (requires admin key)
curl -H "Authorization: Bearer your-admin-key" https://your-server/admin/stats
```

## Connecting Knowledge Keeper MCP

After deployment, users set these environment variables:

```bash
export KK_SYNC_URL=https://your-server
export KK_API_KEY=kk_their-api-key
export KK_ENCRYPTION_KEY=their-passphrase
```

Then use `knowledge_sync` tool to push/pull changes.
