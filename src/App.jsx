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
import { useTriggerListener } from '@/lib/useTriggerListener';

function AppContent() {
  const { isAuthenticated, authSession, getValidAccessToken } = useAuth();
  const taskGroupsByRetailerRef = useRef(new Map());

  const indexTaskGroups = (groups) => {
    const next = new Map();
    for (const group of Array.isArray(groups) ? groups : []) {
      const retailer = String(group?.retailer || '').toLowerCase();
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
    console.log("[knull-app] setting up global IMAP poll listener");
    const wrapper = onImapPollEvent((evt) => {
      console.log("[knull-app] received imap-poll-event:", evt.type, evt);
      if (evt.type === "error") {
        toast.error(`IMAP: ${evt.error}`, { duration: 4000 });
        return;
      }
      if (evt.type === "result") {
        if (evt.newCodes?.length) {
          console.log("[knull-app] showing toast for", evt.newCodes.length, "new codes");
          toast.success(`${evt.newCodes.length} new verification code${evt.newCodes.length !== 1 ? "s" : ""}`);
        }
      }
    });
    // Never clean up this listener — it should stay active for the lifetime of the app
    return () => {
      console.log("[knull-app] removing global IMAP poll listener");
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

      const wsUrl = authSession?.ws_url || import.meta.env.VITE_TRIGGER_WS_URL || '';
      if (!wsUrl) return;

      const accessToken = await getValidAccessToken();
      if (!accessToken || cancelled) return;

      stopBus = connectTriggerBus({
        wsUrl,
        accessToken,
        onStatus: (status) => {
          if (status === 'connected') {
            console.log('[trigger-bus] connected');
          }
          if (status === 'reconnecting') {
            console.log('[trigger-bus] reconnecting');
          }
        },
        onTrigger: async (event, ack) => {
          const retailer = String(event?.retailer || event?.type || '').toLowerCase();
          if (!retailer) {
            ack('ignored', 'Missing retailer/type');
            return;
          }

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
          for (const group of matching) {
            let nextGroup = group;
            if (event.url && (retailer === 'walmart' || retailer === 'costco')) {
              await db.TaskGroup.update(group.id, { target_url: event.url });
              nextGroup = { ...group, target_url: event.url };
              group.target_url = event.url;
            }
            launchedCount += await runTaskGroup(nextGroup);
          }

          toast.success(`[Bus] ${retailer} trigger launched ${launchedCount} instance${launchedCount !== 1 ? 's' : ''}`);
          ack('ok', `launched:${launchedCount}`);
        },
      });
    };

    startBus();

    return () => {
      cancelled = true;
      if (stopTaskGroupSub) stopTaskGroupSub();
      if (stopBus) stopBus();
    };
  }, [isAuthenticated, authSession?.ws_url, getValidAccessToken]);

  // Listen for global Discord trigger events and auto-launch task groups
  const accessToken = isAuthenticated ? authSession?.access_token : null;
  useTriggerListener(accessToken);

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