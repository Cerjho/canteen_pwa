import { useState } from 'react';
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
  FileText
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { ConfirmDialog } from '../../components/ConfirmDialog';

export default function AdminProfile() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [notifications, setNotifications] = useState(true);

  const handleLogout = async () => {
    await signOut();
    navigate('/login');
  };

  const adminInfo = {
    name: user?.user_metadata?.first_name && user?.user_metadata?.last_name 
      ? `${user.user_metadata.first_name} ${user.user_metadata.last_name}`
      : 'Administrator',
    email: user?.email || 'admin@canteen.app',
    role: 'Administrator',
    joinedDate: user?.created_at ? new Date(user.created_at).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }) : 'N/A'
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <div className="container mx-auto px-4 py-6">
        {/* Profile Header */}
        <div className="bg-gradient-to-br from-primary-600 to-primary-700 rounded-2xl p-6 text-white mb-6 shadow-lg">
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-full bg-white/20 flex items-center justify-center ring-4 ring-white/30">
              <User size={40} className="text-white" />
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-bold">{adminInfo.name}</h1>
              <div className="flex items-center gap-2 mt-1 text-primary-100">
                <Mail size={14} />
                <span className="text-sm">{adminInfo.email}</span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="px-2 py-0.5 bg-white/20 rounded-full text-xs font-medium flex items-center gap-1">
                  <Shield size={12} />
                  {adminInfo.role}
                </span>
              </div>
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
                onClick={() => setNotifications(!notifications)}
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
                onClick={() => setDarkMode(!darkMode)}
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
    </div>
  );
}
