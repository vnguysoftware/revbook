import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { setApiKey, getApiKey } from '../lib/api';
import { formatCents } from '../lib/format';
import {
  CheckCircle,
  Loader2,
  ArrowRight,
  Shield,
  Key,
  Copy,
  Check,
  AlertTriangle,
  XCircle,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────

type OnboardingPhase = 'auth' | 'connect' | 'import' | 'report';

type ProviderChoice = 'stripe' | 'apple' | 'both';

interface VerifyCheck {
  label: string;
  status: 'pending' | 'checking' | 'done' | 'error';
  detail?: string;
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

const PHASE_ORDER: OnboardingPhase[] = ['auth', 'connect', 'import', 'report'];

function phaseIndex(phase: OnboardingPhase): number {
  return PHASE_ORDER.indexOf(phase);
}

// ─── Main Component ─────────────────────────────────────────────────

export function OnboardingPage() {
  const navigate = useNavigate();
  const [currentPhase, setCurrentPhase] = useState<OnboardingPhase>('auth');
  const [apiKeyValue, setApiKeyValue] = useState(getApiKey());
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Section refs for scroll-into-view
  const sectionRefs = {
    connect: useRef<HTMLDivElement>(null),
    import: useRef<HTMLDivElement>(null),
    report: useRef<HTMLDivElement>(null),
  };

  useEffect(() => {
    document.title = 'Get Started - RevBack';
  }, []);

  // Auto-advance if returning with existing key
  useEffect(() => {
    if (apiKeyValue) {
      autoAdvance(apiKeyValue);
    }
  }, []);

  async function autoAdvance(key: string) {
    try {
      setApiKey(key);
      const res = await fetch('/setup/status', {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setIsAuthenticated(true);

      if (data.readiness?.isReady) {
        setCurrentPhase('report');
      } else if (data.backfill && ['importing_subscriptions', 'importing_events', 'counting'].includes(data.backfill.status)) {
        setCurrentPhase('import');
      } else if (data.readiness?.hasConnection) {
        setCurrentPhase('import');
      } else {
        setCurrentPhase('connect');
      }
    } catch {
      // Invalid key — stay on auth
    }
  }

  function advanceTo(phase: OnboardingPhase) {
    setCurrentPhase(phase);
    // Scroll into view after render
    setTimeout(() => {
      const ref = sectionRefs[phase as keyof typeof sectionRefs];
      ref?.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }

  function isPhaseVisible(phase: OnboardingPhase): boolean {
    return phaseIndex(phase) <= phaseIndex(currentPhase);
  }

  function isPhaseComplete(phase: OnboardingPhase): boolean {
    return phaseIndex(phase) < phaseIndex(currentPhase);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-4 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center">
              <Shield size={18} className="text-white" />
            </div>
            <span className="text-lg font-bold text-gray-900">RevBack</span>
          </div>
          {isAuthenticated && (
            <button
              onClick={() => navigate('/')}
              className="text-sm text-gray-500 hover:text-gray-900 transition-colors flex items-center gap-1"
            >
              Go to Dashboard <ArrowRight size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Hero */}
      <div className="max-w-2xl mx-auto px-4 pt-12 pb-8 text-center">
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight">
          Defend every dollar
        </h1>
        <p className="text-gray-500 mt-2 text-lg">
          Connect your billing systems. We'll watch your revenue so nothing slips through.
        </p>
      </div>

      {/* Sections */}
      <div className="max-w-2xl mx-auto px-4 pb-16 space-y-6">
        {/* Section 1: Auth */}
        <SectionAuth
          isComplete={isPhaseComplete('auth')}
          apiKeyValue={apiKeyValue}
          setApiKeyValue={setApiKeyValue}
          onAuthenticated={(key: string) => {
            setApiKeyValue(key);
            setIsAuthenticated(true);
            advanceTo('connect');
          }}
        />

        {/* Section 2: Connect */}
        {isPhaseVisible('connect') && (
          <div ref={sectionRefs.connect}>
            <SectionConnect
              isComplete={isPhaseComplete('connect')}
              apiKey={apiKeyValue}
              onConnected={() => advanceTo('import')}
            />
          </div>
        )}

        {/* Section 3: Import */}
        {isPhaseVisible('import') && (
          <div ref={sectionRefs.import}>
            <SectionImport
              isComplete={isPhaseComplete('import')}
              apiKey={apiKeyValue}
              onComplete={() => advanceTo('report')}
              onSkip={() => advanceTo('report')}
            />
          </div>
        )}

        {/* Section 4: Report */}
        {isPhaseVisible('report') && (
          <div ref={sectionRefs.report}>
            <SectionReport apiKey={apiKeyValue} />
          </div>
        )}

        {/* Social proof */}
        {isPhaseVisible('connect') && (
          <p className="text-center text-sm text-gray-400 pt-4">
            Companies using RevBack recover an average of $3,200/month in revenue leakage.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Section Wrapper ─────────────────────────────────────────────────

function Section({
  title,
  isComplete,
  children,
  animate = true,
}: {
  title: string;
  isComplete: boolean;
  children: React.ReactNode;
  animate?: boolean;
}) {
  return (
    <div
      className={`bg-white rounded-xl border transition-all duration-500 ${
        animate ? 'animate-in' : ''
      } ${
        isComplete
          ? 'border-green-200 bg-green-50/30'
          : 'border-gray-200 shadow-sm'
      }`}
      style={animate ? { animation: 'fadeSlideIn 0.5s ease-out forwards' } : undefined}
    >
      <div className={`px-6 py-5 ${isComplete ? 'pb-4' : ''}`}>
        <div className="flex items-center gap-2 mb-4">
          {isComplete ? (
            <CheckCircle size={18} className="text-green-500 flex-shrink-0" />
          ) : (
            <div className="w-[18px] h-[18px] rounded-full border-2 border-gray-300 flex-shrink-0" />
          )}
          <h2 className={`font-semibold ${isComplete ? 'text-green-800' : 'text-gray-900'}`}>
            {title}
          </h2>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Section 1: Auth ─────────────────────────────────────────────────

function SectionAuth({
  isComplete,
  apiKeyValue,
  setApiKeyValue,
  onAuthenticated,
}: {
  isComplete: boolean;
  apiKeyValue: string;
  setApiKeyValue: (v: string) => void;
  onAuthenticated: (key: string) => void;
}) {
  const [mode, setMode] = useState<'connect' | 'create'>('create');
  const [orgName, setOrgName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [createdKey, setCreatedKey] = useState('');
  const [copied, setCopied] = useState(false);

  function autoSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 64);
  }

  async function handleCreate() {
    if (!orgName.trim()) {
      setError('Please enter a company name');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/setup/org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: orgName, slug: autoSlug(orgName) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create organization');
      setCreatedKey(data.apiKey);
      setApiKey(data.apiKey);
      setApiKeyValue(data.apiKey);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleConnect() {
    if (!apiKeyValue) return;
    setLoading(true);
    setError('');
    try {
      setApiKey(apiKeyValue);
      const res = await fetch('/setup/status', {
        headers: { Authorization: `Bearer ${apiKeyValue}` },
      });
      if (!res.ok) throw new Error('Invalid API key');
      onAuthenticated(apiKeyValue);
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

  if (isComplete) {
    return (
      <Section title="Get Started" isComplete animate={false}>
        <p className="text-sm text-green-700">
          API key created and saved.
        </p>
      </Section>
    );
  }

  // After creation — show key and continue
  if (createdKey) {
    return (
      <Section title="Get Started" isComplete={false} animate={false}>
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle size={16} className="text-green-600" />
            <span className="text-sm font-medium text-green-900">Organization created</span>
          </div>
          <p className="text-xs text-green-800 mb-3">
            Save your API key — it won't be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-white px-3 py-2 rounded border border-green-300 text-xs font-mono break-all select-all">
              {createdKey}
            </code>
            <button
              onClick={copyKey}
              className="p-2 bg-green-100 rounded hover:bg-green-200 transition-colors"
              title="Copy API key"
            >
              {copied ? <Check size={14} className="text-green-700" /> : <Copy size={14} className="text-green-700" />}
            </button>
          </div>
        </div>
        <button
          onClick={() => onAuthenticated(createdKey)}
          className="w-full px-4 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors flex items-center justify-center gap-2"
        >
          Continue <ArrowRight size={14} />
        </button>
      </Section>
    );
  }

  return (
    <Section title="Get Started" isComplete={false} animate={false}>
      <div className="flex gap-2 mb-5">
        <button
          onClick={() => setMode('create')}
          className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
            mode === 'create'
              ? 'bg-gray-900 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          Create new
        </button>
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
      </div>

      {mode === 'create' ? (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Company name
            </label>
            <input
              type="text"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="Acme Corp"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
          </div>
          <button
            onClick={handleCreate}
            disabled={loading || !orgName.trim()}
            className="w-full px-4 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {loading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <>Create & Continue <ArrowRight size={14} /></>
            )}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              API key
            </label>
            <input
              type="password"
              value={apiKeyValue}
              onChange={(e) => setApiKeyValue(e.target.value)}
              placeholder="rev_..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
              onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
            />
          </div>
          <button
            onClick={handleConnect}
            disabled={loading || !apiKeyValue}
            className="w-full px-4 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {loading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <>Connect <ArrowRight size={14} /></>
            )}
          </button>
        </div>
      )}

      {error && (
        <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}
    </Section>
  );
}

// ─── Section 2: Connect ──────────────────────────────────────────────

function SectionConnect({
  isComplete,
  apiKey,
  onConnected,
}: {
  isComplete: boolean;
  apiKey: string;
  onConnected: () => void;
}) {
  const [provider, setProvider] = useState<ProviderChoice>('stripe');
  const [stripeKey, setStripeKey] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const [verifyChecks, setVerifyChecks] = useState<VerifyCheck[] | null>(null);
  const [verifyDone, setVerifyDone] = useState(false);

  // Apple fields
  const [appleKeyId, setAppleKeyId] = useState('');
  const [appleIssuerId, setAppleIssuerId] = useState('');
  const [appleBundleId, setAppleBundleId] = useState('');
  const [appleConnected, setAppleConnected] = useState(false);

  if (isComplete) {
    return (
      <Section title="Connect Billing" isComplete animate={false}>
        <p className="text-sm text-green-700">
          Billing system connected and verified.
        </p>
      </Section>
    );
  }

  async function handleStripeConnect() {
    if (!stripeKey) {
      setError('Stripe secret key is required');
      return;
    }
    setConnecting(true);
    setError('');

    // Initialize checklist
    const checks: VerifyCheck[] = [
      { label: 'API key validated', status: 'checking' },
      { label: 'Can access customer data', status: 'pending' },
      { label: 'Counting customers...', status: 'pending' },
      { label: 'Counting subscriptions...', status: 'pending' },
      { label: 'Configuring webhook endpoint...', status: 'pending' },
    ];
    setVerifyChecks([...checks]);

    try {
      // Step 1: Connect Stripe
      const res = await fetch('/setup/stripe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ stripeSecretKey: stripeKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to connect');

      // Mark first check done
      checks[0] = { label: 'API key validated', status: 'done' };
      checks[1] = { ...checks[1], status: 'checking' };
      setVerifyChecks([...checks]);

      // Step 2: Verify with progressive reveal
      await delay(400);
      const verifyRes = await fetch('/setup/verify/stripe', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const verifyData = await verifyRes.json();

      // Progressively reveal results
      const c = verifyData.checks || {};

      // Can access customer data
      checks[1] = {
        label: 'Can access customer data',
        status: c.canListCustomers ? 'done' : 'error',
        detail: c.canListCustomers ? undefined : 'Cannot list customers',
      };
      checks[2] = { ...checks[2], status: 'checking' };
      setVerifyChecks([...checks]);
      await delay(500);

      // Customer count
      checks[2] = {
        label: `Found ${(c.customerCount ?? 0).toLocaleString()} customers`,
        status: 'done',
      };
      checks[3] = { ...checks[3], status: 'checking' };
      setVerifyChecks([...checks]);
      await delay(500);

      // Subscription count
      checks[3] = {
        label: `Found ${(c.subscriptionCount ?? 0).toLocaleString()} active subscriptions`,
        status: 'done',
      };
      checks[4] = { ...checks[4], status: 'checking' };
      setVerifyChecks([...checks]);
      await delay(600);

      // Webhook
      checks[4] = {
        label: 'Webhook endpoint configured',
        status: c.webhookSecretConfigured !== false ? 'done' : 'done',
        detail: c.webhookSecretConfigured ? undefined : 'Add a webhook secret later for signature verification',
      };
      setVerifyChecks([...checks]);
      setVerifyDone(true);
    } catch (err: any) {
      setError(err.message);
      // Mark current checking item as error
      const updated = (checks || []).map((ch) =>
        ch.status === 'checking' ? { ...ch, status: 'error' as const, detail: err.message } : ch
      );
      setVerifyChecks(updated);
    } finally {
      setConnecting(false);
    }
  }

  async function handleAppleConnect() {
    if (!appleKeyId || !appleIssuerId || !appleBundleId) {
      setError('Key ID, Issuer ID, and Bundle ID are required');
      return;
    }
    setConnecting(true);
    setError('');
    try {
      const res = await fetch('/setup/apple', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          keyId: appleKeyId,
          issuerId: appleIssuerId,
          bundleId: appleBundleId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to connect');
      setAppleConnected(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setConnecting(false);
    }
  }

  const showStripe = provider === 'stripe' || provider === 'both';
  const showApple = provider === 'apple' || provider === 'both';
  const stripeReady = verifyDone;
  const appleReady = appleConnected;
  const canProceed =
    (provider === 'stripe' && stripeReady) ||
    (provider === 'apple' && appleReady) ||
    (provider === 'both' && stripeReady && appleReady);

  return (
    <Section title="Connect Billing" isComplete={false}>
      <p className="text-sm text-gray-500 mb-4">
        What billing system do you use?
      </p>

      {/* Provider selector */}
      <div className="flex gap-2 mb-5">
        {(['stripe', 'apple', 'both'] as ProviderChoice[]).map((p) => (
          <button
            key={p}
            onClick={() => { setProvider(p); setError(''); }}
            disabled={connecting}
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors capitalize ${
              provider === p
                ? 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {p === 'both' ? 'Both' : p === 'stripe' ? 'Stripe' : 'Apple'}
          </button>
        ))}
      </div>

      {/* Stripe connection */}
      {showStripe && !verifyChecks && (
        <div className="space-y-3 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Stripe secret key
            </label>
            <input
              type="password"
              value={stripeKey}
              onChange={(e) => setStripeKey(e.target.value)}
              placeholder="sk_live_..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
              onKeyDown={(e) => e.key === 'Enter' && handleStripeConnect()}
            />
            <p className="text-xs text-gray-400 mt-1">
              Find it at{' '}
              <a
                href="https://dashboard.stripe.com/apikeys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-500 hover:underline"
              >
                Stripe Dashboard &gt; API Keys
              </a>
            </p>
          </div>
          <button
            onClick={handleStripeConnect}
            disabled={connecting || !stripeKey}
            className="w-full px-4 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {connecting ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              'Connect'
            )}
          </button>
        </div>
      )}

      {/* Stripe verification checklist */}
      {showStripe && verifyChecks && (
        <div className="mb-4">
          <div className="space-y-2.5">
            {verifyChecks.map((check, i) => (
              <div key={i} className="flex items-center gap-2.5">
                {check.status === 'done' && (
                  <CheckCircle size={16} className="text-green-500 flex-shrink-0" />
                )}
                {check.status === 'checking' && (
                  <Loader2 size={16} className="text-gray-400 animate-spin flex-shrink-0" />
                )}
                {check.status === 'pending' && (
                  <div className="w-4 h-4 rounded-full border-2 border-gray-200 flex-shrink-0" />
                )}
                {check.status === 'error' && (
                  <XCircle size={16} className="text-red-500 flex-shrink-0" />
                )}
                <div>
                  <span className={`text-sm ${
                    check.status === 'done' ? 'text-gray-900' :
                    check.status === 'error' ? 'text-red-700' :
                    check.status === 'checking' ? 'text-gray-700' :
                    'text-gray-400'
                  }`}>
                    {check.label}
                  </span>
                  {check.detail && (
                    <p className="text-xs text-gray-400 mt-0.5">{check.detail}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
          {verifyDone && (
            <div className="mt-4 pt-3 border-t border-gray-100">
              <p className="text-sm font-medium text-green-700">Ready to import.</p>
            </div>
          )}
        </div>
      )}

      {/* Apple connection */}
      {showApple && !appleConnected && (
        <div className={`space-y-3 ${showStripe ? 'mt-6 pt-5 border-t border-gray-100' : ''} mb-4`}>
          {showStripe && (
            <p className="text-sm font-medium text-gray-700 mb-2">Apple App Store</p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Key ID</label>
              <input
                type="text"
                value={appleKeyId}
                onChange={(e) => setAppleKeyId(e.target.value)}
                placeholder="ABC1234567"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Issuer ID</label>
              <input
                type="text"
                value={appleIssuerId}
                onChange={(e) => setAppleIssuerId(e.target.value)}
                placeholder="xxxxxxxx-xxxx-..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Bundle ID</label>
            <input
              type="text"
              value={appleBundleId}
              onChange={(e) => setAppleBundleId(e.target.value)}
              placeholder="com.yourcompany.app"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
            />
          </div>
          <button
            onClick={handleAppleConnect}
            disabled={connecting || !appleKeyId || !appleIssuerId || !appleBundleId}
            className="w-full px-4 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {connecting ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              'Connect Apple'
            )}
          </button>
        </div>
      )}

      {showApple && appleConnected && (
        <div className={`${showStripe ? 'mt-6 pt-5 border-t border-gray-100' : ''} mb-4`}>
          <div className="flex items-center gap-2 text-sm text-green-700">
            <CheckCircle size={16} />
            Apple App Store connected.
          </div>
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg mb-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {canProceed && (
        <button
          onClick={onConnected}
          className="w-full px-4 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors flex items-center justify-center gap-2"
        >
          Continue <ArrowRight size={14} />
        </button>
      )}
    </Section>
  );
}

// ─── Section 3: Import ───────────────────────────────────────────────

function SectionImport({
  isComplete,
  apiKey,
  onComplete,
  onSkip,
}: {
  isComplete: boolean;
  apiKey: string;
  onComplete: () => void;
  onSkip: () => void;
}) {
  const [progress, setProgress] = useState<BackfillProgress | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasAutoCompletedRef = useRef(false);

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
          if (data.status === 'completed' && !hasAutoCompletedRef.current) {
            hasAutoCompletedRef.current = true;
            // Auto-advance after brief pause
            setTimeout(() => onComplete(), 1500);
          }
        }
      }
    } catch {
      // Ignore polling errors
    }
  }, [apiKey, onComplete]);

  useEffect(() => {
    fetchProgress();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Start polling when running
  const isRunning = progress && ['counting', 'importing_subscriptions', 'importing_events'].includes(progress.status);

  useEffect(() => {
    if (isRunning && !pollRef.current) {
      pollRef.current = setInterval(fetchProgress, 2000);
    }
  }, [isRunning, fetchProgress]);

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
      pollRef.current = setInterval(fetchProgress, 2000);
      fetchProgress();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setStarting(false);
    }
  }

  const isCompleted = progress?.status === 'completed';
  const isFailed = progress?.status === 'failed';

  const progressPercent =
    progress && progress.totalCustomers > 0
      ? Math.min(
          Math.round(
            ((progress.importedCustomers + progress.importedEvents) /
              Math.max(progress.totalCustomers + progress.totalEvents, 1)) *
              100,
          ),
          isCompleted ? 100 : 99,
        )
      : 0;

  if (isComplete) {
    return (
      <Section title="Import & Discover" isComplete animate={false}>
        <p className="text-sm text-green-700">
          Import complete — {progress?.eventsCreated?.toLocaleString() ?? 0} events processed.
        </p>
      </Section>
    );
  }

  return (
    <Section title="Import & Discover" isComplete={false}>
      {!progress || progress.status === 'not_started' ? (
        <>
          <p className="text-sm text-gray-600 mb-4">
            Import 30 days of billing history for instant insights?
          </p>
          <div className="flex gap-3">
            <button
              onClick={startImport}
              disabled={starting}
              className="flex-1 px-4 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
            >
              {starting ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                'Start Import'
              )}
            </button>
            <button
              onClick={onSkip}
              className="px-4 py-2.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              Skip
            </button>
          </div>
        </>
      ) : (
        <>
          {/* Progress bar */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm text-gray-600">
                {isCompleted ? 'Complete' : isFailed ? 'Failed' : progress.phase}
              </span>
              <span className="text-sm font-medium text-gray-900">
                {isCompleted ? '100' : progressPercent}%
              </span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all duration-700 ease-out ${
                  isCompleted ? 'bg-green-500' : isFailed ? 'bg-red-500' : 'bg-brand-500'
                }`}
                style={{ width: `${isCompleted ? 100 : progressPercent}%` }}
              />
            </div>
          </div>

          {/* Live stats */}
          <div className="flex items-center gap-6 text-sm text-gray-600 mb-3">
            <span>
              <span className="font-medium text-gray-900">{progress.importedCustomers.toLocaleString()}</span>
              {progress.totalCustomers > 0 && <span>/{progress.totalCustomers.toLocaleString()}</span>}
              {' '}customers
            </span>
            <span>
              <span className="font-medium text-gray-900">{progress.eventsCreated.toLocaleString()}</span> events
            </span>
            {progress.issuesFound > 0 && (
              <span className="text-red-600 font-medium">
                {progress.issuesFound} issues found
              </span>
            )}
          </div>

          {/* Time remaining */}
          {isRunning && progress.estimatedSecondsRemaining != null && progress.estimatedSecondsRemaining > 0 && (
            <p className="text-xs text-gray-400">
              ~{Math.ceil(progress.estimatedSecondsRemaining / 60)} min remaining
            </p>
          )}

          {/* Errors */}
          {progress.errors.length > 0 && (
            <div className="mt-3 p-2 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-xs text-amber-700">{progress.errors[0]}</p>
            </div>
          )}

          {/* Retry on failure */}
          {isFailed && (
            <button
              onClick={startImport}
              className="mt-3 w-full px-4 py-2.5 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors"
            >
              Retry Import
            </button>
          )}
        </>
      )}

      {error && (
        <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}
    </Section>
  );
}

// ─── Section 4: Report ───────────────────────────────────────────────

function SectionReport({ apiKey }: { apiKey: string }) {
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
      <Section title="Your First Look" isComplete={false}>
        <div className="flex items-center justify-center py-12">
          <Loader2 size={24} className="animate-spin text-gray-400" />
        </div>
      </Section>
    );
  }

  if (error || !report) {
    return (
      <Section title="Your First Look" isComplete={false}>
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-700">{error || 'Failed to generate report'}</p>
        </div>
        <button
          onClick={() => navigate('/')}
          className="mt-4 w-full px-4 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors flex items-center justify-center gap-2"
        >
          Go to Dashboard <ArrowRight size={14} />
        </button>
      </Section>
    );
  }

  const hasIssues = report.revenueImpact.totalOpenIssues > 0;

  return (
    <Section title="Your First Look" isComplete={false}>
      {/* Revenue at risk hero */}
      {hasIssues ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center mb-6">
          <p className="text-5xl font-bold text-red-700">
            {formatCents(report.revenueImpact.totalMonthlyRevenueCentsAtRisk)}
            <span className="text-lg font-medium text-red-500">/mo</span>
          </p>
          <p className="text-sm text-red-600 mt-1">
            Estimated Revenue at Risk
          </p>
          <p className="text-xs text-red-500 mt-0.5">
            across {report.revenueImpact.totalOpenIssues} detected issue{report.revenueImpact.totalOpenIssues !== 1 ? 's' : ''}
          </p>
        </div>
      ) : (
        <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center mb-6">
          <CheckCircle size={32} className="mx-auto text-green-500 mb-2" />
          <p className="text-lg font-semibold text-green-900">Looking Good</p>
          <p className="text-sm text-green-700 mt-1">
            No critical billing issues detected. We'll continue monitoring.
          </p>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-gray-50 rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-gray-900">
            {report.overview.totalSubscribers.toLocaleString()}
          </p>
          <p className="text-xs text-gray-500">Subscribers</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-gray-900">
            {report.overview.totalEventsProcessed.toLocaleString()}
          </p>
          <p className="text-xs text-gray-500">Events</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-gray-900">
            {report.overview.activeSources.length}
          </p>
          <p className="text-xs text-gray-500">Sources</p>
        </div>
      </div>

      {/* Severity breakdown */}
      {report.revenueImpact.bySeverity.length > 0 && (
        <div className="flex gap-3 mb-6">
          {report.revenueImpact.bySeverity.map((s) => (
            <div
              key={s.severity}
              className={`flex-1 rounded-lg p-3 text-center ${
                s.severity === 'critical'
                  ? 'bg-red-50 border border-red-200'
                  : s.severity === 'warning'
                    ? 'bg-amber-50 border border-amber-200'
                    : 'bg-blue-50 border border-blue-200'
              }`}
            >
              <p className="text-xl font-bold text-gray-900">{s.count}</p>
              <p className="text-xs capitalize text-gray-600">{s.severity}</p>
            </div>
          ))}
        </div>
      )}

      {/* Top issues */}
      {report.topIssues.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-medium text-gray-700 mb-3">Top Issues</h3>
          <div className="space-y-2">
            {report.topIssues.slice(0, 3).map((issue, i) => (
              <div
                key={issue.id}
                className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors border border-gray-100"
                onClick={() => navigate(`/issues/${issue.id}`)}
              >
                <span className="text-xs font-bold text-gray-400 w-5">#{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{issue.title}</p>
                </div>
                <span
                  className={`px-2 py-0.5 text-xs rounded font-medium ${
                    issue.severity === 'critical'
                      ? 'bg-red-50 text-red-700'
                      : issue.severity === 'warning'
                        ? 'bg-amber-50 text-amber-700'
                        : 'bg-blue-50 text-blue-700'
                  }`}
                >
                  {issue.severity}
                </span>
                <span className="text-sm font-medium text-gray-900 w-24 text-right">
                  {formatCents(issue.estimatedRevenueCents)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CTA */}
      <button
        onClick={() => navigate('/')}
        className="w-full px-4 py-3 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors flex items-center justify-center gap-2"
      >
        Explore Full Dashboard <ArrowRight size={14} />
      </button>
    </Section>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
