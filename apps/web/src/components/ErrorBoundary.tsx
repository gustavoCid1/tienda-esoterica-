/**
 * Límite de errores de pantalla. Sin él, una excepción al pintar (por ejemplo un objeto dentro de
 * JSX, que era la causa de que Auditoría quedara en blanco) desmonta TODA la aplicación. Con él, el
 * resto del panel sigue usable y se muestra el mensaje con un botón para reintentar.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Alert } from './ui.tsx';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Queda en la consola del navegador para poder diagnosticar.
    console.error('Error al mostrar la pantalla:', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <Alert tone="error" title="Esta pantalla tuvo un problema">
        <span>{this.state.error.message || 'Error inesperado.'}</span>{' '}
        <button type="button" className="btn btn-sm" onClick={() => this.setState({ error: null })}>
          Reintentar
        </button>
      </Alert>
    );
  }
}
