import { Navigate, Outlet } from 'react-router-dom';
import { getApiKey } from '../lib/api';

export function AuthGuard() {
  const apiKey = getApiKey();

  if (!apiKey) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
