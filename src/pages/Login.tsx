import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Eye, EyeOff, LogIn, Loader2 } from 'lucide-react';
import { supabase } from '../services/supabaseClient';
import { useAuth, UserRole } from '../hooks/useAuth';

// Get default route based on role
function getDefaultRoute(role: UserRole): string {
  switch (role) {
    case 'admin': return '/admin';
    case 'staff': return '/staff';
    default: return '/menu';
  }
}

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { user, role } = useAuth();
  const loginAttemptRef = useRef(false);

  // Redirect when user becomes authenticated (from onAuthStateChange)
  useEffect(() => {
    if (user && loginAttemptRef.current) {
      // User is now authenticated after login attempt
      loginAttemptRef.current = false;
      setLoading(false);
      navigate(getDefaultRoute(role), { replace: true });
    }
  }, [user, role, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    loginAttemptRef.current = true;

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password
      });

      if (signInError) {
        loginAttemptRef.current = false;
        // Sanitize error message - don't expose internal details
        const userFriendlyError = signInError.message?.includes('Invalid login')
          ? 'Invalid email or password'
          : signInError.message?.includes('Email not confirmed')
          ? 'Please verify your email before logging in'
          : 'Login failed. Please try again.';
        setError(userFriendlyError);
        setLoading(false);
      }
      // On success, don't navigate here - let useEffect handle it
      // when onAuthStateChange fires and updates the user state.
      // This ensures auth state is fully synchronized before navigation.
    } catch (err) {
      loginAttemptRef.current = false;
      setError('An unexpected error occurred. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 via-white to-primary-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800 px-4">
      <div className="max-w-md w-full animate-fade-in">
        {/* Brand section */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-primary-100 dark:bg-primary-900/30 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-sm">
            <span className="text-4xl">🍱</span>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">School Canteen</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Order food for your kids</p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700 p-8">
          <form onSubmit={handleLogin} className="space-y-5">
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm animate-fade-in">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 transition-colors"
                placeholder="parent@example.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full px-4 py-2.5 pr-11 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 transition-colors"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed text-white py-3 rounded-xl font-medium flex items-center justify-center gap-2 transition-colors shadow-sm"
            >
              {loading ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  Logging in...
                </>
              ) : (
                <>
                  <LogIn size={18} />
                  Login
                </>
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-gray-500 dark:text-gray-400 mt-6">
          Have an invitation code?{' '}
          <Link to="/register" className="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 font-medium">
            Register here
          </Link>
        </p>
      </div>
    </div>
  );
}