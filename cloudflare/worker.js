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
 *   LICENSE_SIGNING_KEY — secret key used to sign short-lived license session tokens
 *
 * Config constants below:
 */

const REQUIRED_GUILD_ID   = "1369077918244012072";
const REQUIRED_CHANNEL_ID = "1369077919758155940";
const MONTHLY_USER_LIMIT  = 100;
const LICENSE_TTL_SECONDS = 30 * 60;
const LICENSE_REFRESH_AFTER_SECONDS = 10 * 60;
const ABUSE_MAX_DISTINCT_DEVICES_24H = 4;
const ABUSE_MAX_DISTINCT_COUNTRIES_24H = 3;
const ABUSE_MAX_DENY_EVENTS_10M = 12;
const ABUSE_MAX_BAD_REFRESH_1H = 8;
const ABUSE_ENFORCE_BLOCKS_DEFAULT = false;
const ABUSE_BLOCK_ON_SOFT_SIGNALS_DEFAULT = false;
const ALLOW_SELF_UNBLOCK_ON_REGISTER_DEFAULT = true;
const MEMBERSHIP_RUNTIME_FAILS_TO_LOCK_DEFAULT = 3;
const MEMBERSHIP_RUNTIME_FAIL_WINDOW_SECONDS = 10 * 60;

