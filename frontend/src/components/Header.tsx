import { useNavigate, Link } from 'react-router-dom';
import { clearTokens, getTokens } from '../utils/api';
import { LogOut, User, Home } from 'lucide-react';

interface HeaderProps {
  onLogout: () => void;
}

export default function Header({ onLogout }: HeaderProps) {
  const { user } = getTokens();
  const navigate = useNavigate();

  const handleLogout = () => {
    clearTokens();
    onLogout();
    navigate('/login');
  };

  return (
    <header className="app-header">
      <Link to="/" className="logo">
        <Home size={24} className="nav-icon" />
        Spreetail
      </Link>

      {user && (
        <div className="app-nav">
          <span className="nav-link" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'default' }}>
            <User size={16} />
            Hello, <strong>{user.name}</strong>
          </span>
          <button
            onClick={handleLogout}
            className="btn btn-secondary btn-sm"
            style={{ padding: '0.4rem 0.8rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
          >
            <LogOut size={14} />
            Sign Out
          </button>
        </div>
      )}
    </header>
  );
}
