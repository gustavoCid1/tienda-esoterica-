import { Suspense, useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { NoAccess, useAuth } from './context.tsx';
import { Spinner } from './components/ui.tsx';
import { ROUTES, firstAllowedPath } from './routes.tsx';
import { Login } from './pages/Login.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { NotificationsProvider, useNotifications } from './notifications.tsx';
import { badgeText } from './lib/notifications.ts';

const ROLE_LABEL = { gerente: 'Gerente', vendedor: 'Vendedor', desarrollador: 'Desarrollador' } as const;

export function App() {
  const { user, ready } = useAuth();
  if (!ready) {
    return (
      <div className="center-screen">
        <Spinner label="Iniciando" />
      </div>
    );
  }
  if (!user) return <Login />;
  return (
    <NotificationsProvider>
      <Shell />
    </NotificationsProvider>
  );
}

function Shell() {
  const { user, can, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();

  // El menú móvil se cierra al navegar.
  useEffect(() => setOpen(false), [location.pathname]);

  const { enabled: notifEnabled, counts } = useNotifications();
  const bell = badgeText(counts.total);

  const visible = ROUTES.filter((r) => r.perm === null || can(r.perm));
  const groups = [...new Set(visible.map((r) => r.group))];

  return (
    <div className={`shell ${open ? 'nav-open' : ''}`}>
      <aside className="sidebar" aria-label="Menú principal">
        <div className="brand">
          {/* El logotipo se muestra completo y sin deformar (alto automático). */}
          <img className="brand-logo" src="/logo-amara.png" alt="Esotérica Amara" width={160} height={124} />
        </div>
        <nav>
          {groups.map((g) => (
            <div className="nav-group" key={g}>
              <div className="nav-title">{g}</div>
              {visible
                .filter((r) => r.group === g)
                .map((r) => (
                  <NavLink key={r.path} to={r.path} end={r.path === '/'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                    {r.label}
                    {r.badge === 'notificaciones' && bell !== '' && (
                      <span className="nav-badge" aria-label={`${counts.total} aviso(s) de existencias`}>{bell}</span>
                    )}
                  </NavLink>
                ))}
            </div>
          ))}
        </nav>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} aria-hidden="true" />}

      <div className="main-col">
        <header className="topbar">
          <button type="button" className="icon-btn menu-btn" aria-label="Abrir menú" onClick={() => setOpen((o) => !o)}>
            &#9776;
          </button>
          <div className="topbar-title">Panel administrativo</div>
          {notifEnabled && (
            <NavLink to="/notificaciones" className="bell" aria-label={bell ? `Notificaciones: ${counts.total} producto(s) en o bajo su mínimo` : 'Notificaciones'} title="Existencias en o bajo el mínimo">
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
                <path d="M12 3a6 6 0 0 0-6 6v3.6L4.3 16.2a1 1 0 0 0 .9 1.4h13.6a1 1 0 0 0 .9-1.4L18 12.6V9a6 6 0 0 0-6-6zm-2 16a2 2 0 0 0 4 0z" fill="currentColor" />
              </svg>
              {bell !== '' && <span className="bell-count">{bell}</span>}
            </NavLink>
          )}
          <div className="topbar-user">
            <span className="user-name">{user?.name}</span>
            <span className="user-role">{user ? ROLE_LABEL[user.role] : ''}</span>
            <button type="button" className="btn btn-sm" onClick={logout}>
              Cerrar sesión
            </button>
          </div>
        </header>
        <main className="content">
          {/* key = ruta: al navegar se reinicia el límite de errores y una pantalla rota no bloquea las demás. */}
          <ErrorBoundary key={location.pathname}>
          <Suspense fallback={<Spinner />}>
            <Routes>
              {ROUTES.map((r) => (
                <Route
                  key={r.path}
                  path={r.path}
                  element={r.perm === null || can(r.perm) ? <r.component /> : r.path === '/' ? <Navigate to={firstAllowedPath(can)} replace /> : <NoAccess />}
                />
              ))}
              <Route path="*" element={<Navigate to={firstAllowedPath(can)} replace />} />
            </Routes>
          </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
