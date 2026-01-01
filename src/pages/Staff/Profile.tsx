import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { LogOut, User, Mail, Phone, Clock, Shield, Save, X } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../services/supabaseClient';
import { PageHeader } from '../../components/PageHeader';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { useToast } from '../../components/Toast';

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
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    phone_number: ''
  });

  // Get user role
  const userRole = user?.user_metadata?.role || 'staff';

  // Fetch staff profile from parents table (staff also stored there)
  const { data: profile, isLoading } = useQuery({
    queryKey: ['staff-profile', user?.id],
    queryFn: async () => {
      // Staff profile is stored in parents table
      const { data, error } = await supabase
        .from('parents')
        .select('*')
        .eq('id', user!.id)
        .single();
      
      if (error) {
        // If no profile exists, create basic info from user
        return {
          id: user!.id,
          email: user!.email || '',
          first_name: user!.user_metadata?.first_name || '',
          last_name: user!.user_metadata?.last_name || '',
          phone_number: user!.user_metadata?.phone_number || '',
          created_at: user!.created_at
        } as StaffProfile;
      }
      return data as StaffProfile;
    },
    enabled: !!user
  });

  // Update profile mutation
  const updateProfileMutation = useMutation({
    mutationFn: async (data: Partial<StaffProfile>) => {
      const { error } = await supabase
        .from('parents')
        .upsert({
          id: user!.id,
          email: user!.email,
          ...data,
          updated_at: new Date().toISOString()
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff-profile'] });
      setIsEditing(false);
      showToast('Profile updated', 'success');
    },
    onError: () => showToast('Failed to update profile', 'error')
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
    <div className="min-h-screen pb-24 bg-gray-50">
      <div className="container mx-auto px-4 py-6">
        <PageHeader title="Profile" subtitle="Your account settings" />

        {/* Profile Card */}
        <section className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-20 h-20 bg-primary-100 rounded-full flex items-center justify-center">
              <User size={40} className="text-primary-600" />
            </div>
            <div className="flex-1">
              {isEditing ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={formData.first_name}
                    onChange={(e) => setFormData(prev => ({ ...prev, first_name: e.target.value }))}
                    placeholder="First Name"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  />
                  <input
                    type="text"
                    value={formData.last_name}
                    onChange={(e) => setFormData(prev => ({ ...prev, last_name: e.target.value }))}
                    placeholder="Last Name"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              ) : (
                <>
                  <h2 className="text-xl font-bold">
                    {profile?.first_name} {profile?.last_name}
                  </h2>
                  <div className="flex items-center gap-2 text-primary-600">
                    <Shield size={16} />
                    <span className="capitalize font-medium">{userRole}</span>
                  </div>
                </>
              )}
            </div>
            {!isEditing ? (
              <button
                onClick={handleEdit}
                className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                <User size={20} />
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => setIsEditing(false)}
                  className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  <X size={20} />
                </button>
                <button
                  onClick={handleSave}
                  disabled={updateProfileMutation.isPending}
                  className="p-2 text-primary-600 hover:bg-primary-50 rounded-lg"
                >
                  <Save size={20} />
                </button>
              </div>
            )}
          </div>

          <div className="space-y-4">
            {/* Email */}
            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
              <div className="p-2 bg-blue-100 rounded-full">
                <Mail size={18} className="text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Email</p>
                <p className="font-medium">{profile?.email}</p>
              </div>
            </div>

            {/* Phone */}
            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
              <div className="p-2 bg-green-100 rounded-full">
                <Phone size={18} className="text-green-600" />
              </div>
              <div className="flex-1">
                <p className="text-xs text-gray-500">Phone Number</p>
                {isEditing ? (
                  <input
                    type="tel"
                    value={formData.phone_number}
                    onChange={(e) => setFormData(prev => ({ ...prev, phone_number: e.target.value }))}
                    placeholder="09XX XXX XXXX"
                    className="w-full px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-primary-500"
                  />
                ) : (
                  <p className="font-medium">{profile?.phone_number || 'Not set'}</p>
                )}
              </div>
            </div>

            {/* Member Since */}
            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
              <div className="p-2 bg-purple-100 rounded-full">
                <Clock size={18} className="text-purple-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Member Since</p>
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

        {/* App Info */}
        <section className="bg-white rounded-lg shadow p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">About</h3>
          <div className="space-y-2 text-sm text-gray-600">
            <p><strong>Canteen PWA</strong> - Staff Portal</p>
            <p>Version 1.0.0</p>
          </div>
        </section>

        {/* Logout Button */}
        <button
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2 py-3 text-red-600 hover:bg-red-50 rounded-lg font-medium transition-colors bg-white shadow"
        >
          <LogOut size={20} />
          Sign Out
        </button>
      </div>
    </div>
  );
}
