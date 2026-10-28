/**
 * Series de ventas para las gráficas del gerente: servidor primero (GET /stats/top-products-series y
 * GET /stats/product-series); sin conexión, cálculo LOCAL con el aviso de que puede estar incompleto.
 * NUNCA se combinan servidor y local (el local no conoce las ventas de otras terminales).
 */
import { mxRangeBounds } from '@amara/shared';
import type { LocalStore } from '@amara/database';
import { normalizeProductSeries, normalizeTopSeries } from '../lib/charts';
import type { Granularity, ProductSeries, TopProductsSeries } from '../lib/charts';
import { localProductSeries, localTopSeries, resolverFrom } from '../lib/series-local';
import type { ProductRef } from '../lib/series-local';
import { ApiClient, ApiError } from './api';

export interface SeriesDeps {
  api: ApiClient;
  store: LocalStore;
  online: boolean;
  branchId: string;
}

export interface SeriesLoad<T> {
  data: T;
  source: 'servidor' | 'local';
  note: string | null;
}

export class SeriesForbiddenError extends Error {
  constructor() {
    super('Tu rol no puede ver las gráficas de ventas.');
    this.name = 'SeriesForbiddenError';
  }
}

const LOCAL_NOTE = 'DATOS LOCALES de este teléfono: pueden estar INCOMPLETOS (no incluyen las ventas de otras terminales que no se hayan descargado).';

async function productIndex(store: LocalStore): Promise<Map<string, ProductRef>> {
  const rows = await store.db.all<{ variantId: string; productId: string; productName: string }>(
    'SELECT v.id AS variantId, p.id AS productId, p.name AS productName FROM variants v JOIN products p ON p.id = v.product_id',
  );
  return new Map(rows.map((r) => [r.variantId, { productId: r.productId, productName: r.productName }]));
}

function explain(e: unknown): string | null {
  if (e instanceof ApiError && e.status === 403) throw new SeriesForbiddenError();
  if (e instanceof ApiError && e.status === 401) return 'La sesión en línea venció: se muestran los datos de este teléfono.';
  if (e instanceof ApiError && e.unreachable) return null;
  return `El servidor no pudo dar la gráfica (${e instanceof Error ? e.message : 'error'}): se muestran los datos de este teléfono.`;
}

export async function loadTopSeries(d: SeriesDeps, q: { granularity: Granularity; from: string; to: string; limit?: number }): Promise<SeriesLoad<TopProductsSeries>> {
  const limit = q.limit ?? 5;
  let serverNote: string | null = null;
  if (d.online) {
    try {
      const json = await d.api.get<unknown>(
        `/stats/top-products-series?from=${q.from}&to=${q.to}&granularity=${q.granularity}&branchId=${encodeURIComponent(d.branchId)}&limit=${limit}`,
        { timeoutMs: 15_000 },
      );
      return { data: normalizeTopSeries(json), source: 'servidor', note: null };
    } catch (e) {
      serverNote = explain(e);
    }
  }
  const { from, to } = mxRangeBounds(q.from, q.to);
  const { sales, adjustments } = await d.store.loadReportData(from, to, d.branchId);
  const data = localTopSeries(sales, adjustments, resolverFrom(await productIndex(d.store)), { granularity: q.granularity, fromDay: q.from, toDay: q.to, limit });
  return { data, source: 'local', note: serverNote ? `${serverNote} ${LOCAL_NOTE}` : LOCAL_NOTE };
}

export async function loadProductSeries(
  d: SeriesDeps,
  q: { productId?: string; variantId?: string; granularity: Granularity; from: string; to: string },
): Promise<SeriesLoad<ProductSeries>> {
  let serverNote: string | null = null;
  if (d.online) {
    try {
      const id = q.productId ? `productId=${encodeURIComponent(q.productId)}` : `variantId=${encodeURIComponent(q.variantId ?? '')}`;
      const json = await d.api.get<unknown>(
        `/stats/product-series?${id}&from=${q.from}&to=${q.to}&granularity=${q.granularity}&branchId=${encodeURIComponent(d.branchId)}`,
        { timeoutMs: 15_000 },
      );
      return { data: normalizeProductSeries(json), source: 'servidor', note: null };
    } catch (e) {
      serverNote = explain(e);
    }
  }
  const { from, to } = mxRangeBounds(q.from, q.to);
  const { sales, adjustments } = await d.store.loadReportData(from, to, d.branchId);
  const folioRows = await d.store.db.all<{ id: string; folio: string }>('SELECT id, folio FROM sales WHERE created_at >= ? AND created_at < ?', [from, to]);
  const data = localProductSeries(sales, adjustments, resolverFrom(await productIndex(d.store)), new Map(folioRows.map((r) => [r.id, r.folio])), {
    productId: q.productId,
    variantId: q.variantId,
    granularity: q.granularity,
    fromDay: q.from,
    toDay: q.to,
  });
  return { data, source: 'local', note: serverNote ? `${serverNote} ${LOCAL_NOTE}` : LOCAL_NOTE };
}
