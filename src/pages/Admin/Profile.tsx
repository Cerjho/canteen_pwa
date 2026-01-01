import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  User, 
  Mail, 
  Shield, 
  LogOut, 
  Settings, 
  Bell,
  Moon,
  Sun,
  ChevronRight,
  Key,
  HelpCircle,
  FileText,
  Phone,
  Save,
  X,
  Edit2
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../services/supabaseClient';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ChangePasswordModal } from '../../components/ChangePasswordModal';
import { useToast } from '../../components/Toast';

interface AdminProfileData {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone_number?: string;
  created_at: string;
}

// Notification preferences key for localStorage
const NOTIFICATION_PREFS_KEY = 'canteen_admin_notifications';
const DARK_MODE_KEY = 'canteen_dark_mode';

export default function AdminProfile() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    phone_number: ''
  });

  // Load preferences from localStorage
  const [notifications, setNotifications] = useState(() => {
    const saved = localStorage.getItem(NOTIFICATION_PREFS_KEY);
    return saved !== null ? JSON.parse(saved) : true;
  });
  
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem(DARK_MODE_KEY);
    return saved !== null ? JSON.parse(saved) : false;
  });

  // Persist notification preference
  const handleNotificationToggle = () => {
    const newValue = !notifications;
    setNotifications(newValue);
    localStorage.setItem(NOTIFICATION_PREFS_KEY, JSON.stringify(newValue));
    showToast(newValue ? 'Notifications enabled' : 'Notifications disabled', 'success');
    
    // Request browser notification permission if enabling
    if (newValue && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  };

  // Persist dark mode preference
  const handleDarkModeToggle = () => {
    const newValue = !darkMode;
    setDarkMode(newValue);
    localStorage.setItem(DARK_MODE_KEY, JSON.stringify(newValue));
    
    // Apply dark mode to document (for future full dark mode implementation)
    if (newValue) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    
    showToast(newValue ? 'Dark mode enabled' : 'Dark mode disabled', 'success');
  };

  // Apply dark mode on mount
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    }
  }, []);

  // Fetch admin profile
  const { data: profile } = useQuery({
    queryKey: ['admin-profile', user?.id],
    queryFn: async () => {
      // Try to get from parents table first
      const { data, error } = await supabase
        .from('parents')
        .select('*')
        .eq('id', user!.id)
        .single();
      
      if (error || !data) {
        // Return basic info from auth user
        return {
          id: user!.id,
          email: user!.email || '',
          first_name: user!.user_metadata?.first_name || '',
          last_name: user!.user_metadata?.last_name || '',
          phone_number: user!.user_metadata?.phone_number || '',
          created_at: user!.created_at
        } as AdminProfileData;
      }
      return data as AdminProfileData;
    },
    enabled: !!user
  });

  // Update profile mutation
  const updateProfileMutation = useMutation({
    mutationFn: async (data: Partial<AdminProfileData>) => {
      // Update in parents table
      const { error: dbError } = await supabase
        .from('parents')
        .upsert({
          id: user!.id,
          email: user!.email,
          ...data,
          updated_at: new Date().toISOString()
        });
      
      if (dbError) throw dbError;

      // Also update user metadata
      const { error: authError } = await supabase.auth.updateUser({
        data: {
          first_name: data.first_name,
          last_name: data.last_name,
          phone_number: data.phone_number
        }
      });
      
      if (authError) throw authError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-profile'] });
      setIsEditing(false);
      showToast('Profile updated successfully', 'success');
    },
    onError: () => {
      showToast('Failed to update profile', 'error');
    }
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
    if (!formData.first_name.trim() || !formData.last_name.trim()) {
      showToast('First and last name are required', 'error');
      return;
    }
    updateProfileMutation.mutate(formData);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setFormData({
      first_name: '',
      last_name: '',
      phone_number: ''
    });
  };

  const handleLogout = async () => {
    await signOut();
    navigate('/login');
  };

  const adminInfo = {
    name: profile?.first_name && profile?.last_name 
      ? `${profile.first_name} ${profile.last_name}`
      : user?.user_metadata?.first_name && user?.user_metadata?.last_name
        ? `${user.user_metadata.first_name} ${user.user_metadata.last_name}`
        : 'Administrator',
    email: profile?.email || user?.email || 'admin@canteen.app',
    role: 'Administrator',
    joinedDate: profile?.created_at ? new Date(profile.created_at).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }) : 'N/A',
    phone: profile?.phone_number || 'Not set'
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <div className="container mx-auto px-4 py-6">
        {/* Profile Header */}
        <div className="bg-gradient-to-br from-primary-600 to-primary-700 rounded-2xl p-6 text-white mb-6 shadow-lg relative">
          {!isEditing && (
            <button
              onClick={handleEdit}
              className="absolute top-4 right-4 p-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors"
              title="Edit profile"
            >
              <Edit2 size={18} />
            </button>
          )}
          
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-full bg-white/20 flex items-center justify-center ring-4 ring-white/30">
              <User size={40} className="text-white" />
            </div>
            <div className="flex-1">
              {isEditing ? (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={formData.first_name}
                      onChange={(e) => setFormData(prev => ({ ...prev, first_name: e.target.value }))}
                      placeholder="First Name"
                      className="flex-1 px-3 py-1.5 rounded-lg text-gray-900 text-sm focus:ring-2 focus:ring-white"
                    />
                    <input
                      type="text"
                      value={formData.last_name}
                      onChange={(e) => setFormData(prev => ({ ...prev, last_name: e.target.value }))}
                      placeholder="Last Name"
                      className="flex-1 px-3 py-1.5 rounded-lg text-gray-900 text-sm focus:ring-2 focus:ring-white"
                    />
                  </div>
                  <input
                    type="tel"
                    value={formData.phone_number}
                    onChange={(e) => setFormData(prev => ({ ...prev, phone_number: e.target.value }))}
                    placeholder="Phone Number (e.g., 09XX XXX XXXX)"
                    className="w-full px-3 py-1.5 rounded-lg text-gray-900 text-sm focus:ring-2 focus:ring-white"
                  />
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={handleCancelEdit}
                      className="flex items-center gap-1 px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-sm transition-colors"
                    >
                      <X size={14} />
                      Cancel
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={updateProfileMutation.isPending}
                      className="flex items-center gap-1 px-3 py-1.5 bg-white text-primary-600 rounded-lg text-sm font-medium hover:bg-white/90 transition-colors disabled:opacity-50"
                    >
                      <Save size={14} />
                      {updateProfileMutation.isPending ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <h1 className="text-2xl font-bold">{adminInfo.name}</h1>
                  <div className="flex items-center gap-2 mt-1 text-primary-100">
                    <Mail size={14} />
                    <span className="text-sm">{adminInfo.email}</span>
                  </div>
                  {adminInfo.phone !== 'Not set' && (
                    <div className="flex items-center gap-2 mt-1 text-primary-100">
                      <Phone size={14} />
                      <span className="text-sm">{adminInfo.phone}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    <span className="px-2 py-0.5 bg-white/20 rounded-full text-xs font-medium flex items-center gap-1">
                      <Shield size={12} />
                      {adminInfo.role}
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Account Info Section */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-6">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <User size={18} className="text-gray-400" />
              Account Information
            </h2>
          </div>
          <div className="divide-y divide-gray-100">
            <div className="px-4 py-3 flex items-center justify-between">
              <span className="text-gray-600">Email</span>
              <span className="text-gray-900 font-medium">{adminInfo.email}</span>
            </div>
            <div className="px-4 py-3 flex items-center justify-between">
              <span className="text-gray-600">Phone</span>
              <span className="text-gray-900 font-medium">{adminInfo.phone}</span>
            </div>
            <div className="px-4 py-3 flex items-center justify-between">
              <span className="text-gray-600">Role</span>
              <span className="text-primary-600 font-medium flex items-center gap-1">
                <Shield size={14} />
                {adminInfo.role}
              </span>
            </div>
            <div className="px-4 py-3 flex items-center justify-between">
              <span className="text-gray-600">Member Since</span>
              <span className="text-gray-900">{adminInfo.joinedDate}</span>
            </div>
          </div>
        </div>

        {/* Settings Section */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-6">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <Settings size={18} className="text-gray-400" />
              Settings
            </h2>
          </div>
          <div className="divide-y divide-gray-100">
            <div className="px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-100 rounded-lg">
                  <Bell size={18} className="text-amber-600" />
                </div>
                <div>
                  <p className="text-gray-900 font-medium">Notifications</p>
                  <p className="text-sm text-gray-500">Push notifications for orders</p>
                </div>
              </div>
              <button
                onClick={handleNotificationToggle}
                className={`relative w-11 h-6 rounded-full transition-colors ${
                  notifications ? 'bg-primary-600' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${
                    notifications ? 'translate-x-5' : ''
                  }`}
                />
              </button>
            </div>
            <div className="px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-100 rounded-lg">
                  {darkMode ? <Moon size={18} className="text-indigo-600" /> : <Sun size={18} className="text-indigo-600" />}
                </div>
                <div>
                  <p className="text-gray-900 font-medium">Dark Mode</p>
                  <p className="text-sm text-gray-500">Toggle dark theme</p>
                </div>
              </div>
              <button
                onClick={handleDarkModeToggle}
                className={`relative w-11 h-6 rounded-full transition-colors ${
                  darkMode ? 'bg-primary-600' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${
                    darkMode ? 'translate-x-5' : ''
                  }`}
                />
              </button>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-6">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Quick Actions</h2>
          </div>
          <div className="divide-y divide-gray-100">
            <button
              onClick={() => navigate('/admin/users')}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <User size={18} className="text-blue-600" />
                </div>
                <span className="text-gray-900 font-medium">Manage Users</span>
              </div>
              <ChevronRight size={18} className="text-gray-400" />
            </button>
            <button
              onClick={() => navigate('/admin/reports')}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-100 rounded-lg">
                  <FileText size={18} className="text-purple-600" />
                </div>
                <span className="text-gray-900 font-medium">View Reports</span>
              </div>
              <ChevronRight size={18} className="text-gray-400" />
            </button>
            <button
              onClick={() => setShowPasswordModal(true)}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-100 rounded-lg">
                  <Key size={18} className="text-green-600" />
                </div>
                <span className="text-gray-900 font-medium">Change Password</span>
              </div>
              <ChevronRight size={18} className="text-gray-400" />
            </button>
            <button
              onClick={() => setShowHelpModal(true)}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gray-100 rounded-lg">
                  <HelpCircle size={18} className="text-gray-600" />
                </div>
                <span className="text-gray-900 font-medium">Help & Support</span>
              </div>
              <ChevronRight size={18} className="text-gray-400" />
            </button>
          </div>
        </div>

        {/* Logout Button */}
        <button
          onClick={() => setShowLogoutConfirm(true)}
          className="w-full py-3 px-4 bg-red-50 text-red-600 rounded-xl font-semibold hover:bg-red-100 transition-colors flex items-center justify-center gap-2"
        >
          <LogOut size={20} />
          Sign Out
        </button>

        {/* App Version */}
        <p className="text-center text-gray-400 text-sm mt-6">
          Canteen Admin v1.0.0
        </p>
      </div>

      {/* Logout Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showLogoutConfirm}
        onCancel={() => setShowLogoutConfirm(false)}
        onConfirm={handleLogout}
        title="Sign Out"
        message="Are you sure you want to sign out of your admin account?"
        confirmLabel="Sign Out"
        type="danger"
      />

      {/* Change Password Modal */}
      <ChangePasswordModal
        isOpen={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
        onSuccess={() => showToast('Password changed successfully', 'success')}
      />

      {/* Help & Support Modal */}
      {showHelpModal && (
        <>
          <div 
            className="fixed inset-0 bg-black/50 z-50"
            onClick={() => setShowHelpModal(false)}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div 
              className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-primary-100 rounded-lg">
                  <HelpCircle size={24} className="text-primary-600" />
                </div>
                <h2 className="text-xl font-bold">Help & Support</h2>
              </div>
              
              <div className="space-y-4">
                <div className="p-4 bg-gray-50 rounded-lg">
                  <h3 className="font-semibold mb-2">Contact Support</h3>
                  <p className="text-sm text-gray-600 mb-2">
                    Need help with the canteen system? Reach out to our support team.
                  </p>
                  <p className="text-sm">
                    <span className="font-medium">Email:</span>{' '}
                    <a href="mailto:support@canteen.app" className="text-primary-600 hover:underline">
                      support@canteen.app
                    </a>
                  </p>
                </div>
                
                <div className="p-4 bg-gray-50 rounded-lg">
                  <h3 className="font-semibold mb-2">Documentation</h3>
                  <p className="text-sm text-gray-600">
                    View the admin guide and documentation for detailed instructions on managing the canteen system.
                  </p>
                </div>
                
                <div className="p-4 bg-blue-50 rounded-lg">
                  <h3 className="font-semibold text-blue-900 mb-2">Quick Tips</h3>
                  <ul className="text-sm text-blue-800 space-y-1">
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
