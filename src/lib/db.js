/**
 * db.js — Local SQLite database abstraction layer
 *
 * In Electron: all DB calls go through IPC to the main process (better-sqlite3).
 * In browser dev mode: uses in-memory store as a fallback.
 *
 * Usage (same API everywhere):
 *   import { db } from "@/lib/db";
 *   db.Proxy.list()
 *   db.Proxy.filter({ is_active: true })
 *   db.Proxy.get(id)
 *   db.Proxy.create(data)
 *   db.Proxy.update(id, data)
 *   db.Proxy.delete(id)
 *   db.Proxy.bulkCreate([...])
 *   db.Proxy.subscribe(callback)   ← in-process pub/sub (no cloud sync)
 */

// ── In-memory fallback for browser dev mode ───────────────────────────────────
const memStore = {};
const memSubs = {};

function memId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function getStore(table) {
  if (!memStore[table]) memStore[table] = [];
  return memStore[table];
}

function notify(table, type, data) {
  (memSubs[table] || []).forEach((cb) => cb({ type, data }));
}

function matchesFilter(record, query) {
  return Object.entries(query).every(([k, v]) => record[k] === v);
}

// ── IPC bridge ────────────────────────────────────────────────────────────────
function isElectron() {
  return typeof window !== "undefined" && !!window.electronAPI;
}

async function ipc(channel, payload) {
  if (!isElectron()) return null;
  try {
    return await window.electronAPI.invoke(channel, payload);
  } catch (e) {
    console.error(`[db] IPC error on ${channel}:`, e);
    return null;
  }
}

// ── Collection factory ────────────────────────────────────────────────────────
function makeCollection(table) {
  return {
    async list(sort = "-created_date", limit = 500) {
      if (isElectron()) {
        const result = await ipc("db:list", { table, sort, limit });
        return Array.isArray(result) ? result : [];
      }
      // memory fallback
      const rows = [...getStore(table)];
      const desc = sort.startsWith("-");
      const key = sort.replace("-", "");
      rows.sort((a, b) => {
        const av = a[key] ?? "", bv = b[key] ?? "";
        return desc ? (bv > av ? 1 : bv < av ? -1 : 0) : (av > bv ? 1 : av < bv ? -1 : 0);
      });
      return rows.slice(0, limit);
    },

    async filter(query = {}, sort = "-created_date", limit = 500) {
      if (isElectron()) {
        const result = await ipc("db:filter", { table, query, sort, limit });
        return Array.isArray(result) ? result : [];
      }
      const rows = getStore(table).filter((r) => matchesFilter(r, query));
      const desc = sort.startsWith("-");
      const key = sort.replace("-", "");
      rows.sort((a, b) => {
        const av = a[key] ?? "", bv = b[key] ?? "";
        return desc ? (bv > av ? 1 : bv < av ? -1 : 0) : (av > bv ? 1 : av < bv ? -1 : 0);
      });
      return rows.slice(0, limit);
    },

    async get(id) {
      if (isElectron()) {
        return ipc("db:get", { table, id });
      }
      return getStore(table).find((r) => r.id === id) || null;
    },

    async create(data) {
      if (isElectron()) {
        const result = await ipc("db:create", { table, data });
        notify(table, "create", result);
        return result;
      }
      const record = { id: memId(), created_date: new Date().toISOString(), updated_date: new Date().toISOString(), ...data };
      getStore(table).unshift(record);
      notify(table, "create", record);
      return record;
    },

    async update(id, data) {
      if (isElectron()) {
        const result = await ipc("db:update", { table, id, data });
        notify(table, "update", result);
        return result;
      }
      const store = getStore(table);
      const idx = store.findIndex((r) => r.id === id);
      if (idx === -1) return null;
      store[idx] = { ...store[idx], ...data, updated_date: new Date().toISOString() };
      notify(table, "update", store[idx]);
      return store[idx];
    },

    async delete(id) {
      if (isElectron()) {
        await ipc("db:delete", { table, id });
        notify(table, "delete", { id });
        return;
      }
      const store = getStore(table);
      const idx = store.findIndex((r) => r.id === id);
      if (idx !== -1) {
        const [deleted] = store.splice(idx, 1);
        notify(table, "delete", deleted);
      }
    },

    async bulkCreate(items) {
      if (isElectron()) {
        const results = await ipc("db:bulkCreate", { table, items });
        results.forEach((r) => notify(table, "create", r));
        return results;
      }
      const created = items.map((data) => ({
        id: memId(), created_date: new Date().toISOString(), updated_date: new Date().toISOString(), ...data,
      }));
      getStore(table).unshift(...created);
      created.forEach((r) => notify(table, "create", r));
      return created;
    },

    async bulkUpdate(items) {
      if (isElectron()) {
        const results = await ipc("db:bulkUpdate", { table, items });
        results.forEach((r) => notify(table, "update", r));
        return results;
      }
      return Promise.all(items.map(({ id, ...data }) => this.update(id, data)));
    },

    async updateMany(query, patch) {
      if (isElectron()) {
        const results = await ipc("db:updateMany", { table, query, patch });
        results.forEach((r) => notify(table, "update", r));
        return results;
      }
      const store = getStore(table);
      const updated = [];
      store.forEach((r, i) => {
        if (matchesFilter(r, query)) {
          store[i] = { ...r, ...patch.$set, updated_date: new Date().toISOString() };
          updated.push(store[i]);
          notify(table, "update", store[i]);
        }
      });
      return updated;
    },

    async deleteMany(query) {
      if (isElectron()) {
        await ipc("db:deleteMany", { table, query });
        return;
      }
      const store = getStore(table);
      const toDelete = store.filter((r) => Object.keys(query).length === 0 || matchesFilter(r, query));
      toDelete.forEach((r) => {
        const idx = store.indexOf(r);
        if (idx !== -1) store.splice(idx, 1);
        notify(table, "delete", r);
      });
    },

    subscribe(callback) {
      if (!memSubs[table]) memSubs[table] = [];
      memSubs[table].push(callback);
      return () => {
        memSubs[table] = memSubs[table].filter((cb) => cb !== callback);
      };
    },
  };
}

export const db = {
  Proxy:          makeCollection("Proxy"),
  ProxyGroup:     makeCollection("ProxyGroup"),
  BrowserSession: makeCollection("BrowserSession"),
  TaskGroup:      makeCollection("TaskGroup"),
  DiscordMonitor: makeCollection("DiscordMonitor"),
  AYCDConfig:     makeCollection("AYCDConfig"),
  SystemLog:      makeCollection("SystemLog"),
  SessionProfile: makeCollection("SessionProfile"),
  ActivityEvent:  makeCollection("ActivityEvent"),
  WalmartAccount:  makeCollection("WalmartAccount"),
  ImapConfig:      makeCollection("ImapConfig"),
  VerificationCode:makeCollection("VerificationCode"),
  WalmartDrop:     makeCollection("WalmartDrop"),
  CaptchaConfig:   makeCollection("CaptchaConfig"),
  DiscordVerify:   makeCollection("DiscordVerify"),
};