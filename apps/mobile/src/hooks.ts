import { useEffect, useState } from 'react';

/** Hora actual (ms) que se actualiza cada `intervalMs`: para textos como "hace 5 min". */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
