/** Pitidos de confirmación/error al escanear (WebAudio). Si el audio no está disponible, no pasa nada. */
let ctx: AudioContext | null = null;

function beep(freq: number, ms: number, type: OscillatorType = 'sine'): void {
  try {
    ctx ??= new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + ms / 1000);
  } catch {
    /* sin audio */
  }
}

export const beepOk = () => beep(1100, 70);
export const beepError = () => {
  beep(220, 220, 'square');
};
