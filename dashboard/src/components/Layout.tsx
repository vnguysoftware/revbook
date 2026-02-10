import { useState } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { getApiKey, setApiKey, DEMO_API_KEY, fetcher } from '../lib/api';
import {
  LayoutDashboard,
  AlertTriangle,
  Users,
  Activity,
  Settings,
  Bell,
  Sparkles,
  Radar,
  FileText,
  Menu,
  X,
  ChevronDown,
  Shield,
  LogOut,
  User,
} from 'lucide-react';
import clsx from 'clsx';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/issues', icon: AlertTriangle, label: 'Issues' },
  { to: '/users', icon: Users, label: 'Users' },
  { to: '/events', icon: Activity, label: 'Events' },
  { to: '/alerts', icon: Bell, label: 'Alerts' },
  { to: '/insights', icon: Sparkles, label: 'Insights' },
  { to: '/monitors', icon: Radar, label: 'Monitors' },
  { to: '/webhook-logs', icon: FileText, label: 'Webhook Logs' },
];

export function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const isDemo = getApiKey() === DEMO_API_KEY;
  const { data: issuesSummary } = useSWR<{ open: number }>(
    getApiKey() ? '/issues/summary' : null,
    fetcher,
    { refreshInterval: 30000 },
  );

  function handleLogout() {
    setApiKey('');
    localStorage.removeItem('revback_api_key');
    navigate('/login');
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-50 w-60 bg-sidebar text-gray-300 flex flex-col transition-transform duration-200 lg:relative lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Logo area */}
        <div className="px-5 py-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center">
              <Shield size={16} className="text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold text-white tracking-tight">RevBack</h1>
              <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wider">
                Billing Issue Detection
              </p>
            </div>
          </div>
          {/* Organization name */}
          <div className="mt-3 px-2 py-1.5 rounded-md bg-sidebar-lighter text-xs text-gray-400 truncate">
            Acme Corp
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          <p className="px-3 pb-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
            Monitor
          </p>
          {navItems.map(({ to, icon: Icon, label }) => {
            const isActive =
              to === '/'
                ? location.pathname === '/'
                : location.pathname.startsWith(to);

            return (
              <NavLink
                key={to}
                to={to}
                onClick={() => setMobileOpen(false)}
                className={clsx(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
                  isActive
                    ? 'bg-white/10 text-white shadow-sm'
                    : 'hover:bg-white/5 hover:text-white text-gray-400',
                )}
              >
                <Icon size={18} className={isActive ? 'text-brand-500' : ''} />
                {label}
                {label === 'Issues' && issuesSummary && issuesSummary.open > 0 && (
                  <span className="ml-auto bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                    {issuesSummary.open}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* User/settings area */}
        <div className="border-t border-white/10 p-3">
          <NavLink
            to="/setup"
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 mb-2',
                isActive
                  ? 'bg-white/10 text-white'
                  : 'hover:bg-white/5 hover:text-white text-gray-400',
              )
            }
          >
            <Settings size={18} />
            Setup
          </NavLink>

          {/* User dropdown */}
          <div className="relative">
            <button
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/5 transition-colors"
            >
              <div className="w-7 h-7 rounded-full bg-brand-600 flex items-center justify-center text-white text-xs font-bold">
                A
              </div>
              <div className="flex-1 text-left min-w-0">
                <p className="text-xs font-medium text-gray-200 truncate">Admin</p>
                <p className="text-[10px] text-gray-500 truncate">admin@acme.com</p>
              </div>
              <ChevronDown
                size={14}
                className={clsx(
                  'text-gray-500 transition-transform',
                  userMenuOpen && 'rotate-180',
                )}
              />
            </button>

            {userMenuOpen && (
              <div className="absolute bottom-full left-0 right-0 mb-1 bg-sidebar-lighter rounded-lg border border-white/10 shadow-xl overflow-hidden">
                <button
                  onClick={() => {
                    setUserMenuOpen(false);
                    navigate('/settings/account');
                  }}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
                >
                  <User size={14} />
                  Account Settings
                </button>
                <button
                  onClick={() => {
                    setUserMenuOpen(false);
                    handleLogout();
                  }}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-gray-400 hover:text-white hover:bg-white/5 transition-colors border-t border-white/5"
                >
                  <LogOut size={14} />
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile header */}
        <div className="lg:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-1.5 rounded-md hover:bg-gray-100 transition-colors"
          >
            <Menu size={20} className="text-gray-600" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center">
              <Shield size={12} className="text-white" />
            </div>
            <span className="text-sm font-bold text-gray-900">RevBack</span>
          </div>
        </div>

        {/* Demo banner */}
        {isDemo && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-center text-sm text-amber-700">
            You're viewing demo data
          </div>
        )}

        {/* Scrollable content */}
        <main className="flex-1 overflow-auto bg-gray-50">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
