import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { LogOut, User, Mail, Phone, Clock, Shield, Save, X, Key, ChevronRight, Edit2, Moon, Sun } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../services/supabaseClient';
import { PageHeader } from '../../components/PageHeader';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { useToast } from '../../components/Toast';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ChangePasswordModal } from '../../components/ChangePasswordModal';
import { useTheme } from '../../hooks/useTheme';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

interface StaffProfile {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone_number?: string;
  created_at: string;
}

export default function StaffProfilePage() {
  const { user, signOut } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { theme, toggleTheme } = useTheme();
  const [isEditing, setIsEditing] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    phone_number: ''
  });

  // Get user role
  const userRole = user?.app_metadata?.role || 'staff';

  // Fetch staff profile from user_profiles table
  const { data: profile, isLoading } = useQuery({
    queryKey: ['staff-profile', user?.id],
    queryFn: async () => {
      if (!user) throw new Error('User not authenticated');
      const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();
      
      if (error) {
        console.error('Error fetching staff profile:', error);
      }
      
      // If no profile exists, create basic info from user metadata
      if (!data) {
        return {
          id: user.id,
          email: user.email || '',
          first_name: user.user_metadata?.first_name || '',
          last_name: user.user_metadata?.last_name || '',
          phone_number: user.user_metadata?.phone_number || '',
          created_at: user.created_at
        } as StaffProfile;
      }
      return data as StaffProfile;
    },
    enabled: !!user
  });

  // Update profile mutation (via edge function)
  const updateProfileMutation = useMutation({
    mutationFn: async (data: Partial<StaffProfile>) => {
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
      queryClient.invalidateQueries({ queryKey: ['staff-profile'] });
      setIsEditing(false);
      showToast('Profile updated', 'success');
    },
    onError: (error: Error) => showToast(error.message || 'Failed to update profile', 'error')
  });

  const handleEdit = () => {
    setFormData({
      first_name: profile?.first_name || '',
      last_name: profile?.last_name || '',
      phone_number: profile?.phone_number || ''
    });
    setIsEditing(true);
  };

  const handleSave = () => {
    updateProfileMutation.mutate(formData);
  };

  const handleLogout = async () => {
    await signOut();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24 bg-gray-50 dark:bg-gray-900">
      <div className="container mx-auto px-4 py-6">
        <PageHeader title="Profile" subtitle="Your account settings" />

        {/* Profile Card */}
        <section className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 mb-6">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-20 h-20 bg-primary-100 dark:bg-primary-900/30 rounded-full flex items-center justify-center">
              <User size={40} className="text-primary-600 dark:text-primary-400" />
            </div>
            <div className="flex-1">
              {isEditing ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={formData.first_name}
                    onChange={(e) => setFormData(prev => ({ ...prev, first_name: e.target.value }))}
                    placeholder="First Name"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  />
                  <input
                    type="text"
                    value={formData.last_name}
                    onChange={(e) => setFormData(prev => ({ ...prev, last_name: e.target.value }))}
                    placeholder="Last Name"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  />
                </div>
              ) : (
                <>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                    {profile?.first_name} {profile?.last_name}
                  </h2>
                  <div className="flex items-center gap-2 text-primary-600 dark:text-primary-400">
                    <Shield size={16} />
                    <span className="capitalize font-medium">{userRole}</span>
                  </div>
                </>
              )}
            </div>
            {!isEditing ? (
              <button
                onClick={handleEdit}
                className="p-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                title="Edit profile"
              >
                <Edit2 size={20} />
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => setIsEditing(false)}
                  className="p-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                >
                  <X size={20} />
                </button>
                <button
                  onClick={handleSave}
                  disabled={updateProfileMutation.isPending}
                  className="p-2 text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-gray-700 rounded-lg"
                >
                  <Save size={20} />
                </button>
              </div>
            )}
          </div>

          <div className="space-y-4">
            {/* Email */}
            <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-full">
                <Mail size={18} className="text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Email</p>
                <p className="font-medium text-gray-900 dark:text-gray-100">{profile?.email}</p>
              </div>
            </div>

            {/* Phone */}
            <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <div className="p-2 bg-green-100 dark:bg-green-900 rounded-full">
                <Phone size={18} className="text-green-600 dark:text-green-400" />
              </div>
              <div className="flex-1">
                <p className="text-xs text-gray-500 dark:text-gray-400">Phone Number</p>
                {isEditing ? (
                  <input
                    type="tel"
                    value={formData.phone_number}
                    onChange={(e) => setFormData(prev => ({ ...prev, phone_number: e.target.value }))}
                    placeholder="09XX XXX XXXX"
                    className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded focus:ring-1 focus:ring-primary-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  />
                ) : (
                  <p className="font-medium text-gray-900 dark:text-gray-100">{profile?.phone_number || 'Not set'}</p>
                )}
              </div>
            </div>

            {/* Member Since */}
            <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <div className="p-2 bg-purple-100 dark:bg-purple-900 rounded-full">
                <Clock size={18} className="text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Member Since</p>
                <p className="font-medium text-gray-900 dark:text-gray-100">
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

        {/* Security Section */}
        <section className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 mb-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Security</h3>
          <button
            onClick={() => setShowPasswordModal(true)}
            className="w-full flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 dark:bg-green-900 rounded-full">
                <Key size={18} className="text-green-600 dark:text-green-400" />
              </div>
              <div className="text-left">
                <p className="font-medium text-gray-900 dark:text-gray-100">Change Password</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Update your account password</p>
              </div>
            </div>
            <ChevronRight size={18} className="text-gray-400 dark:text-gray-500" />
          </button>
        </section>

        {/* Settings Section */}
        <section className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 mb-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Settings</h3>
          <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-100 dark:bg-indigo-900 rounded-full">
                {theme === 'dark' ? <Moon size={18} className="text-indigo-600" /> : <Sun size={18} className="text-indigo-600" />}
              </div>
              <div>
                <p className="font-medium text-gray-900 dark:text-gray-100">Dark Mode</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Toggle dark theme</p>
              </div>
            </div>
            <button
              onClick={() => {
                toggleTheme();
                showToast(theme === 'light' ? 'Dark mode enabled' : 'Light mode enabled', 'success');
              }}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                theme === 'dark' ? 'bg-primary-600' : 'bg-gray-300'
              }`}
            >
              <span
                className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${
                  theme === 'dark' ? 'translate-x-5' : ''
                }`}
              />
            </button>
          </div>
        </section>

        {/* App Info */}
        <section className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 mb-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">About</h3>
          <div className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
            <p><strong>Canteen PWA</strong> - Staff Portal</p>
            <p>Version 1.0.0</p>
          </div>
        </section>

        {/* Logout Button */}
        <button
          onClick={() => setShowLogoutConfirm(true)}
          className="w-full flex items-center justify-center gap-2 py-3 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-xl font-medium transition-colors bg-white dark:bg-gray-800 shadow-sm"
        >
          <LogOut size={20} />
          Sign Out
        </button>
      </div>

      {/* Change Password Modal */}
      <ChangePasswordModal
        isOpen={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
        onSuccess={() => showToast('Password changed successfully', 'success')}
      />

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
    </div>
  );
}
