import { Outlet } from 'react-router-dom';

// Standalone Electron app — no auth gate needed, all routes are accessible
export default function ProtectedRoute() {
  return <Outlet />;
}