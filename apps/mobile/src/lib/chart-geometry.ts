/**
 * Geometría PURA de las gráficas SVG (sin React): rutas del pastel, polilíneas de líneas y rectángulos de
 * barras apiladas. Los componentes de src/components/charts.tsx solo dibujan lo que calcula este archivo.
 */
export interface PlotBox {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Máximo "bonito" (1, 2, 5 por potencia de 10) que contiene a `v`. Siempre >= 1 (las unidades son enteros). */
export function niceMax(v: number): number {
  if (!Number.isFinite(v) || v <= 1) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / mag;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return nice * mag;
}

/** Marcas del eje Y: enteros hasta 5; si no, 0, mitad y máximo (el máximo "bonito" es par desde 10). */
export function yTicks(max: number): number[] {
  if (max <= 5) return Array.from({ length: Math.max(1, Math.floor(max)) + 1 }, (_, i) => i);
  return [0, max / 2, max];
}

/** Índices de etiquetas a mostrar en el eje X (siempre incluye el último) para que no se encimen. */
export function labelIndices(count: number, maxLabels: number): number[] {
  if (count <= 0) return [];
  if (count <= maxLabels) return Array.from({ length: count }, (_, i) => i);
  const step = Math.ceil(count / maxLabels);
  const out: number[] = [];
  for (let i = 0; i < count; i += step) out.push(i);
  if (out[out.length - 1] !== count - 1) {
    // Evita que la última se encime con la anterior.
    if (count - 1 - (out[out.length - 1] ?? 0) < step / 2) out.pop();
    out.push(count - 1);
  }
  return out;
}

export interface PieArc {
  index: number;
  /** Ruta SVG de la rebanada (vacía si el valor es 0). */
  path: string;
  ratio: number;
  startAngle: number;
  endAngle: number;
}

const f = (n: number) => Number(n.toFixed(3));

/** Rebanadas de un pastel que empieza arriba y gira a la derecha. Valores <= 0 no dibujan. */
export function pieArcs(values: number[], cx: number, cy: number, r: number): PieArc[] {
  const clean = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const total = clean.reduce((a, b) => a + b, 0);
  if (total <= 0 || r <= 0) return [];
  const positive = clean.filter((v) => v > 0).length;
  let angle = -Math.PI / 2;
  return clean.map((v, index) => {
    if (v <= 0) return { index, path: '', ratio: 0, startAngle: angle, endAngle: angle };
    const ratio = v / total;
    const start = angle;
    const end = angle + ratio * Math.PI * 2;
    angle = end;
    let path: string;
    if (positive === 1) {
      // Un solo valor: círculo completo (un arco de 360 grados degenera en SVG).
      path = `M ${f(cx)} ${f(cy - r)} A ${f(r)} ${f(r)} 0 1 1 ${f(cx)} ${f(cy + r)} A ${f(r)} ${f(r)} 0 1 1 ${f(cx)} ${f(cy - r)} Z`;
    } else {
      const x1 = cx + r * Math.cos(start);
      const y1 = cy + r * Math.sin(start);
      const x2 = cx + r * Math.cos(end);
      const y2 = cy + r * Math.sin(end);
      const large = end - start > Math.PI ? 1 : 0;
      path = `M ${f(cx)} ${f(cy)} L ${f(x1)} ${f(y1)} A ${f(r)} ${f(r)} 0 ${large} 1 ${f(x2)} ${f(y2)} Z`;
    }
    return { index, path, ratio, startAngle: start, endAngle: end };
  });
}

export interface LineLayout {
  yMax: number;
  ticks: { value: number; y: number }[];
  xs: number[];
  /** Una polilínea ("x,y x,y ...") y sus puntos por serie. */
  series: { points: string; dots: { x: number; y: number; value: number }[] }[];
  plotBottom: number;
  plotTop: number;
}

/** Posiciones de un gráfico de líneas. `rows[i][s]` = unidades del cubo i en la serie s. */
export function lineLayout(rows: number[][], seriesCount: number, box: PlotBox): LineLayout {
  const plotLeft = box.left;
  const plotRight = box.width - box.right;
  const plotTop = box.top;
  const plotBottom = box.height - box.bottom;
  const peak = rows.reduce((m, r) => Math.max(m, ...r, 0), 0);
  const yMax = niceMax(peak);
  const y = (v: number) => plotBottom - (Math.max(0, v) / yMax) * (plotBottom - plotTop);
  const n = rows.length;
  const xs = rows.map((_, i) => (n <= 1 ? (plotLeft + plotRight) / 2 : plotLeft + (i * (plotRight - plotLeft)) / (n - 1)));
  const series = Array.from({ length: seriesCount }, (_, s) => {
    const dots = rows.map((r, i) => ({ x: f(xs[i]!), y: f(y(r[s] ?? 0)), value: r[s] ?? 0 }));
    return { points: dots.map((d) => `${d.x},${d.y}`).join(' '), dots };
  });
  return { yMax, ticks: yTicks(yMax).map((value) => ({ value, y: f(y(value)) })), xs, series, plotBottom, plotTop };
}

export interface BarRectGeo {
  row: number;
  series: number;
  x: number;
  y: number;
  width: number;
  height: number;
  value: number;
}
export interface BarLayout {
  yMax: number;
  ticks: { value: number; y: number }[];
  /** Centro horizontal de cada columna. */
  centers: number[];
  bandWidth: number;
  rects: BarRectGeo[];
  plotBottom: number;
  plotTop: number;
}

/** Barras APILADAS (una columna por cubo, un segmento por producto). */
export function barLayout(rows: number[][], seriesCount: number, box: PlotBox): BarLayout {
  const plotLeft = box.left;
  const plotRight = box.width - box.right;
  const plotTop = box.top;
  const plotBottom = box.height - box.bottom;
  const n = Math.max(1, rows.length);
  const band = (plotRight - plotLeft) / n;
  const barW = Math.max(2, Math.min(band * 0.7, 48));
  const peak = rows.reduce((m, r) => Math.max(m, r.slice(0, seriesCount).reduce((a, b) => a + Math.max(0, b), 0)), 0);
  const yMax = niceMax(peak);
  const scale = (plotBottom - plotTop) / yMax;
  const centers = rows.map((_, i) => f(plotLeft + band * i + band / 2));
  const rects: BarRectGeo[] = [];
  rows.forEach((r, row) => {
    let acc = 0;
    for (let s = 0; s < seriesCount; s++) {
      const v = Math.max(0, r[s] ?? 0);
      if (v <= 0) continue;
      const h = v * scale;
      acc += v;
      rects.push({ row, series: s, x: f(centers[row]! - barW / 2), y: f(plotBottom - acc * scale), width: f(barW), height: f(h), value: v });
    }
  });
  return { yMax, ticks: yTicks(yMax).map((value) => ({ value, y: f(plotBottom - value * scale) })), centers, bandWidth: f(band), rects, plotBottom, plotTop };
}
