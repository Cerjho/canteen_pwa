import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { 
  Search, 
  Users, 
  Mail, 
  Phone,
  Wallet,
  UserPlus,
  Shield,
  ShieldCheck,
  X,
  Eye,
  EyeOff,
  Loader2,
  User,
  Baby,
  ShoppingBag,
  Plus,
  Ticket,
  Copy,
  Clock
} from 'lucide-react';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../../services/supabaseClient';
import { PageHeader } from '../../components/PageHeader';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { useToast } from '../../components/Toast';

interface Parent {
  id: string;
  email: string;
  phone_number?: string;
  first_name: string;
  last_name: string;
  balance: number;
  created_at: string;
  children_count?: number;
  orders_count?: number;
}

interface StaffMember {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: 'staff' | 'admin';
  created_at: string;
}

interface CreateUserForm {
  email: string;
  emails: string; // For bulk invite (comma/newline separated)
  password: string;
  confirmPassword: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  role: 'parent' | 'staff' | 'admin';
  mode: 'create' | 'invite';
}

const initialFormState: CreateUserForm = {
  email: '',
  emails: '',
  password: '',
  confirmPassword: '',
  firstName: '',
  lastName: '',
  phoneNumber: '',
  role: 'parent',
  mode: 'invite', // Default to invite for parents
};

interface Invitation {
  id: string;
  email: string;
  code: string;
  role: string;
  used: boolean;
  created_at: string;
  expires_at: string;
}

