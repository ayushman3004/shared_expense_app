import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';
import { Plus, Users, ArrowRight } from 'lucide-react';

interface Group {
  id: string;
  name: string;
  description: string | null;
  members: {
    user: {
      id: string;
      name: string;
      username: string;
    };
  }[];
}

export default function Dashboard() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Create group form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDesc, setNewGroupDesc] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchGroups = async () => {
    try {
      setLoading(true);
      const data = await api.get('/groups');
      setGroups(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load groups');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGroups();
  }, []);

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName) return;

    setCreating(true);
    setError('');

    try {
      const newGroup = await api.post('/groups', {
        name: newGroupName,
        description: newGroupDesc
      });
      setGroups((prev) => [newGroup, ...prev]);
      setNewGroupName('');
      setNewGroupDesc('');
      setShowCreateForm(false);
    } catch (err: any) {
      setError(err.message || 'Failed to create group');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="main-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '2.25rem', margin: '0 0 0.5rem 0' }}>My Shared Groups</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Track shared bills, split expenses, and settle up with flatmates.</p>
        </div>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="btn btn-primary"
        >
          <Plus size={16} />
          Create New Group
        </button>
      </div>

      {error && (
        <div className="badge badge-danger" style={{ display: 'block', width: '100%', padding: '0.75rem', borderRadius: '6px', marginBottom: '1.5rem', textAlign: 'left' }}>
          {error}
        </div>
      )}

      {showCreateForm && (
        <form onSubmit={handleCreateGroup} className="card" style={{ maxWidth: '600px', marginBottom: '2rem' }}>
          <h3 className="card-title">Create Group</h3>
          
          <div className="form-group">
            <label className="form-label" htmlFor="groupName">Group Name</label>
            <input
              type="text"
              id="groupName"
              className="form-input"
              placeholder="e.g. Flat 204 Shared Bills"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              required
              disabled={creating}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="groupDesc">Description (Optional)</label>
            <textarea
              id="groupDesc"
              className="form-input"
              style={{ minHeight: '80px', resize: 'vertical' }}
              placeholder="e.g. Electricity, maid salary, rent and Goa trip spending"
              value={newGroupDesc}
              onChange={(e) => setNewGroupDesc(e.target.value)}
              disabled={creating}
            />
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="btn btn-secondary"
              disabled={creating}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={creating || !newGroupName}
            >
              {creating ? 'Creating...' : 'Create Group'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>Loading groups...</p>
      ) : groups.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '4rem 2rem' }}>
          <Users size={48} style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }} />
          <h2 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>No Groups Found</h2>
          <p style={{ color: 'var(--text-secondary)', maxWidth: '460px', margin: '0 auto 1.5rem auto' }}>
            Get started by creating a new shared group or ask a flatmate to add you as a member of an existing one.
          </p>
          <button
            onClick={() => setShowCreateForm(true)}
            className="btn btn-primary"
          >
            <Plus size={16} />
            Create Your First Group
          </button>
        </div>
      ) : (
        <div className="grid-2">
          {groups.map((group) => (
            <div key={group.id} className="card" style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between', transition: 'border-color 0.2s', cursor: 'pointer' }} onClick={() => window.location.href = `/groups/${group.id}`}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                  <h3 style={{ margin: 0, fontSize: '1.35rem' }}>{group.name}</h3>
                  <span className="badge badge-info" style={{ fontSize: '0.7rem' }}>
                    <Users size={10} />
                    {group.members.length} members
                  </span>
                </div>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1.25rem' }}>
                  {group.description || 'No description provided.'}
                </p>
              </div>

              <div>
                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: '0.25rem', overflow: 'hidden', maxWidth: '80%' }}>
                    {group.members.slice(0, 4).map((m) => (
                      <span key={m.user.id} className="badge badge-secondary" style={{ backgroundColor: 'var(--bg-input)', fontSize: '0.75rem' }}>
                        {m.user.name}
                      </span>
                    ))}
                    {group.members.length > 4 && (
                      <span className="badge badge-secondary" style={{ fontSize: '0.75rem' }}>
                        +{group.members.length - 4}
                      </span>
                    )}
                  </div>
                  <Link to={`/groups/${group.id}`} className="btn btn-secondary btn-sm" style={{ padding: '0.4rem', borderRadius: '50%' }}>
                    <ArrowRight size={14} />
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
