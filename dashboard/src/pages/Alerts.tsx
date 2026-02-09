import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';
import { Card, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { SkeletonCard } from '../components/ui/Skeleton';
import {
  Plus,
  Trash2,
  Send,
  ToggleLeft,
  ToggleRight,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  Bell,
  Hash,
  Mail,
  AlertTriangle,
  MessageSquare,
  ExternalLink,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────

interface AlertConfig {
  id: string;
  orgId: string;
  channel: 'slack' | 'email';
  config: {
    webhookUrl?: string;
    channelName?: string;
    recipients?: string[];
  };
  severityFilter: string[];
  issueTypes: string[] | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface DeliveryLog {
  id: string;
  alertConfigId: string;
  issueId: string | null;
  channel: 'slack' | 'email';
  status: string;
  errorMessage: string | null;
  sentAt: string;
}

// ─── Component ──────────────────────────────────────────────────────

export function AlertsPage() {
  useEffect(() => { document.title = 'Alerts - RevBack'; }, []);

  const [configs, setConfigs] = useState<AlertConfig[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Form state
  const [showNewForm, setShowNewForm] = useState(false);
  const [newChannel, setNewChannel] = useState<'slack' | 'email'>('slack');
  const [slackWebhookUrl, setSlackWebhookUrl] = useState('');
  const [slackChannelName, setSlackChannelName] = useState('');
  const [emailRecipients, setEmailRecipients] = useState('');
  const [severityFilter, setSeverityFilter] = useState<string[]>(['critical', 'warning', 'info']);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  const showSuccess = useCallback((msg: string) => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(''), 3000);
  }, []);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [configRes, historyRes] = await Promise.all([
        apiFetch<{ alertConfigs: AlertConfig[] }>('/alerts'),
        apiFetch<{ deliveries: DeliveryLog[] }>('/alerts/history?limit=10'),
      ]);
      setConfigs(configRes.alertConfigs);
      setDeliveries(historyRes.deliveries);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleCreate() {
    setSaving(true);
    setError('');
    try {
      const config: Record<string, unknown> = {};
      if (newChannel === 'slack') {
        config.webhookUrl = slackWebhookUrl;
        if (slackChannelName) config.channelName = slackChannelName;
      } else {
        config.recipients = emailRecipients.split(',').map(e => e.trim()).filter(Boolean);
      }

      await apiFetch('/alerts', {
        method: 'POST',
        body: JSON.stringify({
          channel: newChannel,
          config,
          severityFilter,
        }),
      });

      showSuccess(`${newChannel === 'slack' ? 'Slack' : 'Email'} alert configured successfully`);
      setShowNewForm(false);
      resetForm();
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(config: AlertConfig) {
    try {
      await apiFetch(`/alerts/${config.id}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: !config.enabled }),
      });
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this alert configuration?')) return;
    try {
      await apiFetch(`/alerts/${id}`, { method: 'DELETE' });
      showSuccess('Alert configuration deleted');
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleTest(id: string) {
    setTestingId(id);
    try {
      const result = await apiFetch<{ ok: boolean; message?: string; error?: string }>('/alerts/test', {
        method: 'POST',
        body: JSON.stringify({ alertConfigId: id }),
      });
      if (result.ok) {
        showSuccess('Test alert sent successfully');
      } else {
        setError(result.error || 'Test alert failed');
      }
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setTestingId(null);
    }
  }

  function resetForm() {
    setSlackWebhookUrl('');
    setSlackChannelName('');
    setEmailRecipients('');
    setSeverityFilter(['critical', 'warning', 'info']);
  }

  function toggleSeverity(severity: string) {
    setSeverityFilter(prev =>
      prev.includes(severity)
        ? prev.filter(s => s !== severity)
        : [...prev, severity],
    );
  }

  if (loading) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <PageHeader title="Alerts" subtitle="Loading alert configurations..." />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <PageHeader
        title="Alerts"
        subtitle="Configure notifications for billing issues"
        actions={
          <button
            onClick={() => setShowNewForm(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors shadow-sm"
          >
            <Plus size={16} />
            Add Alert Channel
          </button>
        }
      />

      {/* Success message */}
      {successMessage && (
        <div className="mb-4 p-3.5 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2">
          <CheckCircle size={16} className="text-green-600 flex-shrink-0" />
          <p className="text-sm text-green-800 font-medium">{successMessage}</p>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="mb-4 p-3.5 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
          <XCircle size={16} className="text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-800">{error}</p>
          <button onClick={() => setError('')} className="ml-auto text-red-400 hover:text-red-600 transition-colors">
            <XCircle size={14} />
          </button>
        </div>
      )}

      {/* New Alert Form */}
      {showNewForm && (
        <Card padding="lg" className="mb-6 border-brand-200">
          <CardHeader title="New Alert Channel" subtitle="Set up a notification destination" />

          {/* Channel selector */}
          <div className="mb-5">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Channel Type</label>
            <div className="flex gap-2">
              <button
                onClick={() => setNewChannel('slack')}
                className={`flex items-center gap-2 px-5 py-3 rounded-lg text-sm font-medium border-2 transition-all ${
                  newChannel === 'slack'
                    ? 'border-purple-500 bg-purple-50 text-purple-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Hash size={16} />
                Slack
              </button>
              <button
                onClick={() => setNewChannel('email')}
                className={`flex items-center gap-2 px-5 py-3 rounded-lg text-sm font-medium border-2 transition-all ${
                  newChannel === 'email'
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Mail size={16} />
                Email
              </button>
            </div>
          </div>

          {/* Channel-specific config */}
          {newChannel === 'slack' ? (
            <div className="space-y-4 mb-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Webhook URL <span className="text-red-500">*</span>
                </label>
                <input
                  type="url"
                  value={slackWebhookUrl}
                  onChange={(e) => setSlackWebhookUrl(e.target.value)}
                  placeholder="https://hooks.slack.com/services/..."
                  className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-shadow"
                />
                <p className="text-xs text-gray-400 mt-1.5">
                  Create an Incoming Webhook in your Slack workspace settings
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Channel Name <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={slackChannelName}
                  onChange={(e) => setSlackChannelName(e.target.value)}
                  placeholder="#billing-alerts"
                  className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-shadow"
                />
              </div>
            </div>
          ) : (
            <div className="mb-5">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Recipients <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={emailRecipients}
                onChange={(e) => setEmailRecipients(e.target.value)}
                placeholder="alice@company.com, bob@company.com"
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-shadow"
              />
              <p className="text-xs text-gray-400 mt-1.5">
                Comma-separated list of email addresses
              </p>
            </div>
          )}

          {/* Severity filter */}
          <div className="mb-6">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Alert on Severities
            </label>
            <div className="flex gap-3">
              {(['critical', 'warning', 'info'] as const).map(sev => (
                <label
                  key={sev}
                  className={`flex items-center gap-2.5 px-4 py-2.5 rounded-lg border-2 cursor-pointer transition-all ${
                    severityFilter.includes(sev)
                      ? sev === 'critical'
                        ? 'border-red-400 bg-red-50'
                        : sev === 'warning'
                          ? 'border-amber-400 bg-amber-50'
                          : 'border-blue-400 bg-blue-50'
                      : 'border-gray-200 bg-white hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={severityFilter.includes(sev)}
                    onChange={() => toggleSeverity(sev)}
                    className="rounded border-gray-300 text-gray-900 focus:ring-gray-800"
                  />
                  <span className={`text-sm font-medium capitalize ${
                    sev === 'critical' ? 'text-red-700' :
                    sev === 'warning' ? 'text-amber-700' :
                    'text-blue-700'
                  }`}>
                    {sev}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t border-gray-100">
            <button
              onClick={handleCreate}
              disabled={saving || severityFilter.length === 0}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              Create Alert
            </button>
            <button
              onClick={() => { setShowNewForm(false); resetForm(); }}
              className="px-5 py-2.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors"
            >
              Cancel
            </button>
          </div>
        </Card>
      )}

      {/* Existing Configurations */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Active Channels</h2>
        {configs.length === 0 ? (
          <Card>
            <EmptyState
              icon={Bell}
              title="No alert channels configured"
              description="Add a Slack or email channel to get notified about billing issues in real-time"
              action={{
                label: 'Add Alert Channel',
                onClick: () => setShowNewForm(true),
              }}
            />
          </Card>
        ) : (
          <div className="space-y-3">
            {configs.map(config => (
              <Card
                key={config.id}
                padding="none"
                className={!config.enabled ? 'opacity-60' : ''}
              >
                <div className="flex items-center gap-4 p-4">
                  {/* Channel icon */}
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    config.channel === 'slack'
                      ? 'bg-purple-50 border border-purple-200'
                      : 'bg-blue-50 border border-blue-200'
                  }`}>
                    {config.channel === 'slack' ? (
                      <MessageSquare size={18} className="text-purple-600" />
                    ) : (
                      <Mail size={18} className="text-blue-600" />
                    )}
                  </div>

                  {/* Config details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge
                        variant={config.channel === 'slack' ? 'info' : 'neutral'}
                        size="sm"
                      >
                        {config.channel}
                      </Badge>
                      {!config.enabled && (
                        <Badge variant="neutral" size="sm">Paused</Badge>
                      )}
                    </div>
                    {config.channel === 'slack' ? (
                      <p className="text-sm text-gray-900 truncate">
                        {config.config.channelName || 'Slack Webhook'}
                        <span className="text-gray-400 text-xs ml-2">
                          {config.config.webhookUrl ? '(URL configured)' : ''}
                        </span>
                      </p>
                    ) : (
                      <p className="text-sm text-gray-900 truncate">
                        {(config.config.recipients || []).join(', ')}
                      </p>
                    )}
                    <div className="flex gap-1.5 mt-2">
                      {(config.severityFilter || []).map(s => (
                        <Badge
                          key={s}
                          variant={s as any}
                          size="sm"
                        >
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleTest(config.id)}
                      disabled={testingId === config.id || !config.enabled}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-600 bg-gray-50 rounded-lg border border-gray-200 hover:bg-gray-100 transition-colors disabled:opacity-50"
                      title="Send test alert"
                    >
                      {testingId === config.id ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Send size={13} />
                      )}
                      Test
                    </button>

                    <button
                      onClick={() => handleToggle(config)}
                      className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                      title={config.enabled ? 'Disable' : 'Enable'}
                    >
                      {config.enabled ? (
                        <ToggleRight size={22} className="text-green-600" />
                      ) : (
                        <ToggleLeft size={22} className="text-gray-400" />
                      )}
                    </button>

                    <button
                      onClick={() => handleDelete(config.id)}
                      className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                      title="Delete"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Delivery History */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Delivery History</h2>
        {deliveries.length === 0 ? (
          <Card>
            <EmptyState
              icon={Clock}
              title="No alerts sent yet"
              description="Alert deliveries will appear here once issues are detected"
            />
          </Card>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Channel</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Issue</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Time</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Error</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {deliveries.map(d => (
                    <tr key={d.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-4 py-3">
                        {d.status === 'sent' ? (
                          <Badge variant="success" dot size="sm">Sent</Badge>
                        ) : d.status === 'rate_limited' ? (
                          <Badge variant="warning" dot size="sm">Rate Limited</Badge>
                        ) : (
                          <Badge variant="critical" dot size="sm">Failed</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant={d.channel === 'slack' ? 'info' : 'neutral'}
                          size="sm"
                        >
                          {d.channel}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        {d.issueId ? (
                          <a
                            href={`/issues/${d.issueId}`}
                            className="inline-flex items-center gap-1 text-xs text-brand-600 font-mono hover:text-brand-700 transition-colors"
                          >
                            {d.issueId.slice(0, 8)}...
                            <ExternalLink size={10} />
                          </a>
                        ) : (
                          <span className="text-xs text-gray-400 italic">Test delivery</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {new Date(d.sentAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-red-600 text-xs max-w-[200px] truncate">
                        {d.errorMessage || <span className="text-gray-300">--</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
