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
/** @type {Record<string, any[]>} */
const memStore = {};
/** @type {Record<string, Array<(event: { type: string, data: any }) => void>>} */
const memSubs = {};

function memId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** @param {string} table */
function getStore(table) {
  if (!memStore[table]) memStore[table] = [];
  return memStore[table];
}

/** @param {string} table @param {string} type @param {any} data */
function notify(table, type, data) {
  (memSubs[table] || []).forEach((cb) => cb({ type, data }));
}

/** @param {Record<string, any>} record @param {Record<string, any>} query */
function matchesFilter(record, query) {
  return Object.entries(query).every(([k, v]) => record[k] === v);
}

// ── IPC bridge ────────────────────────────────────────────────────────────────
function isElectron() {
  return typeof window !== "undefined" && !!(/** @type {any} */ (window)).electronAPI;
}

/** @param {string} channel @param {any} payload */
async function ipc(channel, payload) {
  if (!isElectron()) return null;
  try {
    return await (/** @type {any} */ (window)).electronAPI.invoke(channel, payload);
  } catch (e) {
    console.error(`[db] IPC error on ${channel}:`, e);
    return null;
  }
}

// ── Collection factory ────────────────────────────────────────────────────────
/** @param {string} table */
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

    /** @param {string} id */
    async get(id) {
      if (isElectron()) {
        return ipc("db:get", { table, id });
      }
      return getStore(table).find((r) => r.id === id) || null;
    },

    /** @param {Record<string, any>} data */
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

    /** @param {string} id @param {Record<string, any>} data */
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

    /** @param {string} id */
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

    /** @param {Array<Record<string, any>>} items */
    async bulkCreate(items) {
      if (isElectron()) {
        const results = await ipc("db:bulkCreate", { table, items });
        /** @type {any[]} */ (results).forEach((/** @type {any} */ r) => notify(table, "create", r));
        return results;
      }
      const created = items.map((/** @type {Record<string, any>} */ data) => ({
        id: memId(), created_date: new Date().toISOString(), updated_date: new Date().toISOString(), ...data,
      }));
      getStore(table).unshift(...created);
      created.forEach((/** @type {any} */ r) => notify(table, "create", r));
      return created;
    },

    /** @param {Array<Record<string, any>>} items */
    async bulkUpdate(items) {
      if (isElectron()) {
        const results = await ipc("db:bulkUpdate", { table, items });
        /** @type {any[]} */ (results).forEach((/** @type {any} */ r) => notify(table, "update", r));
        return results;
      }
      return Promise.all(items.map((item) => {
        const { id, ...data } = /** @type {{ id?: string, [key: string]: any }} */ (item);
        return this.update(String(id || ""), data);
      }));
    },

    /** @param {Record<string, any>} query @param {Record<string, any>} patch */
    async updateMany(query, patch) {
      if (isElectron()) {
        const results = await ipc("db:updateMany", { table, query, patch });
        /** @type {any[]} */ (results).forEach((/** @type {any} */ r) => notify(table, "update", r));
        return results;
      }
      const store = getStore(table);
      /** @type {any[]} */
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

    /** @param {Record<string, any>} query */
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

    /** @param {(event: { type: string, data: any }) => void} callback */
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