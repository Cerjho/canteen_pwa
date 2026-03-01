import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  LogOut,
  Wallet,
  Link2,
  Unlink,
  AlertCircle,
  Key,
  Clock,
  Moon,
  Sun,
  Edit2,
  GraduationCap,
  Info,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../../services/supabaseClient';
import { ensureValidAccessToken } from '../../services/authSession';
import { getStudents, linkStudent, unlinkStudent, updateStudent, Student } from '../../services/students';
import { PageHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ChangePasswordModal } from '../../components/ChangePasswordModal';
import { LinkStudentModal } from '../../components/LinkStudentModal';
import { EditDietaryModal } from '../../components/EditDietaryModal';
import { EditProfileModal } from '../../components/EditProfileModal';
import { SettingsGroup, SettingsRow, ProfileHeader, ProfileSkeleton, ToggleSwitch } from '../../components/profile';
import { useTheme } from '../../hooks/useTheme';
import type { Parent } from '../../types';
import { friendlyError } from '../../utils/friendlyError';

export default function Profile() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { theme, toggleTheme } = useTheme();

  // Modal states
  const [showLinkStudent, setShowLinkStudent] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [unlinkingStudent, setUnlinkingStudent] = useState<Student | null>(null);

  // ── Queries ──────────────────────────────────────────────

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['profile', user?.id],
    queryFn: async () => {
      const accessToken = await ensureValidAccessToken();
      const response = await fetch(`${SUPABASE_URL}/functions/v1/manage-profile`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'get' }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Failed to fetch profile');

      if (!result.exists && user) {
        const createResponse = await fetch(`${SUPABASE_URL}/functions/v1/manage-profile`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            apikey: SUPABASE_ANON_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            action: 'create',
            data: {
              first_name: user.user_metadata?.first_name || '',
              last_name: user.user_metadata?.last_name || '',
              phone_number: user.user_metadata?.phone_number || null,
            },
          }),
        });
        const createResult = await createResponse.json();
        if (!createResponse.ok) {
          return {
            id: user.id,
            email: user.email || '',
            first_name: user.user_metadata?.first_name || '',
            last_name: user.user_metadata?.last_name || '',
            phone_number: user.user_metadata?.phone_number || null,
            balance: 0,
          } as Parent;
        }
        const { data: wallet } = await supabase
          .from('wallets')
          .select('balance')
          .eq('user_id', user.id)
          .maybeSingle();
        return { ...createResult.profile, balance: wallet?.balance || 0 } as Parent;
      }

      if (!user) throw new Error('User not authenticated');
      const { data: wallet } = await supabase
        .from('wallets')
        .select('balance')
        .eq('user_id', user.id)
        .maybeSingle();
      return { ...result.profile, balance: wallet?.balance || 0 } as Parent;
    },
    enabled: !!user,
  });

  const { data: students, isLoading: studentsLoading } = useQuery({
    queryKey: ['students', user?.id],
    queryFn: () => {
      if (!user) throw new Error('User not authenticated');
      return getStudents(user.id);
    },
    enabled: !!user,
  });

  // ── Mutations ────────────────────────────────────────────

  const updateProfileMutation = useMutation({
    mutationFn: async (data: { first_name: string; last_name: string; phone_number: string }) => {
      const accessToken = await ensureValidAccessToken();
      const response = await fetch(`${SUPABASE_URL}/functions/v1/manage-profile`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'update',
          data: { first_name: data.first_name, last_name: data.last_name, phone_number: data.phone_number || null },
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Failed to update profile');
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      setShowEditProfile(false);
      showToast('Profile updated successfully', 'success');
    },
    onError: (error: Error) => showToast(friendlyError(error.message, 'update your profile'), 'error'),
  });

  const linkStudentMutation = useMutation({
    mutationFn: (studentId: string) => linkStudent(studentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['students'] });
      setShowLinkStudent(false);
      showToast('Student linked successfully', 'success');
    },
    onError: (error: Error) => showToast(friendlyError(error.message, 'link student'), 'error'),
  });

  const unlinkStudentMutation = useMutation({
    mutationFn: unlinkStudent,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['students'] });
      setUnlinkingStudent(null);
      showToast('Student unlinked successfully', 'success');
    },
    onError: (error: Error) => {
      setUnlinkingStudent(null);
      showToast(friendlyError(error.message, 'unlink student'), 'error');
    },
  });

  const updateStudentMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Student> }) => updateStudent(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['students'] });
      setEditingStudent(null);
      showToast('Info updated successfully', 'success');
    },
    onError: (error: Error) => showToast(friendlyError(error.message, 'update student info'), 'error'),
  });

  // ── Handlers ─────────────────────────────────────────────

  const handleLogout = async () => {
    await signOut();
    navigate('/login');
  };

  // ── Loading state ────────────────────────────────────────

  if (profileLoading) {
    return <ProfileSkeleton />;
  }

  // ── Derived values ───────────────────────────────────────

  const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || 'Parent';
  const memberSince = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })
    : 'N/A';

  // ── Render ───────────────────────────────────────────────

  return (
    <div className="min-h-screen pb-24 bg-gray-50 dark:bg-gray-900">
      <div className="container mx-auto px-4 py-6">
        <PageHeader title="Profile" subtitle="Manage your account" />

        {/* Profile Header Card */}
        <ProfileHeader
          name={fullName}
          email={profile?.email || ''}
          phone={profile?.phone_number || undefined}
          onEdit={() => setShowEditProfile(true)}
        />

        {/* ── My Students ───────────────────────────────── */}
        <SettingsGroup title="My Students">
          {/* Info box */}
          <div className="px-4 py-3">
            <div className="flex gap-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-lg p-3">
              <AlertCircle size={16} className="text-blue-500 dark:text-blue-400 shrink-0 mt-0.5" />
              <p className="text-xs text-blue-700 dark:text-blue-300">
                Students are registered by the school. Use the <strong>Student ID</strong> provided by the school to link your child.
              </p>
            </div>
          </div>

          {studentsLoading ? (
            <div className="px-4 py-6 flex justify-center">
              <div className="w-6 h-6 border-2 border-gray-300 dark:border-gray-600 border-t-primary-600 rounded-full animate-spin" />
            </div>
          ) : students && students.length > 0 ? (
            <>
              {students.map((student) => (
                <div key={student.id} className="px-4 py-3.5 flex items-center gap-3">
                  {/* Student icon */}
                  <div className="p-2 bg-primary-50 dark:bg-primary-900/30 rounded-full shrink-0">
                    <GraduationCap size={18} className="text-primary-600 dark:text-primary-400" />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 dark:text-gray-100 truncate">
                      {student.first_name} {student.last_name}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="font-mono bg-gray-200 dark:bg-gray-600 px-1.5 py-0.5 rounded text-[10px] text-gray-700 dark:text-gray-200">
                        {student.student_id}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {student.grade_level}{student.section && ` · ${student.section}`}
                      </span>
                    </div>
                    {student.dietary_restrictions && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 truncate">
                        ⚠️ {student.dietary_restrictions}
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setEditingStudent(student)}
                      className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                      aria-label="Edit dietary info"
                      title="Edit dietary info"
                    >
                      <Edit2 size={16} className="text-gray-500 dark:text-gray-400" />
                    </button>
                    <button
                      onClick={() => setUnlinkingStudent(student)}
                      className="p-2 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                      aria-label="Unlink student"
                      title="Unlink student"
                    >
                      <Unlink size={16} className="text-red-500 dark:text-red-400" />
                    </button>
                  </div>
                </div>
              ))}
            </>
          ) : (
            <div className="px-4 py-6 text-center">
              <GraduationCap size={32} className="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
              <p className="text-sm text-gray-500 dark:text-gray-400">No students linked yet</p>
            </div>
          )}

          {/* Link Student action row */}
          <SettingsRow
            icon={Link2}
            iconBg="bg-primary-50 dark:bg-primary-900/30"
            iconColor="text-primary-600 dark:text-primary-400"
            label="Link a Student"
            description="Enter their school-issued Student ID"
            onClick={() => setShowLinkStudent(true)}
          />
        </SettingsGroup>

        {/* ── Wallet ────────────────────────────────────── */}
        <SettingsGroup title="Wallet">
          <SettingsRow
            icon={Wallet}
            iconBg="bg-green-100 dark:bg-green-900/30"
            iconColor="text-green-600 dark:text-green-400"
            label="Account Balance"
            value={
              <span className="text-green-600 dark:text-green-400 font-bold">
                ₱{profile?.balance?.toFixed(2) || '0.00'}
              </span>
            }
            chevron
            onClick={() => navigate('/balance')}
          />
        </SettingsGroup>

        {/* ── Security ──────────────────────────────────── */}
        <SettingsGroup title="Security">
          <SettingsRow
            icon={Key}
            iconBg="bg-blue-100 dark:bg-blue-900/30"
            iconColor="text-blue-600 dark:text-blue-400"
            label="Change Password"
            description="Update your account password"
            onClick={() => setShowPasswordModal(true)}
          />
        </SettingsGroup>

        {/* ── Preferences ───────────────────────────────── */}
        <SettingsGroup title="Preferences">
          <SettingsRow
            icon={theme === 'dark' ? Moon : Sun}
            iconBg="bg-indigo-100 dark:bg-indigo-900/30"
            iconColor="text-indigo-600 dark:text-indigo-400"
            label="Dark Mode"
            description="Toggle dark theme"
            rightElement={
              <ToggleSwitch
                checked={theme === 'dark'}
                onChange={() => {
                  toggleTheme();
                  showToast(theme === 'light' ? 'Dark mode enabled' : 'Light mode enabled', 'success');
                }}
                label="Toggle dark mode"
              />
            }
          />
        </SettingsGroup>

        {/* ── About ─────────────────────────────────────── */}
        <SettingsGroup title="About">
          <SettingsRow
            icon={Info}
            iconBg="bg-gray-100 dark:bg-gray-700"
            iconColor="text-gray-500 dark:text-gray-400"
            label="Canteen PWA"
            description="Version 1.0.0"
          />
          <SettingsRow
            icon={Clock}
            iconBg="bg-purple-100 dark:bg-purple-900/30"
            iconColor="text-purple-600 dark:text-purple-400"
            label="Member Since"
            value={memberSince}
          />
        </SettingsGroup>

        {/* ── Logout ────────────────────────────────────── */}
        <SettingsGroup>
          <SettingsRow
            icon={LogOut}
            iconBg="bg-red-50 dark:bg-red-900/30"
            label="Sign Out"
            variant="danger"
            onClick={() => setShowLogoutConfirm(true)}
          />
        </SettingsGroup>
      </div>

      {/* ── Modals ────────────────────────────────────────── */}

      <LinkStudentModal
        isOpen={showLinkStudent}
        onClose={() => setShowLinkStudent(false)}
        onSubmit={(studentId) => linkStudentMutation.mutate(studentId)}
        isLoading={linkStudentMutation.isPending}
      />

      <EditDietaryModal
        isOpen={!!editingStudent}
        student={editingStudent}
        onClose={() => setEditingStudent(null)}
        onSubmit={(data) => editingStudent && updateStudentMutation.mutate({ id: editingStudent.id, data })}
        isLoading={updateStudentMutation.isPending}
      />

      <EditProfileModal
        isOpen={showEditProfile}
        profile={{
          first_name: profile?.first_name || '',
          last_name: profile?.last_name || '',
          phone_number: profile?.phone_number || '',
        }}
        onClose={() => setShowEditProfile(false)}
        onSave={(data) => updateProfileMutation.mutate(data)}
        isLoading={updateProfileMutation.isPending}
      />

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

      <ConfirmDialog
        isOpen={showLogoutConfirm}
        title="Sign Out"
        message="Are you sure you want to sign out?"
        confirmLabel="Sign Out"
        type="danger"
        onConfirm={handleLogout}
        onCancel={() => setShowLogoutConfirm(false)}
      />

      <ChangePasswordModal
        isOpen={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
        onSuccess={() => showToast('Password changed successfully', 'success')}
      />
    </div>
  );
}