let abuseSchemaInitPromise = null;

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
      if (blocked && discord_id) {
        await logAbuseEvent(env, request, { discordId: discord_id, action: "admin_block", deviceId: null, outcome: "deny.blocked", reason: "admin_manual_block" });
        await emitLockoutAlert(env, { discordId: discord_id, action: "admin_block", deviceId: null, reason: "admin_manual_block" });
      }
      return json({ ok: true }, 200, cors);
    }

    // ── Admin: list all users ────────────────────────────────────────────────
    if (path === "/admin/users" && request.method === "GET") {
      const adminKey = request.headers.get("Authorization")?.replace("Bearer ", "");
      if (adminKey !== env.ADMIN_KEY) return json({ error: "Unauthorized" }, 403, cors);
      const { results } = await env.DB.prepare("SELECT * FROM users ORDER BY registered_at DESC").all();
      return json({ users: results }, 200, cors);
    }

    // ── Admin: inspect abuse events ───────────────────────────────────────────
    if (path === "/admin/abuse-events" && request.method === "GET") {
      const adminKey = request.headers.get("Authorization")?.replace("Bearer ", "");
      if (adminKey !== env.ADMIN_KEY) return json({ error: "Unauthorized" }, 403, cors);

      const limit = Math.min(Number(url.searchParams.get("limit") || 200), 500);
      const discordId = url.searchParams.get("discord_id")?.trim();

      let query = "SELECT * FROM abuse_events";
      const binds = [];
      if (discordId) {
        query += " WHERE discord_id = ?";
        binds.push(discordId);
      }
      query += " ORDER BY created_ts DESC LIMIT ?";
      binds.push(limit);

      const { results } = await env.DB.prepare(query).bind(...binds).all();
      return json({ events: results }, 200, cors);
    }

    // ── Admin: lockout-focused feed (discord_id + reason) ───────────────────
    if (path === "/admin/lockouts" && request.method === "GET") {
      const adminKey = request.headers.get("Authorization")?.replace("Bearer ", "");
      if (adminKey !== env.ADMIN_KEY) return json({ error: "Unauthorized" }, 403, cors);

      const limit = Math.min(Number(url.searchParams.get("limit") || 100), 500);
      const discordId = url.searchParams.get("discord_id")?.trim();

      let query = `
        SELECT discord_id, action, outcome, reason, country, created_at
        FROM abuse_events
        WHERE outcome = 'deny.blocked'
      `;
      const binds = [];
      if (discordId) {
        query += " AND discord_id = ?";
        binds.push(discordId);
      }
      query += " ORDER BY created_ts DESC LIMIT ?";
      binds.push(limit);

      const { results } = await env.DB.prepare(query).bind(...binds).all();
      return json({ lockouts: results }, 200, cors);
    }

    // ── Admin: one-time abuse schema migration ───────────────────────────────
    if (path === "/admin/migrate-abuse" && request.method === "POST") {
      const adminKey = request.headers.get("Authorization")?.replace("Bearer ", "");
      if (adminKey !== env.ADMIN_KEY) return json({ error: "Unauthorized" }, 403, cors);
      await ensureAbuseSchemaOnce(env);
      return json({ ok: true }, 200, cors);
    }

    // ── All other routes expect POST with JSON body ───────────────────────────
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);

    let body;
    try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400, cors); }

    const { action, discord_id } = body;

    // ── Register: new user activation ────────────────────────────────────────
    if (action === "register") {
      const { username, discriminator, guild_id, channel_id, user_token } = body;
      const deviceId = body.device_id || null;

      if (!discord_id || !username) {
        await logAbuseEvent(env, request, { discordId: discord_id, action, deviceId, outcome: "deny.missing_fields", reason: "missing_discord_or_username" });
        return json({ error: "Missing discord_id or username" }, 400, cors);
      }
      if (guild_id !== REQUIRED_GUILD_ID) {
        await logAbuseEvent(env, request, { discordId: discord_id, action, deviceId, outcome: "deny.invalid_guild", reason: "invalid_server" });
        return json({ error: "Invalid server" }, 403, cors);
      }
      if (channel_id !== REQUIRED_CHANNEL_ID) {
        await logAbuseEvent(env, request, { discordId: discord_id, action, deviceId, outcome: "deny.invalid_channel", reason: "invalid_channel" });
        return json({ error: "Invalid channel" }, 403, cors);
      }

      // Verify the user is actually in the guild using their own token
      const memberCheck = await verifyGuildMemberSelf(user_token, REQUIRED_GUILD_ID);
      if (!memberCheck.ok) {
        await logAbuseEvent(env, request, { discordId: discord_id, action, deviceId, outcome: "deny.not_in_required_guild", reason: "membership_check_failed" });
        return json({ error: "You are not a member of the required server", blocked: false }, 403, cors);
      }

      // Check if already registered and blocked
      const existing = await env.DB.prepare("SELECT * FROM users WHERE discord_id = ?").bind(discord_id).first();
      if (existing?.blocked) {
        if (shouldAllowSelfUnblockOnRegister(env)) {
          // User has already passed live guild membership check above using their own token.
          // Allow recovery from accidental/temporary blocks during activation retries.
          await env.DB.prepare("UPDATE users SET blocked = 0 WHERE discord_id = ?").bind(discord_id).run();
          await logAbuseEvent(env, request, { discordId: discord_id, action, deviceId, outcome: "allow", reason: "self_unblock_register" });
        } else {
          await logAbuseEvent(env, request, { discordId: discord_id, action, deviceId, outcome: "deny.blocked", reason: "user_blocked" });
          await emitLockoutAlert(env, { discordId: discord_id, action, deviceId, reason: "user_blocked" });
          return json({ error: "Your access has been revoked by an administrator.", blocked: true }, 403, cors);
        }
      }

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

      await logAbuseEvent(env, request, { discordId: discord_id, action, deviceId, outcome: "allow", reason: "register_success" });
      return json({ ok: true, discord_id, username }, 200, cors);
    }

    // ── Validate: called on every app launch ──────────────────────────────────
    if (action === "validate") {
      const deviceId = body.device_id || null;
      if (!discord_id) {
        await logAbuseEvent(env, request, { discordId: discord_id, action, deviceId, outcome: "deny.missing_discord_id", reason: "missing_discord_id" });
        return json({ error: "Missing discord_id" }, 400, cors);
      }

      const user = await env.DB.prepare("SELECT * FROM users WHERE discord_id = ?").bind(discord_id).first();
      if (!user) {
        await logAbuseEvent(env, request, { discordId: discord_id, action, deviceId, outcome: "deny.not_registered", reason: "not_registered" });
        return json({ error: "Not registered", blocked: false }, 403, cors);
      }
      if (user.blocked) {
        await logAbuseEvent(env, request, { discordId: discord_id, action, deviceId, outcome: "deny.blocked", reason: "user_blocked" });
        await emitLockoutAlert(env, { discordId: discord_id, action, deviceId, reason: "user_blocked" });
        return json({ error: "Access revoked by administrator", blocked: true }, 403, cors);
      }

      // Re-check guild membership on every launch with safe-but-strict runtime policy.
      const runtimeMembership = await enforceRuntimeMembership(env, request, {
        discordId: discord_id,
        action,
        deviceId,
      });
      if (runtimeMembership.blocked) {
        return json({ error: "Access revoked: not in required server", blocked: true }, 403, cors);
      }
      if (runtimeMembership.flagged) {
        await logAbuseEvent(env, request, { discordId: discord_id, action, deviceId, outcome: "flagged", reason: runtimeMembership.reason || "membership_check_uncertain" });
      }

      // Update last_validated timestamp
      await env.DB.prepare("UPDATE users SET last_validated = ? WHERE discord_id = ?")
        .bind(new Date().toISOString(), discord_id).run();

      await logAbuseEvent(env, request, { discordId: discord_id, action, deviceId, outcome: "allow", reason: "validate_success" });
      return json({ ok: true, solves_used: user.solves_used ?? 0, monthly_limit: MONTHLY_USER_LIMIT }, 200, cors);
    }

    // ── Handshake: issue short-lived signed session token ─────────────────────
    if (action === "handshake") {
      const { device_id } = body;
      if (!discord_id || !device_id) {
        await logAbuseEvent(env, request, { discordId: discord_id, action, deviceId: device_id || null, outcome: "deny.missing_fields", reason: "missing_discord_or_device" });
        return json({ error: "Missing discord_id or device_id" }, 400, cors);
      }

      const user = await env.DB.prepare("SELECT * FROM users WHERE discord_id = ?").bind(discord_id).first();
      if (!user) {
        await logAbuseEvent(env, request, { discordId: discord_id, action, deviceId: device_id, outcome: "deny.not_registered", reason: "not_registered" });
        return json({ error: "Not registered", blocked: false }, 403, cors);
      }
      if (user.blocked) {
        await logAbuseEvent(env, request, { discordId: discord_id, action, deviceId: device_id, outcome: "deny.blocked", reason: "user_blocked" });
        await emitLockoutAlert(env, { discordId: discord_id, action, deviceId: device_id, reason: "user_blocked" });
        return json({ error: "Access revoked by administrator", blocked: true }, 403, cors);
      }

      const abuseDecision = await evaluateAbuseAndMaybeBlock(env, discord_id);
      if (abuseDecision.reason && !abuseDecision.blocked) {
        await logAbuseEvent(env, request, { discordId: discord_id, action, deviceId: device_id, outcome: "flagged", reason: abuseDecision.reason });
      }
      if (abuseDecision.blocked) {
        await logAbuseEvent(env, request, { discordId: discord_id, action, deviceId: device_id, outcome: "deny.blocked", reason: abuseDecision.reason });
        await emitLockoutAlert(env, { discordId: discord_id, action, deviceId: device_id, reason: abuseDecision.reason || "abuse_policy_block" });
        return json({ error: "Access revoked due to suspicious activity", blocked: true }, 403, cors);
      }

      const runtimeMembership = await enforceRuntimeMembership(env, request, {
        discordId: discord_id,
        action,
        deviceId: device_id,
      });
      if (runtimeMembership.blocked) {
        return json({ error: "Access revoked: not in required server", blocked: true }, 403, cors);
      }
      if (runtimeMembership.flagged) {
        await logAbuseEvent(env, request, { discordId: discord_id, action, deviceId: device_id, outcome: "flagged", reason: runtimeMembership.reason || "membership_check_uncertain" });
      }

      const now = Math.floor(Date.now() / 1000);
      const exp = now + LICENSE_TTL_SECONDS;
      const payload = {
        sub: discord_id,
        did: device_id,
        iat: now,
        exp,
        ver: 1,
      };

      const sessionToken = await issueSessionToken(payload, env.LICENSE_SIGNING_KEY || env.ADMIN_KEY || "");
      await env.DB.prepare("UPDATE users SET last_validated = ? WHERE discord_id = ?")
        .bind(new Date().toISOString(), discord_id).run();

      await logAbuseEvent(env, request, { discordId: discord_id, action, deviceId: device_id, outcome: "allow", reason: "handshake_success" });

      return json({
        ok: true,
        session_token: sessionToken,
        expires_at: new Date(exp * 1000).toISOString(),
        refresh_after: new Date((now + LICENSE_REFRESH_AFTER_SECONDS) * 1000).toISOString(),
      }, 200, cors);
    }

    // ── Refresh: rotate short-lived signed session token ──────────────────────
    if (action === "refresh") {
      const { device_id, session_token } = body;
      if (!discord_id || !device_id || !session_token) {
        await logAbuseEvent(env, request, { discordId: discord_id, action, deviceId: device_id || null, outcome: "deny.missing_fields", reason: "missing_discord_device_or_token" });
        return json({ error: "Missing discord_id, device_id, or session_token" }, 400, cors);
      }

      const secret = env.LICENSE_SIGNING_KEY || env.ADMIN_KEY || "";
      const claims = await verifySessionToken(session_token, secret);
      if (!claims?.ok) {
        await logAbuseEvent(env, request, { discordId: discord_id, action, deviceId: device_id, outcome: "deny.invalid_token", reason: "invalid_session_token" });
        const abuseDecision = await evaluateAbuseAndMaybeBlock(env, discord_id);
        if (abuseDecision.reason && !abuseDecision.blocked) {
          await logAbuseEvent(env, request, { discordId: discord_id, action, deviceId: device_id, outcome: "flagged", reason: abuseDecision.reason });
        }
        if (abuseDecision.blocked) {
          await emitLockoutAlert(env, { discordId: discord_id, action, deviceId: device_id, reason: abuseDecision.reason || "abuse_policy_block" });
          return json({ error: "Access revoked due to suspicious activity", blocked: true }, 403, cors);
        }
        return json({ error: "Invalid session token" }, 403, cors);
      }
      if (claims.payload.sub !== discord_id || claims.payload.did !== device_id) {
        await logAbuseEvent(env, request, { discordId: discord_id, action, deviceId: device_id, outcome: "deny.subject_mismatch", reason: "token_subject_mismatch" });
        const abuseDecision = await evaluateAbuseAndMaybeBlock(env, discord_id);
        if (abuseDecision.reason && !abuseDecision.blocked) {
          await logAbuseEvent(env, request, { discordId: discord_id, action, deviceId: device_id, outcome: "flagged", reason: abuseDecision.reason });
        }
        if (abuseDecision.blocked) {
          await emitLockoutAlert(env, { discordId: discord_id, action, deviceId: device_id, reason: abuseDecision.reason || "abuse_policy_block" });
          return json({ error: "Access revoked due to suspicious activity", blocked: true }, 403, cors);
        }
        return json({ error: "Session token subject mismatch" }, 403, cors);
      }

      const user = await env.DB.prepare("SELECT * FROM users WHERE discord_id = ?").bind(discord_id).first();
      if (!user) {
        await logAbuseEvent(env, request, { discordId: discord_id, action, deviceId: device_id, outcome: "deny.not_registered", reason: "not_registered" });
        return json({ error: "Not registered", blocked: false }, 403, cors);
      }
      if (user.blocked) {
        await logAbuseEvent(env, request, { discordId: discord_id, action, deviceId: device_id, outcome: "deny.blocked", reason: "user_blocked" });
        await emitLockoutAlert(env, { discordId: discord_id, action, deviceId: device_id, reason: "user_blocked" });
        return json({ error: "Access revoked by administrator", blocked: true }, 403, cors);
      }

      const abuseDecision = await evaluateAbuseAndMaybeBlock(env, discord_id);
      if (abuseDecision.reason && !abuseDecision.blocked) {
        await logAbuseEvent(env, request, { discordId: discord_id, action, deviceId: device_id, outcome: "flagged", reason: abuseDecision.reason });
      }
      if (abuseDecision.blocked) {
        await logAbuseEvent(env, request, { discordId: discord_id, action, deviceId: device_id, outcome: "deny.blocked", reason: abuseDecision.reason });
        await emitLockoutAlert(env, { discordId: discord_id, action, deviceId: device_id, reason: abuseDecision.reason || "abuse_policy_block" });
        return json({ error: "Access revoked due to suspicious activity", blocked: true }, 403, cors);
      }

      const now = Math.floor(Date.now() / 1000);
      const exp = now + LICENSE_TTL_SECONDS;
      const payload = {
        sub: discord_id,
        did: device_id,
        iat: now,
        exp,
        ver: 1,
      };

      const rotatedToken = await issueSessionToken(payload, secret);
      await env.DB.prepare("UPDATE users SET last_validated = ? WHERE discord_id = ?")
        .bind(new Date().toISOString(), discord_id).run();

      await logAbuseEvent(env, request, { discordId: discord_id, action, deviceId: device_id, outcome: "allow", reason: "refresh_success" });

      return json({
        ok: true,
        session_token: rotatedToken,
        expires_at: new Date(exp * 1000).toISOString(),
        refresh_after: new Date((now + LICENSE_REFRESH_AFTER_SECONDS) * 1000).toISOString(),
      }, 200, cors);
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
  if (!botToken) return { ok: true, reason: "no_bot_token" }; // skip check if no bot token configured (dev mode)
  try {
    const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}`, {
      headers: { Authorization: `Bot ${botToken}` },
    });

    if (res.ok) return { ok: true, reason: "member" };

    // Only 404 is a definitive "not in guild" signal for this endpoint.
    // 401/403 and other statuses are often bot scope/intent/access issues,
    // so fail-open to avoid false account revocations.
    if (res.status === 404) return { ok: false, reason: "not_member" };

    return { ok: true, reason: `discord_status_${res.status}` };
  } catch {
    return { ok: true, reason: "network_error" }; // network error — grant benefit of the doubt
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

async function verifyGuildMemberWithRetry(botToken, guildId, userId) {
  const first = await verifyGuildMember(botToken, guildId, userId);
  if (!first || first.ok || first.reason === "not_member") return first;
  const second = await verifyGuildMember(botToken, guildId, userId);
  if (second?.reason === "not_member") return second;
  return first;
}

function membershipRuntimeFailThreshold(env) {
  const raw = Number(env.MEMBERSHIP_RUNTIME_FAILS_TO_LOCK);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : MEMBERSHIP_RUNTIME_FAILS_TO_LOCK_DEFAULT;
}

function membershipRuntimeFailWindowSeconds(env) {
  const raw = Number(env.MEMBERSHIP_RUNTIME_FAIL_WINDOW_SECONDS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : MEMBERSHIP_RUNTIME_FAIL_WINDOW_SECONDS;
}

async function countRecentMembershipUncertain(env, discordId) {
  if (!discordId) return 0;
  const now = Math.floor(Date.now() / 1000);
  const sinceTs = now - membershipRuntimeFailWindowSeconds(env);
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM abuse_events WHERE discord_id = ? AND created_ts >= ? AND outcome = 'flagged' AND reason LIKE 'membership_check_failed:%'"
  ).bind(discordId, sinceTs).first();
  return Number(row?.c || 0);
}

async function emitLockoutAlert(env, payload) {
  const webhook = env.ADMIN_ALERT_WEBHOOK;
  if (!webhook) return;
  try {
    const body = {
      content: [
        "KNULL access lockout detected",
        `discord_id: ${payload.discordId || "unknown"}`,
        `reason: ${payload.reason || "unspecified"}`,
        `action: ${payload.action || "unknown"}`,
        `device_id: ${payload.deviceId || "unknown"}`,
      ].join("\n"),
    };
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {}
}

async function setBlockedWithAlert(env, request, { discordId, action, deviceId, reason }) {
  await env.DB.prepare("UPDATE users SET blocked = 1 WHERE discord_id = ?").bind(discordId).run();
  await logAbuseEvent(env, request, { discordId, action, deviceId, outcome: "deny.blocked", reason });
  await emitLockoutAlert(env, { discordId, action, deviceId, reason });
}

async function enforceRuntimeMembership(env, request, { discordId, action, deviceId }) {
  const memberCheck = await verifyGuildMemberWithRetry(env.DISCORD_BOT_TOKEN, REQUIRED_GUILD_ID, discordId);
  if (memberCheck?.ok) return { blocked: false, flagged: false };

  const reason = memberCheck?.reason || "unknown";
  if (reason === "not_member") {
    await setBlockedWithAlert(env, request, {
      discordId,
      action,
      deviceId,
      reason: "membership_not_in_required_guild",
    });
    return { blocked: true, flagged: false, reason: "membership_not_in_required_guild" };
  }

  // For uncertain Discord responses, only lock after repeated failures in a short window.
  const priorFails = await countRecentMembershipUncertain(env, discordId);
  const threshold = membershipRuntimeFailThreshold(env);
  const currentFails = priorFails + 1;
  const flaggedReason = `membership_check_failed:${reason}`;

  if (currentFails >= threshold) {
    await setBlockedWithAlert(env, request, {
      discordId,
      action,
      deviceId,
      reason: `membership_check_unreliable_threshold:${reason}`,
    });
    return { blocked: true, flagged: false, reason: `membership_check_unreliable_threshold:${reason}` };
  }

  return { blocked: false, flagged: true, reason: flaggedReason };
}

async function ensureAbuseSchema(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS abuse_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_id TEXT,
      action TEXT,
      outcome TEXT,
      reason TEXT,
      device_hash TEXT,
      ip_hash TEXT,
      country TEXT,
      user_agent_hash TEXT,
      created_at TEXT,
      created_ts INTEGER
    )
  `).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_abuse_events_discord_ts ON abuse_events(discord_id, created_ts DESC)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_abuse_events_outcome_ts ON abuse_events(outcome, created_ts DESC)").run();
}

