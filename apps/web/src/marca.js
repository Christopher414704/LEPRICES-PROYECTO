// Identidad compartida por las exportaciones; carga diferida y sin dependencia del DOM.
export const colorMarca = [49, 95, 190];
let logoPendiente;
export async function logoParaPdf() {
  if (typeof window === 'undefined') return null;
  if (!logoPendiente) {
    logoPendiente = fetch('/images/leprices-marca.png', { signal: AbortSignal.timeout(5000) })
      .then(async respuesta => {
        if (!respuesta.ok) throw new Error('Logo no disponible.');
        const blob = await respuesta.blob();
        if (blob.type !== 'image/png') throw new Error('Formato de logo no válido.');
        return new Promise((resolve, reject) => {
          const lector = new FileReader();
          lector.onload = () => resolve(lector.result);
          lector.onerror = reject;
          lector.readAsDataURL(blob);
        });
      })
      .catch(() => {
        // El encabezado de texto permite descargar el informe aunque falle la imagen.
        logoPendiente = null;
        return null;
      });
  }
  return logoPendiente;
}
