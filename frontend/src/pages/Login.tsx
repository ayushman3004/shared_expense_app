import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api, setTokens } from '../utils/api';
import { LogIn } from 'lucide-react';

interface LoginProps {
  onLoginSuccess: () => void;
}

export default function Login({ onLoginSuccess }: LoginProps) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleGoogleCredentialResponse = async (response: any) => {
    setLoading(true);
    setError('');

    try {
      const idToken = response.credential;
      // POST the real ID token for backend Google verification
      const data = await api.post('/auth/google', { idToken });
      setTokens(data.accessToken, data.refreshToken, data.user);
      onLoginSuccess();
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Google OAuth verification failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const initGoogleSignIn = () => {
      const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || 'your-google-client-id.apps.googleusercontent.com';
      
      if (typeof window !== 'undefined' && (window as any).google) {
        (window as any).google.accounts.id.initialize({
          client_id: clientId,
          callback: handleGoogleCredentialResponse,
        });
        (window as any).google.accounts.id.renderButton(
          document.getElementById('googleSignInButton'),
          {
            theme: 'filled_blue',
            size: 'large',
            width: '100%',
            text: 'signin_with',
            shape: 'rectangular',
          }
        );
      }
    };

    // Attempt to load. Retry after a small delay in case the async Google script is still initializing.
    const timer = setTimeout(initGoogleSignIn, 600);
    return () => clearTimeout(timer);
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier || !password) {
      setError('Please fill in all fields.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const data = await api.post('/auth/login', { identifier, password });
      setTokens(data.accessToken, data.refreshToken, data.user);
      onLoginSuccess();
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Invalid username/email or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-header">
          <h1 className="logo" style={{ justifyContent: 'center', marginBottom: '1rem' }}>
            Spreetail
          </h1>
          <h2 className="auth-title">Welcome Back</h2>
          <p className="auth-subtitle">Manage shared expenses without the headache.</p>
        </div>

        {error && (
          <div className="badge badge-danger" style={{ display: 'block', width: '100%', padding: '0.75rem', borderRadius: '6px', marginBottom: '1.25rem', textAlign: 'left' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleLogin}>
          <div className="form-group">
            <label className="form-label" htmlFor="identifier">
              Email or Username
            </label>
            <input
              type="text"
              id="identifier"
              className="form-input"
              placeholder="e.g. rohan or aisha@example.com"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="password">
              Password
            </label>
            <input
              type="password"
              id="password"
              className="form-input"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', marginTop: '0.5rem' }}
            disabled={loading}
          >
            {loading ? 'Signing in...' : 'Sign In'}
            <LogIn size={16} />
          </button>
        </form>

        <div className="oauth-divider">OR</div>

        {/* Real Google OAuth Button container */}
        <div style={{ width: '100%', display: 'flex', justifyContent: 'center', minHeight: '40px', overflow: 'hidden', borderRadius: '4px' }} id="googleSignInButton"></div>

        <p className="auth-subtitle" style={{ textAlign: 'center', marginTop: '1.5rem' }}>
          Don't have an account?{' '}
          <Link to="/signup" style={{ color: 'var(--primary)', fontWeight: 600, textDecoration: 'none' }}>
            Create one
          </Link>
        </p>

        <div className="card" style={{ marginTop: '2rem', padding: '1rem', borderStyle: 'dashed', backgroundColor: 'transparent' }}>
          <h4 style={{ fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--text-primary)' }}>💡 Seeded Accounts Info:</h4>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            Log in as any flatmate using their name (e.g. <b>aisha</b>, <b>rohan</b>, or <b>priya</b>) with password <b>password123</b>.
          </p>
        </div>
      </div>
    </div>
  );
}
