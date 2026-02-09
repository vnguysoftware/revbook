import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import { fetcher, apiFetch, getApiKey } from '../lib/api';
import { Card, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { PageHeader } from '../components/ui/PageHeader';
import {
  CheckCircle,
  Copy,
  Check,
  Play,
  Loader2,
  Terminal,
  Smartphone,
  Clock,
  ArrowRight,
  Shield,
} from 'lucide-react';

interface AccessCheckStats {
  accessChecksReceived: number;
  accessChecksToday: number;
}

export function AccessCheckSetupPage() {
  useEffect(() => { document.title = 'Connect Your App - RevBack'; }, []);

  const { data: stats } = useSWR<AccessCheckStats>(
    '/access-checks/stats',
    fetcher,
    { refreshInterval: 10000 },
  );

  const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const apiKey = getApiKey();
  const isConnected = (stats?.accessChecksReceived || 0) > 0;

  function copySnippet(id: string, text: string) {
    navigator.clipboard.writeText(text);
    setCopiedSnippet(id);
    setTimeout(() => setCopiedSnippet(null), 2000);
  }

  async function runTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await apiFetch<{ ok: boolean; userResolved: boolean }>('/access-checks/test', {
        method: 'POST',
        body: JSON.stringify({
          user: 'test-user-123',
          hasAccess: true,
        }),
      });
      setTestResult({
        ok: true,
        message: result.userResolved
          ? 'Connection successful! User was resolved to an existing account.'
          : 'Connection successful! User ID was not matched to an existing user (this is normal for test data).',
      });
    } catch (err: any) {
      setTestResult({ ok: false, message: err.message || 'Connection test failed' });
    } finally {
      setTesting(false);
    }
  }

  const nodeSnippet = `// Add to your access-check logic
async function reportAccessToRevBack(userId, hasAccess) {
  await fetch('${window.location.origin}/api/v1/access-checks', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer YOUR_API_KEY',
    },
    body: JSON.stringify({ user: userId, hasAccess }),
  });
}

// In your existing access check:
const hasAccess = await checkUserAccess(userId);
reportAccessToRevBack(userId, hasAccess); // fire and forget`;

  const pythonSnippet = `# Add to your access-check logic
import requests

def report_access_to_revback(user_id: str, has_access: bool):
    requests.post(
        "${window.location.origin}/api/v1/access-checks",
        json={"user": user_id, "hasAccess": has_access},
        headers={"Authorization": "Bearer YOUR_API_KEY"},
        timeout=5,
    )

# In your existing access check:
has_access = check_user_access(user_id)
report_access_to_revback(user_id, has_access)  # fire and forget`;

  const swiftSnippet = `// Add to your StoreKit access check
func reportAccessToRevBack(userId: String, hasAccess: Bool) {
    var request = URLRequest(
        url: URL(string: "${window.location.origin}/api/v1/access-checks")!
    )
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("Bearer YOUR_API_KEY", forHTTPHeaderField: "Authorization")
    request.httpBody = try? JSONEncoder().encode([
        "user": userId, "hasAccess": hasAccess ? "true" : "false"
    ])
    URLSession.shared.dataTask(with: request).resume()
}`;

  const kotlinSnippet = `// Add to your BillingClient access check
fun reportAccessToRevBack(userId: String, hasAccess: Boolean) {
    val client = OkHttpClient()
    val body = """{"user":"$userId","hasAccess":$hasAccess}"""
        .toRequestBody("application/json".toMediaType())
    val request = Request.Builder()
        .url("${window.location.origin}/api/v1/access-checks")
        .post(body)
        .addHeader("Authorization", "Bearer YOUR_API_KEY")
        .build()
    client.newCall(request).enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) {}
        override fun onResponse(call: Call, response: Response) {}
    })
}`;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <PageHeader
        title="Connect Your App"
        subtitle="Get real-time access verification and catch issues billing data alone can't see"
        breadcrumbs={[
          { label: 'Setup', to: '/setup' },
          { label: 'Connect Your App' },
        ]}
      />

      {/* Status Banner */}
      <Card padding="lg" className="mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isConnected ? (
              <>
                <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                  <CheckCircle size={20} className="text-green-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">App Integration Active</p>
                  <p className="text-xs text-gray-500">
                    Receiving access checks: <span className="font-medium text-green-600">{stats?.accessChecksToday || 0} today</span>
                    {' '}({stats?.accessChecksReceived || 0} total)
                  </p>
                </div>
              </>
            ) : (
              <>
                <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
                  <Shield size={20} className="text-gray-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">No Access Checks Yet</p>
                  <p className="text-xs text-gray-500">
                    Follow the steps below to start sending access-check data
                  </p>
                </div>
              </>
            )}
          </div>
          {isConnected && (
            <Badge variant="success">Connected</Badge>
          )}
        </div>
      </Card>

      {/* What you get */}
      <Card padding="lg" className="mb-6">
        <CardHeader
          title="What This Enables"
          subtitle="Access checks unlock verified detection that billing data alone can't provide"
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-lg bg-gray-50 border border-gray-100">
            <p className="text-sm font-semibold text-gray-900 mb-1">Paid But No Access</p>
            <p className="text-xs text-gray-500">
              Detect when a paying customer can't actually use your product.
              Critical for customer satisfaction and churn prevention.
            </p>
          </div>
          <div className="p-4 rounded-lg bg-gray-50 border border-gray-100">
            <p className="text-sm font-semibold text-gray-900 mb-1">Access Without Payment</p>
            <p className="text-xs text-gray-500">
              Detect when a user has access despite an expired or revoked subscription.
              Directly impacts your revenue.
            </p>
          </div>
        </div>
      </Card>

      {/* Integration Modes */}
      <Card padding="lg" className="mb-6">
        <CardHeader title="Choose Your Integration Mode" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="p-4 rounded-lg border-2 border-brand-500 bg-brand-50/30">
            <div className="flex items-center gap-2 mb-2">
              <Terminal size={16} className="text-brand-600" />
              <p className="text-sm font-semibold text-gray-900">Real-time</p>
              <Badge variant="info" size="sm">Recommended</Badge>
            </div>
            <p className="text-xs text-gray-500">
              Add one line to your existing access-check code. RevBack receives data
              as your app checks access, enabling instant detection.
            </p>
          </div>
          <div className="p-4 rounded-lg border border-gray-200">
            <div className="flex items-center gap-2 mb-2">
              <Clock size={16} className="text-gray-600" />
              <p className="text-sm font-semibold text-gray-900">Batch</p>
              <Badge variant="neutral" size="sm">Easiest</Badge>
            </div>
            <p className="text-xs text-gray-500">
              Add a nightly cron job that syncs all user access states.
              Uses the <code className="text-xs font-mono bg-gray-100 px-1 rounded">/batch</code> endpoint.
            </p>
          </div>
        </div>
      </Card>

      {/* API Key Reminder */}
      <Card padding="md" className="mb-6">
        <div className="flex items-center gap-3">
          <Shield size={16} className="text-gray-400" />
          <p className="text-sm text-gray-600">
            Use the same API key from your billing setup. Replace <code className="text-xs font-mono bg-gray-100 px-1 rounded">YOUR_API_KEY</code> in the snippets below.
          </p>
        </div>
      </Card>

      {/* Code Snippets */}
      <div className="space-y-4 mb-6">
        <h3 className="text-sm font-semibold text-gray-900">Add one line to your access-check code</h3>

        <SnippetCard
          title="Node.js / TypeScript"
          language="javascript"
          code={nodeSnippet}
          copied={copiedSnippet === 'node'}
          onCopy={() => copySnippet('node', nodeSnippet)}
        />
        <SnippetCard
          title="Python"
          language="python"
          code={pythonSnippet}
          copied={copiedSnippet === 'python'}
          onCopy={() => copySnippet('python', pythonSnippet)}
        />
        <SnippetCard
          title="Swift (iOS)"
          language="swift"
          code={swiftSnippet}
          copied={copiedSnippet === 'swift'}
          onCopy={() => copySnippet('swift', swiftSnippet)}
        />
        <SnippetCard
          title="Kotlin (Android)"
          language="kotlin"
          code={kotlinSnippet}
          copied={copiedSnippet === 'kotlin'}
          onCopy={() => copySnippet('kotlin', kotlinSnippet)}
        />
      </div>

      {/* Test Integration */}
      <Card padding="lg" className="mb-6">
        <CardHeader title="Test Your Integration" subtitle="Send a test access check to verify connectivity" />
        <div className="flex items-center gap-3">
          <button
            onClick={runTest}
            disabled={testing}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700 transition-colors disabled:opacity-50"
          >
            {testing ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
            {testing ? 'Testing...' : 'Send Test Check'}
          </button>
          {testResult && (
            <div className={`flex items-center gap-2 text-sm ${testResult.ok ? 'text-green-600' : 'text-red-600'}`}>
              {testResult.ok ? <CheckCircle size={14} /> : <Shield size={14} />}
              {testResult.message}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function SnippetCard({
  title,
  language,
  code,
  copied,
  onCopy,
}: {
  title: string;
  language: string;
  code: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <Card padding="md">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-gray-700">{title}</span>
        <button
          onClick={onCopy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
        >
          {copied ? <Check size={13} className="text-green-600" /> : <Copy size={13} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="text-xs bg-gray-900 text-gray-300 rounded-lg p-4 overflow-x-auto font-mono leading-relaxed">
        {code}
      </pre>
    </Card>
  );
}
