import { useToast } from '../context.tsx';

/** Botón que copia un texto al portapapeles y avisa el resultado. */
export function CopyButton(props: { text: string; label?: string; small?: boolean; disabled?: boolean }) {
  const { notify } = useToast();
  const copy = () => {
    const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (!clip) {
      notify('Este navegador no permite copiar; selecciona el texto manualmente.', 'error');
      return;
    }
    clip.writeText(props.text).then(
      () => notify('Copiado.'),
      () => notify('No se pudo copiar; selecciona el texto manualmente.', 'error'),
    );
  };
  return (
    <button type="button" className={`btn ${props.small ? 'btn-sm' : ''}`} onClick={copy} disabled={props.disabled}>
      {props.label ?? 'Copiar'}
    </button>
  );
}
