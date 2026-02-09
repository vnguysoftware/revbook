import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { setApiKey, getApiKey, apiFetch } from '../lib/api';
import { formatCents, timeAgo } from '../lib/format';
import {
  CheckCircle,
  Circle,
  Loader2,
  ChevronRight,
  ChevronLeft,
  ArrowRight,
  Shield,
  Key,
  Zap,
  Eye,
  AlertTriangle,
  Clock,
  RefreshCw,
  ExternalLink,
  Copy,
  Check,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────

interface IntegrationHealth {
  source: string;
  connected: boolean;
  lastWebhookAt: string | null;
  lastWebhookFreshness: string;
  hasWebhookSecret: boolean;
  webhookDeliveryRate24h: number;
  syncStatus: string;
  lastSyncAt: string | null;
  credentialStatus: string;
  status: string;
}

interface SetupStatus {
  integrations: IntegrationHealth[];
  stats: {
    eventsProcessed: number;
    usersTracked: number;
    openIssues: number;
    eventsToday: number;
  };
  readiness: {
    hasConnection: boolean;
    hasEvents: boolean;
    hasUsers: boolean;
    isReady: boolean;
  };
  backfill: BackfillProgress | null;
}

interface BackfillProgress {
  status: string;
  phase: string;
  totalCustomers: number;
  importedCustomers: number;
  totalEvents: number;
  importedEvents: number;
  eventsCreated: number;
  issuesFound: number;
  errors: string[];
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  estimatedSecondsRemaining: number | null;
  processingRatePerSecond: number;
}

interface VerifyResult {
  source: string;
  verified: boolean;
  checks: Record<string, unknown>;
  message: string;
}

interface FirstLookReport {
  dataReady: boolean;
  overview: {
    totalSubscribers: number;
    activeSources: string[];
    totalEventsProcessed: number;
    eventsBySource: { source: string; count: number }[];
  };
  subscriberHealth: {
    distribution: { state: string; count: number; percentage: number }[];
  };
  revenueImpact: {
    totalMonthlyRevenueCentsAtRisk: number;
    totalOpenIssues: number;
    bySeverity: { severity: string; count: number; revenueCents: number }[];
    byType: { issueType: string; count: number; revenueCents: number }[];
  };
  topIssues: {
    id: string;
    type: string;
    severity: string;
    title: string;
    description: string;
    estimatedRevenueCents: number;
    confidence: number;
  }[];
}

// ─── Constants ──────────────────────────────────────────────────────

const STEPS = [
  { id: 'org', label: 'Organization', time: '~1 minute' },
  { id: 'stripe', label: 'Connect Stripe', time: '~2 minutes' },
  { id: 'apple', label: 'Connect Apple', time: '~3 minutes' },
  { id: 'verify', label: 'Verification', time: '~1 minute' },
  { id: 'import', label: 'Import Data', time: '~5-15 minutes' },
  { id: 'report', label: 'First Look', time: '' },
] as const;

// ─── Main Component ─────────────────────────────────────────────────

export function SetupPage() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [apiKeyInput, setApiKeyInput] = useState(getApiKey());
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Determine starting step based on existing state
  useEffect(() => {
    if (apiKeyInput) {
      checkStatusAndDetermineStep();
    }
  }, []);

  async function checkStatusAndDetermineStep() {
    setLoading(true);
    setError('');
    try {
      setApiKey(apiKeyInput);
      const res = await fetch('/setup/status', {
        headers: { Authorization: `Bearer ${apiKeyInput}` },
      });
      if (!res.ok) throw new Error('Invalid API key');
      const data: SetupStatus = await res.json();
      setStatus(data);
      setIsAuthenticated(true);

      // Auto-advance to the right step
      if (data.readiness.isReady) {
        setCurrentStep(5); // First Look
      } else if (data.backfill && ['importing_subscriptions', 'importing_events', 'counting'].includes(data.backfill.status)) {
        setCurrentStep(4); // Import in progress
      } else if (data.readiness.hasConnection) {
        setCurrentStep(3); // Verification
      } else {
        setCurrentStep(1); // Connect Stripe
      }
    } catch (err: any) {
      setError(err.message);
      setCurrentStep(0);
    } finally {
      setLoading(false);
    }
  }

  function goToStep(step: number) {
    if (step >= 0 && step < STEPS.length) {
      setCurrentStep(step);
    }
  }

  useEffect(() => { document.title = 'Setup - RevBack'; }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center">
                <Shield size={20} className="text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">RevBack Setup</h1>
                <p className="text-gray-500 mt-0.5 text-sm">
                  Connect your billing systems and start finding revenue issues
                </p>
              </div>
            </div>
            {isAuthenticated && (
              <button
                onClick={() => navigate('/')}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Go to Dashboard <ArrowRight size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Step indicator */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center gap-1">
            {STEPS.map((step, i) => {
              const isCompleted = i < currentStep;
              const isCurrent = i === currentStep;
              return (
                <div key={step.id} className="flex items-center">
                  <button
                    onClick={() => isAuthenticated && goToStep(i)}
                    className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-all ${
                      isCurrent
                        ? 'bg-gray-900 text-white shadow-sm'
                        : isCompleted
                          ? 'bg-green-50 text-green-700 hover:bg-green-100 cursor-pointer border border-green-200'
                          : 'bg-gray-100 text-gray-400'
                    }`}
                    disabled={!isAuthenticated && i > 0}
                  >
                    {isCompleted ? (
                      <CheckCircle size={14} className="text-green-600" />
                    ) : (
                      <span className={`w-5 h-5 flex items-center justify-center text-[10px] font-bold rounded-full ${
                        isCurrent ? 'bg-white/20' : 'bg-gray-200'
                      }`}>
                        {i + 1}
                      </span>
                    )}
                    <span className="hidden sm:inline">{step.label}</span>
                  </button>
                  {i < STEPS.length - 1 && (
                    <div className={`w-6 h-px mx-1 ${isCompleted ? 'bg-green-300' : 'bg-gray-200'}`} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Step content */}
      <div className="max-w-4xl mx-auto px-4 py-8">
        {currentStep === 0 && (
          <StepOrganization
            apiKeyInput={apiKeyInput}
            setApiKeyInput={setApiKeyInput}
            loading={loading}
            error={error}
            onAuthenticated={() => {
              setIsAuthenticated(true);
              checkStatusAndDetermineStep();
            }}
            setError={setError}
            setLoading={setLoading}
          />
        )}
        {currentStep === 1 && (
          <StepStripe
            onNext={() => goToStep(2)}
            onSkip={() => goToStep(3)}
            apiKey={apiKeyInput}
          />
        )}
        {currentStep === 2 && (
          <StepApple
            onNext={() => goToStep(3)}
            onSkip={() => goToStep(3)}
            apiKey={apiKeyInput}
          />
        )}
        {currentStep === 3 && (
          <StepVerification
            apiKey={apiKeyInput}
            status={status}
            onRefresh={checkStatusAndDetermineStep}
            onNext={() => goToStep(4)}
          />
        )}
        {currentStep === 4 && (
          <StepImport
            apiKey={apiKeyInput}
            onComplete={() => goToStep(5)}
          />
        )}
        {currentStep === 5 && (
          <StepFirstLook
            apiKey={apiKeyInput}
          />
        )}

        {/* Navigation */}
        {isAuthenticated && (
          <div className="flex justify-between mt-8">
            <button
              onClick={() => goToStep(currentStep - 1)}
              disabled={currentStep === 0}
              className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={16} /> Previous
            </button>
            <div />
          </div>
        )}
      </div>

      {/* Integration Health Dashboard (shown at bottom when authenticated) */}
      {isAuthenticated && status && status.integrations.length > 0 && (
        <div className="border-t border-gray-200 bg-white">
          <div className="max-w-4xl mx-auto px-4 py-6">
            <h3 className="font-semibold text-gray-900 mb-4">Integration Health</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {status.integrations.map((conn) => (
                <IntegrationCard key={conn.source} connection={conn} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Step 1: Organization Setup ─────────────────────────────────────

function StepOrganization({
  apiKeyInput,
  setApiKeyInput,
  loading,
  error,
  onAuthenticated,
  setError,
  setLoading,
}: {
  apiKeyInput: string;
  setApiKeyInput: (v: string) => void;
  loading: boolean;
  error: string;
  onAuthenticated: () => void;
  setError: (v: string) => void;
  setLoading: (v: boolean) => void;
}) {
  const [mode, setMode] = useState<'connect' | 'create'>('connect');
  const [orgName, setOrgName] = useState('');
  const [orgSlug, setOrgSlug] = useState('');
  const [createdKey, setCreatedKey] = useState('');
  const [copied, setCopied] = useState(false);

  async function handleConnect() {
    if (!apiKeyInput) return;
    setLoading(true);
    setError('');
    try {
      setApiKey(apiKeyInput);
      const res = await fetch('/setup/status', {
        headers: { Authorization: `Bearer ${apiKeyInput}` },
      });
      if (!res.ok) throw new Error('Invalid API key');
      onAuthenticated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    if (!orgName || !orgSlug) {
      setError('Organization name and slug are required');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/setup/org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: orgName, slug: orgSlug }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create organization');
      setCreatedKey(data.apiKey);
      setApiKeyInput(data.apiKey);
      setApiKey(data.apiKey);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function copyKey() {
    navigator.clipboard.writeText(createdKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Auto-generate slug from name
  useEffect(() => {
    if (orgName) {
      setOrgSlug(
        orgName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 64),
      );
    }
  }, [orgName]);

  if (createdKey) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="bg-green-50 border border-green-200 rounded-lg p-6 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle size={20} className="text-green-600" />
            <h3 className="font-semibold text-green-900">Organization Created</h3>
          </div>
          <p className="text-sm text-green-800 mb-4">
            Save your API key now. It will not be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-white px-3 py-2 rounded border border-green-300 text-sm font-mono break-all">
              {createdKey}
            </code>
            <button
              onClick={copyKey}
              className="p-2 bg-green-100 rounded hover:bg-green-200 transition-colors"
              title="Copy API key"
            >
              {copied ? <Check size={16} className="text-green-700" /> : <Copy size={16} className="text-green-700" />}
            </button>
          </div>
        </div>
        <button
          onClick={onAuthenticated}
          className="w-full px-4 py-3 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors flex items-center justify-center gap-2"
        >
          Continue to Setup <ArrowRight size={16} />
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto">
      <div className="text-center mb-6">
        <Key size={32} className="mx-auto text-gray-400 mb-3" />
        <h2 className="text-xl font-bold text-gray-900">Get Started</h2>
        <p className="text-gray-500 mt-1 text-sm">
          Connect with your API key or create a new organization
        </p>
      </div>

      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setMode('connect')}
          className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
            mode === 'connect'
              ? 'bg-gray-900 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          I have an API key
        </button>
        <button
          onClick={() => setMode('create')}
          className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
            mode === 'create'
              ? 'bg-gray-900 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          Create new organization
        </button>
      </div>

      {mode === 'connect' ? (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="font-semibold mb-3">Enter your API key</h3>
          <div className="flex gap-2">
            <input
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder="rev_..."
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
              onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
            />
            <button
              onClick={handleConnect}
              disabled={loading || !apiKeyInput}
              className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-md hover:bg-gray-800 disabled:opacity-50 transition-colors"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : 'Connect'}
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Organization Name
            </label>
            <input
              type="text"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="Acme Corp"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Slug <span className="text-gray-400 font-normal">(used in webhook URLs)</span>
            </label>
            <input
              type="text"
              value={orgSlug}
              onChange={(e) => setOrgSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              placeholder="acme-corp"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
            />
            <p className="text-xs text-gray-400 mt-1">
              Webhook URL: /webhooks/{orgSlug || 'your-slug'}/stripe
            </p>
          </div>
          <button
            onClick={handleCreate}
            disabled={loading || !orgName || !orgSlug}
            className="w-full px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-md hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            {loading ? (
              <Loader2 size={16} className="animate-spin mx-auto" />
            ) : (
              'Create Organization'
            )}
          </button>
        </div>
      )}

      {error && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}
    </div>
  );
}

// ─── Step 2: Connect Stripe ─────────────────────────────────────────

function StepStripe({
  onNext,
  onSkip,
  apiKey,
}: {
  onNext: () => void;
  onSkip: () => void;
  apiKey: string;
}) {
  const [stripeKey, setStripeKey] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');

  async function handleConnect() {
    if (!stripeKey) {
      setError('Stripe secret key is required');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/setup/stripe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          stripeSecretKey: stripeKey,
          webhookSecret: webhookSecret || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to connect');
      setConnected(true);
      setWebhookUrl(data.webhookUrl);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (connected) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="bg-green-50 border border-green-200 rounded-lg p-6 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle size={20} className="text-green-600" />
            <h3 className="font-semibold text-green-900">Stripe Connected</h3>
          </div>
          <p className="text-sm text-green-800">
            Your Stripe API key has been validated and saved.
          </p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h3 className="font-semibold mb-3">Next: Configure Webhooks in Stripe</h3>
          <ol className="space-y-3 text-sm text-gray-600">
            <li className="flex gap-3">
              <span className="bg-gray-100 text-gray-500 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">
                1
              </span>
              <span>
                Go to{' '}
                <a
                  href="https://dashboard.stripe.com/webhooks"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline inline-flex items-center gap-1"
                >
                  Stripe Dashboard &gt; Developers &gt; Webhooks
                  <ExternalLink size={12} />
                </a>
              </span>
            </li>
            <li className="flex gap-3">
              <span className="bg-gray-100 text-gray-500 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">
                2
              </span>
              <span>
                Add endpoint:{' '}
                <code className="bg-gray-100 px-2 py-0.5 rounded text-xs">
                  YOUR_DOMAIN{webhookUrl}
                </code>
              </span>
            </li>
            <li className="flex gap-3">
              <span className="bg-gray-100 text-gray-500 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">
                3
              </span>
              <span>
                Select events: <code className="bg-gray-100 px-1 rounded text-xs">customer.subscription.*</code>,{' '}
                <code className="bg-gray-100 px-1 rounded text-xs">invoice.*</code>,{' '}
                <code className="bg-gray-100 px-1 rounded text-xs">charge.refunded</code>,{' '}
                <code className="bg-gray-100 px-1 rounded text-xs">charge.dispute.*</code>
              </span>
            </li>
          </ol>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onNext}
            className="flex-1 px-4 py-3 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors flex items-center justify-center gap-2"
          >
            Continue to Apple Setup <ArrowRight size={16} />
          </button>
          <button
            onClick={() => onSkip()}
            className="px-4 py-3 text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            Skip Apple
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto">
      <div className="text-center mb-6">
        <Zap size={32} className="mx-auto text-gray-400 mb-3" />
        <h2 className="text-xl font-bold text-gray-900">Connect Stripe</h2>
        <p className="text-gray-500 mt-1 text-sm">
          Paste your Stripe secret key to start monitoring subscriptions
        </p>
        <p className="text-gray-400 mt-1 text-xs">Estimated time: ~2 minutes</p>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Stripe Secret Key <span className="text-red-500">*</span>
          </label>
          <input
            type="password"
            value={stripeKey}
            onChange={(e) => setStripeKey(e.target.value)}
            placeholder="sk_live_..."
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
          />
          <p className="text-xs text-gray-400 mt-1">
            Find it at{' '}
            <a
              href="https://dashboard.stripe.com/apikeys"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:underline"
            >
              Stripe Dashboard &gt; Developers &gt; API Keys
            </a>
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Webhook Signing Secret{' '}
            <span className="text-gray-400 font-normal">(optional, recommended)</span>
          </label>
          <input
            type="password"
            value={webhookSecret}
            onChange={(e) => setWebhookSecret(e.target.value)}
            placeholder="whsec_..."
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
          />
          <p className="text-xs text-gray-400 mt-1">
            You can add this later after configuring webhooks
          </p>
        </div>

        <button
          onClick={handleConnect}
          disabled={loading || !stripeKey}
          className="w-full px-4 py-3 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 size={16} className="animate-spin" /> Validating...
            </span>
          ) : (
            'Connect Stripe'
          )}
        </button>
      </div>

      {error && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="mt-4 text-center">
        <button
          onClick={onSkip}
          className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          Skip Stripe, connect Apple instead
        </button>
      </div>
    </div>
  );
}

// ─── Step 3: Connect Apple ──────────────────────────────────────────

function StepApple({
  onNext,
  onSkip,
  apiKey,
}: {
  onNext: () => void;
  onSkip: () => void;
  apiKey: string;
}) {
  const [keyId, setKeyId] = useState('');
  const [issuerId, setIssuerId] = useState('');
  const [bundleId, setBundleId] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [originalUrl, setOriginalUrl] = useState('');
  const [showProxy, setShowProxy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);

  async function handleConnect() {
    if (!keyId || !issuerId || !bundleId) {
      setError('Key ID, Issuer ID, and Bundle ID are required');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const body: Record<string, string> = { keyId, issuerId, bundleId };
      if (privateKey) body.privateKey = privateKey;
      if (originalUrl) body.originalNotificationUrl = originalUrl;

      const res = await fetch('/setup/apple', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to connect');
      setConnected(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (connected) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="bg-green-50 border border-green-200 rounded-lg p-6 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle size={20} className="text-green-600" />
            <h3 className="font-semibold text-green-900">Apple Connected</h3>
          </div>
          <p className="text-sm text-green-800">
            Your Apple App Store credentials have been saved.
            {originalUrl && ' Webhook proxy has been configured for forwarding.'}
          </p>
        </div>
        <button
          onClick={onNext}
          className="w-full px-4 py-3 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors flex items-center justify-center gap-2"
        >
          Continue to Verification <ArrowRight size={16} />
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto">
      <div className="text-center mb-6">
        <Shield size={32} className="mx-auto text-gray-400 mb-3" />
        <h2 className="text-xl font-bold text-gray-900">Connect Apple App Store</h2>
        <p className="text-gray-500 mt-1 text-sm">
          Enter your App Store Server API credentials
        </p>
        <p className="text-gray-400 mt-1 text-xs">Estimated time: ~3 minutes</p>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
        <h4 className="text-sm font-medium text-blue-900 mb-2">Where to find these credentials</h4>
        <ol className="text-xs text-blue-800 space-y-1">
          <li>1. Go to App Store Connect &gt; Users and Access &gt; Keys</li>
          <li>2. Click "App Store Connect API" tab</li>
          <li>3. Generate a new key if you do not have one</li>
          <li>4. Note the Key ID and Issuer ID shown at the top</li>
          <li>5. Download the private key (.p8 file)</li>
        </ol>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Key ID <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={keyId}
              onChange={(e) => setKeyId(e.target.value)}
              placeholder="ABC1234567"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Issuer ID <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={issuerId}
              onChange={(e) => setIssuerId(e.target.value)}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Bundle ID <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={bundleId}
            onChange={(e) => setBundleId(e.target.value)}
            placeholder="com.yourcompany.app"
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Private Key (.p8 contents){' '}
            <span className="text-gray-400 font-normal">(recommended)</span>
          </label>
          <textarea
            value={privateKey}
            onChange={(e) => setPrivateKey(e.target.value)}
            placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
            rows={4}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
          />
        </div>

        {/* Webhook Proxy Toggle */}
        <div className="border-t border-gray-100 pt-4">
          <button
            onClick={() => setShowProxy(!showProxy)}
            className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            <RefreshCw size={14} />
            <span>Already have a notification URL configured?</span>
            <ChevronRight
              size={14}
              className={`transition-transform ${showProxy ? 'rotate-90' : ''}`}
            />
          </button>

          {showProxy && (
            <div className="mt-3 p-4 bg-gray-50 rounded-lg">
              <p className="text-xs text-gray-600 mb-2">
                Apple only allows one Server Notification URL per app. Enter your existing URL below
                and we will forward all notifications to it while also processing them for RevBack.
              </p>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Your existing Apple notification URL
              </label>
              <input
                type="url"
                value={originalUrl}
                onChange={(e) => setOriginalUrl(e.target.value)}
                placeholder="https://api.yourapp.com/apple/notifications"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
              />
            </div>
          )}
        </div>

        <button
          onClick={handleConnect}
          disabled={loading || !keyId || !issuerId || !bundleId}
          className="w-full px-4 py-3 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 size={16} className="animate-spin" /> Saving...
            </span>
          ) : (
            'Connect Apple'
          )}
        </button>
      </div>

      {error && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="mt-4 text-center">
        <button
          onClick={onSkip}
          className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          Skip Apple setup for now
        </button>
      </div>
    </div>
  );
}

// ─── Step 4: Verification ───────────────────────────────────────────

function StepVerification({
  apiKey,
  status,
  onRefresh,
  onNext,
}: {
  apiKey: string;
  status: SetupStatus | null;
  onRefresh: () => void;
  onNext: () => void;
}) {
  const [stripeVerify, setStripeVerify] = useState<VerifyResult | null>(null);
  const [appleVerify, setAppleVerify] = useState<VerifyResult | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);

  async function verifyStripe() {
    setVerifying('stripe');
    try {
      const res = await fetch('/setup/verify/stripe', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const data = await res.json();
      setStripeVerify(data);
    } catch (err: any) {
      setStripeVerify({
        source: 'stripe',
        verified: false,
        checks: {},
        message: err.message,
      });
    } finally {
      setVerifying(null);
    }
  }

  async function verifyApple() {
    setVerifying('apple');
    try {
      const res = await fetch('/setup/verify/apple', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const data = await res.json();
      setAppleVerify(data);
    } catch (err: any) {
      setAppleVerify({
        source: 'apple',
        verified: false,
        checks: {},
        message: err.message,
      });
    } finally {
      setVerifying(null);
    }
  }

  const hasStripe = status?.integrations.some((i) => i.source === 'stripe');
  const hasApple = status?.integrations.some((i) => i.source === 'apple');
  const allVerified =
    (!hasStripe || stripeVerify?.verified) && (!hasApple || appleVerify?.verified);

  return (
    <div className="max-w-lg mx-auto">
      <div className="text-center mb-6">
        <Eye size={32} className="mx-auto text-gray-400 mb-3" />
        <h2 className="text-xl font-bold text-gray-900">Verify Connections</h2>
        <p className="text-gray-500 mt-1 text-sm">
          Check that your billing integrations are working correctly
        </p>
        <p className="text-gray-400 mt-1 text-xs">Estimated time: ~1 minute</p>
      </div>

      <div className="space-y-4">
        {hasStripe && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Stripe</h3>
              <button
                onClick={verifyStripe}
                disabled={verifying === 'stripe'}
                className="px-3 py-1.5 text-xs font-medium bg-gray-100 hover:bg-gray-200 rounded-md transition-colors disabled:opacity-50"
              >
                {verifying === 'stripe' ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  'Run Check'
                )}
              </button>
            </div>
            {stripeVerify && (
              <VerifyResultCard result={stripeVerify} />
            )}
            {!stripeVerify && (
              <p className="text-sm text-gray-400">Click "Run Check" to verify Stripe connectivity</p>
            )}
          </div>
        )}

        {hasApple && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Apple App Store</h3>
              <button
                onClick={verifyApple}
                disabled={verifying === 'apple'}
                className="px-3 py-1.5 text-xs font-medium bg-gray-100 hover:bg-gray-200 rounded-md transition-colors disabled:opacity-50"
              >
                {verifying === 'apple' ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  'Run Check'
                )}
              </button>
            </div>
            {appleVerify && (
              <VerifyResultCard result={appleVerify} />
            )}
            {!appleVerify && (
              <p className="text-sm text-gray-400">Click "Run Check" to verify Apple credentials</p>
            )}
          </div>
        )}

        {!hasStripe && !hasApple && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-600" />
              <p className="text-sm text-amber-800">
                No billing connections configured. Go back to connect Stripe or Apple.
              </p>
            </div>
          </div>
        )}
      </div>

      <button
        onClick={onNext}
        disabled={!hasStripe && !hasApple}
        className="w-full mt-6 px-4 py-3 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
      >
        {allVerified ? 'Start Historical Import' : 'Continue Anyway'} <ArrowRight size={16} />
      </button>
    </div>
  );
}

function VerifyResultCard({ result }: { result: VerifyResult }) {
  return (
    <div
      className={`p-3 rounded-lg ${
        result.verified
          ? 'bg-green-50 border border-green-200'
          : 'bg-red-50 border border-red-200'
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        {result.verified ? (
          <CheckCircle size={16} className="text-green-600" />
        ) : (
          <AlertTriangle size={16} className="text-red-600" />
        )}
        <span
          className={`text-sm font-medium ${
            result.verified ? 'text-green-800' : 'text-red-800'
          }`}
        >
          {result.message}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1 text-xs">
        {Object.entries(result.checks).map(([key, value]) => {
          if (key === 'error' && !value) return null;
          return (
            <div key={key} className="flex items-center gap-1">
              {value === true ? (
                <CheckCircle size={10} className="text-green-500" />
              ) : value === false ? (
                <Circle size={10} className="text-red-400" />
              ) : null}
              <span className="text-gray-600">
                {key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase())}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Step 5: Historical Import ──────────────────────────────────────

function StepImport({
  apiKey,
  onComplete,
}: {
  apiKey: string;
  onComplete: () => void;
}) {
  const [progress, setProgress] = useState<BackfillProgress | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const fetchProgress = useCallback(async () => {
    try {
      const res = await fetch('/setup/backfill/progress', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const data = await res.json();
      if (data.status && data.status !== 'not_started') {
        setProgress(data);
        if (data.status === 'completed' || data.status === 'failed') {
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        }
      }
    } catch {
      // Ignore polling errors
    }
  }, [apiKey]);

  useEffect(() => {
    fetchProgress();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function startImport() {
    setStarting(true);
    setError('');
    try {
      const res = await fetch('/setup/backfill/stripe', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start import');

      // Start polling
      pollRef.current = setInterval(fetchProgress, 2000);
      fetchProgress();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setStarting(false);
    }
  }

  const isRunning =
    progress &&
    ['counting', 'importing_subscriptions', 'importing_events'].includes(progress.status);
  const isCompleted = progress?.status === 'completed';
  const isFailed = progress?.status === 'failed';

  // Start polling if already running
  useEffect(() => {
    if (isRunning && !pollRef.current) {
      pollRef.current = setInterval(fetchProgress, 2000);
    }
  }, [isRunning, fetchProgress]);

  const progressPercent =
    progress && progress.totalCustomers > 0
      ? Math.min(
          Math.round(
            ((progress.importedCustomers + progress.importedEvents) /
              Math.max(progress.totalCustomers + progress.totalEvents, 1)) *
              100,
          ),
          99,
        )
      : 0;

  return (
    <div className="max-w-lg mx-auto">
      <div className="text-center mb-6">
        <RefreshCw size={32} className={`mx-auto text-gray-400 mb-3 ${isRunning ? 'animate-spin' : ''}`} />
        <h2 className="text-xl font-bold text-gray-900">Import Historical Data</h2>
        <p className="text-gray-500 mt-1 text-sm">
          Pull your existing subscription data from Stripe for instant insights
        </p>
        <p className="text-gray-400 mt-1 text-xs">Estimated time: ~5-15 minutes</p>
      </div>

      {!progress || progress.status === 'not_started' ? (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <p className="text-sm text-gray-600 mb-4">
            We will import all your active subscriptions and the last 30 days of billing events
            from Stripe. This data powers the issue detection engine and gives you immediate
            visibility into potential revenue problems.
          </p>
          <div className="bg-gray-50 rounded-lg p-4 mb-4">
            <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">What gets imported</h4>
            <ul className="text-sm text-gray-600 space-y-1">
              <li>- All subscriptions (active, past due, canceled, trialing)</li>
              <li>- Payment events (last 30 days)</li>
              <li>- Failed payments and retries</li>
              <li>- Refunds and chargebacks</li>
            </ul>
          </div>
          <button
            onClick={startImport}
            disabled={starting}
            className="w-full px-4 py-3 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            {starting ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 size={16} className="animate-spin" /> Starting...
              </span>
            ) : (
              'Start Import'
            )}
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          {/* Progress bar */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium text-gray-700">
                {isCompleted ? 'Complete' : isFailed ? 'Failed' : progress.phase}
              </span>
              <span className="text-sm text-gray-500">
                {isCompleted ? '100%' : `${progressPercent}%`}
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2.5">
              <div
                className={`h-2.5 rounded-full transition-all duration-500 ${
                  isCompleted
                    ? 'bg-green-500 w-full'
                    : isFailed
                      ? 'bg-red-500'
                      : 'bg-blue-500'
                }`}
                style={{ width: isCompleted ? '100%' : `${progressPercent}%` }}
              />
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-gray-900">{progress.importedCustomers}</p>
              <p className="text-xs text-gray-500">Subscribers</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-gray-900">{progress.importedEvents}</p>
              <p className="text-xs text-gray-500">Events</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-gray-900">{progress.eventsCreated}</p>
              <p className="text-xs text-gray-500">Processed</p>
            </div>
          </div>

          {/* Time remaining */}
          {isRunning && progress.estimatedSecondsRemaining != null && progress.estimatedSecondsRemaining > 0 && (
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
              <Clock size={14} />
              <span>
                ~{Math.ceil(progress.estimatedSecondsRemaining / 60)} minutes remaining
                ({progress.processingRatePerSecond}/sec)
              </span>
            </div>
          )}

          {/* Errors */}
          {progress.errors.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
              <p className="text-xs font-medium text-amber-800 mb-1">
                {progress.errors.length} warning(s)
              </p>
              <p className="text-xs text-amber-700 truncate">{progress.errors[0]}</p>
            </div>
          )}

          {/* Actions */}
          {isCompleted && (
            <button
              onClick={onComplete}
              className="w-full px-4 py-3 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors flex items-center justify-center gap-2"
            >
              View First Look Report <ArrowRight size={16} />
            </button>
          )}

          {isFailed && (
            <button
              onClick={startImport}
              className="w-full px-4 py-3 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors"
            >
              Retry Import
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {!isRunning && !isCompleted && (
        <div className="mt-4 text-center">
          <button
            onClick={onComplete}
            className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            Skip import, go to report
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Step 6: First Look Report ──────────────────────────────────────

function StepFirstLook({ apiKey }: { apiKey: string }) {
  const navigate = useNavigate();
  const [report, setReport] = useState<FirstLookReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function fetchReport() {
      try {
        const res = await fetch('/api/v1/first-look', {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!res.ok) throw new Error('Failed to load report');
        const data = await res.json();
        setReport(data);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchReport();
  }, [apiKey]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={32} className="animate-spin text-gray-400" />
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm text-red-700">{error || 'Failed to generate report'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-gray-900">Your First Look</h2>
        <p className="text-gray-500 mt-1">
          Here is what we found in your billing data
        </p>
      </div>

      {/* Revenue at risk hero */}
      {report.revenueImpact.totalOpenIssues > 0 ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-8 text-center mb-8">
          <p className="text-sm text-red-600 uppercase tracking-wider font-medium mb-2">
            Estimated Monthly Revenue at Risk
          </p>
          <p className="text-5xl font-bold text-red-700">
            {formatCents(report.revenueImpact.totalMonthlyRevenueCentsAtRisk)}
          </p>
          <p className="text-red-600 mt-2">
            across {report.revenueImpact.totalOpenIssues} detected issues
          </p>
        </div>
      ) : (
        <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center mb-8">
          <CheckCircle size={40} className="mx-auto text-green-600 mb-3" />
          <p className="text-lg font-semibold text-green-900">Looking Good</p>
          <p className="text-green-700 mt-1 text-sm">
            No critical issues detected yet. We will continue monitoring.
          </p>
        </div>
      )}

      {/* Overview stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
          <p className="text-3xl font-bold text-gray-900">
            {report.overview.totalSubscribers.toLocaleString()}
          </p>
          <p className="text-sm text-gray-500">Subscribers Found</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
          <p className="text-3xl font-bold text-gray-900">
            {report.overview.totalEventsProcessed.toLocaleString()}
          </p>
          <p className="text-sm text-gray-500">Events Processed</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
          <p className="text-3xl font-bold text-gray-900">
            {report.overview.activeSources.length}
          </p>
          <p className="text-sm text-gray-500">Sources Connected</p>
        </div>
      </div>

      {/* Subscriber health distribution */}
      {report.subscriberHealth.distribution.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h3 className="font-semibold text-gray-900 mb-4">Subscriber Health</h3>
          <div className="space-y-2">
            {report.subscriberHealth.distribution.map((d) => (
              <div key={d.state} className="flex items-center gap-3">
                <span className="text-sm text-gray-600 w-28 capitalize">
                  {d.state.replace(/_/g, ' ')}
                </span>
                <div className="flex-1 bg-gray-100 rounded-full h-3">
                  <div
                    className={`h-3 rounded-full ${
                      d.state === 'active' || d.state === 'trial'
                        ? 'bg-green-500'
                        : d.state === 'grace_period' || d.state === 'billing_retry'
                          ? 'bg-amber-500'
                          : d.state === 'expired' || d.state === 'revoked'
                            ? 'bg-red-500'
                            : 'bg-gray-400'
                    }`}
                    style={{ width: `${Math.max(d.percentage, 1)}%` }}
                  />
                </div>
                <span className="text-sm text-gray-500 w-16 text-right">
                  {d.count.toLocaleString()} ({d.percentage}%)
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Issues by severity */}
      {report.revenueImpact.bySeverity.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h3 className="font-semibold text-gray-900 mb-4">Issues by Severity</h3>
          <div className="grid grid-cols-3 gap-4">
            {report.revenueImpact.bySeverity.map((s) => (
              <div
                key={s.severity}
                className={`rounded-lg p-4 ${
                  s.severity === 'critical'
                    ? 'bg-red-50 border border-red-200'
                    : s.severity === 'warning'
                      ? 'bg-amber-50 border border-amber-200'
                      : 'bg-blue-50 border border-blue-200'
                }`}
              >
                <p className="text-xs uppercase font-medium text-gray-500 mb-1">{s.severity}</p>
                <p className="text-2xl font-bold text-gray-900">{s.count}</p>
                <p className="text-sm text-gray-600">{formatCents(s.revenueCents)} at risk</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top issues */}
      {report.topIssues.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h3 className="font-semibold text-gray-900 mb-4">Top Issues by Revenue Impact</h3>
          <div className="space-y-3">
            {report.topIssues.map((issue, i) => (
              <div
                key={issue.id}
                className="flex items-start gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer"
                onClick={() => navigate(`/issues/${issue.id}`)}
              >
                <span className="text-sm font-bold text-gray-400 w-6 flex-shrink-0">
                  #{i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{issue.title}</p>
                  <p className="text-xs text-gray-500 truncate">{issue.description}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <span
                    className={`inline-block px-2 py-0.5 text-xs rounded font-medium ${
                      issue.severity === 'critical'
                        ? 'bg-red-50 text-red-700'
                        : issue.severity === 'warning'
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-blue-50 text-blue-700'
                    }`}
                  >
                    {issue.severity}
                  </span>
                  <p className="text-sm font-medium text-gray-900 mt-1">
                    {formatCents(issue.estimatedRevenueCents)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Issues by type */}
      {report.revenueImpact.byType.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h3 className="font-semibold text-gray-900 mb-4">Issues by Type</h3>
          <div className="space-y-2">
            {report.revenueImpact.byType.map((t) => (
              <div key={t.issueType} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {t.issueType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                  </p>
                  <p className="text-xs text-gray-500">{t.count} issue{t.count !== 1 ? 's' : ''}</p>
                </div>
                <p className="text-sm font-medium text-gray-900">{formatCents(t.revenueCents)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CTA */}
      <div className="text-center mt-8">
        <button
          onClick={() => navigate('/')}
          className="px-8 py-3 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors inline-flex items-center gap-2"
        >
          Go to Full Dashboard <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}

// ─── Integration Health Card ────────────────────────────────────────

function IntegrationCard({ connection }: { connection: IntegrationHealth }) {
  const statusColors: Record<string, string> = {
    healthy: 'bg-green-500',
    stale: 'bg-amber-500',
    awaiting_first_webhook: 'bg-gray-400',
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg capitalize font-semibold text-gray-900">
            {connection.source}
          </span>
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              statusColors[connection.status] || 'bg-gray-400'
            }`}
          />
        </div>
        <span
          className={`px-2 py-0.5 text-xs rounded font-medium ${
            connection.connected
              ? 'bg-green-50 text-green-700'
              : 'bg-red-50 text-red-700'
          }`}
        >
          {connection.connected ? 'Connected' : 'Disconnected'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="text-gray-400 uppercase font-medium mb-0.5">Last Webhook</p>
          <p className="text-gray-700">
            {connection.lastWebhookAt
              ? connection.lastWebhookFreshness
              : 'Never'}
          </p>
        </div>
        <div>
          <p className="text-gray-400 uppercase font-medium mb-0.5">24h Deliveries</p>
          <p className="text-gray-700">{connection.webhookDeliveryRate24h}</p>
        </div>
        <div>
          <p className="text-gray-400 uppercase font-medium mb-0.5">Credentials</p>
          <p className={connection.credentialStatus === 'valid' ? 'text-green-700' : 'text-red-700'}>
            {connection.credentialStatus}
          </p>
        </div>
        <div>
          <p className="text-gray-400 uppercase font-medium mb-0.5">Sync Status</p>
          <p className="text-gray-700 capitalize">{connection.syncStatus || 'n/a'}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Shared Components ──────────────────────────────────────────────

function ChecklistItem({
  done,
  label,
  sublabel,
}: {
  done: boolean;
  label: string;
  sublabel: string;
}) {
  return (
    <div className="flex items-center gap-3">
      {done ? (
        <CheckCircle size={18} className="text-green-500 flex-shrink-0" />
      ) : (
        <Circle size={18} className="text-gray-300 flex-shrink-0" />
      )}
      <div>
        <p className={`text-sm font-medium ${done ? 'text-gray-900' : 'text-gray-400'}`}>
          {label}
        </p>
        <p className="text-xs text-gray-500">{sublabel}</p>
      </div>
    </div>
  );
}
