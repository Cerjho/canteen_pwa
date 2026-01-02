import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { 
  LogOut, 
  User, 
  Edit2, 
  ChevronRight, 
  Wallet, 
  Link2, 
  Unlink, 
  AlertCircle,
  Phone,
  Key,
  Save,
  X,
  Clock
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../services/supabaseClient';
import { getStudents, linkStudent, unlinkStudent, updateStudent, Student } from '../../services/students';
import { PageHeader } from '../../components/PageHeader';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { useToast } from '../../components/Toast';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ChangePasswordModal } from '../../components/ChangePasswordModal';
import type { Parent } from '../../types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export default function Profile() {
  const { user, signOut } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [showLinkStudent, setShowLinkStudent] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [unlinkingStudent, setUnlinkingStudent] = useState<Student | null>(null);
  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    phone_number: ''
  });

  // Fetch parent profile (via edge function to handle creation if needed)
  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['profile', user?.id],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Not authenticated');

      // First try to get existing profile via edge function
      const response = await fetch(`${SUPABASE_URL}/functions/v1/manage-profile`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'get' }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Failed to fetch profile');

      // If profile doesn't exist, create it via edge function
      if (!result.exists && user) {
        const createResponse = await fetch(`${SUPABASE_URL}/functions/v1/manage-profile`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: SUPABASE_ANON_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            action: 'create',
            data: {
              first_name: user.user_metadata?.first_name || '',
              last_name: user.user_metadata?.last_name || '',
              phone_number: user.user_metadata?.phone_number || null
            }
          }),
        });

        const createResult = await createResponse.json();
        if (!createResponse.ok) {
          console.error('Failed to create profile:', createResult.message);
          // Return default profile from auth metadata
          return {
            id: user.id,
            email: user.email || '',
            first_name: user.user_metadata?.first_name || '',
            last_name: user.user_metadata?.last_name || '',
            phone_number: user.user_metadata?.phone_number || null,
            balance: 0
          } as Parent;
        }
        
        // Fetch balance from wallets table
        const { data: wallet } = await supabase
          .from('wallets')
          .select('balance')
          .eq('user_id', user.id)
          .maybeSingle();
        
        return { ...createResult.profile, balance: wallet?.balance || 0 } as Parent;
      }
      
      // Fetch balance from wallets table
      if (!user) throw new Error('User not authenticated');
      const { data: wallet } = await supabase
        .from('wallets')
        .select('balance')
        .eq('user_id', user.id)
        .maybeSingle();
      
      return { ...result.profile, balance: wallet?.balance || 0 } as Parent;
    },
    enabled: !!user
  });

  // Fetch students
  const { data: students, isLoading: studentsLoading } = useQuery({
    queryKey: ['students', user?.id],
    queryFn: () => {
      if (!user) throw new Error('User not authenticated');
      return getStudents(user.id);
    },
    enabled: !!user
  });

  // Update profile mutation (via edge function)
  const updateProfileMutation = useMutation({
    mutationFn: async (data: { first_name: string; last_name: string; phone_number: string }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Not authenticated');

      const response = await fetch(`${SUPABASE_URL}/functions/v1/manage-profile`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'update',
          data: {
            first_name: data.first_name,
            last_name: data.last_name,
            phone_number: data.phone_number || null
          }
        }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Failed to update profile');
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      setIsEditingProfile(false);
      showToast('Profile updated successfully', 'success');
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to update profile', 'error');
    }
  });

  // Link student mutation (via Edge Function)
  const linkStudentMutation = useMutation({
    mutationFn: (studentId: string) => linkStudent(studentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['students'] });
      setShowLinkStudent(false);
      showToast('Student linked successfully', 'success');
    },
    onError: (error: Error) => showToast(error.message, 'error')
  });

  // Unlink student mutation (via Edge Function)
  const unlinkStudentMutation = useMutation({
    mutationFn: unlinkStudent,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['students'] });
      setUnlinkingStudent(null);
      showToast('Student unlinked successfully', 'success');
    },
    onError: (error: Error) => {
      setUnlinkingStudent(null);
      showToast(error.message || 'Failed to unlink student', 'error');
    }
  });

  // Update student mutation (dietary info only, via Edge Function)
  const updateStudentMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Student> }) =>
      updateStudent(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['students'] });
      setEditingStudent(null);
      showToast('Info updated successfully', 'success');
    },
    onError: (error: Error) => showToast(error.message || 'Failed to update info', 'error')
  });

  const handleEditProfile = () => {
    setFormData({
      first_name: profile?.first_name || '',
      last_name: profile?.last_name || '',
      phone_number: profile?.phone_number || ''
    });
    setIsEditingProfile(true);
  };

  const handleSaveProfile = () => {
    if (!formData.first_name.trim() || !formData.last_name.trim()) {
      showToast('First and last name are required', 'error');
      return;
    }
    updateProfileMutation.mutate(formData);
  };

  const handleCancelEdit = () => {
    setIsEditingProfile(false);
    setFormData({ first_name: '', last_name: '', phone_number: '' });
  };

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
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center">
                <User size={32} className="text-primary-600" />
              </div>
              <div>
                {isEditingProfile ? (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={formData.first_name}
                        onChange={(e) => setFormData(prev => ({ ...prev, first_name: e.target.value }))}
                        placeholder="First Name"
                        className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                      />
                      <input
                        type="text"
                        value={formData.last_name}
                        onChange={(e) => setFormData(prev => ({ ...prev, last_name: e.target.value }))}
                        placeholder="Last Name"
                        className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                    <input
                      type="tel"
                      value={formData.phone_number}
                      onChange={(e) => setFormData(prev => ({ ...prev, phone_number: e.target.value }))}
                      placeholder="Phone (e.g., 09XX XXX XXXX)"
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                ) : (
                  <>
                    <h2 className="text-xl font-bold">
                      {profile?.first_name} {profile?.last_name}
                    </h2>
                    <p className="text-gray-600">{profile?.email}</p>
                    {profile?.phone_number && (
                      <p className="text-sm text-gray-500 flex items-center gap-1 mt-1">
                        <Phone size={14} />
                        {profile.phone_number}
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
            
            {isEditingProfile ? (
              <div className="flex gap-2">
                <button
                  onClick={handleCancelEdit}
                  className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                  title="Cancel"
                >
                  <X size={20} />
                </button>
                <button
                  onClick={handleSaveProfile}
                  disabled={updateProfileMutation.isPending}
                  className="p-2 text-primary-600 hover:bg-primary-50 rounded-lg"
                  title="Save"
                >
                  <Save size={20} />
                </button>
              </div>
            ) : (
              <button
                onClick={handleEditProfile}
                className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                title="Edit profile"
              >
                <Edit2 size={20} />
              </button>
            )}
          </div>

          {/* Account Details */}
          <div className="space-y-3 border-t pt-4">
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

            <button
              onClick={() => setShowPasswordModal(true)}
              className="w-full flex justify-between items-center hover:bg-gray-50 -mx-2 px-2 py-2 rounded-lg transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-full">
                  <Key size={18} className="text-blue-600" />
                </div>
                <span className="text-gray-600">Change Password</span>
              </div>
              <ChevronRight size={20} className="text-gray-400" />
            </button>

            <div className="flex items-center gap-3 px-2 py-2">
              <div className="p-2 bg-purple-100 rounded-full">
                <Clock size={18} className="text-purple-600" />
              </div>
              <div className="flex-1">
                <span className="text-gray-600 text-sm">Member Since</span>
                <p className="font-medium">
                  {profile?.created_at 
                    ? new Date(profile.created_at).toLocaleDateString('en-PH', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                      })
                    : 'N/A'
                  }
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Students Section */}
        <section className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">My Students</h3>
            <button
              onClick={() => setShowLinkStudent(true)}
              className="flex items-center gap-1 text-primary-600 hover:text-primary-700 font-medium"
            >
              <Link2 size={20} />
              Link Student
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

          {studentsLoading ? (
            <LoadingSpinner size="sm" />
          ) : students && students.length > 0 ? (
            <div className="space-y-3">
              {students.map((student) => (
                <div
                  key={student.id}
                  className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
                >
                  <div>
                    <p className="font-medium">
                      {student.first_name} {student.last_name}
                    </p>
                    <p className="text-sm text-gray-600">
                      <span className="font-mono bg-gray-200 px-1.5 py-0.5 rounded text-xs mr-2">
                        {student.student_id}
                      </span>
                      {student.grade_level}
                      {student.section && ` - Section ${student.section}`}
                    </p>
                    {student.dietary_restrictions && (
                      <p className="text-xs text-amber-600 mt-1">
                        ⚠️ {student.dietary_restrictions}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setEditingStudent(student)}
                      className="p-2 hover:bg-gray-200 rounded-lg"
                      aria-label="Edit dietary info"
                      title="Edit dietary info"
                    >
                      <Edit2 size={18} className="text-gray-600" />
                    </button>
                    <button
                      onClick={() => setUnlinkingStudent(student)}
                      className="p-2 hover:bg-amber-100 rounded-lg"
                      aria-label="Unlink student"
                      title="Unlink student"
                    >
                      <Unlink size={18} className="text-amber-600" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-4">
              No students linked yet. Click "Link Student" and enter the Student ID to connect.
            </p>
          )}
        </section>

        {/* App Info */}
        <section className="bg-white rounded-lg shadow p-6 mb-6">
          <h3 className="text-lg font-semibold mb-3">About</h3>
          <div className="space-y-1 text-sm text-gray-600">
            <p><strong>Canteen PWA</strong> - Parent Portal</p>
            <p>Version 1.0.0</p>
          </div>
        </section>

        {/* Logout Button */}
        <button
          onClick={() => setShowLogoutConfirm(true)}
          className="w-full flex items-center justify-center gap-2 py-3 text-red-600 hover:bg-red-50 rounded-lg font-medium transition-colors bg-white shadow"
        >
          <LogOut size={20} />
          Sign Out
        </button>
      </div>

      {/* Link Student Modal */}
      {showLinkStudent && (
        <LinkStudentModal
          onClose={() => setShowLinkStudent(false)}
          onSubmit={(studentId) => linkStudentMutation.mutate(studentId)}
          isLoading={linkStudentMutation.isPending}
        />
      )}

      {/* Edit Student Modal (dietary info only) */}
      {editingStudent && (
        <EditDietaryModal
          student={editingStudent}
          onClose={() => setEditingStudent(null)}
          onSubmit={(data) =>
            updateStudentMutation.mutate({ id: editingStudent.id, data })
          }
          isLoading={updateStudentMutation.isPending}
        />
      )}

      {/* Unlink Student Confirmation */}
      {unlinkingStudent && (
        <ConfirmDialog
          isOpen={true}
          title="Unlink Student"
          message={`Are you sure you want to unlink ${unlinkingStudent.first_name} ${unlinkingStudent.last_name} from your account? You can link them again later using their Student ID.`}
          confirmLabel={unlinkStudentMutation.isPending ? 'Unlinking...' : 'Unlink'}
          type="warning"
          onConfirm={() => unlinkStudentMutation.mutate(unlinkingStudent.id)}
          onCancel={() => setUnlinkingStudent(null)}
        />
      )}

      {/* Logout Confirmation */}
      <ConfirmDialog
        isOpen={showLogoutConfirm}
        title="Sign Out"
        message="Are you sure you want to sign out?"
        confirmLabel="Sign Out"
        type="danger"
        onConfirm={handleLogout}
        onCancel={() => setShowLogoutConfirm(false)}
      />

      {/* Change Password Modal */}
      <ChangePasswordModal
        isOpen={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
        onSuccess={() => showToast('Password changed successfully', 'success')}
      />
    </div>
  );
}

// Link Student Modal Component
interface LinkStudentModalProps {
  onClose: () => void;
  onSubmit: (studentId: string) => void;
  isLoading: boolean;
}

function LinkStudentModal({ onClose, onSubmit, isLoading }: LinkStudentModalProps) {
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
          Link Your Student
        </h2>

        <p className="text-gray-600 mb-4">
          Enter the Student ID provided by the school to link your student to your account.
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
              {isLoading ? 'Linking...' : 'Link Student'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Edit Dietary Info Modal
interface EditDietaryModalProps {
  student: Student;
  onClose: () => void;
  onSubmit: (data: Partial<Student>) => void;
  isLoading: boolean;
}

function EditDietaryModal({ student, onClose, onSubmit, isLoading }: EditDietaryModalProps) {
  const [dietaryRestrictions, setDietaryRestrictions] = useState(
    student?.dietary_restrictions || ''
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
          For {student.first_name} {student.last_name}
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
