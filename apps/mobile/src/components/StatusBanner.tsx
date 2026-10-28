import React from 'react';
import { View } from 'react-native';
import { Banner } from './ui';
import { useApp } from '../state/AppContext';
import { useNow } from '../hooks';
import { computeStaleness, shouldWarn } from '../lib/staleness';

/**
 * Aviso de conexión y de DATOS DESACTUALIZADOS. Se muestra en las pantallas donde se ven precios,
 * existencias o ventas. Solo aparece cuando hay algo que advertir.
 */
export function StatusBanner({ compact = false }: { compact?: boolean }) {
  const { sync, online } = useApp();
  const now = useNow(30_000);
  const pending = sync.status?.pending ?? 0;
  const info = computeStaleness({ lastSyncOkAt: sync.status?.lastSyncOkAt ?? null, nowMs: now, pending });
  const warn = shouldWarn(info, pending);
  const firstSentence = info.detail.split('. ')[0]!;
  if (!warn && online) return null;
  return (
    <View style={{ gap: 8 }}>
      {!online ? <Banner kind="warn" title="Sin conexión" text="Trabajas con los datos guardados en este teléfono. Las ventas y movimientos se enviarán al reconectar." /> : null}
      {warn ? <Banner kind={info.level === 'critico' || info.level === 'nunca' ? 'error' : 'warn'} title={info.title} text={compact ? (firstSentence.endsWith('.') ? firstSentence : `${firstSentence}.`) : info.detail} /> : null}
    </View>
  );
}
