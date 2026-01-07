import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Eye, EyeOff, User, Phone, Loader2, CheckCircle, XCircle, Shield } from 'lucide-react';
import { supabase } from '../services/supabaseClient';

interface InvitationData {
  email: string; // Masked email from server
  role: string;
}

// Input sanitization
function sanitizeInput(str: string, maxLength: number = 100): string {
  return str.trim().slice(0, maxLength).replace(/[<>]/g, '');
}

// Phone number validation (Philippine format)
function isValidPhoneNumber(phone: string): boolean {
  if (!phone) return true; // Optional
  const cleaned = phone.replace(/\s|-/g, '');
  return /^(\+63|0)9\d{9}$/.test(cleaned);
}

export default function Register() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const codeFromUrl = searchParams.get('code') || '';
  
  const [step, setStep] = useState<'code' | 'form' | 'success'>('code');
  const [inviteCode, setInviteCode] = useState(codeFromUrl);
  const [invitation, setInvitation] = useState<InvitationData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [attempts, setAttempts] = useState(0);
  
  // Form fields
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Verify code via Edge Function (secure server-side validation)
  const verifyCode = useCallback(async (code: string) => {
    // Client-side rate limiting
    if (attempts >= 5) {
      setError('Too many attempts. Please wait a minute and try again.');
      return;
    }

    setLoading(true);
    setError('');
    setAttempts(prev => prev + 1);

    try {
      // Call Edge Function for secure verification
      const { data, error: verifyError } = await supabase.functions.invoke('verify-invitation', {
        body: { code: sanitizeInput(code, 6) }
      });

      if (verifyError) {
        setError(verifyError.message || 'Verification failed. Please try again.');
        setLoading(false);
        return;
      }

      if (data?.error) {
        setError(data.message || 'Invalid invitation code.');
        setLoading(false);
        return;
      }

      if (data?.success && data?.invitation) {
        setInvitation(data.invitation);
        setStep('form');
      } else {
        setError('Invalid invitation code.');
      }
    } catch (err) {
      setError('Something went wrong. Please try again.');
    }
    setLoading(false);
  }, [attempts]);

  // Auto-verify code from URL (with delay to prevent abuse)
  useEffect(() => {
    if (codeFromUrl && codeFromUrl.length === 6 && step === 'code' && !invitation) {
      const timer = setTimeout(() => {
        verifyCode(codeFromUrl);
      }, 500);
      return () => clearTimeout(timer);
    }
    // Only run when codeFromUrl changes, not on every verifyCode change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeFromUrl]);

  // Reset attempts after 1 minute
  useEffect(() => {
    if (attempts >= 5) {
      const timer = setTimeout(() => setAttempts(0), 60000);
      return () => clearTimeout(timer);
    }
  }, [attempts]);

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const cleanCode = sanitizeInput(inviteCode, 6).toUpperCase();
    
    if (!cleanCode || cleanCode.length !== 6) {
      setError('Please enter a valid 6-character code');
      return;
    }

    // Basic format validation before sending
    if (!/^[A-Z0-9]{6}$/.test(cleanCode)) {
      setError('Invalid code format');
      return;
    }

    await verifyCode(cleanCode);
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Sanitize inputs
    const cleanFirstName = sanitizeInput(firstName, 50);
    const cleanLastName = sanitizeInput(lastName, 50);
    const cleanPhone = phoneNumber.replace(/\s|-/g, '').slice(0, 15);

    // Client-side validation (server will re-validate)
    if (!cleanFirstName || !cleanLastName) {
      setError('Please enter your first and last name');
      return;
    }

    if (cleanFirstName.length < 2 || cleanLastName.length < 2) {
      setError('Names must be at least 2 characters');
      return;
    }

    if (phoneNumber && !isValidPhoneNumber(phoneNumber)) {
      setError('Invalid phone format. Use 09XXXXXXXXX or +639XXXXXXXXX');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    if (password.length > 72) {
      setError('Password cannot exceed 72 characters');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

    try {
      // Call Edge Function for secure server-side registration
      const { data, error: registerError } = await supabase.functions.invoke('register', {
        body: {
          invitation_code: sanitizeInput(inviteCode, 6),
          first_name: cleanFirstName,
          last_name: cleanLastName,
          phone_number: cleanPhone || undefined,
          password, // Password sent securely over HTTPS
        },
      });

      if (registerError) {
        setError(registerError.message || 'Registration failed. Please try again.');
        setLoading(false);
        return;
      }

      if (data?.error) {
        setError(data.message || 'Registration failed. Please try again.');
        setLoading(false);
        return;
      }

      // Clear sensitive data from memory
      setPassword('');
      setConfirmPassword('');
      
      setStep('success');
    } catch (err) {
      setError('Something went wrong. Please try again.');
    }
    setLoading(false);
  };

  // Step 1: Enter invitation code
  if (step === 'code') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
        <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-primary-100 dark:bg-primary-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <Shield size={32} className="text-primary-600 dark:text-primary-400" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Join School Canteen</h1>
            <p className="text-gray-600 dark:text-gray-400 mt-2">
              Enter your invitation code to register
            </p>
          </div>

          <form onSubmit={handleVerifyCode} className="space-y-4">
            {error && (
              <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm flex items-start gap-2">
                <XCircle size={18} className="flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Invitation Code
              </label>
              <input
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                maxLength={6}
                className="w-full px-4 py-3 text-center text-2xl tracking-widest font-mono border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 uppercase bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                placeholder="ABC123"
                autoFocus
                autoComplete="off"
                spellCheck={false}
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 text-center">
                You should have received this from your school admin
              </p>
            </div>

            <button
              type="submit"
              disabled={loading || inviteCode.length !== 6 || attempts >= 5}
              className="w-full bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white py-3 rounded-lg font-medium flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  Verifying...
                </>
              ) : attempts >= 5 ? (
                'Please wait...'
              ) : (
                'Continue'
              )}
            </button>
          </form>

          <p className="text-center text-sm text-gray-600 dark:text-gray-400 mt-6">
            Already have an account?{' '}
            <Link to="/login" className="text-primary-600 hover:text-primary-700 font-medium">
              Login
            </Link>
          </p>
        </div>
      </div>
    );
  }

  // Step 2: Registration form
  if (step === 'form') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4 py-8">
        <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-primary-100 dark:bg-primary-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <User size={32} className="text-primary-600 dark:text-primary-400" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Complete Registration</h1>
            <p className="text-gray-600 dark:text-gray-400 mt-2">
              Set up your account for <strong>{invitation?.email}</strong>
            </p>
            <span className="inline-block mt-2 px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-400 text-xs rounded-full capitalize">
              {invitation?.role} Account
            </span>
          </div>

          <form onSubmit={handleRegister} className="space-y-4">
            {error && (
              <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm flex items-start gap-2">
                <XCircle size={18} className="flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  First Name *
                </label>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                  maxLength={50}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  placeholder="Juan"
                  autoComplete="given-name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Last Name *
                </label>
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                  maxLength={50}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  placeholder="Dela Cruz"
                  autoComplete="family-name"
                />
              </div>
            </div>

            {invitation?.role === 'parent' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Phone Number
                </label>
                <div className="relative">
                  <Phone size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
                  <input
                    type="tel"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    maxLength={15}
                    className="w-full pl-10 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    placeholder="09171234567"
                    autoComplete="tel"
                  />
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Format: 09XXXXXXXXX</p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Password *
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  maxLength={72}
                  className="w-full px-3 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  placeholder="Min. 6 characters"
                  autoComplete="new-password"
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

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Confirm Password *
              </label>
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
                maxLength={72}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                placeholder="Confirm your password"
                autoComplete="new-password"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white py-3 rounded-lg font-medium flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  Creating Account...
                </>
              ) : (
                'Create Account'
              )}
            </button>
          </form>

          <button
            onClick={() => {
              setStep('code');
              setInvitation(null);
              setPassword('');
              setConfirmPassword('');
            }}
            className="w-full mt-4 text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 text-sm"
          >
            ← Use a different code
          </button>
        </div>
      </div>
    );
  }

  // Step 3: Success
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8 text-center">
        <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle size={32} className="text-green-600 dark:text-green-400" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">Account Created!</h1>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          Welcome to School Canteen! Your account has been set up successfully.
        </p>
        <button
          onClick={() => navigate('/login')}
          className="w-full bg-primary-600 hover:bg-primary-700 text-white py-3 rounded-lg font-medium"
        >
          Go to Login
        </button>
      </div>
    </div>
  );
}
