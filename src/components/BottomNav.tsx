import { NavLink } from 'react-router-dom';
import { Home, ShoppingBag, User, ClipboardList, Clock, Shield, Package } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useActiveOrderCount } from './ActiveOrderBadge';

export function BottomNav() {
  const { user } = useAuth();
  const activeOrderCount = useActiveOrderCount();
  
  // Check user role from user metadata
  const userRole = user?.user_metadata?.role;
  const isParent = userRole === 'parent' || !userRole;
  const isStaff = userRole === 'staff';
  const isAdmin = userRole === 'admin';

  // Build navigation items based on role
  const navItems = [];

  if (isAdmin) {
    // Admin can access everything
    navItems.push(
      { to: '/admin', icon: Shield, label: 'Admin', badge: 0 },
      { to: '/staff', icon: ClipboardList, label: 'Staff', badge: 0 },
      { to: '/menu', icon: Home, label: 'Menu', badge: 0 }
    );
  } else if (isStaff) {
    // Staff-only navigation
    navItems.push(
      { to: '/staff', icon: ClipboardList, label: 'Orders', badge: 0 },
      { to: '/staff/products', icon: Package, label: 'Products', badge: 0 },
      { to: '/staff/profile', icon: User, label: 'Profile', badge: 0 }
    );
  } else if (isParent) {
    // Parent-only navigation
    navItems.push(
      { to: '/menu', icon: Home, label: 'Menu', badge: 0 },
      { to: '/dashboard', icon: ShoppingBag, label: 'Active', badge: activeOrderCount },
      { to: '/orders', icon: Clock, label: 'History', badge: 0 },
      { to: '/profile', icon: User, label: 'Profile', badge: 0 }
    );
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 safe-area-inset-bottom z-30">
      <div className="flex justify-around items-center h-16">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `relative flex flex-col items-center justify-center px-4 py-2 transition-colors ${
                isActive
                  ? 'text-primary-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`
            }
          >
            <div className="relative">
              <item.icon size={24} />
              {item.badge > 0 && (
                <span className="absolute -top-1 -right-2 inline-flex items-center justify-center min-w-[16px] h-4 px-1 text-[10px] font-bold text-white bg-red-500 rounded-full">
                  {item.badge > 9 ? '9+' : item.badge}
                </span>
              )}
            </div>
            <span className="text-xs mt-1 font-medium">{item.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}