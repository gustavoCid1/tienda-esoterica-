/**
 * Ajustes (solo gerente): impresora y papel, respaldos (carpeta, segundo destino), servidor,
 * escáner USB, teléfono como escáner (QR de vinculación) y datos de la terminal.
 */
import { useCallback, useEffect, useState } from 'react';
import * as QRCodeNs from 'qrcode';
import type { AppSettings } from '../../shared/settings.ts';
import type { BackupLogRow, LanState, PrinterInfo } from '../../shared/ipc.ts';
import { Banner, Field } from '../components/Field.tsx';
import { Modal } from '../components/Modal.tsx';
import { call, errorText, onEvent } from '../lib/api.ts';
import { dateTime } from '../lib/format.ts';
import { useApp } from '../state/AppState.tsx';
import { useFeedback } from '../state/Feedback.tsx';
import { useScanHandler } from '../state/Scanner.tsx';
import { ActivationScreen } from './Activation.tsx';

// qrcode es CommonJS: las funciones pueden llegar como `default` o nombradas según el empaquetador.
const QRCode: typeof QRCodeNs = (QRCodeNs as unknown as { default?: typeof QRCodeNs }).default ?? QRCodeNs;

export function SettingsScreen() {
  const { settings, refreshSettings, backup, info, device, sync } = useApp();
  const { toast, confirm } = useFeedback();
  const [draft, setDraft] = useState<AppSettings | null>(settings);
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [logs, setLogs] = useState<BackupLogRow[]>([]);
  const [lan, setLan] = useState<LanState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pairOpen, setPairOpen] = useState(false);
  const [reactivate, setReactivate] = useState(false);

  useScanHandler(() => toast('info', 'En esta pantalla no se usa el escáner.'));
  useEffect(() => setDraft(settings), [settings]);

  const loadAll = useCallback(async () => {
    try {
      const [p, l, b] = await Promise.all([call('print:printers'), call('lan:state'), call('backup:list')]);
      setPrinters(p);
      setLan(l);
      setLogs(b);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);
  useEffect(() => {
    void loadAll();
    return onEvent('evt:lan', setLan);
  }, [loadAll]);
  useEffect(() => {
    if (backup?.lastResult) call('backup:list').then(setLogs).catch(() => undefined);
  }, [backup?.lastResult]);

  if (!draft) return <div className="page"><p className="muted">Cargando...</p></div>;
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const set = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => setDraft({ ...draft, [k]: v });

  const save = async () => {
    setBusy('save');
    setError(null);
    try {
      await call('settings:save', draft);
      await refreshSettings();
      toast('ok', 'Ajustes guardados.');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const pick = async (key: 'backupDir' | 'backupSecondaryDir', title: string) => {
    try {
      const dir = await call('settings:pickFolder', { title });
      if (dir) set(key, dir);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const testPrint = async (target: 'ticket' | 'label') => {
    if (dirty) return toast('warn', 'Guarda los ajustes antes de probar la impresión.');
    setBusy(`print-${target}`);
    try {
      const r = await call('print:test', { target });
      if (r.ok) toast('ok', 'Prueba enviada a la impresora. Revisa que haya salido completa.');
      else setError(r.error ?? 'No se pudo imprimir la prueba.');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const backupNow = async () => {
    setBusy('backup');
    try {
      const r = await call('backup:now');
      if (r.ok) toast('ok', 'Respaldo hecho y verificado.');
      else setError(r.error ?? 'El respaldo falló.');
      setLogs(await call('backup:list'));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const testApi = async () => {
    if (!draft.apiUrl) return toast('info', 'Escribe primero la dirección del servidor.');
    setBusy('api');
    try {
      const r = await call('settings:testApi', { url: draft.apiUrl });
      if (r.ok) toast('ok', 'El servidor respondió correctamente.');
      else toast('warn', r.status ? `El servidor respondió con error ${r.status}.` : (r.error ?? 'No se pudo conectar. Revisa la dirección y la conexión a internet.'));
    } catch (e) {
      toast('warn', errorText(e));
    } finally {
      setBusy(null);
    }
  };

  if (reactivate) {
    return (
      <div className="page">
        <button className="btn" onClick={() => setReactivate(false)}>Volver a ajustes</button>
        <ActivationScreen onDone={() => setReactivate(false)} />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="row-between">
        <h1>Ajustes</h1>
        <button className="btn btn-gold btn-lg" onClick={() => void save()} disabled={!dirty || busy === 'save'}>{dirty ? 'Guardar cambios' : 'Sin cambios'}</button>
      </div>
      {error && <Banner kind="error" onClose={() => setError(null)}>{error}</Banner>}

      <section className="card">
        <h3>Impresión de tickets</h3>
        <div className="grid2">
          <Field label="Impresora de tickets" hint="La que tiene el rollo térmico">
            <select className="inp" value={draft.ticketPrinter} onChange={(e) => set('ticketPrinter', e.target.value)}>
              <option value="">Impresora predeterminada de Windows</option>
              {printers.map((p) => <option key={p.name} value={p.name}>{p.displayName}{p.isDefault ? ' (predeterminada)' : ''}</option>)}
            </select>
          </Field>
          <Field label="Ancho del papel">
            <select className="inp" value={draft.paperMm} onChange={(e) => set('paperMm', e.target.value === '58' ? 58 : 80)}>
              <option value={80}>80 mm</option>
              <option value={58}>58 mm</option>
            </select>
          </Field>
          <Field label="Tamaño de página" hint="Usa 'Del controlador' salvo que el ticket salga cortado o con mucho papel en blanco">
            <select className="inp" value={draft.printPageSizeMode} onChange={(e) => set('printPageSizeMode', e.target.value === 'medido' ? 'medido' : 'driver')}>
              <option value="driver">Del controlador de la impresora</option>
              <option value="medido">Medir el largo del ticket</option>
            </select>
          </Field>
          <Field label="Al guardar una venta">
            <label className="check"><input type="checkbox" checked={draft.autoPrint} onChange={(e) => set('autoPrint', e.target.checked)} /> Imprimir automáticamente las dos copias (cliente y tienda)</label>
          </Field>
        </div>
        <Field label="Texto al pie del ticket"><input className="inp" value={draft.ticketFooter} maxLength={120} onChange={(e) => set('ticketFooter', e.target.value)} /></Field>
        <div className="row-gap">
          <button className="btn" onClick={() => void testPrint('ticket')} disabled={busy !== null}>Imprimir prueba de ticket</button>
          <button className="btn btn-quiet" onClick={() => void loadAll()}>Actualizar lista de impresoras</button>
        </div>
      </section>

      <section className="card">
        <h3>Etiquetas</h3>
        <div className="grid3">
          <Field label="Impresora de etiquetas">
            <select className="inp" value={draft.labelPrinter} onChange={(e) => set('labelPrinter', e.target.value)}>
              <option value="">Impresora predeterminada de Windows</option>
              {printers.map((p) => <option key={p.name} value={p.name}>{p.displayName}</option>)}
            </select>
          </Field>
          <Field label="Ancho (mm)"><input className="inp" inputMode="numeric" value={draft.labelWidthMm} onChange={(e) => set('labelWidthMm', Number(e.target.value) || 0)} /></Field>
          <Field label="Alto (mm)"><input className="inp" inputMode="numeric" value={draft.labelHeightMm} onChange={(e) => set('labelHeightMm', Number(e.target.value) || 0)} /></Field>
        </div>
        <button className="btn" onClick={() => void testPrint('label')} disabled={busy !== null}>Imprimir etiqueta de prueba</button>
      </section>

      <section className="card">
        <h3>Respaldos de la base de datos</h3>
        <p className="muted">Se hace una copia verificada cada {Math.round(draft.backupIntervalMin / 60 * 10) / 10} horas, al cerrar la caja y cada día con la tarea de Windows. Si el USB no está conectado, aparecerá un aviso.</p>
        {backup?.warning && <Banner kind="error">{backup.warning}</Banner>}
        <div className="grid2">
          <Field label="Carpeta de respaldos">
            <div className="row-gap"><input className="inp grow" value={draft.backupDir} onChange={(e) => set('backupDir', e.target.value)} /><button className="btn" onClick={() => void pick('backupDir', 'Carpeta de respaldos')}>Elegir</button></div>
          </Field>
          <Field label="Segundo destino (USB o carpeta externa)" hint="Opcional pero recomendado">
            <div className="row-gap"><input className="inp grow" value={draft.backupSecondaryDir} onChange={(e) => set('backupSecondaryDir', e.target.value)} placeholder="Sin segundo destino" /><button className="btn" onClick={() => void pick('backupSecondaryDir', 'Segundo destino de respaldos')}>Elegir</button></div>
          </Field>
          <Field label="Cada cuántos minutos" hint="Mínimo 15. 120 = cada 2 horas"><input className="inp" inputMode="numeric" value={draft.backupIntervalMin} onChange={(e) => set('backupIntervalMin', Number(e.target.value) || 0)} /></Field>
          <Field label="Cuántas copias recientes conservar" hint="Además se guarda una por día y una por mes">
            <input className="inp" inputMode="numeric" value={draft.retention.keepRecent} onChange={(e) => set('retention', { ...draft.retention, keepRecent: Number(e.target.value) || 0 })} />
          </Field>
        </div>
        <div className="row-gap">
          <button className="btn btn-gold" onClick={() => void backupNow()} disabled={busy !== null || dirty}>{busy === 'backup' ? 'Respaldando...' : 'Respaldar ahora'}</button>
          <button className="btn" onClick={() => void call('app:openFolder', { which: 'backup' }).catch((e) => setError(errorText(e)))}>Abrir carpeta</button>
        </div>
        {dirty && <div className="muted small">Guarda los cambios antes de respaldar para usar las carpetas nuevas.</div>}
        <table className="table table-tight">
          <thead><tr><th>Fecha</th><th>Tipo</th><th>Resultado</th><th>Archivo</th></tr></thead>
          <tbody>
            {logs.slice(0, 8).map((l) => (
              <tr key={l.id}>
                <td>{dateTime(l.at)}</td>
                <td>{l.kind}</td>
                <td className={l.ok ? '' : 'neg'}>{l.ok ? (l.verified ? 'Correcto y verificado' : 'Correcto') : `Falló: ${l.error ?? ''}`}</td>
                <td className="small muted">{l.path ?? ''}</td>
              </tr>
            ))}
            {logs.length === 0 && <tr><td colSpan={4} className="muted center">Aún no hay respaldos registrados.</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h3>Servidor (internet)</h3>
        <Field label="Dirección de la API" hint="Sin internet o sin servidor la caja sigue funcionando; solo deja de sincronizar">
          <div className="row-gap"><input className="inp grow" value={draft.apiUrl} onChange={(e) => set('apiUrl', e.target.value)} placeholder="https://amara.midominio.com" spellCheck={false} /><button className="btn" onClick={() => void testApi()} disabled={busy !== null}>Probar conexión</button></div>
        </Field>
        <div className="muted">Terminal: {device?.terminal?.code ?? '-'} - Sucursal: {device?.branch?.name ?? '-'} - {sync?.activated ? 'Token de sincronización guardado' : 'Sin token de sincronización'}</div>
        <div className="row-gap"><button className="btn" onClick={async () => {
          if (await confirm({ title: 'Cambiar de terminal', message: 'Vas a vincular esta computadora con otra sucursal o terminal. Solo es posible si no hay operaciones pendientes de enviar.', confirmText: 'Continuar' })) setReactivate(true);
        }}>Cambiar sucursal o terminal</button></div>
      </section>

      <section className="card">
        <h3>Escáner</h3>
        <div className="grid2">
          <Field label="Escáner USB: velocidad máxima entre teclas (ms)" hint="Normal: 50. Súbelo si el escáner se lee a medias; bájalo si confunde el teclado">
            <input className="inp" inputMode="numeric" value={draft.scannerMaxGapMs} onChange={(e) => set('scannerMaxGapMs', Number(e.target.value) || 0)} />
          </Field>
          <Field label="Largo mínimo de un código"><input className="inp" inputMode="numeric" value={draft.scannerMinLength} onChange={(e) => set('scannerMinLength', Number(e.target.value) || 0)} /></Field>
        </div>
        <hr />
        <h4>Teléfono como escáner (misma red Wi-Fi)</h4>
        <label className="check"><input type="checkbox" checked={draft.lanEnabled} onChange={(e) => set('lanEnabled', e.target.checked)} /> Permitir que un teléfono vinculado mande lecturas a esta PC (guarda los ajustes para aplicar)</label>
        {lan && !lan.listening && draft.lanEnabled && settings?.lanEnabled && <Banner kind="warn">{lan.error ?? 'El servidor del teléfono no está activo.'}</Banner>}
        {lan && lan.listening && <div className="muted small">Escuchando en el puerto {lan.port}. Si Windows pregunta por el Firewall, permite el acceso en redes privadas.</div>}
        <div className="stack">
          {lan?.devices.map((d) => (
            <div key={d.id} className="row-between hist">
              <div><strong>{d.name}</strong><div className="muted small">Vinculado {dateTime(d.pairedAt)} - Última lectura {d.lastSeenAt ? dateTime(d.lastSeenAt) : 'nunca'}</div></div>
              <button className="btn btn-danger btn-sm" onClick={async () => {
                if (await confirm({ title: 'Revocar teléfono', message: `"${d.name}" dejará de poder mandar lecturas y tendrá que vincularse de nuevo.`, confirmText: 'Revocar', danger: true })) {
                  try { setLan(await call('lan:revoke', { deviceId: d.id })); toast('ok', 'Teléfono revocado.'); } catch (e) { setError(errorText(e)); }
                }
              }}>Revocar</button>
            </div>
          ))}
          {lan && lan.devices.length === 0 && <div className="muted">Ningún teléfono vinculado.</div>}
        </div>
        <button className="btn btn-gold" onClick={() => setPairOpen(true)} disabled={!lan?.listening}>Vincular un teléfono</button>
      </section>

      <section className="card">
        <h3>Datos de esta computadora</h3>
        <div className="muted small">Versión {info?.version} - {info?.platform}</div>
        <div className="small">Base de datos: <span className="mono">{info?.dbPath}</span></div>
        <div className="small">Carpeta de datos: <span className="mono">{info?.dataDir}</span></div>
        <div className="row-gap"><button className="btn btn-sm" onClick={() => void call('app:openFolder', { which: 'data' }).catch((e) => setError(errorText(e)))}>Abrir carpeta de datos</button></div>
      </section>

      {pairOpen && lan && <PairModal lan={lan} onClose={() => { void call('lan:cancelPairing').then(setLan).catch(() => undefined); setPairOpen(false); }} />}
    </div>
  );
}

function PairModal({ lan, onClose }: { lan: LanState; onClose: () => void }) {
  const [host, setHost] = useState(lan.hostCandidates[0] ?? '');
  const [qr, setQr] = useState<string | null>(null);
  const [state, setState] = useState<LanState>(lan);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const known = state.devices.length;
  const [initialDevices] = useState(known);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    const off = onEvent('evt:lan', setState);
    return () => {
      window.clearInterval(t);
      off();
    };
  }, []);

  const start = async () => {
    setError(null);
    try {
      const s = await call('lan:startPairing', { host });
      setState(s);
      setQr(s.pairing ? await QRCode.toDataURL(s.pairing.payloadText, { margin: 2, width: 320, errorCorrectionLevel: 'M' }) : null);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const remaining = state.pairing ? Math.max(0, Math.round((Date.parse(state.pairing.expiresAt) - now) / 1000)) : 0;
  const paired = state.devices.length > initialDevices && !state.pairing && qr !== null;

  return (
    <Modal title="Vincular teléfono" size="md" onClose={onClose}
      footer={<button className="btn" onClick={onClose}>{paired ? 'Listo' : 'Cerrar y cancelar código'}</button>}>
      <div className="stack">
        <p className="muted">Conecta el teléfono a la misma red Wi-Fi que esta PC, abre la app de Amara y escanea este código. Sirve para UN teléfono y caduca en 5 minutos.</p>
        {!qr && !paired && (
          <>
            <Field label="Dirección de esta PC en la red" hint="Normalmente la primera de la lista">
              <select className="inp" value={host} onChange={(e) => setHost(e.target.value)}>
                {lan.hostCandidates.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </Field>
            <button className="btn btn-gold btn-lg" onClick={() => void start()} disabled={!host}>Mostrar código QR</button>
          </>
        )}
        {qr && state.pairing && (
          <div className="qrbox">
            <img src={qr} alt="Código QR de vinculación" width={320} height={320} />
            <div className="strong">Caduca en {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</div>
          </div>
        )}
        {qr && !state.pairing && !paired && <Banner kind="warn">El código caducó o se canceló. Cierra y genera uno nuevo.</Banner>}
        {paired && <Banner kind="ok">Teléfono vinculado correctamente.</Banner>}
        {error && <Banner kind="error">{error}</Banner>}
      </div>
    </Modal>
  );
}
