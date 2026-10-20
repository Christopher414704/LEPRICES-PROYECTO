import { crearInvestigacionVehiculos } from './investigacion-vehiculos.service.js';

// Cada ejecución tiene su propio proceso: el plazo global también detiene PDF y OCR.
process.once('message', async ({ consulta, usuarioId }) => {
  const informar = mensaje => process.send?.({ progreso: mensaje });
  const solicitar = (url, opciones) => {
    informar(String(url).includes('/chat/completions')
      ? 'Contrastando datos con los documentos encontrados.'
      : 'Consultando fuentes permitidas y servicios de investigación.');
    return fetch(url, opciones);
  };
  try {
    const motor = crearInvestigacionVehiculos({ solicitar });
    const resultado = await motor.investigar(consulta, usuarioId);
    process.send({ resultado }, () => process.exit(0));
  } catch (error) {
    process.send({ error: { statusCode: error.statusCode ?? 503,
      message: error.statusCode ? error.message : 'La investigación no pudo terminar. Puedes reintentar.' } }, () => process.exit(1));
  }
});
