/**
 * Minimal self-contained IMAP client using only Node's built-in net/tls.
 * Fetches UNSEEN messages from INBOX, parses RFC822, and extracts a
 * numeric verification code. No external IMAP library dependency.
 *
 * Exposes: imapFetch({ host, port, username, password, tls, limit })
 *   → { messages: [{ uid, to, from, subject, date, snippet, code }], error? }
 */

const net = require("net");
const tls = require("tls");

// latin1 preserves a 1:1 byte↔char mapping, so string length === byte length.
// This makes substring slicing byte-accurate for IMAP {N} literal lengths.
function openImap({ host, port, tls: useTls = true }) {
  return new Promise((resolve, reject) => {
    const socket = useTls
      ? tls.connect({ host, port: port || 993, rejectUnauthorized: false })
      : net.createConnection({ host, port: port || 143 });

    let buffer = "";
    const lineQueue = [];
    const lineWaiters = [];
    let pendingLiteral = null; // { line, n }
    let settled = false;

    function drain() {
      while (true) {
        if (pendingLiteral) {
          if (buffer.length >= pendingLiteral.n) {
            const literal = buffer.substring(0, pendingLiteral.n);
            buffer = buffer.substring(pendingLiteral.n);
            const entry = { line: pendingLiteral.line, literal };
            pendingLiteral = null;
            deliver(entry);
            continue;
          }
          return;
        }
        const idx = buffer.indexOf("\r\n");
        if (idx === -1) return;
        const line = buffer.substring(0, idx);
        buffer = buffer.substring(idx + 2);
        const m = line.match(/\{(\d+)\}\s*$/);
        if (m) {
          pendingLiteral = { line, n: parseInt(m[1], 10) };
          continue;
        }
        deliver({ line, literal: null });
      }
    }

    function deliver(entry) {
      if (lineWaiters.length) lineWaiters.shift()(entry);
      else lineQueue.push(entry);
    }

    socket.on("data", (chunk) => { buffer += chunk.toString("latin1"); drain(); });
    socket.once("error", (err) => {
      if (!settled) { settled = true; reject(err); }
    });
    socket.once("close", () => {
      while (lineWaiters.length) lineWaiters.shift()({ line: "* CLOSE", literal: null });
    });

    function readLine() {
      return new Promise((res) => {
        if (lineQueue.length) res(lineQueue.shift());
        else lineWaiters.push(res);
      });
    }
    function send(cmd) { socket.write(cmd + "\r\n"); }

    readLine().then((entry) => {
      if (entry.line.startsWith("* OK")) {
        settled = true;
        resolve({ socket, readLine, send });
      } else {
        settled = true;
        reject(new Error("IMAP greeting: " + entry.line));
      }
    });
  });
}

let _tag = 1;
function runCmd(conn, cmd) {
  const tag = "A" + String(_tag++).padStart(3, "0");
  conn.socket.write(tag + " " + cmd + "\r\n");
  const out = [];
  return (async () => {
    while (true) {
      const entry = await conn.readLine();
      if (entry.line.startsWith(tag + " ")) {
        const ok = /\bOK\b/.test(entry.line.substring(tag.length));
        return { ok, lines: out, final: entry.line };
      }
      out.push(entry);
    }
  })();
}

function quote(s) {
  return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

function stripAngle(nameAddr) {
  if (!nameAddr) return "";
  const m = nameAddr.match(/<([^>]+)>/);
  if (m) return m[1].toLowerCase();
  const m2 = nameAddr.match(/[^\s<>]+@[^\s<>]+/);
  return m2 ? m2[0].toLowerCase() : "";
}

function decodeQP(s) {
  return s.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function parseRfc822(raw) {
  const sep = raw.indexOf("\r\n\r\n");
  const headerRaw = sep >= 0 ? raw.substring(0, sep) : raw;
  let body = sep >= 0 ? raw.substring(sep + 4) : "";
  const headers = {};
  const lines = headerRaw.split(/\r\n/);
  let cur = null;
  for (const l of lines) {
    if (/^[ \t]/.test(l) && cur) headers[cur] += " " + l.trim();
    else {
      const i = l.indexOf(":");
      if (i > 0) { cur = l.substring(0, i).trim().toLowerCase(); headers[cur] = l.substring(i + 1).trim(); }
      else cur = null;
    }
  }
  const cte = (headers["content-transfer-encoding"] || "").toLowerCase();
  if (cte.includes("quoted-printable")) body = decodeQP(body);
  else if (cte.includes("base64")) {
    try { body = Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g, ""), "base64").toString("latin1"); } catch (_) {}
  }
  const text = body.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ");
  return {
    headers,
    text,
    subject: headers["subject"] || "",
    from: stripAngle(headers["from"] || ""),
    to: stripAngle(headers["to"] || ""),
    date: headers["date"] || "",
  };
}

function extractCode(subject, text) {
  const src = (subject || "") + " " + (text || "");
  const patterns = [
    /verification code[^\d]{0,15}(\d{4,8})/i,
    /\bcode\b[^\d]{0,15}(\d{4,8})/i,
    /\b(\d{6})\b/,
    /\b(\d{4,8})\b/,
  ];
  for (const p of patterns) {
    const m = src.match(p);
    if (m) return m[1];
  }
  return null;
}

async function imapFetch(config) {
  const { host, port, username, password, tls: useTls = true, limit = 15 } = config;
  if (!host || !username || !password) return { error: "Missing IMAP credentials" };

  let conn;
  try {
    conn = await openImap({ host, port: port || 993, tls: useTls });
  } catch (e) {
    return { error: "Connection failed: " + e.message };
  }

  try {
    let r = await runCmd(conn, "LOGIN " + quote(username) + " " + quote(password));
    if (!r.ok) return { error: "Login failed: " + r.final };

    r = await runCmd(conn, "SELECT INBOX");
    if (!r.ok) return { error: "Select INBOX failed: " + r.final };

    r = await runCmd(conn, "UID SEARCH UNSEEN");
    if (!r.ok) return { error: "Search failed: " + r.final };
    const searchLine = r.lines.map((e) => e.line).find((l) => l.toUpperCase().startsWith("* SEARCH"));
    const uids = searchLine ? searchLine.replace(/^\* SEARCH/i, "").trim().split(/\s+/).filter(Boolean) : [];
    if (!uids.length) return { messages: [] };

    const recent = uids.slice(-limit);
    const messages = [];

    for (const uid of recent) {
      const fr = await runCmd(conn, "UID FETCH " + uid + " (UID BODY.PEEK[])");
      if (!fr.ok) continue;
      const litEntry = fr.lines.find((e) => e.literal);
      if (!litEntry) continue;
      const parsed = parseRfc822(litEntry.literal);
      const uidLine = fr.lines.find((e) => /UID\s+(\d+)/.test(e.line));
      const uidMatch = uidLine ? uidLine.line.match(/UID\s+(\d+)/) : null;
      const realUid = uidMatch ? uidMatch[1] : uid;
      const code = extractCode(parsed.subject, parsed.text);
      messages.push({
        uid: realUid,
        to: parsed.to,
        from: parsed.from,
        subject: parsed.subject,
        date: parsed.date,
        snippet: parsed.text.slice(0, 200),
        code,
      });
    }

    try { await runCmd(conn, "LOGOUT"); } catch (_) {}
    try { conn.socket.end(); } catch (_) {}
    return { messages };
  } catch (e) {
    try { conn.socket.destroy(); } catch (_) {}
    return { error: e.message };
  }
}

module.exports = { imapFetch };