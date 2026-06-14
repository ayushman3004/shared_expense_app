import React, { useState } from 'react';
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

  const handleMockGoogleLogin = async () => {
    setLoading(true);
    setError('');
    
    // Choose a random demo identity
    const demoAccounts = [
      { name: 'Aisha Mock', email: 'aisha_mock@example.com', googleId: 'g_12345' },
      { name: 'Rohan Mock', email: 'rohan_mock@example.com', googleId: 'g_67890' },
      { name: 'Guest User', email: 'guest@example.com', googleId: 'g_abcde' }
    ];
    
    const account = demoAccounts[Math.floor(Math.random() * demoAccounts.length)];

    try {
      const data = await api.post('/auth/oauth-mock', account);
      setTokens(data.accessToken, data.refreshToken, data.user);
      onLoginSuccess();
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Mock Google login failed');
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

        <button
          onClick={handleMockGoogleLogin}
          className="btn btn-secondary"
          style={{ width: '100%' }}
          disabled={loading}
        >
          {/* Simple mock Google G icon */}
          <svg style={{ width: '16px', height: '16px', fill: 'currentColor' }} viewBox="0 0 24 24">
            <path d="M12.24 10.285V14.4h6.887c-.648 2.41-2.519 4.114-6.887 4.114-4.82 0-8.73-3.91-8.73-8.73s3.91-8.73 8.73-8.73c2.25 0 4.305.81 5.925 2.16l3.08-3.08C18.665 1.575 15.635.75 12.24.75 6.015.75 1 5.765 1 12s5.015 11.25 11.24 11.25c6.5 0 10.82-4.57 10.82-11.025 0-.74-.06-1.44-.19-2.07l-10.63.13z"/>
          </svg>
          Sign in with Google (OAuth Mock)
        </button>

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
