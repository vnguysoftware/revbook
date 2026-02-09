import { useNavigate } from 'react-router-dom';
import { setApiKey, DEMO_API_KEY } from '../lib/api';
import { Shield } from 'lucide-react';

export function DemoPage() {
  const navigate = useNavigate();

  function enterDemo() {
    setApiKey(DEMO_API_KEY);
    navigate('/');
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg max-w-md w-full p-8 text-center">
        <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center mx-auto mb-5">
          <Shield size={28} className="text-white" />
        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-2">Defend Every Dollar</h1>
        <p className="text-gray-500 mb-6">
          See how RevBack watches your revenue across Stripe, Apple, and Google Play — so nothing slips through.
        </p>

        <ul className="text-left text-sm text-gray-600 space-y-2 mb-8">
          <li className="flex items-start gap-2">
            <span className="text-brand-600 font-bold mt-0.5">-</span>
            Seeded with realistic billing data across multiple providers
          </li>
          <li className="flex items-start gap-2">
            <span className="text-brand-600 font-bold mt-0.5">-</span>
            Pre-detected issues: paid-no-access, refund leaks, webhook gaps
          </li>
          <li className="flex items-start gap-2">
            <span className="text-brand-600 font-bold mt-0.5">-</span>
            Full dashboard with users, events, and revenue impact estimates
          </li>
        </ul>

        <button
          onClick={enterDemo}
          className="w-full py-3 px-4 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-lg transition-colors"
        >
          Enter Demo
        </button>

        <p className="text-xs text-gray-400 mt-4">
          No signup required. You'll be viewing sample data.
        </p>
      </div>
    </div>
  );
}
