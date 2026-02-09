import { useState, useEffect } from 'react';
import { getApiKey } from '../lib/api';
import { formatDate } from '../lib/format';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { Badge } from '../components/ui/Badge';
import {
  Key,
  Plus,
  Copy,
  Check,
  Trash2,
  AlertTriangle,
  X,
} from 'lucide-react';

interface ApiKeyEntry {
  id: string;
  name: string;
  prefix: string;
  fullKey?: string;
  status: 'active' | 'revoked';
  createdAt: string;
  lastUsedAt: string | null;
}

function generateMockKey(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = 'rev_live_';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function ApiKeysPage() {
  useEffect(() => { document.title = 'API Keys - RevBack'; }, []);

  const [keys, setKeys] = useState<ApiKeyEntry[]>(() => {
    const currentKey = getApiKey();
    if (currentKey) {
      return [{
        id: 'current',
        name: 'Current Session Key',
        prefix: currentKey.slice(0, 12) + '...',
        status: 'active',
        createdAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
      }];
    }
    return [];
  });

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<ApiKeyEntry | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [revokeConfirmId, setRevokeConfirmId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  }

  function handleCopy(key: ApiKeyEntry) {
    const textToCopy = key.fullKey || key.prefix;
    navigator.clipboard.writeText(textToCopy);
    setCopiedId(key.id);
    showToast('API key copied to clipboard');
    setTimeout(() => setCopiedId(null), 2000);
  }

  function handleCreate() {
    if (!newKeyName.trim()) return;

    const fullKey = generateMockKey();
    const entry: ApiKeyEntry = {
      id: generateId(),
      name: newKeyName.trim(),
      prefix: fullKey.slice(0, 12) + '...',
      fullKey,
      status: 'active',
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    };

    setKeys(prev => [entry, ...prev]);
    setNewlyCreatedKey(entry);
    setNewKeyName('');
    setShowCreateForm(false);
  }

  function handleDismissNewKey() {
    if (newlyCreatedKey) {
      setKeys(prev =>
        prev.map(k =>
          k.id === newlyCreatedKey.id ? { ...k, fullKey: undefined } : k,
        ),
      );
      setNewlyCreatedKey(null);
    }
  }

  function handleRevoke(id: string) {
    setKeys(prev => prev.filter(k => k.id !== id));
    setRevokeConfirmId(null);
    showToast('API key revoked');
  }

  const activeKeys = keys.filter(k => k.status === 'active');

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <PageHeader
        title="API Keys"
        subtitle="Manage your API keys for webhook and API access"
        actions={
          <button
            onClick={() => { setShowCreateForm(true); setNewlyCreatedKey(null); }}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-800 transition-colors"
          >
            <Plus size={14} />
            Create New Key
          </button>
        }
      />

      {/* Toast notification */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 bg-gray-900 text-white text-sm font-medium rounded-lg shadow-lg animate-in">
          <Check size={14} />
          {toast}
        </div>
      )}

      {/* Create Key Form */}
      {showCreateForm && !newlyCreatedKey && (
        <div className="mb-6 bg-white rounded-lg border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-900">Create New API Key</h3>
            <button
              onClick={() => { setShowCreateForm(false); setNewKeyName(''); }}
              className="p-1 rounded hover:bg-gray-100 transition-colors"
            >
              <X size={16} className="text-gray-400" />
            </button>
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Key name
              </label>
              <input
                type="text"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="e.g., Production, Development, CI/CD"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowCreateForm(false); setNewKeyName(''); }}
                className="px-3 py-2 text-sm font-medium text-gray-600 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!newKeyName.trim()}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50 transition-colors"
              >
                Create Key
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Newly Created Key Banner */}
      {newlyCreatedKey && newlyCreatedKey.fullKey && (
        <div className="mb-6 bg-green-50 border border-green-200 rounded-lg p-5">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} className="text-amber-600" />
            <span className="text-sm font-semibold text-gray-900">
              Save your API key now
            </span>
          </div>
          <p className="text-xs text-gray-600 mb-3">
            This key will only be shown once. Copy it and store it securely.
          </p>
          <div className="flex items-center gap-2 mb-4">
            <code className="flex-1 bg-white px-3 py-2.5 rounded-lg border border-green-300 text-xs font-mono break-all select-all text-gray-900">
              {newlyCreatedKey.fullKey}
            </code>
            <button
              onClick={() => handleCopy(newlyCreatedKey)}
              className="flex-shrink-0 p-2.5 bg-green-100 rounded-lg hover:bg-green-200 transition-colors"
              title="Copy API key"
            >
              {copiedId === newlyCreatedKey.id ? (
                <Check size={16} className="text-green-700" />
              ) : (
                <Copy size={16} className="text-green-700" />
              )}
            </button>
          </div>
          <button
            onClick={handleDismissNewKey}
            className="w-full px-4 py-2 text-sm font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-800 transition-colors"
          >
            I've saved my key
          </button>
        </div>
      )}

      {/* Revoke Confirmation Dialog */}
      {revokeConfirmId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <Trash2 size={18} className="text-red-600" />
              </div>
              <h3 className="text-base font-semibold text-gray-900">Revoke API Key</h3>
            </div>
            <p className="text-sm text-gray-600 mb-1">
              Are you sure you want to revoke{' '}
              <span className="font-medium text-gray-900">
                {keys.find(k => k.id === revokeConfirmId)?.name}
              </span>
              ?
            </p>
            <p className="text-xs text-gray-500 mb-5">
              This action cannot be undone. Any integrations using this key will stop working immediately.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRevokeConfirmId(null)}
                className="px-3 py-2 text-sm font-medium text-gray-600 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleRevoke(revokeConfirmId)}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors"
              >
                Revoke Key
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {activeKeys.length === 0 && !showCreateForm && (
        <div className="bg-white rounded-lg border border-gray-200">
          <EmptyState
            icon={Key}
            title="No API keys yet"
            description="Create an API key to get started with webhook and API access."
            action={{
              label: 'Create API Key',
              onClick: () => setShowCreateForm(true),
            }}
          />
        </div>
      )}

      {/* Keys Table */}
      {activeKeys.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left py-3 px-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">Name</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">Key</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">Status</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">Created</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">Last Used</th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {activeKeys.map((key) => (
                  <tr key={key.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded bg-gray-50 border border-gray-200 flex items-center justify-center">
                          <Key size={14} className="text-gray-500" />
                        </div>
                        <span className="text-sm font-medium text-gray-900">{key.name}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <code className="text-xs font-mono text-gray-500 bg-gray-50 px-2 py-1 rounded">
                        {key.prefix}
                      </code>
                    </td>
                    <td className="py-3 px-4">
                      <Badge variant="success" size="sm">active</Badge>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-xs text-gray-500">{formatDate(key.createdAt)}</span>
                    </td>
                    <td className="py-3 px-4">
                      {key.lastUsedAt ? (
                        <span className="text-xs text-gray-500">{formatDate(key.lastUsedAt)}</span>
                      ) : (
                        <span className="text-xs text-gray-300">Never</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleCopy(key)}
                          className="p-1.5 rounded-md hover:bg-gray-100 transition-colors"
                          title="Copy key prefix"
                        >
                          {copiedId === key.id ? (
                            <Check size={14} className="text-green-600" />
                          ) : (
                            <Copy size={14} className="text-gray-400" />
                          )}
                        </button>
                        <button
                          onClick={() => setRevokeConfirmId(key.id)}
                          className="p-1.5 rounded-md hover:bg-red-50 transition-colors"
                          title="Revoke key"
                        >
                          <Trash2 size={14} className="text-gray-400 hover:text-red-500" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
