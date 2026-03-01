import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  LogOut,
  Mail,
  Phone,
  Clock,
  Shield,
  Bell,
  Moon,
  Sun,
  Key,
  HelpCircle,
  Info,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../../services/supabaseClient';
import { ensureValidAccessToken } from '../../services/authSession';
import { useToast } from '../../components/Toast';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ChangePasswordModal } from '../../components/ChangePasswordModal';
import { EditProfileModal } from '../../components/EditProfileModal';
import { SettingsGroup, SettingsRow, ProfileHeader, ProfileSkeleton, ToggleSwitch } from '../../components/profile';
import { useTheme } from '../../hooks/useTheme';
import { friendlyError } from '../../utils/friendlyError';

const NOTIFICATION_PREFS_KEY = 'canteen_admin_notifications';

interface AdminProfileData {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone_number?: string;
  created_at: string;
}

export default function AdminProfile() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { theme, toggleTheme } = useTheme();

  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);

  const [notifications, setNotifications] = useState(() => {
    const saved = localStorage.getItem(NOTIFICATION_PREFS_KEY);
    return saved !== null ? JSON.parse(saved) : true;
  });

  const userRole = user?.app_metadata?.role || 'admin';
  const roleLabel = userRole.charAt(0).toUpperCase() + userRole.slice(1);

  // ── Query ────────────────────────────────────────────────

  const { data: profile, isLoading } = useQuery({
    queryKey: ['admin-profile', user?.id],
    queryFn: async () => {
      if (!user) throw new Error('User not authenticated');
      const { data, error } = await supabase
        .from('user_profiles')
        .select('id, email, phone_number, first_name, last_name, role, created_at')
        .eq('id', user.id)
        .maybeSingle();

      if (error) console.error('Error fetching admin profile:', error);

      if (!data) {
        return {
          id: user.id,
          email: user.email || '',
          first_name: user.user_metadata?.first_name || '',
          last_name: user.user_metadata?.last_name || '',
          phone_number: user.user_metadata?.phone_number || '',
          created_at: user.created_at,
        } as AdminProfileData;
      }
      return data as AdminProfileData;
    },
    enabled: !!user,
  });

  // ── Mutation (via edge function for consistency) ─────────

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
      queryClient.invalidateQueries({ queryKey: ['admin-profile'] });
      setShowEditProfile(false);
      showToast('Profile updated successfully', 'success');
    },
    onError: (error: Error) => showToast(friendlyError(error.message, 'update profile'), 'error'),
  });

  // ── Handlers ─────────────────────────────────────────────

  const handleNotificationToggle = () => {
    const newValue = !notifications;
    setNotifications(newValue);
    localStorage.setItem(NOTIFICATION_PREFS_KEY, JSON.stringify(newValue));
    showToast(newValue ? 'Notifications enabled' : 'Notifications disabled', 'success');
    if (newValue && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  };

  const handleLogout = async () => {
    await signOut();
    navigate('/login');
  };

  // ── Loading ──────────────────────────────────────────────

  if (isLoading) return <ProfileSkeleton />;

  // ── Derived ──────────────────────────────────────────────

  const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || 'Administrator';
  const memberSince = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : 'N/A';

  // ── Render ───────────────────────────────────────────────

  return (
    <div className="min-h-screen pb-20 bg-gray-50 dark:bg-gray-900">
      <div className="container mx-auto px-4 py-6">
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
            icon={Shield}
            iconBg="bg-primary-100 dark:bg-primary-900/30"
            iconColor="text-primary-600 dark:text-primary-400"
            label="Role"
            value={<span className="text-primary-600 dark:text-primary-400 font-semibold">{roleLabel}</span>}
          />
          <SettingsRow
            icon={Clock}
            iconBg="bg-purple-100 dark:bg-purple-900/30"
            iconColor="text-purple-600 dark:text-purple-400"
            label="Member Since"
            value={memberSince}
          />
        </SettingsGroup>

        {/* ── Preferences ───────────────────────────────── */}
        <SettingsGroup title="Preferences">
          <SettingsRow
            icon={Bell}
            iconBg="bg-amber-100 dark:bg-amber-900/30"
            iconColor="text-amber-600 dark:text-amber-400"
            label="Notifications"
            description="Push notifications for orders"
            rightElement={
              <ToggleSwitch
                checked={notifications}
                onChange={handleNotificationToggle}
                label="Toggle notifications"
              />
            }
          />
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

        {/* ── About ─────────────────────────────────────── */}
        <SettingsGroup title="About">
          <SettingsRow
            icon={Info}
            iconBg="bg-gray-100 dark:bg-gray-700"
            iconColor="text-gray-500 dark:text-gray-400"
            label="Canteen PWA"
            description="Version 1.0.0 · Admin Portal"
          />
          <SettingsRow
            icon={HelpCircle}
            iconBg="bg-gray-100 dark:bg-gray-700"
            iconColor="text-gray-500 dark:text-gray-400"
            label="Help & Support"
            onClick={() => setShowHelpModal(true)}
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

        <p className="text-center text-gray-400 dark:text-gray-500 text-xs mt-4">
          Canteen Admin v1.0.0
        </p>
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
        message="Are you sure you want to sign out of your admin account?"
        confirmLabel="Sign Out"
        type="danger"
        onConfirm={handleLogout}
        onCancel={() => setShowLogoutConfirm(false)}
      />

      {/* Help & Support Modal */}
      {showHelpModal && (
        <>
          <div className="fixed inset-0 bg-black/50 z-50" onClick={() => setShowHelpModal(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-md w-full p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-primary-100 dark:bg-primary-900/30 rounded-full">
                  <HelpCircle size={22} className="text-primary-600 dark:text-primary-400" />
                </div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Help & Support</h2>
              </div>

              <div className="space-y-4">
                <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                  <h3 className="font-semibold mb-2 text-gray-900 dark:text-gray-100">Contact Support</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                    Need help with the canteen system? Reach out to our support team.
                  </p>
                  <p className="text-sm text-gray-900 dark:text-gray-100">
                    <span className="font-medium">Email:</span>{' '}
                    <a href="mailto:support@canteen.app" className="text-primary-600 hover:underline">
                      support@canteen.app
                    </a>
                  </p>
                </div>

                <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                  <h3 className="font-semibold mb-2 text-gray-900 dark:text-gray-100">Documentation</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    View the admin guide and documentation for detailed instructions on managing the canteen system.
                  </p>
                </div>

                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <h3 className="font-semibold text-blue-900 dark:text-blue-300 mb-2">Quick Tips</h3>
                  <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
                    <li>• Use the Dashboard for real-time order monitoring</li>
                    <li>• Set up Weekly Menu for recurring items</li>
                    <li>• Check Reports for sales analytics</li>
                    <li>• Manage Staff access in Users section</li>
                  </ul>
                </div>
              </div>

              <button
                onClick={() => setShowHelpModal(false)}
                className="w-full mt-6 py-2.5 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors"
              >
                Got it
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
