/**
 * Generación de etiquetas: Code128 (jsbarcode, SVG) + QR (qrcode, SVG con buildQrValue).
 * El código de barras lleva el CÓDIGO INTERNO (único): el escáner USB lo encuentra con findByCode.
 */
import JsBarcode from 'jsbarcode';
import * as QRCodeNs from 'qrcode';
import { buildQrValue } from '@amara/shared';
import type { LabelRender } from '../../shared/label-html.ts';
import type { LabelItem } from '../../shared/ipc.ts';

// qrcode es un módulo CommonJS: según el empaquetador sus funciones llegan como `default` o como exportaciones nombradas.
const QRCode: typeof QRCodeNs = (QRCodeNs as unknown as { default?: typeof QRCodeNs }).default ?? QRCodeNs;

function code128Svg(text: string): string {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  JsBarcode(svg, text, { format: 'CODE128', displayValue: false, margin: 0, height: 50, width: 2 });
  // Si la librería no dejó viewBox, se agrega para que el SVG escale sin deformarse.
  if (!svg.getAttribute('viewBox')) {
    const w = parseFloat(svg.getAttribute('width') ?? '0');
    const h = parseFloat(svg.getAttribute('height') ?? '0');
    if (w > 0 && h > 0) svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  return new XMLSerializer().serializeToString(svg);
}

export async function makeLabel(item: Pick<LabelItem, 'variantId' | 'code' | 'productName' | 'label' | 'priceCents'>): Promise<LabelRender> {
  const qrSvg = await QRCode.toString(buildQrValue(item.variantId), { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
  return {
    productName: item.productName,
    variantLabel: item.label,
    priceCents: item.priceCents,
    code: item.code,
    barcodeSvg: code128Svg(item.code),
    qrSvg,
  };
}

/** Expande las copias de cada renglón (una etiqueta por copia). */
export async function expandLabels(items: LabelItem[]): Promise<LabelRender[]> {
  const out: LabelRender[] = [];
  for (const it of items) {
    const one = await makeLabel(it);
    for (let i = 0; i < it.copies; i++) out.push(one);
  }
  return out;
}
