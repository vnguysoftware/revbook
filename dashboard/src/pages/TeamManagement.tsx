import { useState, useEffect } from 'react';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import {
  Users,
  UserPlus,
  Mail,
  Shield,
  Crown,
  Trash2,
  MoreVertical,
  X,
  Send,
  Clock,
  RotateCcw,
} from 'lucide-react';

type Role = 'Owner' | 'Admin' | 'Member' | 'Viewer';

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: Role;
  joinedAt: string;
}

interface PendingInvite {
  id: string;
  email: string;
  role: Role;
  sentAt: string;
}

const ROLE_COLORS: Record<Role, { bg: string; text: string }> = {
  Owner: { bg: 'bg-purple-100', text: 'text-purple-700' },
  Admin: { bg: 'bg-blue-100', text: 'text-blue-700' },
  Member: { bg: 'bg-green-100', text: 'text-green-700' },
  Viewer: { bg: 'bg-gray-100', text: 'text-gray-700' },
};

const ROLES: Role[] = ['Owner', 'Admin', 'Member', 'Viewer'];

const INITIAL_MEMBERS: TeamMember[] = [
  {
    id: '1',
    name: 'Admin',
    email: 'admin@acme.com',
    role: 'Owner',
    joinedAt: '2024-01-15',
  },
];

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function TeamManagementPage() {
  useEffect(() => {
    document.title = 'Team - RevBack';
  }, []);

  const [members, setMembers] = useState<TeamMember[]>(INITIAL_MEMBERS);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('Member');
  const [roleDropdownOpen, setRoleDropdownOpen] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    const newInvite: PendingInvite = {
      id: crypto.randomUUID(),
      email: inviteEmail.trim(),
      role: inviteRole,
      sentAt: new Date().toISOString(),
    };
    setPendingInvites((prev) => [...prev, newInvite]);
    setInviteEmail('');
    setInviteRole('Member');
    setShowInviteForm(false);
  }

  function handleRoleChange(memberId: string, newRole: Role) {
    setMembers((prev) =>
      prev.map((m) => (m.id === memberId ? { ...m, role: newRole } : m)),
    );
    setRoleDropdownOpen(null);
  }

  function handleRemoveMember(memberId: string) {
    setMembers((prev) => prev.filter((m) => m.id !== memberId));
    setConfirmRemove(null);
  }

  function handleCancelInvite(inviteId: string) {
    setPendingInvites((prev) => prev.filter((i) => i.id !== inviteId));
  }

  function handleResendInvite(inviteId: string) {
    setPendingInvites((prev) =>
      prev.map((i) =>
        i.id === inviteId ? { ...i, sentAt: new Date().toISOString() } : i,
      ),
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <PageHeader
        title="Team"
        subtitle="Manage who has access to your organization"
        actions={
          <button
            onClick={() => setShowInviteForm(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors"
          >
            <UserPlus size={16} />
            Invite Member
          </button>
        }
      />

      {/* Invite Modal */}
      {showInviteForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">
                Invite Team Member
              </h2>
              <button
                onClick={() => setShowInviteForm(false)}
                className="p-1.5 rounded-md hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleInvite} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Email address
                </label>
                <div className="relative">
                  <Mail
                    size={16}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                  />
                  <input
                    type="email"
                    required
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="colleague@company.com"
                    className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-shadow bg-white"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Role
                </label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as Role)}
                  className="w-full px-3 py-2.5 text-sm rounded-lg border border-gray-200 bg-white text-gray-700 appearance-none cursor-pointer hover:border-gray-300 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                >
                  {ROLES.filter((r) => r !== 'Owner').map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowInviteForm(false)}
                  className="px-4 py-2.5 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors"
                >
                  <Send size={14} />
                  Send Invite
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Members Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden mb-8">
        <div className="px-5 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Users size={16} className="text-gray-500" />
            <h3 className="text-sm font-semibold text-gray-900">
              Members ({members.length})
            </h3>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left py-3 px-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">
                  Member
                </th>
                <th className="text-left py-3 px-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">
                  Role
                </th>
                <th className="text-left py-3 px-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">
                  Joined
                </th>
                <th className="text-right py-3 px-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {members.map((member) => (
                <tr
                  key={member.id}
                  className="hover:bg-gray-50/50 transition-colors"
                >
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-brand-600 flex items-center justify-center text-white text-xs font-bold">
                        {getInitials(member.name)}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {member.name}
                          {member.id === '1' && (
                            <span className="ml-1.5 text-xs text-gray-400 font-normal">
                              (You)
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-gray-500">{member.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full ${ROLE_COLORS[member.role].bg} ${ROLE_COLORS[member.role].text}`}
                    >
                      {member.role === 'Owner' && <Crown size={11} />}
                      {member.role === 'Admin' && <Shield size={11} />}
                      {member.role}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <span className="text-xs text-gray-500">
                      {formatDate(member.joinedAt)}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-end gap-2">
                      {member.id !== '1' && (
                        <>
                          {/* Role change dropdown */}
                          <div className="relative">
                            <button
                              onClick={() =>
                                setRoleDropdownOpen(
                                  roleDropdownOpen === member.id
                                    ? null
                                    : member.id,
                                )
                              }
                              className="p-1.5 rounded-md hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600"
                            >
                              <MoreVertical size={16} />
                            </button>
                            {roleDropdownOpen === member.id && (
                              <div className="absolute right-0 top-full mt-1 w-40 bg-white rounded-lg border border-gray-200 shadow-lg z-10 py-1">
                                <p className="px-3 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                                  Change role
                                </p>
                                {ROLES.filter((r) => r !== 'Owner').map(
                                  (role) => (
                                    <button
                                      key={role}
                                      onClick={() =>
                                        handleRoleChange(member.id, role)
                                      }
                                      className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                                        member.role === role
                                          ? 'text-gray-900 font-medium'
                                          : 'text-gray-600'
                                      }`}
                                    >
                                      {role}
                                    </button>
                                  ),
                                )}
                              </div>
                            )}
                          </div>

                          {/* Remove button */}
                          {confirmRemove === member.id ? (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => handleRemoveMember(member.id)}
                                className="px-2 py-1 text-xs font-medium text-red-600 bg-red-50 rounded hover:bg-red-100 transition-colors"
                              >
                                Confirm
                              </button>
                              <button
                                onClick={() => setConfirmRemove(null)}
                                className="px-2 py-1 text-xs font-medium text-gray-500 bg-gray-50 rounded hover:bg-gray-100 transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmRemove(member.id)}
                              className="p-1.5 rounded-md hover:bg-red-50 transition-colors text-gray-400 hover:text-red-600"
                            >
                              <Trash2 size={15} />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pending Invitations */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Mail size={16} className="text-gray-500" />
            <h3 className="text-sm font-semibold text-gray-900">
              Pending Invitations ({pendingInvites.length})
            </h3>
          </div>
        </div>

        {pendingInvites.length === 0 ? (
          <EmptyState
            icon={Mail}
            title="No pending invitations"
            description="Invite team members to collaborate on your RevBack organization"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left py-3 px-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">
                    Email
                  </th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">
                    Role
                  </th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">
                    Sent
                  </th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pendingInvites.map((invite) => (
                  <tr
                    key={invite.id}
                    className="hover:bg-gray-50/50 transition-colors"
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-xs font-bold">
                          <Mail size={14} />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">
                            {invite.email}
                          </p>
                          <div className="flex items-center gap-1 text-xs text-amber-600">
                            <Clock size={10} />
                            Pending
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full ${ROLE_COLORS[invite.role].bg} ${ROLE_COLORS[invite.role].text}`}
                      >
                        {invite.role}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-xs text-gray-500">
                        {formatDate(invite.sentAt)}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleResendInvite(invite.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
                        >
                          <RotateCcw size={12} />
                          Resend
                        </button>
                        <button
                          onClick={() => handleCancelInvite(invite.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-600 bg-white border border-gray-200 rounded-md hover:bg-red-50 transition-colors"
                        >
                          <X size={12} />
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