async function ensureAbuseSchemaOnce(env) {
  if (!abuseSchemaInitPromise) {
    abuseSchemaInitPromise = ensureAbuseSchema(env).catch((e) => {
      abuseSchemaInitPromise = null;
      throw e;
    });
  }
  return abuseSchemaInitPromise;
}

async function sha256Hex(input) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashSignal(env, value) {
  if (!value) return null;
  const salt = env.ABUSE_LOG_SALT || env.LICENSE_SIGNING_KEY || env.ADMIN_KEY || "knull-abuse";
  return sha256Hex(`${salt}:${value}`);
}

function getIp(request) {
  const direct = request.headers.get("CF-Connecting-IP");
  if (direct) return direct;
  const forwarded = request.headers.get("X-Forwarded-For");
  if (!forwarded) return null;
  return forwarded.split(",")[0]?.trim() || null;
}

async function logAbuseEvent(env, request, { discordId, action, deviceId, outcome, reason }) {
  await ensureAbuseSchemaOnce(env);
  const createdAt = new Date().toISOString();
  const createdTs = Math.floor(Date.now() / 1000);
  const country = request.headers.get("CF-IPCountry") || "UNK";
  const ipHash = await hashSignal(env, getIp(request));
  const uaHash = await hashSignal(env, request.headers.get("User-Agent"));
  const deviceHash = await hashSignal(env, deviceId || null);

  await env.DB.prepare(
    `INSERT INTO abuse_events (discord_id, action, outcome, reason, device_hash, ip_hash, country, user_agent_hash, created_at, created_ts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(discordId || null, action || null, outcome || null, reason || null, deviceHash, ipHash, country, uaHash, createdAt, createdTs).run();
}

async function evaluateAbuseAndMaybeBlock(env, discordId) {
  if (!discordId) return { blocked: false };

  const now = Math.floor(Date.now() / 1000);
  const dayAgo = now - 24 * 60 * 60;
  const hourAgo = now - 60 * 60;
  const tenMinAgo = now - 10 * 60;

  const devices = await env.DB.prepare(
    "SELECT COUNT(DISTINCT device_hash) AS c FROM abuse_events WHERE discord_id = ? AND created_ts >= ? AND device_hash IS NOT NULL"
  ).bind(discordId, dayAgo).first();

  const countries = await env.DB.prepare(
    "SELECT COUNT(DISTINCT country) AS c FROM abuse_events WHERE discord_id = ? AND created_ts >= ? AND country IS NOT NULL AND country != ''"
  ).bind(discordId, dayAgo).first();

  const denyBurst = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM abuse_events WHERE discord_id = ? AND created_ts >= ? AND outcome LIKE 'deny.%'"
  ).bind(discordId, tenMinAgo).first();

  const badRefresh = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM abuse_events WHERE discord_id = ? AND created_ts >= ? AND action = 'refresh' AND outcome IN ('deny.invalid_token','deny.subject_mismatch')"
  ).bind(discordId, hourAgo).first();

  const deviceCount = Number(devices?.c || 0);
  const countryCount = Number(countries?.c || 0);
  const denyCount = Number(denyBurst?.c || 0);
  const badRefreshCount = Number(badRefresh?.c || 0);

  let reason = null;
  let blockable = false;
  if (deviceCount > ABUSE_MAX_DISTINCT_DEVICES_24H) {
    reason = "abuse.too_many_devices";
    blockable = true;
  } else if (countryCount > ABUSE_MAX_DISTINCT_COUNTRIES_24H) {
    reason = "abuse.too_many_countries";
    blockable = true;
  } else if (denyCount > ABUSE_MAX_DENY_EVENTS_10M) {
    reason = "abuse.deny_burst";
    blockable = shouldBlockOnSoftSignals(env);
  } else if (badRefreshCount > ABUSE_MAX_BAD_REFRESH_1H) {
    reason = "abuse.invalid_refresh_burst";
    blockable = shouldBlockOnSoftSignals(env);
  }

  if (!reason) return { blocked: false, reason: null };

  const enforce = shouldEnforceAbuseBlocks(env);
  if (!enforce || !blockable) return { blocked: false, reason };

  await env.DB.prepare("UPDATE users SET blocked = 1 WHERE discord_id = ?").bind(discordId).run();
  return { blocked: true, reason };
}

function shouldEnforceAbuseBlocks(env) {
  const raw = (env.ABUSE_ENFORCE_BLOCKS || "").toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return ABUSE_ENFORCE_BLOCKS_DEFAULT;
}

function shouldBlockOnSoftSignals(env) {
  const raw = (env.ABUSE_BLOCK_ON_SOFT_SIGNALS || "").toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return ABUSE_BLOCK_ON_SOFT_SIGNALS_DEFAULT;
}

function shouldAllowSelfUnblockOnRegister(env) {
  const raw = (env.ALLOW_SELF_UNBLOCK_ON_REGISTER || "").toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return ALLOW_SELF_UNBLOCK_ON_REGISTER_DEFAULT;
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function toBase64Url(input) {
  const raw = typeof input === "string" ? input : String.fromCharCode(...new Uint8Array(input));
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const pad = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return atob(b64);
}

async function hmacSign(secret, message) {
  const keyData = new TextEncoder().encode(secret);
  const msgData = new TextEncoder().encode(message);
  const key = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return await crypto.subtle.sign("HMAC", key, msgData);
}

async function issueSessionToken(payload, secret) {
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = toBase64Url(payloadJson);
  const sig = await hmacSign(secret, payloadB64);
  const sigB64 = toBase64Url(sig);
  return `${payloadB64}.${sigB64}`;
}

async function verifySessionToken(token, secret) {
  try {
    const parts = String(token).split(".");
    if (parts.length !== 2) return { ok: false };
    const [payloadB64, sigB64] = parts;
    const expectedSig = await hmacSign(secret, payloadB64);
    if (toBase64Url(expectedSig) !== sigB64) return { ok: false };

    const payloadJson = fromBase64Url(payloadB64);
    const payload = JSON.parse(payloadJson);
    const now = Math.floor(Date.now() / 1000);
    if (!payload?.exp || now >= payload.exp) return { ok: false };

    return { ok: true, payload };
  } catch {
    return { ok: false };
  }
}