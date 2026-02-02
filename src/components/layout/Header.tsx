import { Link, useLocation } from 'react-router-dom';

export default function Header() {
  const location = useLocation();
  const pathname = location.pathname;

  return (
    <header className="drag-region sticky top-0 z-50 border-border border-b bg-background-card/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
        {/* Logo */}
        <Link className="no-drag flex items-center gap-2.5" to="/">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary">
            <svg className="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M13 10V3L4 14h7v7l9-11h-7z" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
            </svg>
          </div>
          <span className="font-medium text-base text-text">Openwork</span>
        </Link>

        {/* Navigation */}
        <nav className="no-drag flex items-center gap-1">
          <NavLink active={pathname === '/'} to="/">
            Home
          </NavLink>
          <NavLink active={pathname === '/history'} to="/history">
            History
          </NavLink>
          <NavLink active={pathname === '/settings'} to="/settings">
            Settings
          </NavLink>
        </nav>

        {/* Spacer for balance */}
        <div className="w-24" />
      </div>
    </header>
  );
}

function NavLink({ to, active, children }: { to: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link className={`nav-link ${active ? 'nav-link-active' : ''}`} to={to}>
      {children}
    </Link>
  );
}
