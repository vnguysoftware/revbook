import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { DashboardPage } from './pages/Dashboard';
import { IssuesPage } from './pages/Issues';
import { IssueDetailPage } from './pages/IssueDetail';
import { UsersPage } from './pages/Users';
import { UserProfilePage } from './pages/UserProfile';
import { EventsPage } from './pages/Events';
import { OnboardingPage } from './pages/Onboarding';
import { AlertsPage } from './pages/Alerts';
import { InsightsPage } from './pages/Insights';
import { MonitorsPage } from './pages/Monitors';
import { WebhookLogsPage } from './pages/WebhookLogs';
import { AccessCheckSetupPage } from './pages/AccessCheckSetup';
import { ApiKeysPage } from './pages/ApiKeys';
import { SettingsPage } from './pages/Settings';
import { AccountSettingsPage } from './pages/AccountSettings';
import { DemoPage } from './pages/Demo';
import { TeamManagementPage } from './pages/TeamManagement';
import { LoginPage } from './pages/Login';
import { SignupPage } from './pages/Signup';
import { AuthGuard } from './components/AuthGuard';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/setup" element={<OnboardingPage />} />
        <Route path="/demo" element={<DemoPage />} />
        <Route element={<AuthGuard />}>
        <Route element={<Layout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/issues" element={<IssuesPage />} />
          <Route path="/issues/:issueId" element={<IssueDetailPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/users/:userId" element={<UserProfilePage />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="/alerts" element={<AlertsPage />} />
          <Route path="/insights" element={<InsightsPage />} />
          <Route path="/monitors" element={<MonitorsPage />} />
          <Route path="/webhook-logs" element={<WebhookLogsPage />} />
          <Route path="/connect-app" element={<AccessCheckSetupPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/account" element={<AccountSettingsPage />} />
          <Route path="/settings/api-keys" element={<ApiKeysPage />} />
          <Route path="/settings/team" element={<TeamManagementPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
