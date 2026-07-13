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
 * Set these secrets via wrangler secret put:
 *   DISCORD_CLIENT_ID     — your Discord OAuth2 app client ID
 *   DISCORD_CLIENT_SECRET — your Discord OAuth2 app client secret
 *   REQUIRED_ROLE_ID      — the Born Sniper role ID (right-click role in Discord → Copy ID)
 *   ADMIN_KEY             — a secret string you use for admin endpoints
 *
 * Config constants below:
 */

const REQUIRED_GUILD_ID  = "1369077918244012072";
const MONTHLY_USER_LIMIT = 100;

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

    // ── OAuth exchange: trade Discord code for access token + register user ──
    if (path === "/oauth/exchange") {
      const { code, redirect_uri } = body;
      if (!code) return json({ error: "Missing code" }, 400, cors);

      // Exchange code for access token
      const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: env.DISCORD_CLIENT_ID,
          client_secret: env.DISCORD_CLIENT_SECRET,
          grant_type: "authorization_code",
          code,
          redirect_uri,
        }),
      });
      if (!tokenRes.ok) return json({ error: "Failed to exchange Discord code" }, 400, cors);
      const tokenData = await tokenRes.json();
      const accessToken = tokenData.access_token;

      // Fetch user identity
      const meRes = await fetch("https://discord.com/api/v10/users/@me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!meRes.ok) return json({ error: "Failed to fetch Discord identity" }, 400, cors);
      const me = await meRes.json();

      // Verify guild membership AND Born Sniper role via the user's own OAuth token
      const memberCheck = await verifyGuildMemberRole(accessToken, REQUIRED_GUILD_ID, env.REQUIRED_ROLE_ID);
      if (!memberCheck.ok) return json({ error: memberCheck.error || "Access denied — Born Sniper role required" }, 403, cors);

      // Check if blocked
      const existing = await env.DB.prepare("SELECT * FROM users WHERE discord_id = ?").bind(me.id).first();
      if (existing?.blocked) return json({ error: "Your access has been revoked by an administrator.", blocked: true }, 403, cors);

      const now = new Date().toISOString();
      if (existing) {
        await env.DB.prepare("UPDATE users SET username = ?, last_validated = ? WHERE discord_id = ?")
          .bind(me.username, now, me.id).run();
      } else {
        await env.DB.prepare(
          "INSERT INTO users (discord_id, username, discriminator, guild_id, channel_id, blocked, solves_used, registered_at, last_validated) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)"
        ).bind(me.id, me.username, me.discriminator ?? "0", REQUIRED_GUILD_ID, "", now, now).run();
      }

      return json({ ok: true, discord_id: me.id, username: me.username, access_token: accessToken }, 200, cors);
    }

    // ── Validate: called on every app launch ──────────────────────────────────
    if (action === "validate") {
      if (!discord_id) return json({ error: "Missing discord_id" }, 400, cors);

      const user = await env.DB.prepare("SELECT * FROM users WHERE discord_id = ?").bind(discord_id).first();
      if (!user) return json({ error: "Not registered", blocked: false }, 403, cors);
      if (user.blocked) return json({ error: "Access revoked by administrator", blocked: true }, 403, cors);

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

// ── Helper: verify guild membership + Born Sniper role via guilds.members.read ─
// Uses GET /users/@me/guilds/{guild_id}/member — requires guilds.members.read scope
async function verifyGuildMemberRole(accessToken, guildId, requiredRoleId) {
  try {
    const res = await fetch(`https://discord.com/api/v10/users/@me/guilds/${guildId}/member`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 403 || res.status === 404) return { ok: false, error: "You are not a member of the required server" };
    if (!res.ok) return { ok: false, error: "Failed to verify server membership" };
    const member = await res.json();
    const roles = member.roles ?? [];
    if (requiredRoleId && !roles.includes(requiredRoleId)) {
      return { ok: false, error: "You do not have the Born Sniper role — access restricted" };
    }
    return { ok: true };
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