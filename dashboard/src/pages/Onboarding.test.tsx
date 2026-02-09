import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { OnboardingPage } from './Onboarding';

// ─── Mocks ──────────────────────────────────────────────────────────

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('../lib/api', () => ({
  getApiKey: vi.fn(() => ''),
  setApiKey: vi.fn(),
}));

// ─── Helpers ────────────────────────────────────────────────────────

function renderOnboarding() {
  return render(
    <MemoryRouter>
      <OnboardingPage />
    </MemoryRouter>,
  );
}

function mockFetch(handler: (url: string, opts?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = vi.fn(handler) as Mock;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── Tests ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.restoreAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  localStorage.clear();
  mockNavigate.mockReset();
  // Default: no pre-existing key, all fetches fail gracefully
  mockFetch(() => jsonResponse({ error: 'not configured' }, 500));
});

describe('OnboardingPage', () => {
  describe('initial render', () => {
    it('renders hero copy', () => {
      renderOnboarding();
      expect(screen.getByText('Defend every dollar')).toBeInTheDocument();
      expect(screen.getByText(/Connect your billing systems/)).toBeInTheDocument();
    });

    it('renders Section 1 (Get Started) by default', () => {
      renderOnboarding();
      expect(screen.getByText('Get Started')).toBeInTheDocument();
      expect(screen.getByText('Create new')).toBeInTheDocument();
      expect(screen.getByText('I have an API key')).toBeInTheDocument();
    });

    it('does not render later sections initially', () => {
      renderOnboarding();
      expect(screen.queryByText('Connect Billing')).not.toBeInTheDocument();
      expect(screen.queryByText('Import & Discover')).not.toBeInTheDocument();
      expect(screen.queryByText('Your First Look')).not.toBeInTheDocument();
    });

    it('does not show Go to Dashboard before auth', () => {
      renderOnboarding();
      expect(screen.queryByText('Go to Dashboard')).not.toBeInTheDocument();
    });
  });

  describe('Section 1: Create org flow', () => {
    it('shows company name input in create mode', () => {
      renderOnboarding();
      expect(screen.getByPlaceholderText('Acme Corp')).toBeInTheDocument();
      expect(screen.getByText('Create & Continue')).toBeInTheDocument();
    });

    it('shows validation error for empty name', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderOnboarding();

      // The button should be disabled when name is empty
      const button = screen.getByText('Create & Continue').closest('button')!;
      expect(button).toBeDisabled();
    });

    it('creates org and shows API key', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mockFetch((url) => {
        if (url === '/setup/org') {
          return jsonResponse({
            organization: { id: '1', name: 'Test Co', slug: 'test-co' },
            apiKey: 'rev_testkey123',
            webhookBaseUrl: '/webhooks/test-co',
          }, 201);
        }
        return jsonResponse({ error: 'not found' }, 404);
      });

      renderOnboarding();
      await user.type(screen.getByPlaceholderText('Acme Corp'), 'Test Co');
      await user.click(screen.getByText('Create & Continue'));

      await waitFor(() => {
        expect(screen.getByText('Organization created')).toBeInTheDocument();
      });
      expect(screen.getByText('rev_testkey123')).toBeInTheDocument();
      expect(screen.getByText("Save your API key — it won't be shown again.")).toBeInTheDocument();
    });

    it('shows error on org creation failure', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mockFetch((url) => {
        if (url === '/setup/org') {
          return jsonResponse({ error: 'Slug already taken' }, 409);
        }
        return jsonResponse({}, 500);
      });

      renderOnboarding();
      await user.type(screen.getByPlaceholderText('Acme Corp'), 'Existing Co');
      await user.click(screen.getByText('Create & Continue'));

      await waitFor(() => {
        expect(screen.getByText('Slug already taken')).toBeInTheDocument();
      });
    });

    it('advances to connect phase after continuing from created key', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mockFetch((url) => {
        if (url === '/setup/org') {
          return jsonResponse({
            organization: { id: '1', name: 'Test Co', slug: 'test-co' },
            apiKey: 'rev_testkey123',
            webhookBaseUrl: '/webhooks/test-co',
          }, 201);
        }
        return jsonResponse({}, 500);
      });

      renderOnboarding();
      await user.type(screen.getByPlaceholderText('Acme Corp'), 'Test Co');
      await user.click(screen.getByText('Create & Continue'));

      await waitFor(() => {
        expect(screen.getByText('Organization created')).toBeInTheDocument();
      });

      // Click Continue button to advance
      await user.click(screen.getByRole('button', { name: /continue/i }));

      await waitFor(() => {
        expect(screen.getByText('Connect Billing')).toBeInTheDocument();
      });
    });
  });

  describe('Section 1: Existing API key flow', () => {
    it('switches to API key input mode', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderOnboarding();

      await user.click(screen.getByText('I have an API key'));
      expect(screen.getByPlaceholderText('rev_...')).toBeInTheDocument();
      expect(screen.getByText('Connect')).toBeInTheDocument();
    });

    it('authenticates with valid key and advances', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mockFetch((url) => {
        if (url === '/setup/status') {
          return jsonResponse({
            integrations: [],
            stats: { eventsProcessed: 0 },
            readiness: { hasConnection: false, isReady: false },
            backfill: null,
          });
        }
        return jsonResponse({}, 500);
      });

      renderOnboarding();
      await user.click(screen.getByText('I have an API key'));
      await user.type(screen.getByPlaceholderText('rev_...'), 'rev_validkey');
      await user.click(screen.getByText('Connect'));

      await waitFor(() => {
        expect(screen.getByText('Connect Billing')).toBeInTheDocument();
      });
    });

    it('shows error for invalid key', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mockFetch(() => jsonResponse({ error: 'Invalid API key' }, 401));

      renderOnboarding();
      await user.click(screen.getByText('I have an API key'));
      await user.type(screen.getByPlaceholderText('rev_...'), 'rev_badkey');
      await user.click(screen.getByText('Connect'));

      await waitFor(() => {
        expect(screen.getByText('Invalid API key')).toBeInTheDocument();
      });
    });
  });

  describe('Section 2: Connect Billing', () => {
    async function advanceToConnect() {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mockFetch((url) => {
        if (url === '/setup/org') {
          return jsonResponse({
            organization: { id: '1', name: 'Co', slug: 'co' },
            apiKey: 'rev_key1',
            webhookBaseUrl: '/webhooks/co',
          }, 201);
        }
        return jsonResponse({}, 500);
      });

      renderOnboarding();
      await user.type(screen.getByPlaceholderText('Acme Corp'), 'Co');
      await user.click(screen.getByText('Create & Continue'));
      await waitFor(() => expect(screen.getByText('Organization created')).toBeInTheDocument());
      await user.click(screen.getByRole('button', { name: /continue/i }));
      await waitFor(() => expect(screen.getByText('Connect Billing')).toBeInTheDocument());
      return user;
    }

    it('shows provider selector with Stripe/Apple/Both', async () => {
      await advanceToConnect();
      expect(screen.getByText('Stripe')).toBeInTheDocument();
      expect(screen.getByText('Apple')).toBeInTheDocument();
      expect(screen.getByText('Both')).toBeInTheDocument();
    });

    it('shows Stripe key input by default', async () => {
      await advanceToConnect();
      expect(screen.getByPlaceholderText('sk_live_...')).toBeInTheDocument();
    });

    it('shows Apple fields when Apple is selected', async () => {
      const user = await advanceToConnect();

      // Reconfigure fetch for connect phase
      mockFetch(() => jsonResponse({}, 500));

      await user.click(screen.getByText('Apple'));
      expect(screen.getByPlaceholderText('ABC1234567')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('xxxxxxxx-xxxx-...')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('com.yourcompany.app')).toBeInTheDocument();
    });

    it('shows verification checklist on Stripe connect', async () => {
      const user = await advanceToConnect();

      mockFetch((url) => {
        if (typeof url === 'string' && url.includes('/setup/stripe')) {
          return jsonResponse({ connected: true });
        }
        if (typeof url === 'string' && url.includes('/setup/verify/stripe')) {
          return jsonResponse({
            checks: {
              apiKeyValid: true,
              canListCustomers: true,
              canListSubscriptions: true,
              customerCount: 1247,
              subscriptionCount: 892,
              webhookSecretConfigured: true,
            },
          });
        }
        return jsonResponse({}, 500);
      });

      await user.type(screen.getByPlaceholderText('sk_live_...'), 'sk_test_key');
      await user.click(screen.getByRole('button', { name: 'Connect' }));

      // Advance timers to cover the staggered delays (400 + 500 + 500 + 600 = 2000ms)
      await vi.advanceTimersByTimeAsync(3000);

      await waitFor(() => {
        expect(screen.getByText('API key validated')).toBeInTheDocument();
      });

      await waitFor(() => {
        expect(screen.getByText('Can access customer data')).toBeInTheDocument();
      });

      await waitFor(() => {
        expect(screen.getByText(/Found.*1,247.*customers/)).toBeInTheDocument();
      });

      await waitFor(() => {
        expect(screen.getByText(/Found.*892.*active subscriptions/)).toBeInTheDocument();
      });

      await waitFor(() => {
        expect(screen.getByText('Webhook endpoint configured')).toBeInTheDocument();
        expect(screen.getByText('Ready to import.')).toBeInTheDocument();
      });
    });

    it('shows error on Stripe connect failure', async () => {
      const user = await advanceToConnect();

      mockFetch(() => jsonResponse({ error: 'Invalid Stripe key' }, 400));

      await user.type(screen.getByPlaceholderText('sk_live_...'), 'sk_test_bad');
      await user.click(screen.getByRole('button', { name: 'Connect' }));

      await vi.advanceTimersByTimeAsync(500);

      await waitFor(() => {
        // Error appears in both checklist detail and error box
        const errors = screen.getAllByText('Invalid Stripe key');
        expect(errors.length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe('Section 3: Import & Discover', () => {
    it('shows import prompt with Start and Skip buttons', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      // Simulate being at the import phase by using existing key + auto-advance
      const { getApiKey } = await import('../lib/api');
      (getApiKey as Mock).mockReturnValue('rev_existing');

      mockFetch((url) => {
        if (typeof url === 'string' && url.includes('/setup/status')) {
          return jsonResponse({
            integrations: [{ provider: 'stripe', connected: true }],
            stats: { eventsProcessed: 0 },
            readiness: { hasConnection: true, isReady: false },
            backfill: null,
          });
        }
        if (typeof url === 'string' && url.includes('/setup/backfill/progress')) {
          return jsonResponse({ status: 'not_started' });
        }
        return jsonResponse({}, 500);
      });

      renderOnboarding();

      await waitFor(() => {
        expect(screen.getByText('Import & Discover')).toBeInTheDocument();
      });

      expect(screen.getByText('Import 30 days of billing history for instant insights?')).toBeInTheDocument();
      expect(screen.getByText('Start Import')).toBeInTheDocument();
      expect(screen.getByText('Skip')).toBeInTheDocument();
    });

    it('skip button advances to report phase', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      const { getApiKey } = await import('../lib/api');
      (getApiKey as Mock).mockReturnValue('rev_existing');

      mockFetch((url) => {
        if (typeof url === 'string' && url.includes('/setup/status')) {
          return jsonResponse({
            integrations: [{ provider: 'stripe', connected: true }],
            stats: { eventsProcessed: 0 },
            readiness: { hasConnection: true, isReady: false },
            backfill: null,
          });
        }
        if (typeof url === 'string' && url.includes('/setup/backfill/progress')) {
          return jsonResponse({ status: 'not_started' });
        }
        if (typeof url === 'string' && url.includes('/api/v1/first-look')) {
          return jsonResponse({
            dataReady: true,
            overview: {
              totalSubscribers: 0,
              activeSources: [],
              totalEventsProcessed: 0,
              eventsBySource: [],
            },
            subscriberHealth: { distribution: [] },
            revenueImpact: {
              totalMonthlyRevenueCentsAtRisk: 0,
              totalOpenIssues: 0,
              bySeverity: [],
              byType: [],
            },
            topIssues: [],
          });
        }
        return jsonResponse({}, 500);
      });

      renderOnboarding();

      await waitFor(() => {
        expect(screen.getByText('Skip')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Skip'));

      await waitFor(() => {
        expect(screen.getByText('Your First Look')).toBeInTheDocument();
      });
    });
  });

  describe('Section 4: Report', () => {
    it('shows "Looking Good" when no issues found', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      const { getApiKey } = await import('../lib/api');
      (getApiKey as Mock).mockReturnValue('rev_existing');

      mockFetch((url) => {
        if (typeof url === 'string' && url.includes('/setup/status')) {
          return jsonResponse({
            integrations: [{ provider: 'stripe', connected: true }],
            stats: { eventsProcessed: 100 },
            readiness: { hasConnection: true, isReady: true },
            backfill: { status: 'completed' },
          });
        }
        if (typeof url === 'string' && url.includes('/setup/backfill/progress')) {
          return jsonResponse({ status: 'completed', eventsCreated: 100 });
        }
        if (typeof url === 'string' && url.includes('/api/v1/first-look')) {
          return jsonResponse({
            dataReady: true,
            overview: {
              totalSubscribers: 50,
              activeSources: ['stripe'],
              totalEventsProcessed: 100,
              eventsBySource: [{ source: 'stripe', count: 100 }],
            },
            subscriberHealth: {
              distribution: [{ state: 'active', count: 50, percentage: 100 }],
            },
            revenueImpact: {
              totalMonthlyRevenueCentsAtRisk: 0,
              totalOpenIssues: 0,
              bySeverity: [],
              byType: [],
            },
            topIssues: [],
          });
        }
        return jsonResponse({}, 500);
      });

      renderOnboarding();

      await waitFor(() => {
        expect(screen.getByText('Looking Good')).toBeInTheDocument();
      });

      expect(screen.getByText('No critical billing issues detected. We\'ll continue monitoring.')).toBeInTheDocument();
      expect(screen.getByText('50')).toBeInTheDocument(); // Subscribers
      expect(screen.getByText('100')).toBeInTheDocument(); // Events
      expect(screen.getByText('Explore Full Dashboard')).toBeInTheDocument();
    });

    it('shows revenue at risk when issues are found', async () => {
      const { getApiKey } = await import('../lib/api');
      (getApiKey as Mock).mockReturnValue('rev_existing');

      mockFetch((url) => {
        if (typeof url === 'string' && url.includes('/setup/status')) {
          return jsonResponse({
            integrations: [{ provider: 'stripe', connected: true }],
            stats: { eventsProcessed: 4231 },
            readiness: { hasConnection: true, isReady: true },
            backfill: { status: 'completed' },
          });
        }
        if (typeof url === 'string' && url.includes('/setup/backfill/progress')) {
          return jsonResponse({ status: 'completed', eventsCreated: 4231 });
        }
        if (typeof url === 'string' && url.includes('/api/v1/first-look')) {
          return jsonResponse({
            dataReady: true,
            overview: {
              totalSubscribers: 1247,
              activeSources: ['stripe'],
              totalEventsProcessed: 4231,
              eventsBySource: [{ source: 'stripe', count: 4231 }],
            },
            subscriberHealth: {
              distribution: [
                { state: 'active', count: 892, percentage: 71.5 },
                { state: 'expired', count: 355, percentage: 28.5 },
              ],
            },
            revenueImpact: {
              totalMonthlyRevenueCentsAtRisk: 420000,
              totalOpenIssues: 12,
              bySeverity: [
                { severity: 'critical', count: 3, revenueCents: 210000 },
                { severity: 'warning', count: 5, revenueCents: 150000 },
                { severity: 'info', count: 4, revenueCents: 60000 },
              ],
              byType: [],
            },
            topIssues: [
              {
                id: 'iss_1',
                type: 'payment_without_entitlement',
                severity: 'critical',
                title: 'Payment succeeded but entitlement is inactive',
                description: 'Payment succeeded but entitlement state did not transition to active',
                estimatedRevenueCents: 120000,
                confidence: 0.92,
              },
              {
                id: 'iss_2',
                type: 'refund_not_revoked',
                severity: 'warning',
                title: 'Refund recorded but entitlement not revoked',
                description: 'Refund was recorded but entitlement was not revoked',
                estimatedRevenueCents: 89000,
                confidence: 0.87,
              },
            ],
          });
        }
        return jsonResponse({}, 500);
      });

      renderOnboarding();

      await waitFor(() => {
        expect(screen.getByText('Estimated Revenue at Risk')).toBeInTheDocument();
      });

      // Check revenue display ($4,200/mo)
      expect(screen.getByText(/\$4,200/)).toBeInTheDocument();
      expect(screen.getByText(/12 detected issues/)).toBeInTheDocument();

      // Severity breakdown
      expect(screen.getByText('3')).toBeInTheDocument(); // critical count
      expect(screen.getByText('5')).toBeInTheDocument(); // warning count
      expect(screen.getByText('4')).toBeInTheDocument(); // info count

      // Top issues
      expect(screen.getByText('Payment succeeded but entitlement is inactive')).toBeInTheDocument();
      expect(screen.getByText('Refund recorded but entitlement not revoked')).toBeInTheDocument();

      // CTA
      expect(screen.getByText('Explore Full Dashboard')).toBeInTheDocument();
    });

    it('navigates to dashboard on CTA click', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const { getApiKey } = await import('../lib/api');
      (getApiKey as Mock).mockReturnValue('rev_existing');

      mockFetch((url) => {
        if (typeof url === 'string' && url.includes('/setup/status')) {
          return jsonResponse({
            integrations: [],
            stats: { eventsProcessed: 0 },
            readiness: { hasConnection: true, isReady: true },
            backfill: { status: 'completed' },
          });
        }
        if (typeof url === 'string' && url.includes('/setup/backfill/progress')) {
          return jsonResponse({ status: 'completed', eventsCreated: 0 });
        }
        if (typeof url === 'string' && url.includes('/api/v1/first-look')) {
          return jsonResponse({
            dataReady: true,
            overview: { totalSubscribers: 0, activeSources: [], totalEventsProcessed: 0, eventsBySource: [] },
            subscriberHealth: { distribution: [] },
            revenueImpact: { totalMonthlyRevenueCentsAtRisk: 0, totalOpenIssues: 0, bySeverity: [], byType: [] },
            topIssues: [],
          });
        }
        return jsonResponse({}, 500);
      });

      renderOnboarding();

      await waitFor(() => {
        expect(screen.getByText('Explore Full Dashboard')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Explore Full Dashboard'));
      expect(mockNavigate).toHaveBeenCalledWith('/');
    });

    it('navigates to issue detail on issue click', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const { getApiKey } = await import('../lib/api');
      (getApiKey as Mock).mockReturnValue('rev_existing');

      mockFetch((url) => {
        if (typeof url === 'string' && url.includes('/setup/status')) {
          return jsonResponse({
            integrations: [],
            stats: { eventsProcessed: 100 },
            readiness: { hasConnection: true, isReady: true },
            backfill: { status: 'completed' },
          });
        }
        if (typeof url === 'string' && url.includes('/setup/backfill/progress')) {
          return jsonResponse({ status: 'completed', eventsCreated: 100 });
        }
        if (typeof url === 'string' && url.includes('/api/v1/first-look')) {
          return jsonResponse({
            dataReady: true,
            overview: { totalSubscribers: 10, activeSources: ['stripe'], totalEventsProcessed: 100, eventsBySource: [] },
            subscriberHealth: { distribution: [] },
            revenueImpact: {
              totalMonthlyRevenueCentsAtRisk: 50000,
              totalOpenIssues: 1,
              bySeverity: [{ severity: 'critical', count: 1, revenueCents: 50000 }],
              byType: [],
            },
            topIssues: [
              {
                id: 'iss_abc',
                type: 'payment_without_entitlement',
                severity: 'critical',
                title: 'Payment succeeded but entitlement is inactive',
                description: 'test',
                estimatedRevenueCents: 50000,
                confidence: 0.9,
              },
            ],
          });
        }
        return jsonResponse({}, 500);
      });

      renderOnboarding();

      await waitFor(() => {
        expect(screen.getByText('Payment succeeded but entitlement is inactive')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Payment succeeded but entitlement is inactive'));
      expect(mockNavigate).toHaveBeenCalledWith('/issues/iss_abc');
    });

    it('shows error state when report fails to load', async () => {
      const { getApiKey } = await import('../lib/api');
      (getApiKey as Mock).mockReturnValue('rev_existing');

      mockFetch((url) => {
        if (typeof url === 'string' && url.includes('/setup/status')) {
          return jsonResponse({
            integrations: [],
            stats: { eventsProcessed: 0 },
            readiness: { hasConnection: true, isReady: true },
            backfill: { status: 'completed' },
          });
        }
        if (typeof url === 'string' && url.includes('/setup/backfill/progress')) {
          return jsonResponse({ status: 'completed', eventsCreated: 0 });
        }
        if (typeof url === 'string' && url.includes('/api/v1/first-look')) {
          return jsonResponse({ error: 'Failed to load report' }, 500);
        }
        return jsonResponse({}, 500);
      });

      renderOnboarding();

      await waitFor(() => {
        expect(screen.getByText('Failed to load report')).toBeInTheDocument();
      });

      // Should still show dashboard buttons (header + fallback in report section)
      const dashboardButtons = screen.getAllByText('Go to Dashboard');
      expect(dashboardButtons.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Auto-advance with existing key', () => {
    it('auto-advances to connect phase when key exists but no connection', async () => {
      const { getApiKey } = await import('../lib/api');
      (getApiKey as Mock).mockReturnValue('rev_existing');

      mockFetch((url) => {
        if (typeof url === 'string' && url.includes('/setup/status')) {
          return jsonResponse({
            integrations: [],
            stats: { eventsProcessed: 0 },
            readiness: { hasConnection: false, isReady: false },
            backfill: null,
          });
        }
        return jsonResponse({}, 500);
      });

      renderOnboarding();

      await waitFor(() => {
        expect(screen.getByText('Connect Billing')).toBeInTheDocument();
      });
    });

    it('auto-advances to import phase when connection exists', async () => {
      const { getApiKey } = await import('../lib/api');
      (getApiKey as Mock).mockReturnValue('rev_existing');

      mockFetch((url) => {
        if (typeof url === 'string' && url.includes('/setup/status')) {
          return jsonResponse({
            integrations: [{ provider: 'stripe' }],
            stats: { eventsProcessed: 0 },
            readiness: { hasConnection: true, isReady: false },
            backfill: null,
          });
        }
        if (typeof url === 'string' && url.includes('/setup/backfill/progress')) {
          return jsonResponse({ status: 'not_started' });
        }
        return jsonResponse({}, 500);
      });

      renderOnboarding();

      await waitFor(() => {
        expect(screen.getByText('Import & Discover')).toBeInTheDocument();
      });
    });

    it('auto-advances to report phase when ready', async () => {
      const { getApiKey } = await import('../lib/api');
      (getApiKey as Mock).mockReturnValue('rev_existing');

      mockFetch((url) => {
        if (typeof url === 'string' && url.includes('/setup/status')) {
          return jsonResponse({
            integrations: [{ provider: 'stripe' }],
            stats: { eventsProcessed: 1000 },
            readiness: { hasConnection: true, isReady: true },
            backfill: { status: 'completed' },
          });
        }
        if (typeof url === 'string' && url.includes('/setup/backfill/progress')) {
          return jsonResponse({ status: 'completed', eventsCreated: 1000 });
        }
        if (typeof url === 'string' && url.includes('/api/v1/first-look')) {
          return jsonResponse({
            dataReady: true,
            overview: { totalSubscribers: 50, activeSources: ['stripe'], totalEventsProcessed: 1000, eventsBySource: [] },
            subscriberHealth: { distribution: [] },
            revenueImpact: { totalMonthlyRevenueCentsAtRisk: 0, totalOpenIssues: 0, bySeverity: [], byType: [] },
            topIssues: [],
          });
        }
        return jsonResponse({}, 500);
      });

      renderOnboarding();

      await waitFor(() => {
        expect(screen.getByText('Your First Look')).toBeInTheDocument();
      });
    });
  });

  describe('Go to Dashboard header button', () => {
    it('shows after authentication and navigates on click', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const { getApiKey } = await import('../lib/api');
      (getApiKey as Mock).mockReturnValue('rev_existing');

      mockFetch((url) => {
        if (typeof url === 'string' && url.includes('/setup/status')) {
          return jsonResponse({
            integrations: [],
            stats: { eventsProcessed: 0 },
            readiness: { hasConnection: false, isReady: false },
            backfill: null,
          });
        }
        return jsonResponse({}, 500);
      });

      renderOnboarding();

      await waitFor(() => {
        expect(screen.getByText('Go to Dashboard')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Go to Dashboard'));
      expect(mockNavigate).toHaveBeenCalledWith('/');
    });
  });

  describe('Social proof', () => {
    it('shows social proof text after auth', async () => {
      const { getApiKey } = await import('../lib/api');
      (getApiKey as Mock).mockReturnValue('rev_existing');

      mockFetch((url) => {
        if (typeof url === 'string' && url.includes('/setup/status')) {
          return jsonResponse({
            integrations: [],
            stats: { eventsProcessed: 0 },
            readiness: { hasConnection: false, isReady: false },
            backfill: null,
          });
        }
        return jsonResponse({}, 500);
      });

      renderOnboarding();

      await waitFor(() => {
        expect(
          screen.getByText(/Companies using RevBack recover an average of \$3,200\/month/)
        ).toBeInTheDocument();
      });
    });
  });

  describe('Phase visibility', () => {
    it('completed phases show green checkmark', async () => {
      const { getApiKey } = await import('../lib/api');
      (getApiKey as Mock).mockReturnValue('rev_existing');

      mockFetch((url) => {
        if (typeof url === 'string' && url.includes('/setup/status')) {
          return jsonResponse({
            integrations: [{ provider: 'stripe' }],
            stats: { eventsProcessed: 0 },
            readiness: { hasConnection: true, isReady: false },
            backfill: null,
          });
        }
        if (typeof url === 'string' && url.includes('/setup/backfill/progress')) {
          return jsonResponse({ status: 'not_started' });
        }
        return jsonResponse({}, 500);
      });

      renderOnboarding();

      await waitFor(() => {
        expect(screen.getByText('Import & Discover')).toBeInTheDocument();
      });

      // Auth section should show completed state
      expect(screen.getByText('API key created and saved.')).toBeInTheDocument();
      // Connect section should show completed state
      expect(screen.getByText('Billing system connected and verified.')).toBeInTheDocument();
    });
  });
});
