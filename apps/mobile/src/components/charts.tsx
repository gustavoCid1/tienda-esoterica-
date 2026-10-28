/**
 * Gráficas dibujadas a mano con react-native-svg (sin librerías de gráficas): pastel, líneas y barras apiladas.
 * La geometría sale de lib/chart-geometry (pura y con pruebas); aquí solo se dibuja. Los colores de las series vienen
 * de lib/charts (que lee theme.ts); el resto de colores se leen de theme.ts sin redefinirlos.
 */
import React, { useState } from 'react';
import { Pressable, Text as RNText, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import { barLayout, labelIndices, lineLayout, pieArcs } from '../lib/chart-geometry';
import type { PlotBox } from '../lib/chart-geometry';
import { CHART_KINDS } from '../lib/charts';
import type { ChartData, ChartKind, PieSlice } from '../lib/charts';
import { colors, radius, space } from '../theme';
import { Chip, ChipRow } from './ui';

/** Selector de tipo de gráfica (pastel, líneas, barras). */
export function ChartKindSelector({ value, onChange, kinds }: { value: ChartKind; onChange: (k: ChartKind) => void; kinds?: ChartKind[] }) {
  const list = kinds ? CHART_KINDS.filter((k) => kinds.includes(k.id)) : CHART_KINDS;
  return (
    <ChipRow>
      {list.map((k) => (
        <Chip key={k.id} label={k.label} selected={value === k.id} onPress={() => onChange(k.id)} />
      ))}
    </ChipRow>
  );
}

const BOX: Omit<PlotBox, 'width' | 'height'> = { left: 30, right: 8, top: 10, bottom: 26 };
const HEIGHT = 220;

export function ChartView(props: {
  kind: ChartKind;
  data: ChartData;
  slices: PieSlice[];
  selectedBucket: string | null;
  onSelectBucket: (bucket: string | null) => void;
  selectedSlice: number | null;
  onSelectSlice: (index: number | null) => void;
}) {
  const { kind, data, slices, selectedBucket, onSelectBucket, selectedSlice, onSelectSlice } = props;
  const [width, setWidth] = useState(0);

  return (
    <View onLayout={(e) => setWidth(Math.floor(e.nativeEvent.layout.width))} style={{ width: '100%' }}>
      {width > 0 ? (
        kind === 'pie' ? (
          <Pie width={width} slices={slices} selected={selectedSlice} onSelect={onSelectSlice} />
        ) : (
          <XYChart kind={kind} width={width} data={data} selectedBucket={selectedBucket} onSelectBucket={onSelectBucket} />
        )
      ) : (
        <View style={{ height: HEIGHT }} />
      )}
    </View>
  );
}

function Pie({ width, slices, selected, onSelect }: { width: number; slices: PieSlice[]; selected: number | null; onSelect: (i: number | null) => void }) {
  const size = Math.min(width, 240);
  const r = size / 2 - 6;
  const arcs = pieArcs(slices.map((s) => s.value), size / 2, size / 2, r);
  const total = slices.reduce((a, s) => a + s.value, 0);
  return (
    <View style={{ alignItems: 'center', gap: space.sm }}>
      <Svg width={size} height={size} accessibilityLabel={`Gráfica de pastel con ${slices.length} productos`}>
        {arcs.map((a) =>
          a.path ? (
            <Path
              key={a.index}
              d={a.path}
              fill={slices[a.index]!.color}
              stroke={colors.white}
              strokeWidth={selected === a.index ? 3 : 1.5}
              opacity={selected === null || selected === a.index ? 1 : 0.45}
              onPress={() => onSelect(selected === a.index ? null : a.index)}
            />
          ) : null,
        )}
      </Svg>
      <View style={{ alignSelf: 'stretch', gap: 6 }}>
        {slices.map((s, i) => (
          <LegendRow key={`${s.name}-${i}`} color={s.color} label={s.name} value={`${s.value} (${total > 0 ? Math.round((s.value / total) * 100) : 0}%)`} active={selected === i} onPress={() => onSelect(selected === i ? null : i)} />
        ))}
      </View>
    </View>
  );
}

function XYChart({ kind, width, data, selectedBucket, onSelectBucket }: { kind: 'line' | 'bar'; width: number; data: ChartData; selectedBucket: string | null; onSelectBucket: (b: string | null) => void }) {
  const box: PlotBox = { ...BOX, width, height: HEIGHT };
  const values = data.rows.map((r) => r.values);
  const n = data.keys.length;
  const bars = kind === 'bar' ? barLayout(values, n, box) : null;
  const lines = kind === 'line' ? lineLayout(values, n, box) : null;
  const geo = bars ?? lines!;
  const xs = bars ? bars.centers : lines!.xs;
  const band = bars ? bars.bandWidth : data.rows.length > 1 ? (width - box.left - box.right) / (data.rows.length - 1) : width - box.left - box.right;
  const shown = new Set(labelIndices(data.rows.length, Math.max(2, Math.floor((width - box.left) / 44))));
  return (
    <View style={{ gap: space.sm }}>
      <Svg width={width} height={HEIGHT} accessibilityLabel={kind === 'bar' ? 'Gráfica de barras de ventas por producto' : 'Gráfica de líneas de ventas por producto'}>
        {/* Rejilla y eje Y */}
        {geo.ticks.map((t) => (
          <G key={t.value}>
            <Line x1={box.left} x2={width - box.right} y1={t.y} y2={t.y} stroke={colors.border} strokeWidth={1} />
            <SvgText x={box.left - 6} y={t.y + 4} fontSize={10} fill={colors.muted} textAnchor="end">
              {String(t.value)}
            </SvgText>
          </G>
        ))}
        {/* Cubo seleccionado */}
        {selectedBucket !== null
          ? data.rows.map((r, i) =>
              r.bucket === selectedBucket ? <Rect key={`sel-${r.bucket}`} x={xs[i]! - band / 2} y={geo.plotTop} width={band} height={geo.plotBottom - geo.plotTop} fill={colors.goldSoft} /> : null,
            )
          : null}
        {/* Series */}
        {bars
          ? bars.rects.map((r) => <Rect key={`${r.row}-${r.series}`} x={r.x} y={r.y} width={r.width} height={r.height} fill={data.keys[r.series]!.color} />)
          : lines!.series.map((s, si) => (
              <G key={si}>
                <Polyline points={s.points} fill="none" stroke={data.keys[si]!.color} strokeWidth={2.5} strokeLinejoin="round" />
                {s.dots.map((d, di) => (
                  <Circle key={di} cx={d.x} cy={d.y} r={3} fill={data.keys[si]!.color} />
                ))}
              </G>
            ))}
        {/* Eje X */}
        {data.rows.map((r, i) =>
          shown.has(i) ? (
            <SvgText key={`x-${r.bucket}`} x={xs[i]} y={HEIGHT - 8} fontSize={10} fill={colors.muted} textAnchor="middle">
              {r.label}
            </SvgText>
          ) : null,
        )}
        {/* Zonas táctiles: tocar un día/mes lo selecciona */}
        {data.rows.map((r, i) => (
          <Rect
            key={`hit-${r.bucket}`}
            x={xs[i]! - band / 2}
            y={geo.plotTop}
            width={band}
            height={geo.plotBottom - geo.plotTop + 16}
            fill="transparent"
            onPress={() => onSelectBucket(selectedBucket === r.bucket ? null : r.bucket)}
          />
        ))}
      </Svg>
      <View style={{ gap: 6 }}>
        {data.keys.map((k) => (
          <LegendRow key={k.key} color={k.color} label={k.name} />
        ))}
      </View>
    </View>
  );
}

export function LegendRow({ color, label, value, active, onPress }: { color: string; label: string; value?: string; active?: boolean; onPress?: () => void }) {
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 2, paddingHorizontal: 4, borderRadius: radius.sm, backgroundColor: active ? colors.goldSoft : 'transparent' }}>
      <View style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: color }} />
      <RNText style={{ flex: 1, fontSize: 14, color: colors.text }} numberOfLines={1}>
        {label}
      </RNText>
      {value ? <RNText style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>{value}</RNText> : null}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}>
      {body}
    </Pressable>
  );
}
