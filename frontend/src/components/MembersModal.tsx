import { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { Trash2 } from 'lucide-react';

interface MembersModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  groupId: string;
  member?: any; // undefined if adding, otherwise GroupMember object
}

export default function MembersModal({ isOpen, onClose, onSuccess, groupId, member }: MembersModalProps) {
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<'ADMIN' | 'MEMBER'>('MEMBER');
  const [joinedAt, setJoinedAt] = useState(new Date().toISOString().slice(0, 10));
  const [leftAt, setLeftAt] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (member) {
      setUsername(member.user.username);
      setRole(member.role);
      setJoinedAt(new Date(member.joinedAt).toISOString().slice(0, 10));
      setLeftAt(member.leftAt ? new Date(member.leftAt).toISOString().slice(0, 10) : '');
    } else {
      setUsername('');
      setRole('MEMBER');
      setJoinedAt(new Date().toISOString().slice(0, 10));
      setLeftAt('');
    }
    setError('');
  }, [member, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username || !joinedAt) {
      setError('Username and Join Date are required.');
      return;
    }

    setSubmitting(true);

    const payload = {
      username,
      role,
      joinedAt: new Date(joinedAt),
      leftAt: leftAt ? new Date(leftAt) : null
    };

    try {
      if (member) {
        // Edit existing membership
        await api.put(`/groups/${groupId}/members/${member.userId}`, {
          role,
          joinedAt: new Date(joinedAt),
          leftAt: leftAt ? new Date(leftAt) : null
        });
      } else {
        // Add new member
        await api.post(`/groups/${groupId}/members`, payload);
      }
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Failed to save group member configurations');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!member) return;
    if (!window.confirm(`Are you sure you want to remove ${member.user.name} from the group?`)) return;

    setSubmitting(true);
    setError('');

    try {
      await api.delete(`/groups/${groupId}/members/${member.userId}`);
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Failed to delete member');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal-content" style={{ maxWidth: '480px' }}>
        <div className="modal-header">
          <h2 style={{ fontSize: '1.25rem' }}>{member ? 'Configure Membership' : 'Add New Member'}</h2>
          <button onClick={onClose} className="btn btn-secondary btn-sm" style={{ padding: '0.25rem' }}>✕</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && (
              <div className="badge badge-danger" style={{ display: 'block', width: '100%', padding: '0.75rem', borderRadius: '6px', marginBottom: '1rem', textAlign: 'left' }}>
                {error}
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Username</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. rohan"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                disabled={submitting || !!member} // Read-only if editing
              />
            </div>

            <div className="form-group">
              <label className="form-label">Role</label>
              <select
                className="form-input"
                value={role}
                onChange={(e) => setRole(e.target.value as any)}
                disabled={submitting}
              >
                <option value="MEMBER">Member</option>
                <option value="ADMIN">Group Admin</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Joined Group At</label>
              <input
                type="date"
                className="form-input"
                value={joinedAt}
                onChange={(e) => setJoinedAt(e.target.value)}
                required
                disabled={submitting}
              />
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Left Group At (Optional)</label>
              <input
                type="date"
                className="form-input"
                value={leftAt}
                onChange={(e) => setLeftAt(e.target.value)}
                disabled={submitting}
              />
              <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                Leave blank if the member is still active in the group.
              </p>
            </div>
          </div>

          <div className="modal-footer" style={{ justifyContent: member ? 'space-between' : 'flex-end' }}>
            {member && (
              <button
                type="button"
                onClick={handleDelete}
                className="btn btn-danger"
                style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                disabled={submitting}
              >
                <Trash2 size={14} /> Remove Member
              </button>
            )}
            
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button type="button" onClick={onClose} className="btn btn-secondary" disabled={submitting}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? 'Saving...' : 'Save Configuration'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
