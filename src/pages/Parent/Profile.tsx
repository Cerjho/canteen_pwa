import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { LogOut, User, Edit2, ChevronRight, Wallet, Link2, Unlink, AlertCircle } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../services/supabaseClient';
import { getChildren, linkStudent, unlinkStudent, updateChild, Child } from '../../services/children';
import { PageHeader } from '../../components/PageHeader';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { useToast } from '../../components/Toast';
import type { Parent } from '../../types';

export default function Profile() {
  const { user, signOut } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [showLinkChild, setShowLinkChild] = useState(false);
  const [editingChild, setEditingChild] = useState<Child | null>(null);

  // Fetch parent profile
  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['profile', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('parents')
        .select('*')
        .eq('id', user!.id)
        .single();
      if (error) throw error;
      return data as Parent;
    },
    enabled: !!user
  });

  // Fetch children
  const { data: children, isLoading: childrenLoading } = useQuery({
    queryKey: ['children', user?.id],
    queryFn: () => getChildren(user!.id),
    enabled: !!user
  });

  // Link child mutation (via Edge Function)
  const linkChildMutation = useMutation({
    mutationFn: (studentId: string) => linkStudent(studentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['children'] });
      setShowLinkChild(false);
      showToast('Child linked successfully', 'success');
    },
    onError: (error: Error) => showToast(error.message, 'error')
  });

  // Unlink child mutation (via Edge Function)
  const unlinkChildMutation = useMutation({
    mutationFn: unlinkStudent,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['children'] });
      showToast('Child unlinked successfully', 'success');
    },
    onError: (error: Error) => showToast(error.message || 'Failed to unlink child', 'error')
  });

  // Update child mutation (dietary info only, via Edge Function)
  const updateChildMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Child> }) =>
      updateChild(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['children'] });
      setEditingChild(null);
      showToast('Info updated successfully', 'success');
    },
    onError: (error: Error) => showToast(error.message || 'Failed to update info', 'error')
  });

  const handleLogout = async () => {
    await signOut();
  };

  if (profileLoading) {
    return <LoadingSpinner size="lg" />;
  }

  return (
    <div className="min-h-screen pb-24">
      <div className="container mx-auto px-4 py-6">
        <PageHeader title="Profile" subtitle="Manage your account" />

        {/* Account Info */}
        <section className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center">
              <User size={32} className="text-primary-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold">
                {profile?.first_name} {profile?.last_name}
              </h2>
              <p className="text-gray-600">{profile?.email}</p>
            </div>
          </div>

          <div className="border-t pt-4">
            <Link 
              to="/balance" 
              className="flex justify-between items-center hover:bg-gray-50 -mx-2 px-2 py-2 rounded-lg transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-100 rounded-full">
                  <Wallet size={18} className="text-green-600" />
                </div>
                <span className="text-gray-600">Account Balance</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xl font-bold text-green-600">
                  ₱{profile?.balance?.toFixed(2) || '0.00'}
                </span>
                <ChevronRight size={20} className="text-gray-400" />
              </div>
            </Link>
          </div>
        </section>

        {/* Children Section */}
        <section className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">My Children</h3>
            <button
              onClick={() => setShowLinkChild(true)}
              className="flex items-center gap-1 text-primary-600 hover:text-primary-700 font-medium"
            >
              <Link2 size={20} />
              Link Child
            </button>
          </div>

          {/* Info box about student IDs */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
            <div className="flex gap-2">
              <AlertCircle size={18} className="text-blue-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-blue-800">
                Students are registered by the school. Use the <strong>Student ID</strong> provided by the school to link your child to your account.
              </p>
            </div>
          </div>

          {childrenLoading ? (
            <LoadingSpinner size="sm" />
          ) : children && children.length > 0 ? (
            <div className="space-y-3">
              {children.map((child) => (
                <div
                  key={child.id}
                  className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
                >
                  <div>
                    <p className="font-medium">
                      {child.first_name} {child.last_name}
                    </p>
                    <p className="text-sm text-gray-600">
                      <span className="font-mono bg-gray-200 px-1.5 py-0.5 rounded text-xs mr-2">
                        {child.student_id}
                      </span>
                      {child.grade_level}
                      {child.section && ` - Section ${child.section}`}
                    </p>
                    {child.dietary_restrictions && (
                      <p className="text-xs text-amber-600 mt-1">
                        ⚠️ {child.dietary_restrictions}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setEditingChild(child)}
                      className="p-2 hover:bg-gray-200 rounded-lg"
                      aria-label="Edit dietary info"
                      title="Edit dietary info"
                    >
                      <Edit2 size={18} className="text-gray-600" />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm('Unlink this child from your account?')) {
                          unlinkChildMutation.mutate(child.id);
                        }
                      }}
                      className="p-2 hover:bg-amber-100 rounded-lg"
                      aria-label="Unlink child"
                      title="Unlink child"
                    >
                      <Unlink size={18} className="text-amber-600" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-4">
              No children linked yet. Click "Link Child" and enter the Student ID to connect.
            </p>
          )}
        </section>

        {/* Logout Button */}
        <button
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2 py-3 text-red-600 hover:bg-red-50 rounded-lg font-medium transition-colors"
        >
          <LogOut size={20} />
          Sign Out
        </button>
      </div>

      {/* Link Child Modal */}
      {showLinkChild && (
        <LinkChildModal
          onClose={() => setShowLinkChild(false)}
          onSubmit={(studentId) => linkChildMutation.mutate(studentId)}
          isLoading={linkChildMutation.isPending}
        />
      )}

      {/* Edit Child Modal (dietary info only) */}
      {editingChild && (
        <EditDietaryModal
          child={editingChild}
          onClose={() => setEditingChild(null)}
          onSubmit={(data) =>
            updateChildMutation.mutate({ id: editingChild.id, data })
          }
          isLoading={updateChildMutation.isPending}
        />
      )}
    </div>
  );
}

// Link Child Modal Component
interface LinkChildModalProps {
  onClose: () => void;
  onSubmit: (studentId: string) => void;
  isLoading: boolean;
}

function LinkChildModal({ onClose, onSubmit, isLoading }: LinkChildModalProps) {
  const [studentId, setStudentId] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentId.trim()) return;
    onSubmit(studentId.trim());
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
          <Link2 size={24} className="text-primary-600" />
          Link Your Child
        </h2>

        <p className="text-gray-600 mb-4">
          Enter the Student ID provided by the school to link your child to your account.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Student ID
            </label>
            <input
              type="text"
              value={studentId}
              onChange={(e) => setStudentId(e.target.value.toUpperCase())}
              placeholder="e.g., 26-00001"
              required
              className="w-full px-3 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 font-mono text-lg text-center"
              autoFocus
            />
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
            <p className="text-sm text-amber-800">
              💡 <strong>Don't have a Student ID?</strong><br />
              Contact the school administration to get your child's Student ID.
            </p>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 border border-gray-300 rounded-lg font-medium hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !studentId.trim()}
              className="flex-1 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 disabled:bg-gray-300"
            >
              {isLoading ? 'Linking...' : 'Link Child'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Edit Dietary Info Modal
interface EditDietaryModalProps {
  child: Child;
  onClose: () => void;
  onSubmit: (data: Partial<Child>) => void;
  isLoading: boolean;
}

function EditDietaryModal({ child, onClose, onSubmit, isLoading }: EditDietaryModalProps) {
  const [dietaryRestrictions, setDietaryRestrictions] = useState(
    child?.dietary_restrictions || ''
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      dietary_restrictions: dietaryRestrictions || undefined
    });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
        <h2 className="text-xl font-bold mb-2">Edit Dietary Info</h2>
        <p className="text-sm text-gray-600 mb-4">
          For {child.first_name} {child.last_name}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Dietary Restrictions / Allergies
            </label>
            <textarea
              value={dietaryRestrictions}
              onChange={(e) => setDietaryRestrictions(e.target.value)}
              placeholder="e.g., No peanuts, vegetarian, lactose intolerant"
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <p className="text-xs text-gray-500">
            This information will be shown to staff when preparing orders.
          </p>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 border border-gray-300 rounded-lg font-medium hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex-1 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 disabled:bg-gray-300"
            >
              {isLoading ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
