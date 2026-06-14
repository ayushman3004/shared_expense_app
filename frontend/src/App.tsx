import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { getTokens, clearTokens } from './utils/api';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Dashboard from './pages/Dashboard';
import GroupDashboard from './pages/GroupDashboard';
import ImportWizard from './pages/ImportWizard';
import ProfileModal from './components/ProfileModal';
import { LogOut, LayoutDashboard, User, Settings } from 'lucide-react';
import './App.css';

function App() {
  const [auth, setAuth] = useState(() => getTokens());
  const [profileModalOpen, setProfileModalOpen] = useState(false);

  // Watch for local storage updates or manually trigger success
  const syncAuth = () => {
    setAuth(getTokens());
  };

  const handleLogout = () => {
    clearTokens();
    syncAuth();
  };

  // Guard for protected routes
  const PrivateRoute = ({ children }: { children: React.ReactNode }) => {
    return auth.accessToken ? children as React.JSX.Element : <Navigate to="/login" replace />;
  };

  // Guard for guest-only routes
  const GuestRoute = ({ children }: { children: React.ReactNode }) => {
    return !auth.accessToken ? children as React.JSX.Element : <Navigate to="/" replace />;
  };

  return (
    <BrowserRouter>
      <div className="app-container">
        {auth.accessToken && (
          <header className="app-header">
            <Link to="/" className="logo">
              <span>⚡</span> Spreetail
            </Link>
            <nav className="app-nav">
              <Link to="/" className="nav-link" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <LayoutDashboard size={16} />
                Dashboard
              </Link>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', borderLeft: '1px solid var(--border-color)', paddingLeft: '1rem' }}>
                <span 
                  onClick={() => setProfileModalOpen(true)}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.9rem', cursor: 'pointer' }}
                  title="Edit Profile"
                >
                  <User size={14} />
                  Hi, {auth.user?.name || 'User'}
                </span>
                <button
                  onClick={() => setProfileModalOpen(true)}
                  className="btn btn-secondary btn-sm"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem' }}
                  title="Settings"
                >
                  <Settings size={14} />
                </button>
                <button
                  onClick={handleLogout}
                  className="btn btn-secondary btn-sm"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 0.75rem' }}
                >
                  <LogOut size={14} />
                  Logout
                </button>
              </div>
            </nav>
          </header>
        )}

        {profileModalOpen && (
          <ProfileModal
            isOpen={profileModalOpen}
            onClose={() => setProfileModalOpen(false)}
            onSuccess={() => {
              setProfileModalOpen(false);
              syncAuth();
            }}
            user={auth.user}
          />
        )}

        <Routes>
          {/* Guest Routes */}
          <Route
            path="/login"
            element={
              <GuestRoute>
                <Login onLoginSuccess={syncAuth} />
              </GuestRoute>
            }
          />
          <Route
            path="/signup"
            element={
              <GuestRoute>
                <Signup onLoginSuccess={syncAuth} />
              </GuestRoute>
            }
          />

          {/* Protected Routes */}
          <Route
            path="/"
            element={
              <PrivateRoute>
                <Dashboard />
              </PrivateRoute>
            }
          />
          <Route
            path="/groups/:groupId"
            element={
              <PrivateRoute>
                <GroupDashboard />
              </PrivateRoute>
            }
          />
          <Route
            path="/groups/:groupId/import"
            element={
              <PrivateRoute>
                <ImportWizard />
              </PrivateRoute>
            }
          />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
