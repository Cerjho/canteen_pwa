import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { User } from '@supabase/supabase-js';
import { useAuth, useRoleChangeRedirect, UserRole } from './hooks/useAuth';
import { useSystemSettings } from './hooks/useSystemSettings';
import { clearAuthStorage } from './services/authSession';
// Parent pages
import ParentMenu from './pages/Parent/Menu';
import ParentDashboard from './pages/Parent/Dashboard';
import ParentProfile from './pages/Parent/Profile';
import ParentBalance from './pages/Parent/Balance';
import ParentOrderHistory from './pages/Parent/OrderHistory';
import ParentOrderConfirmation from './pages/Parent/OrderConfirmation';
// Staff pages
import StaffDashboard from './pages/Staff/Dashboard';
import StaffProducts from './pages/Staff/Products';
import StaffProfile from './pages/Staff/Profile';
// Auth pages
import Login from './pages/Login';
import Register from './pages/Register';
// Shared components
import { LoadingSpinner } from './components/LoadingSpinner';
import { BottomNav } from './components/BottomNav';
import { OfflineIndicator } from './components/OfflineIndicator';
import { MaintenancePage } from './components/MaintenancePage';

// Admin pages
import AdminLayout from './pages/Admin/Layout';
import AdminDashboard from './pages/Admin/Dashboard';
import AdminProducts from './pages/Admin/Products';
import AdminOrders from './pages/Admin/Orders';
import AdminUsers from './pages/Admin/Users';
import AdminReports from './pages/Admin/Reports';
import AdminWeeklyMenu from './pages/Admin/WeeklyMenu';
import AdminStudents from './pages/Admin/Students';
import AdminProfile from './pages/Admin/Profile';
import AdminSettings from './pages/Admin/Settings';
import AdminAuditLogs from './pages/Admin/AuditLogs';

// Role-based route protection component
function RoleRoute({ 
  children, 
  allowedRoles,
  user,
  userRole 
}: { 
  children: React.ReactNode;
  allowedRoles: UserRole[];
  user: User | null;
  userRole: UserRole;
}) {
  if (!user) {
    return <Navigate to="/login" />;
  }
  
  if (!allowedRoles.includes(userRole)) {
    // Redirect to appropriate home based on role
    if (userRole === 'admin') return <Navigate to="/admin" />;
    if (userRole === 'staff') return <Navigate to="/staff" />;
    return <Navigate to="/menu" />;
  }
  
  return <>{children}</>;
}

// Get default route based on role
function getDefaultRoute(role: UserRole): string {
  switch (role) {
    case 'admin': return '/admin';
    case 'staff': return '/staff';
    default: return '/menu';
  }
}

function App() {
  const { user, role: userRole, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { settings, isLoading: settingsLoading, refetch: refetchSettings } = useSystemSettings();
  
  // Check if current path is admin route
  const isAdminRoute = location.pathname.startsWith('/admin');
  
  // Auto-redirect on role change (e.g., admin changes user's role)
  useRoleChangeRedirect(navigate);

  // Loading timeout — if stuck for 10s, show retry option (stale SW cache edge case)
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);
  useEffect(() => {
    if (!loading && !settingsLoading) {
      setLoadingTimedOut(false);
      return;
    }
    const timer = setTimeout(() => setLoadingTimedOut(true), 10_000);
    return () => clearTimeout(timer);
  }, [loading, settingsLoading]);

  if (loading || settingsLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <LoadingSpinner size="lg" />
        {loadingTimedOut && (
          <div className="text-center animate-fade-in">
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
              Taking longer than expected...
            </p>
            <button
              onClick={() => {
                // Clear SW caches
                if ('caches' in window) {
                  caches.keys().then(names => {
                    names.forEach(name => caches.delete(name));
                  });
                }
                // Clear stale Supabase session from localStorage
                clearAuthStorage();
                // Redirect to login with a clean slate
                window.location.href = '/login';
              }}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors"
            >
              Reload App
            </button>
          </div>
        )}
      </div>
    );
  }

  // Show maintenance page for non-admin users when maintenance mode is enabled
  if (settings.maintenance_mode && userRole !== 'admin') {
    return (
      <MaintenancePage 
        canteenName={settings.canteen_name} 
        onRefresh={() => refetchSettings()} 
      />
    );
  }

  return (
    <>
      <OfflineIndicator />
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={!user ? <Login /> : <Navigate to={getDefaultRoute(userRole)} />} />
        <Route path="/register" element={!user ? <Register /> : <Navigate to={getDefaultRoute(userRole)} />} />

        {/* Parent routes - also accessible by admin */}
        <Route path="/menu" element={
          <RoleRoute allowedRoles={['parent', 'admin']} user={user} userRole={userRole}>
            <ParentMenu />
          </RoleRoute>
        } />
        <Route path="/dashboard" element={
          <RoleRoute allowedRoles={['parent', 'admin']} user={user} userRole={userRole}>
            <ParentDashboard />
          </RoleRoute>
        } />
        <Route path="/profile" element={
          <RoleRoute allowedRoles={['parent', 'admin']} user={user} userRole={userRole}>
            <ParentProfile />
          </RoleRoute>
        } />
        <Route path="/orders" element={
          <RoleRoute allowedRoles={['parent', 'admin']} user={user} userRole={userRole}>
            <ParentOrderHistory />
          </RoleRoute>
        } />
        <Route path="/balance" element={
          <RoleRoute allowedRoles={['parent', 'admin']} user={user} userRole={userRole}>
            <ParentBalance />
          </RoleRoute>
        } />
        <Route path="/order-confirmation" element={
          <RoleRoute allowedRoles={['parent', 'admin']} user={user} userRole={userRole}>
            <ParentOrderConfirmation />
          </RoleRoute>
        } />

        {/* Staff routes - also accessible by admin */}
        <Route path="/staff" element={
          <RoleRoute allowedRoles={['staff', 'admin']} user={user} userRole={userRole}>
            <StaffDashboard />
          </RoleRoute>
        } />
        <Route path="/staff/products" element={
          <RoleRoute allowedRoles={['staff', 'admin']} user={user} userRole={userRole}>
            <StaffProducts />
          </RoleRoute>
        } />
        <Route path="/staff/profile" element={
          <RoleRoute allowedRoles={['staff', 'admin']} user={user} userRole={userRole}>
            <StaffProfile />
          </RoleRoute>
        } />

        {/* Admin-only routes */}
        <Route path="/admin" element={
          <RoleRoute allowedRoles={['admin']} user={user} userRole={userRole}>
            <AdminLayout />
          </RoleRoute>
        }>
          <Route index element={<AdminDashboard />} />
          <Route path="products" element={<AdminProducts />} />
          <Route path="weekly-menu" element={<AdminWeeklyMenu />} />
          <Route path="students" element={<AdminStudents />} />
          <Route path="orders" element={<AdminOrders />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="reports" element={<AdminReports />} />
          <Route path="audit-logs" element={<AdminAuditLogs />} />
          <Route path="settings" element={<AdminSettings />} />
          <Route path="profile" element={<AdminProfile />} />
        </Route>

        {/* Default redirect based on role */}
        <Route path="/" element={<Navigate to={user ? getDefaultRoute(userRole) : "/login"} />} />
        
        {/* 404 fallback */}
        <Route path="*" element={<Navigate to={user ? getDefaultRoute(userRole) : "/login"} />} />
      </Routes>
      
      {/* Bottom Navigation - only show when logged in and not on admin routes */}
      {user && !isAdminRoute && <BottomNav />}
    </>
  );
}

export default App;