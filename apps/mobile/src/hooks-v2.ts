import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_CHART_KIND, chartKindMetaKey, parseChartKind } from './lib/charts';
import type { ChartKind } from './lib/charts';
import { useApp } from './state/AppContext';

/** Tipo de gráfica elegido, recordado POR USUARIO en la base local del teléfono (tabla meta). */
export function useChartKind(): [ChartKind, (k: ChartKind) => void] {
  const { store, session } = useApp();
  const userId = session?.user.id ?? null;
  const [kind, setKind] = useState<ChartKind>(DEFAULT_CHART_KIND);

  useEffect(() => {
    let off = false;
    if (!store || !userId) return;
    store
      .getMeta(chartKindMetaKey(userId))
      .then((v) => {
        const k = parseChartKind(v);
        if (!off && k) setKind(k);
      })
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, [store, userId]);

  const change = useCallback(
    (k: ChartKind) => {
      setKind(k);
      if (store && userId) store.setMeta(chartKindMetaKey(userId), k).catch(() => undefined);
    },
    [store, userId],
  );
  return [kind, change];
}
