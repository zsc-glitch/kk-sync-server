/**
 * KK Sync Server — Cloud sync backend for Knowledge Keeper MCP
 * Zero-compile, zero-native-deps. Pure JS + JSON file storage.
 * 
 * Run: node src/index.js
 * Env: PORT=3100 ADMIN_KEY=your-secret DATA_DIR=./data
 */

import { Hono } from "hono";
import { createHash, randomBytes } from "crypto";
import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { createServer } from "http";

// ============================================================
// JSON File Storage
// ============================================================

const DATA_DIR = process.env.DATA_DIR || join(import.meta.dirname, "..", "data");

function hashKey(key) {
  return createHash("sha256").update(key).digest("hex");
}

class JsonStore {
  constructor() {
    this.data = { users: {}, items: {}, devices: {} };
    this.dirty = false;
  }

  async init() {
    const file = join(DATA_DIR, "db.json");
    if (existsSync(file)) {
      const raw = await readFile(file, "utf8");
      this.data = JSON.parse(raw);
    } else {
      await mkdir(DATA_DIR, { recursive: true });
      await this.save();
    }
    setInterval(() => { if (this.dirty) this.save(); }, 5000);
  }

  async save() {
    const file = join(DATA_DIR, "db.json");
    await writeFile(file, JSON.stringify(this.data, null, 2));
    this.dirty = false;
  }

  createUser(email, tier) {
    const id = randomBytes(16).toString("hex");
    const apiKey = `kk_${randomBytes(24).toString("hex")}`;
    const apiKeyHash = hashKey(apiKey);
    this.data.users[id] = { id, email, apiKeyHash, tier, createdAt: new Date().toISOString(), expiresAt: null };
    this.data.items[id] = {};
    this.dirty = true;
    return { id, apiKey };
  }

  findByApiKey(apiKey) {
    const hash = hashKey(apiKey);
    return Object.values(this.data.users).find(u => u.apiKeyHash === hash);
  }

  getItem(userId, itemId) {
    return this.data.items[userId]?.[itemId];
  }

  setItem(userId, itemId, item) {
    if (!this.data.items[userId]) this.data.items[userId] = {};
    this.data.items[userId][itemId] = {
      id: itemId,
      ...item,
      updatedAt: new Date().toISOString(),
    };
    this.dirty = true;
  }

  deleteItem(userId, itemId) {
    if (this.data.items[userId]?.[itemId]) {
      this.data.items[userId][itemId].deleted = true;
      this.data.items[userId][itemId].updatedAt = new Date().toISOString();
      this.dirty = true;
    }
  }

  getUserItems(userId) {
    return this.data.items[userId] || {};
  }

  touchDevice(deviceId, userId) {
    this.data.devices[deviceId] = { id: deviceId, userId, lastSeen: new Date().toISOString() };
    this.dirty = true;
  }

  stats() {
    const users = Object.values(this.data.users);
    const proUsers = users.filter(u => u.tier === "pro").length;
    const teamUsers = users.filter(u => u.tier === "team").length;
    let syncedItems = 0;
    for (const userItems of Object.values(this.data.items)) {
      syncedItems += Object.values(userItems).filter(i => !i.deleted).length;
    }
    return { users: users.length, proUsers, teamUsers, syncedItems, monthlyRevenue: proUsers * 9 + teamUsers * 29 };
  }
}

// ============================================================
// API
// ============================================================

const store = new JsonStore();
const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok", version: "0.1.0" }));

// License
app.get("/v1/license", (c) => {
  const apiKey = c.req.header("Authorization")?.replace("Bearer ", "");
  if (!apiKey) return c.json({ tier: "free", expiresAt: null, features: ["local-storage"] });

  const user = store.findByApiKey(apiKey);
  if (!user) return c.json({ tier: "free", expiresAt: null, features: ["local-storage"] });

  const features = user.tier === "team"
    ? ["local-storage", "cloud-sync", "multi-device", "team-shared", "analytics", "priority-support"]
    : user.tier === "pro"
    ? ["local-storage", "cloud-sync", "multi-device", "analytics", "priority-support"]
    : ["local-storage"];

  return c.json({ tier: user.tier, expiresAt: user.expiresAt, features });
});