export default function AdminUsers() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<'parents' | 'staff' | 'invitations'>('parents');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedParent, setSelectedParent] = useState<Parent | null>(null);
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [showCreateUserModal, setShowCreateUserModal] = useState(false);
  const [createUserType, setCreateUserType] = useState<'parent' | 'staff'>('parent');

  // Fetch pending invitations
  const { data: invitations, isLoading: invitationsLoading } = useQuery<Invitation[]>({
    queryKey: ['admin-invitations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invitations')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data || [];
    }
  });

  // Fetch parents (users with role = 'parent')
  const { data: parents, isLoading: parentsLoading } = useQuery<Parent[]>({
    queryKey: ['admin-parents'],
    queryFn: async () => {
      // Get user profiles with role = 'parent'
      const { data: profiles, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('role', 'parent')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      
      // Get wallets for balance
      const { data: wallets } = await supabase
        .from('wallets')
        .select('user_id, balance');
      
      const walletMap = new Map((wallets || []).map(w => [w.user_id, w.balance]));
      
      // Get children and orders count for each parent
      const enrichedParents = await Promise.all(
        (profiles || []).map(async (profile) => {
          const { count: childrenCount } = await supabase
            .from('parent_students')
            .select('*', { count: 'exact', head: true })
            .eq('parent_id', profile.id);

          const { count: ordersCount } = await supabase
            .from('orders')
            .select('*', { count: 'exact', head: true })
            .eq('parent_id', profile.id);

          return {
            ...profile,
            balance: walletMap.get(profile.id) || 0,
            children_count: childrenCount || 0,
            orders_count: ordersCount || 0
          };
        })
      );

      return enrichedParents;
    }
  });

  // Fetch staff members from edge function
  const { data: staffMembers, isLoading: staffLoading } = useQuery<StaffMember[]>({
    queryKey: ['admin-staff'],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      
      try {
        const response = await fetch(
          `${SUPABASE_URL}/functions/v1/list-staff`,
          {
            headers: {
              Authorization: `Bearer ${session?.access_token}`,
              apikey: SUPABASE_ANON_KEY,
              'Content-Type': 'application/json',
            },
          }
        );

        if (!response.ok) {
          return [];
        }

        const result = await response.json();
        return result.staff || [];
      } catch {
        return [];
      }
    }
  });

  // Top up balance mutation via edge function
  const topUpMutation = useMutation({
    mutationFn: async ({ parentId, amount }: { parentId: string; amount: number }) => {
      const { data: { session } } = await supabase.auth.getSession();
      
      const response = await fetch(`${SUPABASE_URL}/functions/v1/admin-topup`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session?.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: parentId,
          amount
        })
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || 'Failed to top up balance');
      }
      
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['admin-parents'] });
      setShowTopUpModal(false);
      setSelectedParent(null);
      showToast(`Balance updated: ₱${data.previous_balance.toFixed(2)} → ₱${data.new_balance.toFixed(2)}`, 'success');
    },
    onError: (error: Error) => showToast(error.message || 'Failed to update balance', 'error')
  });

  // Create user mutation via edge function
  const createUserMutation = useMutation({
    mutationFn: async (formData: CreateUserForm) => {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session?.access_token) {
        throw new Error('Not authenticated. Please log in again.');
      }

      // For invite mode, use send-invites function
      if (formData.mode === 'invite') {
        const emailList = formData.emails.split(/[,;\n]+/).map(e => e.trim()).filter(e => e);
        
        const response = await fetch(
          `${SUPABASE_URL}/functions/v1/send-invites`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              apikey: SUPABASE_ANON_KEY,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              emails: emailList,
              role: formData.role,
            }),
          }
        );

        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error || 'Failed to send invitations');
        }
        return result;
      }

      // For create mode, use create-user function
      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/create-user`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: SUPABASE_ANON_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: formData.email,
            password: formData.password,
            role: formData.role,
            firstName: formData.firstName,
            lastName: formData.lastName,
            phoneNumber: formData.phoneNumber || undefined,
            mode: 'create',
          }),
        }
      );

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || `Failed to create user (${response.status})`);
      }

      return result;
    },
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin-parents'] });
      queryClient.invalidateQueries({ queryKey: ['admin-staff'] });
      queryClient.invalidateQueries({ queryKey: ['admin-invitations'] });
      setShowCreateUserModal(false);
      
      // Show appropriate message based on mode and results
      if (variables.mode === 'invite' && result.summary) {
        const { success, failed } = result.summary;
        
        if (success > 0) {
          // Show invite codes in console for admin to share
          console.log('Invitation codes:', result.results);
          showToast(
            `${success} invitation(s) created! Check the Invitations tab for codes.`, 
            'success'
          );
        }
        if (failed > 0) {
          const firstError = result.results?.find((r: any) => !r.success);
          showToast(`${failed} failed: ${firstError?.error || 'Unknown error'}`, 'error');
        }
      } else {
        showToast(`${variables.role === 'parent' ? 'Parent' : 'Staff member'} created successfully`, 'success');
      }
    },
    onError: (error: Error) => {
      showToast(error.message, 'error');
    }
  });

  // Filter parents by search
  const filteredParents = parents?.filter(parent => {
    const searchLower = searchQuery.toLowerCase();
    return (
      parent.first_name.toLowerCase().includes(searchLower) ||
      parent.last_name.toLowerCase().includes(searchLower) ||
      parent.email.toLowerCase().includes(searchLower) ||
      parent.phone_number?.includes(searchQuery)
    );
  });

  // Filter staff by search
  const filteredStaff = staffMembers?.filter(staff => {
    const searchLower = searchQuery.toLowerCase();
    return (
      staff.first_name?.toLowerCase().includes(searchLower) ||
      staff.last_name?.toLowerCase().includes(searchLower) ||
      staff.email.toLowerCase().includes(searchLower)
    );
  });

  // Filter invitations
  const pendingInvitations = invitations?.filter(inv => !inv.used && new Date(inv.expires_at) > new Date());
  const filteredInvitations = pendingInvitations?.filter(inv => {
    const searchLower = searchQuery.toLowerCase();
    return inv.email.toLowerCase().includes(searchLower) || inv.code.toLowerCase().includes(searchLower);
  });

  const openCreateModal = (type: 'parent' | 'staff') => {
    setCreateUserType(type);
    setShowCreateUserModal(true);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    showToast('Copied to clipboard!', 'success');
  };

  if (parentsLoading || staffLoading || invitationsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20 bg-gray-50">
      <div className="container mx-auto px-4 py-6">
        <PageHeader
          title="User Management"
          subtitle="Manage parents, staff, and invitations"
        />

        {/* Tabs */}
        <div className="flex gap-2 mb-6 overflow-x-auto">
          <button
            onClick={() => setActiveTab('parents')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap ${
              activeTab === 'parents'
                ? 'bg-primary-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-200'
            }`}
          >
            <Users size={18} />
            Parents ({parents?.length || 0})
          </button>
          <button
            onClick={() => setActiveTab('staff')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap ${
              activeTab === 'staff'
                ? 'bg-primary-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-200'
            }`}
          >
            <ShieldCheck size={18} />
            Staff ({staffMembers?.length || 0})
          </button>
          <button
            onClick={() => setActiveTab('invitations')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap ${
              activeTab === 'invitations'
                ? 'bg-primary-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-200'
            }`}
          >
            <Ticket size={18} />
            Invitations ({pendingInvitations?.length || 0})
          </button>
        </div>
        {/* Search and Add */}
        <div className="flex gap-3 mb-6">
          <div className="relative flex-1">
            <Search size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder={activeTab === 'parents' ? 'Search parents...' : 'Search staff...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <button
            onClick={() => openCreateModal(activeTab === 'parents' ? 'parent' : 'staff')}
            className="flex items-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors whitespace-nowrap"
          >
            <UserPlus size={20} />
            Add {activeTab === 'parents' ? 'Parent' : 'Staff'}
          </button>
        </div>

        {/* Parents Tab */}
        {activeTab === 'parents' && (
          <div className="space-y-3">
            {filteredParents?.length === 0 ? (
              <div className="bg-white rounded-xl p-8 text-center">
                <Users size={48} className="mx-auto text-gray-300 mb-3" />
                <p className="text-gray-500">No parents found</p>
                <button
                  onClick={() => openCreateModal('parent')}
                  className="mt-4 text-primary-600 hover:underline"
                >
                  Add first parent
                </button>
              </div>
            ) : (
              filteredParents?.map((parent) => (
                <div
                  key={parent.id}
                  className="bg-white rounded-xl p-4 shadow-sm border border-gray-100"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center">
                        <User size={24} className="text-primary-600" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">
                          {parent.first_name} {parent.last_name}
                        </h3>
                        <div className="flex items-center gap-3 text-sm text-gray-500 mt-1">
                          <span className="flex items-center gap-1">
                            <Mail size={14} />
                            {parent.email}
                          </span>
                          {parent.phone_number && (
                            <span className="flex items-center gap-1">
                              <Phone size={14} />
                              {parent.phone_number}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setSelectedParent(parent);
                        setShowTopUpModal(true);
                      }}
                      className="flex items-center gap-1 px-3 py-1.5 bg-green-50 text-green-700 rounded-lg hover:bg-green-100 text-sm font-medium"
                    >
                      <Plus size={16} />
                      Top Up
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-gray-100">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center">
                        <Baby size={16} className="text-blue-600" />
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Children</p>
                        <p className="font-semibold text-gray-900">{parent.children_count}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-purple-50 rounded-lg flex items-center justify-center">
                        <ShoppingBag size={16} className="text-purple-600" />
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Orders</p>
                        <p className="font-semibold text-gray-900">{parent.orders_count}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-green-50 rounded-lg flex items-center justify-center">
                        <Wallet size={16} className="text-green-600" />
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Balance</p>
                        <p className="font-semibold text-green-600">₱{parent.balance.toFixed(2)}</p>
                      </div>
                    </div>
                  </div>

                  <p className="text-xs text-gray-400 mt-3">
                    Registered {format(new Date(parent.created_at), 'MMM d, yyyy')}
                  </p>
                </div>
              ))
            )}
          </div>
        )}

        {/* Staff Tab */}
        {activeTab === 'staff' && (
          <div className="space-y-3">
            {filteredStaff?.length === 0 ? (
              <div className="bg-white rounded-xl p-8 text-center">
                <Shield size={48} className="mx-auto text-gray-300 mb-3" />
                <p className="text-gray-500">No staff members found</p>
                <button
                  onClick={() => openCreateModal('staff')}
                  className="mt-4 text-primary-600 hover:underline"
                >
                  Add first staff member
                </button>
              </div>
            ) : (
              filteredStaff?.map((staff) => (
                <div
                  key={staff.id}
                  className="bg-white rounded-xl p-4 shadow-sm border border-gray-100"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                        staff.role === 'admin' ? 'bg-purple-100' : 'bg-blue-100'
                      }`}>
                        {staff.role === 'admin' ? (
                          <ShieldCheck size={24} className="text-purple-600" />
                        ) : (
                          <Shield size={24} className="text-blue-600" />
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-gray-900">
                            {staff.first_name} {staff.last_name}
                          </h3>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            staff.role === 'admin'
                              ? 'bg-purple-100 text-purple-700'
                              : 'bg-blue-100 text-blue-700'
                          }`}>
                            {staff.role}
                          </span>
                        </div>
                        <p className="text-sm text-gray-500 flex items-center gap-1 mt-1">
                          <Mail size={14} />
                          {staff.email}
                        </p>
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 mt-3">
                    Added {format(new Date(staff.created_at), 'MMM d, yyyy')}
                  </p>
                </div>
              ))
            )}
          </div>
        )}

        {/* Invitations Tab */}
        {activeTab === 'invitations' && (
          <div className="space-y-4">
            {/* Registration URL Info */}
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
              <p className="text-sm text-blue-800 font-medium mb-2">📋 How to invite parents:</p>
              <ol className="text-sm text-blue-700 space-y-1 list-decimal list-inside">
                <li>Click "Send Invite" and enter email addresses</li>
                <li>Share the invite code with parents (WhatsApp, print, etc.)</li>
                <li>Parents visit: <strong>{window.location.origin}/register</strong></li>
                <li>They enter the code and complete their registration</li>
              </ol>
            </div>

            {filteredInvitations?.length === 0 ? (
              <div className="bg-white rounded-xl p-8 text-center">
                <Ticket size={48} className="mx-auto text-gray-300 mb-3" />
                <p className="text-gray-500">No pending invitations</p>
                <button
                  onClick={() => openCreateModal('parent')}
                  className="mt-4 text-primary-600 hover:underline"
                >
                  Send first invitation
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredInvitations?.map((invitation) => (
                  <div
                    key={invitation.id}
                    className="bg-white rounded-xl p-4 shadow-sm border border-gray-100"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center">
                          <Ticket size={24} className="text-amber-600" />
                        </div>
                        <div>
                          <p className="text-sm text-gray-500">{invitation.email}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <code className="text-xl font-mono font-bold text-primary-600 tracking-widest">
                              {invitation.code}
                            </code>
                            <button
                              onClick={() => copyToClipboard(invitation.code)}
                              className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600"
                              title="Copy code"
                            >
                              <Copy size={16} />
                            </button>
                          </div>
                          <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                            <span className="flex items-center gap-1">
                              <Clock size={12} />
                              Expires {format(new Date(invitation.expires_at), 'MMM d, yyyy')}
                            </span>
                            <span className={`px-2 py-0.5 rounded-full ${
                              invitation.role === 'parent' 
                                ? 'bg-primary-100 text-primary-700' 
                                : 'bg-blue-100 text-blue-700'
                            }`}>
                              {invitation.role}
                            </span>
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => copyToClipboard(`${window.location.origin}/register?code=${invitation.code}`)}
                        className="px-3 py-1.5 text-sm bg-primary-50 text-primary-600 rounded-lg hover:bg-primary-100 flex items-center gap-1"
                      >
                        <Copy size={14} />
                        Copy Link
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Top Up Modal */}
      {showTopUpModal && selectedParent && (
        <TopUpModal
          parent={selectedParent}
          onClose={() => {
            setShowTopUpModal(false);
            setSelectedParent(null);
          }}
          onSubmit={(amount) => topUpMutation.mutate({ parentId: selectedParent.id, amount })}
          isLoading={topUpMutation.isPending}
        />
      )}

      {/* Create User Modal */}
      {showCreateUserModal && (
        <CreateUserModal
          type={createUserType}
          onClose={() => setShowCreateUserModal(false)}
          onSubmit={(data) => createUserMutation.mutate(data)}
          isLoading={createUserMutation.isPending}
        />
      )}
    </div>
  );
}

// Top Up Modal Component
interface TopUpModalProps {
  parent: Parent;
  onClose: () => void;
  onSubmit: (amount: number) => void;
  isLoading: boolean;
}

function TopUpModal({ parent, onClose, onSubmit, isLoading }: TopUpModalProps) {
  const [amount, setAmount] = useState('');
  const presetAmounts = [100, 200, 500, 1000];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const numAmount = parseFloat(amount);
    if (numAmount > 0) {
      onSubmit(numAmount);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-50" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
          <div className="flex items-center justify-between p-4 border-b border-gray-100">
            <h2 className="text-lg font-bold">Top Up Balance</h2>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
              <X size={20} />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-4 space-y-4">
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-sm text-gray-500">Parent</p>
              <p className="font-medium">{parent.first_name} {parent.last_name}</p>
              <p className="text-sm text-gray-500 mt-1">
                Current Balance: <span className="text-green-600 font-medium">₱{parent.balance.toFixed(2)}</span>
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Amount to Add (₱)
              </label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                min="1"
                step="0.01"
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                placeholder="Enter amount"
              />
            </div>

            <div className="flex gap-2">
              {presetAmounts.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setAmount(preset.toString())}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm font-medium"
                >
                  ₱{preset}
                </button>
              ))}
            </div>

            {amount && parseFloat(amount) > 0 && (
              <div className="bg-green-50 rounded-lg p-3">
                <p className="text-sm text-green-700">
                  New Balance: <span className="font-bold">₱{(parent.balance + parseFloat(amount)).toFixed(2)}</span>
                </p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading || !amount || parseFloat(amount) <= 0}
                className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:bg-gray-300 flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Processing...
                  </>
                ) : (
                  'Add Balance'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}

// Create User Modal Component
interface CreateUserModalProps {
  type: 'parent' | 'staff';
  onClose: () => void;
  onSubmit: (data: CreateUserForm) => void;
  isLoading: boolean;
}

function CreateUserModal({ type, onClose, onSubmit, isLoading }: CreateUserModalProps) {
  const [form, setForm] = useState<CreateUserForm>({
    ...initialFormState,
    role: type,
    mode: type === 'parent' ? 'invite' : 'create', // Default invite for parents, create for staff
  });
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof CreateUserForm, string>>>({});

  // Count emails for bulk invite
  const emailCount = form.emails.split(/[,;\n]+/).map(e => e.trim()).filter(e => e).length;

  // Common domain typos to check
  const domainTypos: Record<string, string> = {
    'gmial.com': 'gmail.com',
    'gmai.com': 'gmail.com',
    'gamil.com': 'gmail.com',
    'gmail.co': 'gmail.com',
    'gmal.com': 'gmail.com',
    'gnail.com': 'gmail.com',
    'gmail.con': 'gmail.com',
    'gmail.om': 'gmail.com',
    'yaho.com': 'yahoo.com',
    'yahooo.com': 'yahoo.com',
    'yahoo.co': 'yahoo.com',
    'yahoo.con': 'yahoo.com',
    'hotmal.com': 'hotmail.com',
    'hotmai.com': 'hotmail.com',
    'hotmail.co': 'hotmail.com',
    'hotmail.con': 'hotmail.com',
    'outlok.com': 'outlook.com',
    'outllook.com': 'outlook.com',
    'outlook.co': 'outlook.com',
    'outlook.con': 'outlook.com',
  };

  const validateEmail = (email: string): { valid: boolean; suggestion?: string } => {
    // More comprehensive email regex
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
    
    if (!emailRegex.test(email)) {
      return { valid: false };
    }

    const domain = email.split('@')[1].toLowerCase();
    if (domainTypos[domain]) {
      return { valid: false, suggestion: domainTypos[domain] };
    }

    // Check for very short TLDs that are likely typos
    const tld = domain.split('.').pop() || '';
    if (tld.length < 2) {
      return { valid: false };
    }

    return { valid: true };
  };

  const validateForm = (): boolean => {
    const newErrors: Partial<Record<keyof CreateUserForm, string>> = {};

    if (form.mode === 'invite') {
      // For invite mode, just need at least one email
      const emails = form.emails.split(/[,;\n]+/).map(e => e.trim()).filter(e => e);
      if (emails.length === 0) {
        newErrors.emails = 'At least one email is required';
      } else {
        const invalidResults = emails.map(e => ({ email: e, ...validateEmail(e) })).filter(r => !r.valid);
        if (invalidResults.length > 0) {
          const suggestions = invalidResults.filter(r => r.suggestion);
          if (suggestions.length > 0) {
            newErrors.emails = `Possible typo in: ${suggestions.map(s => `${s.email} (did you mean @${s.suggestion}?)`).join(', ')}`;
          } else {
            newErrors.emails = `Invalid email(s): ${invalidResults.slice(0, 3).map(r => r.email).join(', ')}${invalidResults.length > 3 ? '...' : ''}`;
          }
        }
      }
    } else {
      // For create mode, need all fields
      if (!form.email) {
        newErrors.email = 'Email is required';
      } else {
        const emailValidation = validateEmail(form.email);
        if (!emailValidation.valid) {
          if (emailValidation.suggestion) {
            newErrors.email = `Did you mean @${emailValidation.suggestion}?`;
          } else {
            newErrors.email = 'Invalid email format';
          }
        }
      }

      if (!form.firstName) {
        newErrors.firstName = 'First name is required';
      }

      if (!form.lastName) {
        newErrors.lastName = 'Last name is required';
      }

      if (!form.password) {
        newErrors.password = 'Password is required';
      } else if (form.password.length < 6) {
        newErrors.password = 'Password must be at least 6 characters';
      }

      if (form.password !== form.confirmPassword) {
        newErrors.confirmPassword = 'Passwords do not match';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validateForm()) {
      onSubmit(form);
    }
  };

  const updateForm = (field: keyof CreateUserForm, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: undefined }));
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-50" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
        <div className="bg-white rounded-xl shadow-xl max-w-md w-full my-8">
          <div className="flex items-center justify-between p-4 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                type === 'parent' ? 'bg-primary-100' : 'bg-blue-100'
              }`}>
                {type === 'parent' ? (
                  <User size={20} className="text-primary-600" />
                ) : (
                  <Shield size={20} className="text-blue-600" />
                )}
              </div>
              <div>
                <h2 className="text-lg font-bold">
                  {type === 'parent' ? 'Add Parent' : 'Add Staff Member'}
                </h2>
                <p className="text-sm text-gray-500">
                  {form.mode === 'invite' 
                    ? 'Send invitation email' 
                    : 'Create account with password'}
                </p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
              <X size={20} />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-4 space-y-4">
            {/* Mode Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Registration Method
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => updateForm('mode', 'invite')}
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border-2 transition-colors ${
                    form.mode === 'invite'
                      ? 'border-primary-500 bg-primary-50 text-primary-700'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <Users size={18} />
                  <span className="font-medium text-sm">Quick Add</span>
                </button>
                <button
                  type="button"
                  onClick={() => updateForm('mode', 'create')}
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border-2 transition-colors ${
                    form.mode === 'create'
                      ? 'border-primary-500 bg-primary-50 text-primary-700'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <UserPlus size={18} />
                  <span className="font-medium text-sm">Full Details</span>
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                {form.mode === 'invite' 
                  ? '⚡ Bulk add by email only - users complete setup on first login' 
                  : '📝 Add one user with full details and custom password'}
              </p>
            </div>

            {/* Role Selection (for staff only) */}
            {type === 'staff' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Role
                </label>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => updateForm('role', 'staff')}
                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 transition-colors ${
                      form.role === 'staff'
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <Shield size={20} />
                    <span className="font-medium">Staff</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => updateForm('role', 'admin')}
                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 transition-colors ${
                      form.role === 'admin'
                        ? 'border-purple-500 bg-purple-50 text-purple-700'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <ShieldCheck size={20} />
                    <span className="font-medium">Admin</span>
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  {form.role === 'staff' 
                    ? 'Can fulfill orders and manage daily operations' 
                    : 'Full access to all features including user management'}
                </p>
              </div>
            )}

            {/* INVITE MODE - Bulk Email Input */}
            {form.mode === 'invite' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email Addresses {emailCount > 0 && <span className="text-primary-600">({emailCount})</span>}
                </label>
                <textarea
                  value={form.emails}
                  onChange={(e) => updateForm('emails', e.target.value)}
                  rows={4}
                  className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 ${
                    errors.emails ? 'border-red-500' : 'border-gray-300'
                  }`}
                  placeholder="Enter email addresses (one per line, or separated by commas)&#10;&#10;Example:&#10;parent1@email.com&#10;parent2@email.com, parent3@email.com"
                />
                {errors.emails && (
                  <p className="text-xs text-red-500 mt-1">{errors.emails}</p>
                )}
                <p className="text-xs text-gray-500 mt-1">
                  Separate multiple emails with commas, semicolons, or new lines
                </p>
              </div>
            )}

            {/* CREATE MODE - Full Form */}
            {form.mode === 'create' && (
              <>
                {/* Name Fields */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      First Name *
                    </label>
                    <input
                      type="text"
                      value={form.firstName}
                      onChange={(e) => updateForm('firstName', e.target.value)}
                      className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 ${
                        errors.firstName ? 'border-red-500' : 'border-gray-300'
                      }`}
                      placeholder="Juan"
                    />
                    {errors.firstName && (
                      <p className="text-xs text-red-500 mt-1">{errors.firstName}</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Last Name *
                    </label>
                    <input
                      type="text"
                      value={form.lastName}
                      onChange={(e) => updateForm('lastName', e.target.value)}
                      className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 ${
                        errors.lastName ? 'border-red-500' : 'border-gray-300'
                      }`}
                      placeholder="Dela Cruz"
                    />
                    {errors.lastName && (
                      <p className="text-xs text-red-500 mt-1">{errors.lastName}</p>
                    )}
                  </div>
                </div>

                {/* Email */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Email Address *
                  </label>
                  <div className="relative">
                    <Mail size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) => updateForm('email', e.target.value)}
                      className={`w-full pl-10 pr-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 ${
                        errors.email ? 'border-red-500' : 'border-gray-300'
                      }`}
                      placeholder="email@example.com"
                    />
                  </div>
                  {errors.email && (
                    <p className="text-xs text-red-500 mt-1">{errors.email}</p>
                  )}
                </div>

                {/* Phone (for parents only) */}
                {type === 'parent' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Phone Number
                    </label>
                    <div className="relative">
                      <Phone size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="tel"
                        value={form.phoneNumber}
                        onChange={(e) => updateForm('phoneNumber', e.target.value)}
                        className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                        placeholder="+63 917 123 4567"
                      />
                    </div>
                  </div>
                )}

                {/* Password */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Password *
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={form.password}
                      onChange={(e) => updateForm('password', e.target.value)}
                      className={`w-full px-3 py-2 pr-10 border rounded-lg focus:ring-2 focus:ring-primary-500 ${
                        errors.password ? 'border-red-500' : 'border-gray-300'
                      }`}
                      placeholder="Min. 6 characters"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  {errors.password && (
                    <p className="text-xs text-red-500 mt-1">{errors.password}</p>
                  )}
                </div>

                {/* Confirm Password */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Confirm Password *
                  </label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={form.confirmPassword}
                    onChange={(e) => updateForm('confirmPassword', e.target.value)}
                    className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 ${
                      errors.confirmPassword ? 'border-red-500' : 'border-gray-300'
                    }`}
                    placeholder="Confirm password"
                  />
                  {errors.confirmPassword && (
                    <p className="text-xs text-red-500 mt-1">{errors.confirmPassword}</p>
                  )}
                </div>
              </>
            )}

            {/* Invite Mode Info */}
            {form.mode === 'invite' && (
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
                <p className="text-sm text-blue-700">
                  <strong>📧 Invitation Email</strong><br />
                  An email will be sent to <strong>{form.email || 'the user'}</strong> with a link to set their password and complete registration.
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isLoading}
                className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading || (form.mode === 'invite' && emailCount === 0)}
                className="flex-1 px-4 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:bg-gray-300 flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    {form.mode === 'invite' ? `Adding ${emailCount}...` : 'Creating...'}
                  </>
                ) : (
                  <>
                    {form.mode === 'invite' ? <Users size={18} /> : <UserPlus size={18} />}
                    {form.mode === 'invite' 
                      ? `Add ${emailCount} User${emailCount !== 1 ? 's' : ''}` 
                      : `Create ${type === 'parent' ? 'Parent' : 'Staff'}`}
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
