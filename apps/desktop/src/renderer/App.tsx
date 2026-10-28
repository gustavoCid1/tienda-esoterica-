/** Estructura de la aplicación: activación -> inicio de sesión -> pantallas según el rol. */
import { useState } from 'react';
import { can } from '@amara/shared';
import type { Permission } from '@amara/shared';
import { Banner } from './components/Field.tsx';
import { StatusBar } from './components/StatusBar.tsx';
import { ActivationScreen } from './screens/Activation.tsx';
import { CashScreen } from './screens/Cash.tsx';
import { InventoryScreen } from './screens/Inventory.tsx';
import { LabelsScreen } from './screens/Labels.tsx';
import { LimpiasScreen } from './screens/Limpias.tsx';
import { LoginScreen } from './screens/Login.tsx';
import { PosScreen } from './screens/Pos.tsx';
import { SettingsScreen } from './screens/Settings.tsx';
import { SyncScreen } from './screens/SyncScreen.tsx';
import { TicketsScreen } from './screens/Tickets.tsx';
import { TokensScreen } from './screens/Tokens.tsx';
import { AppProvider, useApp } from './state/AppState.tsx';
import { FeedbackProvider, useFeedback } from './state/Feedback.tsx';
import { PosProvider, usePos } from './state/PosState.tsx';
import { ScannerProvider } from './state/Scanner.tsx';

type ScreenId = 'pos' | 'tickets' | 'cash' | 'limpias' | 'inventory' | 'labels' | 'tokens' | 'sync' | 'settings';

interface NavItem {
  id: ScreenId;
  label: string;
  perm: Permission;
}

export function App() {
  return (
    <FeedbackProvider>
      <AppProvider>
        <ScannerProvider>
          <PosProvider>
            <Shell />
          </PosProvider>
        </ScannerProvider>
      </AppProvider>
    </FeedbackProvider>
  );
}

function Shell() {
  const { ready, device, user, notice, dismissNotice, sync, backup, logout } = useApp();
  const pos = usePos();
  const { confirm, toast } = useFeedback();
  const [screen, setScreen] = useState<ScreenId>('pos');

  if (!ready) return <div className="splash">Cargando...</div>;
  if (!device?.activated) return <ActivationScreen />;
  if (!user) return <LoginScreen />;

  const isManager = can(user.role, 'tickets.archivo');
  const nav: NavItem[] = [
    { id: 'pos', label: 'Vender', perm: 'ventas.crear' },
    { id: 'tickets', label: isManager ? 'Tickets' : 'Mis tickets', perm: 'ventas.ver_propias' },
    // v2: el vendedor también entra a Caja, pero SOLO para cerrarla a ciegas con autorización de administrador.
    { id: 'cash', label: 'Caja', perm: 'ventas.crear' },
    // v2: Limpias. El gerente entra libre; el vendedor pide contraseña de administrador o token dentro de la pantalla.
    { id: 'limpias', label: 'Limpias', perm: 'ventas.crear' },
    { id: 'inventory', label: 'Inventario', perm: 'inventario.ver' },
    { id: 'labels', label: 'Etiquetas', perm: 'productos.ver' },
    { id: 'tokens', label: 'Tokens', perm: 'config.editar' },
    { id: 'sync', label: 'Sincronización', perm: 'sync.estado' },
    { id: 'settings', label: 'Ajustes', perm: 'config.editar' },
  ];
  const visible = nav.filter((n) => can(user.role, n.perm));
  const current: ScreenId = visible.some((n) => n.id === screen) ? screen : 'pos';

  const doLogout = async () => {
    if (pos.lines.length > 0) {
      const ok = await confirm({
        title: 'Hay una venta sin cobrar',
        message: 'Si cierras la sesión se perderán los productos del carrito. ¿Quieres cerrar la sesión?',
        confirmText: 'Cerrar sesión',
        cancelText: 'Volver a la venta',
        danger: true,
      });
      if (!ok) return;
    }
    try {
      await logout();
    } catch {
      toast('error', 'No se pudo cerrar la sesión.');
      return;
    }
    pos.clearCart();
    pos.setLastSale(null);
    pos.setMode('venta');
    setScreen('pos');
  };

  return (
    <div className="shell">
      <StatusBar
        userName={user.name}
        roleLabel={user.role === 'gerente' ? 'Gerente' : 'Vendedor'}
        place={`${device.branch?.name ?? ''} - Terminal ${device.terminal?.code ?? ''}`}
        sync={sync}
        backup={backup}
        onLogout={() => void doLogout()}
      />
      <div className="body">
        <nav className="nav" aria-label="Secciones">
          {visible.map((n) => (
            <button key={n.id} className={n.id === current ? 'nav-item nav-on' : 'nav-item'} onClick={() => setScreen(n.id)}>
              {n.label}
              {n.id === 'sync' && sync && sync.pending > 0 && <span className="badge">{sync.pending}</span>}
            </button>
          ))}
        </nav>
        <main className="content">
          {notice && <Banner kind="warn" onClose={dismissNotice}>{notice}</Banner>}
          {backup?.warning && <Banner kind="error">{backup.warning}</Banner>}
          {current === 'pos' && <PosScreen />}
          {current === 'tickets' && <TicketsScreen />}
          {current === 'cash' && <CashScreen />}
          {current === 'limpias' && <LimpiasScreen />}
          {current === 'inventory' && <InventoryScreen goLabels={() => setScreen('labels')} />}
          {current === 'labels' && <LabelsScreen />}
          {current === 'tokens' && <TokensScreen />}
          {current === 'sync' && <SyncScreen />}
          {current === 'settings' && <SettingsScreen />}
        </main>
      </div>
    </div>
  );
}
