import { db } from "@/lib/db";
import { launchBrowser } from "@/lib/electronBridge";

const LAUNCH_CACHE_TTL_MS = 3000;
const launchCache = {
  expiresAt: 0,
  proxiesById: new Map(),
  proxyGroupsById: new Map(),
  walmartAccounts: [],
};

async function loadLaunchCache(force = false) {
  const now = Date.now();
  if (!force && now < launchCache.expiresAt && launchCache.proxiesById.size) {
    return launchCache;
  }

  const [proxies, proxyGroups, walmartAccounts] = await Promise.all([
    db.Proxy.list().catch(() => []),
    db.ProxyGroup.list().catch(() => []),
    db.WalmartAccount.list().catch(() => []),
  ]);

  launchCache.proxiesById = new Map((Array.isArray(proxies) ? proxies : []).map((proxy) => [proxy.id, proxy]));
  launchCache.proxyGroupsById = new Map((Array.isArray(proxyGroups) ? proxyGroups : []).map((group) => [group.id, group]));
  launchCache.walmartAccounts = Array.isArray(walmartAccounts) ? walmartAccounts : [];
  launchCache.expiresAt = now + LAUNCH_CACHE_TTL_MS;

  return launchCache;
}

export async function prewarmTaskLaunchPath() {
  await loadLaunchCache(true);
}

function pickProxy(proxies, mode, index) {
  if (!proxies.length) return null;
  if (mode === "random") return proxies[Math.floor(Math.random() * proxies.length)];
  return proxies[index % proxies.length];
}

const normalizeId = (id) => (id == null ? "" : String(id));

const resolveAssignedAccounts = (taskGroup, allAccounts) => {
  const rawIds = Array.isArray(taskGroup.account_ids)
    ? taskGroup.account_ids
    : typeof taskGroup.account_ids === "string"
      ? (() => { try { return JSON.parse(taskGroup.account_ids); } catch { return []; } })()
      : [];

  const desiredIds = Array.isArray(rawIds) ? rawIds.map(normalizeId) : [];
  return (Array.isArray(allAccounts) ? allAccounts : []).filter((account) => desiredIds.includes(normalizeId(account.id)));
};

async function resolveProxyForAccount(account, groupProxies, cache) {
  if (account.proxy_assignment_type === "single" && account.proxy_id) {
    const cached = cache?.proxiesById?.get(account.proxy_id) || null;
    const proxy = cached || await db.Proxy.get(account.proxy_id).catch(() => null);
    if (proxy?.id && cache?.proxiesById) cache.proxiesById.set(proxy.id, proxy);
    if (proxy) return proxy;
  }

  if (account.proxy_assignment_type === "group" && account.proxy_group_id) {
    const cachedGroup = cache?.proxyGroupsById?.get(account.proxy_group_id) || null;
    const proxyGroup = cachedGroup || await db.ProxyGroup.get(account.proxy_group_id).catch(() => null);
    if (proxyGroup?.id && cache?.proxyGroupsById) cache.proxyGroupsById.set(proxyGroup.id, proxyGroup);
    if (proxyGroup?.proxy_ids?.length) {
      const proxies = await Promise.all(proxyGroup.proxy_ids.map(async (id) => {
        const cachedProxy = cache?.proxiesById?.get(id) || null;
        if (cachedProxy) return cachedProxy;
        const fetched = await db.Proxy.get(id).catch(() => null);
        if (fetched?.id && cache?.proxiesById) cache.proxiesById.set(fetched.id, fetched);
        return fetched;
      }));
      const found = proxies.find(Boolean);
      if (found) return found;
    }
  }

  return groupProxies.length ? groupProxies[0] : null;
}

export async function runTaskGroup(taskGroup) {
  const cache = await loadLaunchCache();

  let proxies = [];
  if (taskGroup.proxy_group_id) {
    const proxyGroup = cache.proxyGroupsById.get(taskGroup.proxy_group_id) || await db.ProxyGroup.get(taskGroup.proxy_group_id);
    if (proxyGroup?.proxy_ids?.length) {
      const fetched = await Promise.all(proxyGroup.proxy_ids.map(async (id) => {
        const cachedProxy = cache.proxiesById.get(id) || null;
        if (cachedProxy) return cachedProxy;
        const proxy = await db.Proxy.get(id).catch(() => null);
        if (proxy?.id) cache.proxiesById.set(proxy.id, proxy);
        return proxy;
      }));
      proxies = fetched.filter(Boolean);
    }
  }

  const isWalmart = (taskGroup.retailer || "").toLowerCase() === "walmart";
  let assignedAccounts = [];

  if (isWalmart && taskGroup.account_ids?.length) {
    const allAccounts = cache.walmartAccounts.length ? cache.walmartAccounts : await db.WalmartAccount.list().catch(() => []);
    assignedAccounts = resolveAssignedAccounts(taskGroup, allAccounts);
  }

  const now = new Date().toISOString();

  if (assignedAccounts.length) {
    const launchUrl = taskGroup.target_url;
    const sessions = [];

    for (const account of assignedAccounts) {
      const proxy = await resolveProxyForAccount(account, proxies, cache);
      const session = await db.BrowserSession.create({
        name: `[AUTO] ${taskGroup.name} - ${account.label}`,
        target_url: taskGroup.target_url,
        proxy_id: proxy?.id || null,
        proxy_label: proxy ? `${proxy.host}:${proxy.port}` : "No proxy",
        status: "running",
        rotation_mode: taskGroup.rotation_mode || "round_robin",
        user_agent: taskGroup.user_agent || null,
        browser: taskGroup.browser || "chrome",
        started_at: now,
        walmart_account_id: account.id,
        walmart_account_email: account.email,
      });

      await launchBrowser({
        sessionId: session.id,
        url: launchUrl,
        proxy,
        userAgent: taskGroup.user_agent || null,
        browser: taskGroup.browser || "chrome",
        manualOpen: true,
        credentials: null,
        partitionKey: `walmart-account-${account.id}`,
      });

      sessions.push(session);
      await db.WalmartAccount.update(account.id, { last_used: now }).catch(() => {});
      if (taskGroup.delay_ms > 0 && sessions.length < assignedAccounts.length) {
        await new Promise((resolve) => setTimeout(resolve, taskGroup.delay_ms));
      }
    }

    return sessions.length;
  }

  const count = taskGroup.instance_count || 1;
  const mode = taskGroup.rotation_mode || "round_robin";
  const assignedProxies = Array.from({ length: count }, (_, i) => pickProxy(proxies, mode, i));

  const sessions = await db.BrowserSession.bulkCreate(
    assignedProxies.map((proxy, i) => ({
      name: `[AUTO] ${taskGroup.name} #${i + 1}`,
      target_url: taskGroup.target_url,
      proxy_id: proxy?.id || null,
      proxy_label: proxy ? `${proxy.host}:${proxy.port}` : "No proxy",
      status: "running",
      rotation_mode: mode,
      user_agent: taskGroup.user_agent || null,
      browser: taskGroup.browser || "chrome",
      started_at: now,
    }))
  );

  for (let i = 0; i < sessions.length; i++) {
    launchBrowser({
      sessionId: sessions[i].id,
      url: taskGroup.target_url,
      proxy: assignedProxies[i],
      userAgent: taskGroup.user_agent || null,
      browser: taskGroup.browser || "chrome",
    });

    if (taskGroup.delay_ms > 0 && i < sessions.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, taskGroup.delay_ms));
    }
  }

  return count;
}
