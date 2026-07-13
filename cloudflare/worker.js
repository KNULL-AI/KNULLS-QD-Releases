/**
 * KNULL Queue Destroyer — Cloudflare Worker
 *
 * Deploy this to Cloudflare Workers with a D1 database bound as DB.
 *
 * D1 setup (run once via wrangler):
 *   wrangler d1 create knull-users
 *   wrangler d1 execute knull-users --command "
 *     CREATE TABLE IF NOT EXISTS users (
 *       discord_id TEXT PRIMARY KEY,
 *       username TEXT,
 *       discriminator TEXT,
 *       guild_id TEXT,
 *       channel_id TEXT,
 *       blocked INTEGER DEFAULT 0,
 *       solves_used INTEGER DEFAULT 0,
 *       registered_at TEXT,
 *       last_validated TEXT
 *     );
 *   "
 *
 * wrangler.toml:
 *   name = "knull-activation"
 *   [[d1_databases]]
 *   binding = "DB"
 *   database_name = "knull-users"
 *   database_id = "<your-d1-database-id>"
 *
 * Set these secrets via: wrangler secret put DISCORD_BOT_TOKEN
 *   DISCORD_BOT_TOKEN — your bot token (must be in the server with GUILD_MEMBER intent)
 *   ADMIN_KEY         — a secret string you use for admin endpoints
 *
 * Config constants below:
 */

const REQUIRED_GUILD_ID   = "1369077918244012072";
const REQUIRED_CHANNEL_ID = "1369077919758155940";
const MONTHLY_USER_LIMIT  = 100;

export default {
  async fetch(request, env) {
    // CORS for local Electron (file:// or http://localhost)
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    const url = new URL(request.url);
    const path = url.pathname;

    // ── Admin: block/unblock a user ──────────────────────────────────────────
    if (path === "/admin/block" && request.method === "POST") {
      const adminKey = request.headers.get("Authorization")?.replace("Bearer ", "");
      if (adminKey !== env.ADMIN_KEY) return json({ error: "Unauthorized" }, 403, cors);
      const { discord_id, blocked } = await request.json();
      await env.DB.prepare(
        "UPDATE users SET blocked = ? WHERE discord_id = ?"
      ).bind(blocked ? 1 : 0, discord_id).run();
      return json({ ok: true }, 200, cors);
    }

    // ── Admin: list all users ────────────────────────────────────────────────
    if (path === "/admin/users" && request.method === "GET") {
      const adminKey = request.headers.get("Authorization")?.replace("Bearer ", "");
      if (adminKey !== env.ADMIN_KEY) return json({ error: "Unauthorized" }, 403, cors);
      const { results } = await env.DB.prepare("SELECT * FROM users ORDER BY registered_at DESC").all();
      return json({ users: results }, 200, cors);
    }

    // ── All other routes expect POST with JSON body ───────────────────────────
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);

    let body;
    try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400, cors); }

    const { action, discord_id } = body;

    // ── Register: new user activation ────────────────────────────────────────
    if (action === "register") {
      const { username, discriminator, guild_id, channel_id, user_token } = body;

      if (!discord_id || !username) return json({ error: "Missing discord_id or username" }, 400, cors);
      if (guild_id !== REQUIRED_GUILD_ID) return json({ error: "Invalid server" }, 403, cors);
      if (channel_id !== REQUIRED_CHANNEL_ID) return json({ error: "Invalid channel" }, 403, cors);

      // Verify the user is actually in the guild using their own token
      const memberCheck = await verifyGuildMemberSelf(user_token, REQUIRED_GUILD_ID);
      if (!memberCheck.ok) return json({ error: "You are not a member of the required server", blocked: false }, 403, cors);

      // Check if already registered and blocked
      const existing = await env.DB.prepare("SELECT * FROM users WHERE discord_id = ?").bind(discord_id).first();
      if (existing?.blocked) return json({ error: "Your access has been revoked by an administrator.", blocked: true }, 403, cors);

      const now = new Date().toISOString();
      if (existing) {
        await env.DB.prepare(
          "UPDATE users SET username = ?, discriminator = ?, guild_id = ?, channel_id = ?, last_validated = ? WHERE discord_id = ?"
        ).bind(username, discriminator ?? "0", guild_id, channel_id, now, discord_id).run();
      } else {
        await env.DB.prepare(
          "INSERT INTO users (discord_id, username, discriminator, guild_id, channel_id, blocked, solves_used, registered_at, last_validated) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)"
        ).bind(discord_id, username, discriminator ?? "0", guild_id, channel_id, now, now).run();
      }

      return json({ ok: true, discord_id, username }, 200, cors);
    }

    // ── Validate: called on every app launch ──────────────────────────────────
    if (action === "validate") {
      if (!discord_id) return json({ error: "Missing discord_id" }, 400, cors);

      const user = await env.DB.prepare("SELECT * FROM users WHERE discord_id = ?").bind(discord_id).first();
      if (!user) return json({ error: "Not registered", blocked: false }, 403, cors);
      if (user.blocked) return json({ error: "Access revoked by administrator", blocked: true }, 403, cors);

      // Re-check guild membership via bot on every launch (graceful if no bot token)
      const memberCheck = await verifyGuildMember(env.DISCORD_BOT_TOKEN, REQUIRED_GUILD_ID, discord_id);
      if (!memberCheck.ok) {
        // Auto-block if they left the server
        await env.DB.prepare("UPDATE users SET blocked = 1 WHERE discord_id = ?").bind(discord_id).run();
        return json({ error: "You have been removed from the required server — access revoked.", blocked: true }, 403, cors);
      }

      // Update last_validated timestamp
      await env.DB.prepare("UPDATE users SET last_validated = ? WHERE discord_id = ?")
        .bind(new Date().toISOString(), discord_id).run();

      return json({ ok: true, solves_used: user.solves_used ?? 0, monthly_limit: MONTHLY_USER_LIMIT }, 200, cors);
    }

    // ── Status: community pool stats ──────────────────────────────────────────
    if (action === "status") {
      const { results } = await env.DB.prepare("SELECT SUM(solves_used) as total FROM users").all();
      const total = results[0]?.total ?? 0;
      const user = discord_id
        ? await env.DB.prepare("SELECT solves_used FROM users WHERE discord_id = ?").bind(discord_id).first()
        : null;
      return json({
        pool_active: true,
        solves_used: total,
        monthly_budget: 10000,
        user_used: user?.solves_used ?? 0,
        user_limit: MONTHLY_USER_LIMIT,
      }, 200, cors);
    }

    return json({ error: "Unknown action" }, 400, cors);
  },
};

// ── Helper: verify guild membership via Discord Bot API ───────────────────────
async function verifyGuildMember(botToken, guildId, userId) {
  if (!botToken) return { ok: true }; // skip check if no bot token configured (dev mode)
  try {
    const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}`, {
      headers: { Authorization: `Bot ${botToken}` },
    });
    return { ok: res.ok };
  } catch {
    return { ok: true }; // network error — grant benefit of the doubt
  }
}

// ── Helper: verify guild membership using the user's own token ────────────────
async function verifyGuildMemberSelf(userToken, guildId) {
  if (!userToken) return { ok: false };
  try {
    const res = await fetch(`https://discord.com/api/v10/users/@me/guilds`, {
      headers: { Authorization: userToken },
    });
    if (!res.ok) return { ok: false };
    const guilds = await res.json();
    const isMember = Array.isArray(guilds) && guilds.some((g) => g.id === guildId);
    return { ok: isMember };
  } catch {
    return { ok: true }; // network error — grant benefit of the doubt
  }
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}