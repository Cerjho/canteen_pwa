import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  LogOut,
  Mail,
  Phone,
  Clock,
  Key,
  Moon,
  Sun,
  Info,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../../services/supabaseClient';
import { ensureValidAccessToken } from '../../services/authSession';
import { PageHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ChangePasswordModal } from '../../components/ChangePasswordModal';
import { EditProfileModal } from '../../components/EditProfileModal';
import { SettingsGroup, SettingsRow, ProfileHeader, ProfileSkeleton, ToggleSwitch } from '../../components/profile';
import { useTheme } from '../../hooks/useTheme';
import { friendlyError } from '../../utils/friendlyError';

interface StaffProfile {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone_number?: string;
  created_at: string;
}

export default function StaffProfilePage() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { theme, toggleTheme } = useTheme();

  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);

  const userRole = user?.app_metadata?.role || 'staff';
  const roleLabel = userRole.charAt(0).toUpperCase() + userRole.slice(1);

  // ── Query ────────────────────────────────────────────────

  const { data: profile, isLoading } = useQuery({
    queryKey: ['staff-profile', user?.id],
    queryFn: async () => {
      if (!user) throw new Error('User not authenticated');
      const { data, error } = await supabase
        .from('user_profiles')
        .select('id, email, phone_number, first_name, last_name, role, created_at')
        .eq('id', user.id)
        .maybeSingle();

      if (error) console.error('Error fetching staff profile:', error);

      if (!data) {
        return {
          id: user.id,
          email: user.email || '',
          first_name: user.user_metadata?.first_name || '',
          last_name: user.user_metadata?.last_name || '',
          phone_number: user.user_metadata?.phone_number || '',
          created_at: user.created_at,
        } as StaffProfile;
      }
      return data as StaffProfile;
    },
    enabled: !!user,
  });

  // ── Mutation ─────────────────────────────────────────────

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
      queryClient.invalidateQueries({ queryKey: ['staff-profile'] });
      setShowEditProfile(false);
      showToast('Profile updated', 'success');
    },
    onError: (error: Error) => showToast(friendlyError(error.message, 'update profile'), 'error'),
  });

  // ── Handlers ─────────────────────────────────────────────

  const handleLogout = async () => {
    await signOut();
    navigate('/login');
  };

  // ── Loading ──────────────────────────────────────────────

  if (isLoading) return <ProfileSkeleton />;

  // ── Derived ──────────────────────────────────────────────

  const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || 'Staff';
  const memberSince = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })
    : 'N/A';

  // ── Render ───────────────────────────────────────────────

  return (
    <div className="min-h-screen pb-24 bg-gray-50 dark:bg-gray-900">
      <div className="container mx-auto px-4 py-6">
        <PageHeader title="Profile" subtitle="Your account settings" />

        <ProfileHeader
          name={fullName}
          email={profile?.email || ''}
          phone={profile?.phone_number || undefined}
          role={roleLabel}
          onEdit={() => setShowEditProfile(true)}
        />

        {/* ── Account ───────────────────────────────────── */}
        <SettingsGroup title="Account">
          <SettingsRow
            icon={Mail}
            iconBg="bg-blue-100 dark:bg-blue-900/30"
            iconColor="text-blue-600 dark:text-blue-400"
            label="Email"
            value={profile?.email || '—'}
          />
          <SettingsRow
            icon={Phone}
            iconBg="bg-green-100 dark:bg-green-900/30"
            iconColor="text-green-600 dark:text-green-400"
            label="Phone"
            value={profile?.phone_number || 'Not set'}
          />
          <SettingsRow
            icon={Clock}
            iconBg="bg-purple-100 dark:bg-purple-900/30"
            iconColor="text-purple-600 dark:text-purple-400"
            label="Member Since"
            value={memberSince}
          />
        </SettingsGroup>

        {/* ── Security ──────────────────────────────────── */}
        <SettingsGroup title="Security">
          <SettingsRow
            icon={Key}
            iconBg="bg-green-100 dark:bg-green-900/30"
            iconColor="text-green-600 dark:text-green-400"
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
            description="Version 1.0.0 · Staff Portal"
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

      <ChangePasswordModal
        isOpen={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
        onSuccess={() => showToast('Password changed successfully', 'success')}
      />

      <ConfirmDialog
        isOpen={showLogoutConfirm}
        title="Sign Out"
        message="Are you sure you want to sign out?"
        confirmLabel="Sign Out"
        type="danger"
        onConfirm={handleLogout}
        onCancel={() => setShowLogoutConfirm(false)}
      />
    </div>
  );
}
