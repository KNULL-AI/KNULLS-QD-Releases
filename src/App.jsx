import { Toaster } from "react-hot-toast"
import { useEffect, useRef } from "react"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { HashRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import ScrollToTop from './components/ScrollToTop';
import AppLayout from '@/components/layout/AppLayout';
import Dashboard from '@/pages/Dashboard';
import Proxies from '@/pages/Proxies';
import Sessions from '@/pages/Sessions';
import DiscordMonitor from '@/pages/DiscordMonitor';
import Accounts from '@/pages/Accounts';
import TaskGroups from '@/pages/TaskGroups';
import CaptchaSolver from '@/pages/CaptchaSolver';
import Logs from '@/pages/Logs';
import SessionProfiles from '@/pages/SessionProfiles';
import Settings from '@/pages/Settings';
import Activate from '@/pages/Activate';
import toast from 'react-hot-toast';
import { onImapPollEvent, offImapPollEvent } from '@/lib/electronBridge';
import { db } from '@/lib/db';
import { connectTriggerBus } from '@/lib/triggerBus';
import { prewarmTaskLaunchPath, runTaskGroup } from '@/lib/taskGroupLauncher';

const VERBOSE_APP_LOGS = import.meta.env.DEV || String(import.meta.env.VITE_VERBOSE_APP_LOGS || '').toLowerCase() === 'true';
const TRIGGER_BURST_DEDUPE_MS = Number(import.meta.env.VITE_TRIGGER_BURST_DEDUPE_MS || 12000);
const FALLBACK_TRIGGER_WS_URL = (
  import.meta.env.VITE_TRIGGER_WS_URL
  || import.meta.env.VITE_TRIGGER_API_BASE
  || 'https://knull-trigger-auth.sloanbrack.workers.dev'
).trim();

function appDebug(...args) {
  if (VERBOSE_APP_LOGS) {
    console.log(...args);
  }
}

function normalizeRetailerKey(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  const compact = raw.replace(/[\s_]+/g, '-');
  if (compact === 'queue' || compact === 'security') return 'pokemon-center';
  if (compact === 'pokemoncenter' || compact === 'pokemon-center') return 'pokemon-center';
  return compact;
}

function inferRetailerKey(group) {
  const normalized = normalizeRetailerKey(group?.retailer || '');
  if (normalized) return normalized;

  const url = String(group?.target_url || '').toLowerCase();
  const name = String(group?.name || '').toLowerCase();
  const hintRaw = `${name} ${url}`;
  const hintCompact = hintRaw.replace(/[^a-z0-9]+/g, '');

  if (hintRaw.includes('pokemon-center') || hintRaw.includes('pokemon center') || hintCompact.includes('pokemoncenter')) {
    return 'pokemon-center';
  }
  if (hintRaw.includes('costco') || hintCompact.includes('costco')) return 'costco';
  if (hintRaw.includes('walmart') || hintCompact.includes('walmart')) return 'walmart';
  return '';
}

function AppContent() {
  const { isAuthenticated, authSession, getValidAccessToken } = useAuth();
  const taskGroupsByRetailerRef = useRef(new Map());
  const recentTriggerFingerprintsRef = useRef(new Map());
  const getValidAccessTokenRef = useRef(getValidAccessToken);
  const activeBusStopRef = useRef(null);

  useEffect(() => {
    getValidAccessTokenRef.current = getValidAccessToken;
  }, [getValidAccessToken]);

  const shouldSuppressBurstTrigger = (event, retailer) => {
    const now = Date.now();
    const seen = recentTriggerFingerprintsRef.current;

    for (const [key, ts] of seen.entries()) {
      if (now - ts > TRIGGER_BURST_DEDUPE_MS) {
        seen.delete(key);
      }
    }

    const fingerprint = [
      retailer,
      String(event?.type || '').toLowerCase(),
      String(event?.title || '').toLowerCase(),
      String(event?.url || '').toLowerCase(),
    ].join('::');

    const prev = seen.get(fingerprint);
    if (prev && (now - prev) <= TRIGGER_BURST_DEDUPE_MS) {
      return true;
    }

    seen.set(fingerprint, now);
    return false;
  };

  const indexTaskGroups = (groups) => {
    const next = new Map();
    for (const group of Array.isArray(groups) ? groups : []) {
      const retailer = inferRetailerKey(group);
      if (!retailer) continue;
      if (!next.has(retailer)) next.set(retailer, []);
      next.get(retailer).push(group);
    }
    taskGroupsByRetailerRef.current = next;
    return next;
  };

  const refreshTaskGroupIndex = async () => {
    const groups = await db.TaskGroup.list();
    return indexTaskGroups(groups);
  };

  // Global IMAP poll listener — persists across page navigation and routes
  // so the user sees real-time verification code updates no matter which page they're on
  useEffect(() => {
    appDebug("[knull-app] setting up global IMAP poll listener");
    const wrapper = onImapPollEvent((evt) => {
      appDebug("[knull-app] received imap-poll-event:", evt.type, evt);
      if (evt.type === "error") {
        toast.error(`IMAP: ${evt.error}`, { duration: 4000 });
        return;
      }
      if (evt.type === "result") {
        if (evt.newCodes?.length) {
          appDebug("[knull-app] showing toast for", evt.newCodes.length, "new codes");
          toast.success(`${evt.newCodes.length} new verification code${evt.newCodes.length !== 1 ? "s" : ""}`);
        }
      }
    });
    // Never clean up this listener — it should stay active for the lifetime of the app
    return () => {
      appDebug("[knull-app] removing global IMAP poll listener");
      offImapPollEvent(wrapper);
    };
  }, []);

  useEffect(() => {
    let stopBus = null;
    let cancelled = false;
    let stopTaskGroupSub = null;

    const startBus = async () => {
      if (!isAuthenticated) return;

      await Promise.allSettled([
        prewarmTaskLaunchPath(),
        refreshTaskGroupIndex(),
      ]);

      stopTaskGroupSub = db.TaskGroup.subscribe(() => {
        refreshTaskGroupIndex().catch(() => {});
      });

      const wsUrl = authSession?.ws_url || FALLBACK_TRIGGER_WS_URL;
      if (!wsUrl) return;

      const accessToken = await getValidAccessTokenRef.current();
      if (!accessToken || cancelled) return;

      // Ensure only one live trigger-bus subscription exists in this renderer.
      if (activeBusStopRef.current) {
        try {
          activeBusStopRef.current();
        } catch {
          // Ignore teardown race from a stale effect pass.
        }
        activeBusStopRef.current = null;
      }

      stopBus = connectTriggerBus({
        wsUrl,
        accessToken,
        onStatus: (status) => {
          if (status === 'connected') {
            appDebug('[trigger-bus] connected');
          }
          if (status === 'reconnecting') {
            appDebug('[trigger-bus] reconnecting');
          }
        },
        onTrigger: async (event, ack) => {
          const retailer = normalizeRetailerKey(event?.retailer || event?.type || '');
          if (!retailer) {
            ack('ignored', 'Missing retailer/type');
            return;
          }

          if (shouldSuppressBurstTrigger(event, retailer)) {
            ack('ignored', 'Duplicate trigger suppressed');
            return;
          }

          appDebug('[trigger-bus] trigger received:', {
            retailer,
            trigger_id: event?.trigger_id || null,
            source_message_id: event?.source_message_id || null,
            url: event?.url || null,
            type: event?.type || null,
          });

          let matching = taskGroupsByRetailerRef.current.get(retailer) || [];
          if (!matching.length) {
            const indexed = await refreshTaskGroupIndex();
            matching = indexed.get(retailer) || [];
          }
          if (!matching.length) {
            ack('ignored', `No local task groups for ${retailer}`);
            return;
          }

          let launchedCount = 0;
          try {
            for (const group of matching) {
              let nextGroup = group;
              if (event.url && (retailer === 'walmart' || retailer === 'costco')) {
                await db.TaskGroup.update(group.id, { target_url: event.url });
                nextGroup = { ...group, target_url: event.url };
                group.target_url = event.url;
              }

              appDebug('[trigger-bus] launching task group:', {
                group_id: group.id,
                name: group.name,
                retailer: group.retailer,
                target_url: nextGroup.target_url,
                instance_count: nextGroup.instance_count,
                account_ids: Array.isArray(nextGroup.account_ids) ? nextGroup.account_ids.length : 0,
              });

              const launched = await runTaskGroup(nextGroup);
              launchedCount += launched;
              appDebug('[trigger-bus] launch complete:', {
                group_id: group.id,
                launched,
                total_launched: launchedCount,
              });
            }
          } catch (error) {
            console.error('[trigger-bus] launch failed:', error);
            toast.error(`Launch failed: ${error?.message || 'unknown error'}`);
            ack('error', error?.message || 'Trigger handling failed');
            return;
          }

          toast.success(`[Bus] ${retailer} trigger launched ${launchedCount} instance${launchedCount !== 1 ? 's' : ''}`);
          ack('ok', `launched:${launchedCount}`);
        },
      });

      activeBusStopRef.current = stopBus;
    };

    startBus();

    return () => {
      cancelled = true;
      if (stopTaskGroupSub) stopTaskGroupSub();
      if (stopBus) stopBus();
      if (activeBusStopRef.current === stopBus) {
        activeBusStopRef.current = null;
      }
    };
  }, [isAuthenticated, authSession?.ws_url]);

  return (
    <QueryClientProvider client={queryClientInstance}>
      <Router>
        <ScrollToTop />
        <Routes>
          {isAuthenticated ? (
            <>
              <Route element={<AppLayout />}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/proxies" element={<Proxies />} />
                <Route path="/sessions" element={<Sessions />} />
                <Route path="/discord" element={<DiscordMonitor />} />
                <Route path="/accounts" element={<Accounts />} />
                <Route path="/task-groups" element={<TaskGroups />} />
                <Route path="/captcha" element={<CaptchaSolver />} />
                <Route path="/logs" element={<Logs />} />
                <Route path="/profiles" element={<SessionProfiles />} />
                <Route path="/settings" element={<Settings />} />
              </Route>
              <Route path="/activate" element={<Navigate to="/" replace />} />
              <Route path="*" element={<PageNotFound />} />
            </>
          ) : (
            <>
              <Route path="/activate" element={<Activate />} />
              <Route path="*" element={<Activate />} />
            </>
          )}
        </Routes>
      </Router>
      <Toaster position="bottom-right" toastOptions={{ style: { background: '#1a1a2e', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.08)', fontFamily: 'monospace', fontSize: '13px' } }} />
    </QueryClientProvider>
  )
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App