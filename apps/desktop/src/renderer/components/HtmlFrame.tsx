/**
 * Muestra un documento HTML completo (ticket, cierre, permiso, hoja de etiquetas) dentro de un iframe aislado:
 * es el MISMO HTML que se manda a la impresora. `sandbox="allow-same-origin"` sin `allow-scripts`: el documento no
 * puede ejecutar código; solo se deja leer su alto para ajustar el recuadro.
 */
import { useRef, useState } from 'react';

export function HtmlFrame({ html, title, widthMm, autoHeight = true, height = 360 }: { html: string; title: string; widthMm?: number; autoHeight?: boolean; height?: number }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [h, setH] = useState(height);
  const measure = () => {
    if (!autoHeight) return;
    try {
      const doc = ref.current?.contentDocument;
      if (doc?.documentElement) setH(Math.max(120, doc.documentElement.scrollHeight + 4));
    } catch {
      /* sin acceso al documento: se queda el alto por omisión */
    }
  };
  return (
    <iframe
      ref={ref}
      title={title}
      srcDoc={html}
      sandbox="allow-same-origin"
      onLoad={measure}
      className="docframe"
      style={{ width: widthMm ? `${widthMm}mm` : '100%', height: autoHeight ? h : height }}
    />
  );
}
