/** Último empleado elegido en la ventana de cobro: SOLO una sugerencia (siempre hay que confirmar). */
const KEY = 'amara.desktop.lastSeller';

export function getLastSeller(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setLastSeller(id: string): void {
  try {
    window.localStorage.setItem(KEY, id);
  } catch {
    /* sin almacenamiento: no pasa nada, solo no se sugiere */
  }
}
