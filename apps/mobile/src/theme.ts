/** Diseño: blanco predominante, dorado de acento, texto negro/gris oscuro, sin adornos. */
export const colors = {
  bg: '#FFFFFF',
  surface: '#FAF8F2',
  border: '#E4DECF',
  borderStrong: '#111111',
  text: '#111111',
  muted: '#555555',
  gold: '#B8860B',
  goldBright: '#C9A227',
  goldSoft: '#F6EEDC',
  dark: '#111111',
  danger: '#9B1C1C',
  dangerSoft: '#FBEAEA',
  ok: '#2F6B3A',
  okSoft: '#E9F3EB',
  white: '#FFFFFF',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16 } as const;

/** Relación de aspecto real del logo (1280x995): se usa SIEMPRE con resizeMode contain. */
export const LOGO_ASPECT = 1280 / 995;
