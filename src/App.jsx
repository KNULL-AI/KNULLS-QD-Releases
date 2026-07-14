import { Toaster } from "react-hot-toast"
import { useEffect } from "react"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { HashRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider } from '@/lib/AuthContext';
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
import toast from 'react-hot-toast';
import { onImapPollEvent, offImapPollEvent } from '@/lib/electronBridge';

function App() {
  // Global IMAP poll listener — persists across page navigation and routes
  // so the user sees real-time verification code updates no matter which page they're on
  useEffect(() => {
    const wrapper = onImapPollEvent((evt) => {
      if (evt.type === "error") {
        toast.error(`IMAP: ${evt.error}`, { duration: 4000 });
        return;
      }
      if (evt.type === "result") {
        if (evt.newCodes?.length) {
          toast.success(`${evt.newCodes.length} new verification code${evt.newCodes.length !== 1 ? "s" : ""}`);
        }
      }
    });
    // Never clean up this listener — it should stay active for the lifetime of the app
    return () => offImapPollEvent(wrapper);
  }, []);

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          <Routes>
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
            <Route path="*" element={<PageNotFound />} />
          </Routes>
        </Router>
        <Toaster position="bottom-right" toastOptions={{ style: { background: '#1a1a2e', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.08)', fontFamily: 'monospace', fontSize: '13px' } }} />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App