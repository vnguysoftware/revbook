import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  User,
  Key,
  Users,
  Plug,
  CreditCard,
  ArrowRight,
} from 'lucide-react';

interface SettingsSection {
  to: string;
  icon: React.ElementType;
  label: string;
  description: string;
  available: boolean;
}

const sections: SettingsSection[] = [
  {
    to: '/settings/account',
    icon: User,
    label: 'Account',
    description: 'Manage your organization profile and preferences',
    available: true,
  },
  {
    to: '/settings/api-keys',
    icon: Key,
    label: 'API Keys',
    description: 'Create and manage API keys for your integrations',
    available: true,
  },
  {
    to: '/settings/team',
    icon: Users,
    label: 'Team',
    description: 'Invite team members and manage roles',
    available: true,
  },
  {
    to: '/settings/integrations',
    icon: Plug,
    label: 'Integrations',
    description: 'Connect billing platforms and configure webhooks',
    available: false,
  },
  {
    to: '/settings/billing',
    icon: CreditCard,
    label: 'Billing',
    description: 'Manage your RevBack subscription and invoices',
    available: false,
  },
];

export function SettingsPage() {
  useEffect(() => {
    document.title = 'Settings - RevBack';
  }, []);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">
          Manage your organization, team, and integrations
        </p>
      </div>

      {/* Settings Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {sections.map((section) => {
          const Icon = section.icon;

          if (!section.available) {
            return (
              <div
                key={section.label}
                className="bg-white rounded-lg border border-gray-200 p-5 opacity-60"
              >
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                    <Icon size={20} className="text-gray-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-gray-900">{section.label}</h3>
                      <span className="px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-500 rounded">
                        Coming soon
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{section.description}</p>
                  </div>
                </div>
              </div>
            );
          }

          return (
            <Link
              key={section.label}
              to={section.to}
              className="bg-white rounded-lg border border-gray-200 p-5 hover:border-gray-300 hover:shadow-sm transition-all group"
            >
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-gray-100 group-hover:bg-brand-50 flex items-center justify-center flex-shrink-0 transition-colors">
                  <Icon size={20} className="text-gray-600 group-hover:text-brand-600 transition-colors" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-900">{section.label}</h3>
                    <ArrowRight
                      size={16}
                      className="text-gray-300 group-hover:text-brand-500 transition-colors"
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{section.description}</p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