// Push
app.post("/api/sync/push", async (c) => {
  const apiKey = c.req.header("Authorization")?.replace("Bearer ", "");
  if (!apiKey) return c.json({ success: false, error: "Unauthorized" }, 401);

  const user = store.findByApiKey(apiKey);
  if (!user) return c.json({ success: false, error: "Invalid API key" }, 401);
  if (user.tier === "free") return c.json({ success: false, error: "Cloud sync requires Pro or Team plan" }, 403);

  const deviceId = c.req.header("X-Device-Id") || "unknown";
  const body = await c.req.json();

  const results = [];

  for (const item of (body.items || [])) {
    const existing = store.getItem(user.id, item.id);
    if (existing && existing.version !== item.expectedVersion) {
      results.push({ id: item.id, serverVersion: existing.version, conflict: true });
    } else {
      const newVersion = existing ? existing.version + 1 : 1;
      store.setItem(user.id, item.id, {
        data: JSON.stringify(item.data),
        hash: item.hash,
        version: newVersion,
        deleted: false,
        deviceId,
      });
      results.push({ id: item.id, serverVersion: newVersion, conflict: false });
    }
  }

  for (const id of (body.deleted || [])) {
    store.deleteItem(user.id, id);
  }

  store.touchDevice(deviceId, user.id);
  return c.json({ success: true, data: results });
});

// Pull
app.post("/api/sync/pull", async (c) => {
  const apiKey = c.req.header("Authorization")?.replace("Bearer ", "");
  if (!apiKey) return c.json({ success: false, error: "Unauthorized" }, 401);

  const user = store.findByApiKey(apiKey);
  if (!user) return c.json({ success: false, error: "Invalid API key" }, 401);
  if (user.tier === "free") return c.json({ success: false, error: "Cloud sync requires Pro or Team plan" }, 403);

  const body = await c.req.json();
  const allItems = store.getUserItems(user.id);

  const changedItems = Object.values(allItems)
    .filter(item => {
      if (item.deleted) return false;
      const known = body.knownVersions?.[item.id];
      return !known || item.version > known;
    })
    .map(item => ({
      id: item.id,
      data: JSON.parse(item.data),
      serverVersion: item.version,
    }));

  const deleted = body.since
    ? Object.values(allItems).filter(i => i.deleted && i.updatedAt > body.since).map(i => i.id)
    : [];

  return c.json({ success: true, data: { items: changedItems, deleted } });
});

// Admin: create user
app.post("/admin/users", async (c) => {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey || c.req.header("Authorization") !== `Bearer ${adminKey}`) {
    return c.json({ success: false, error: "Forbidden" }, 403);
  }

  const body = await c.req.json();
  const result = store.createUser(body.email, body.tier);
  return c.json({ success: true, data: result });
});

// Admin: stats
app.get("/admin/stats", (c) => {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey || c.req.header("Authorization") !== `Bearer ${adminKey}`) {
    return c.json({ success: false, error: "Forbidden" }, 403);
  }
  return c.json(store.stats());
});

// ============================================================
// Start Server
// ============================================================

const port = parseInt(process.env.PORT || "3100");

await store.init();

// Register payment routes (Stripe integration)
try {
  const { registerPaymentRoutes } = await import("./payment.js");
  registerPaymentRoutes(app, store);
  console.log("💳 Payment routes registered");
} catch (e) {
  console.log("💳 Payment module not loaded:", e.message);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${port}`);
  const method = (req.method || "GET").toUpperCase();

  let body;
  if (method !== "GET" && method !== "HEAD") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = Buffer.concat(chunks).toString();
  }

  const headers = {};
  for (let i = 0; i < (req.rawHeaders?.length || 0); i += 2) {
    const key = req.rawHeaders?.[i];
    if (key) headers[key.toLowerCase()] = req.rawHeaders[i + 1] || "";
  }

  const request = new Request(url.toString(), { method, headers, body: body || undefined });
  const response = await app.fetch(request);

  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(await response.text());
});

server.listen(port, () => {
  console.log(`🚀 KK Sync Server running on http://localhost:${port}`);
  console.log(`📊 Admin: http://localhost:${port}/admin/stats`);
  console.log(`🔑 Set ADMIN_KEY env var for admin access`);
});
