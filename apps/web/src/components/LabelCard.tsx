/**
 * Dibuja una etiqueta: Code 128 (jsbarcode, SVG) y QR (qrcode, imagen). El tamaño físico se
 * expresa en milímetros para que la impresión salga a escala. Nunca lleva el logotipo.
 */
import { useEffect, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import { isCode128Printable, type LabelSize, type LabelSpec } from '../lib/labels.ts';

export function LabelCard({ spec, size }: { spec: LabelSpec; size: LabelSize }) {
  const svg = useRef<SVGSVGElement>(null);
  const [qr, setQr] = useState('');
  const [drawError, setDrawError] = useState(false);
  // La validez se calcula al renderizar (no con estado) para que el <svg> exista cuando se dibuja.
  const drawable = spec.barcodeValue !== '' && isCode128Printable(spec.barcodeValue);

  useEffect(() => {
    setDrawError(false);
    if (!drawable || !svg.current) return;
    try {
      JsBarcode(svg.current, spec.barcodeValue, {
        format: 'CODE128',
        width: 1.3,
        height: Math.max(18, size.heightMm * 0.9),
        displayValue: true,
        fontSize: 9,
        margin: 0,
        textMargin: 1,
        background: '#ffffff',
        lineColor: '#000000',
      });
    } catch {
      setDrawError(true);
    }
  }, [drawable, spec.barcodeValue, size.heightMm]);

  useEffect(() => {
    let alive = true;
    if (!spec.qrValue) {
      setQr('');
      return;
    }
    QRCode.toDataURL(spec.qrValue, { margin: 0, width: 160, errorCorrectionLevel: 'M' })
      .then((url) => alive && setQr(url))
      .catch(() => alive && setQr(''));
    return () => {
      alive = false;
    };
  }, [spec.qrValue]);

  return (
    <div className={`label ${spec.warnings.length ? 'label-warn' : ''}`} style={{ width: `${size.widthMm}mm`, height: `${size.heightMm}mm` }}>
      <div className="label-main">
        {spec.title && <div className="label-title">{spec.title}</div>}
        <div className="label-sub">
          {spec.subtitle}
          {spec.priceText && <span className="label-price"> {spec.priceText}</span>}
        </div>
        {drawable ? (
          <>
            <svg ref={svg} className="label-barcode" />
            {drawError && <div className="label-err">No se pudo generar el código</div>}
          </>
        ) : (
          <div className="label-err">{spec.barcodeValue ? 'Código no válido para Code 128' : 'Sin código'}</div>
        )}
      </div>
      {spec.qrValue && qr && <img className="label-qr" src={qr} alt="" />}
    </div>
  );
}
