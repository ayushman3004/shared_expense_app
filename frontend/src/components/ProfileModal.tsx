import React, { useState, useEffect } from 'react';
import { api, setTokens, getTokens } from '../utils/api';
import { Settings, Trash2 } from 'lucide-react';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updatedUser: any) => void;
  user: any;
}

export default function ProfileModal({ isOpen, onClose, onSuccess, user }: ProfileModalProps) {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user) {
      setName(user.name || '');
      setUsername(user.username || '');
      setEmail(user.email || '');
    }
    setError('');
    setSuccess('');
  }, [user, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!name || !username || !email) {
      setError('All fields are required.');
      return;
    }

    setSubmitting(true);

    try {
      const data = await api.put('/auth/profile', { name, username, email });
      // Update local storage tokens with new user details
      const tokens = getTokens();
      if (tokens.accessToken && tokens.refreshToken) {
        setTokens(tokens.accessToken, tokens.refreshToken, data.user);
      }
      setSuccess('Profile updated successfully!');
      setTimeout(() => {
        onSuccess(data.user);
      }, 1000);
    } catch (err: any) {
      setError(err.message || 'Failed to update profile.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeactivate = async () => {
    if (!window.confirm('WARNING: Are you sure you want to deactivate your account? You will be logged out and lose access to all your groups.')) {
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      await api.delete('/auth/profile');
      alert('Your account has been deactivated. Logging out...');
      localStorage.clear();
      window.location.href = '/login';
    } catch (err: any) {
      setError(err.message || 'Failed to deactivate account.');
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal-content" style={{ maxWidth: '480px' }}>
        <div className="modal-header">
          <h2 style={{ fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Settings size={18} /> Account Settings
          </h2>
          <button onClick={onClose} className="btn btn-secondary btn-sm" style={{ padding: '0.25rem' }}>✕</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && (
              <div className="badge badge-danger" style={{ display: 'block', width: '100%', padding: '0.75rem', borderRadius: '6px', marginBottom: '1rem', textAlign: 'left' }}>
                {error}
              </div>
            )}

            {success && (
              <div className="badge badge-success" style={{ display: 'block', width: '100%', padding: '0.75rem', borderRadius: '6px', marginBottom: '1rem', textAlign: 'left' }}>
                {success}
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Full Name</label>
              <input
                type="text"
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={submitting}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Username</label>
              <input
                type="text"
                className="form-input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                disabled={submitting}
              />
            </div>

            <div className="form-group" style={{ marginBottom: '1.5rem' }}>
              <label className="form-label">Email Address</label>
              <input
                type="email"
                className="form-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={submitting}
              />
            </div>

            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem', marginTop: '1rem' }}>
              <h4 style={{ fontSize: '0.9rem', color: 'var(--danger)', marginBottom: '0.5rem' }}>Danger Zone</h4>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                Deactivating your account soft-deletes your credentials and logs you out immediately.
              </p>
              <button
                type="button"
                onClick={handleDeactivate}
                className="btn btn-danger btn-sm"
                style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                disabled={submitting}
              >
                <Trash2 size={12} /> Deactivate Account
              </button>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn btn-secondary" disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Saving...' : 'Save Profile'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
