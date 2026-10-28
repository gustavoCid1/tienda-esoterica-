/**
 * Reduce una foto elegida por la persona a un JPEG pequeño (data URL) para guardarla con el
 * producto. productSchema limita la foto a 2,000,000 caracteres; se apunta a mucho menos.
 */
export const MAX_PHOTO_CHARS = 1_500_000;

export function fileToResizedDataUrl(file: File, maxSide = 640, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('El archivo no es una imagen.'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Este navegador no puede procesar imágenes.'));
        return;
      }
      ctx.fillStyle = '#ffffff'; // fondo blanco para PNG con transparencia
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const out = canvas.toDataURL('image/jpeg', quality);
      if (out.length > MAX_PHOTO_CHARS) reject(new Error('La foto sigue siendo demasiado pesada; elige una más pequeña.'));
      else resolve(out);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen.'));
    };
    img.src = url;
  });
}
