const errorHttp = (statusCode, message) => Object.assign(new Error(message), { statusCode });
export const normalizarBusqueda = (texto) => String(texto ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export function validarAnio(valor, obligatorio = false) {
  if ((valor == null || valor === '') && !obligatorio) return null;
  if (!/^\d{4}$/.test(String(valor)) || Number(valor) < 1886 || Number(valor) > new Date().getUTCFullYear()+2) throw errorHttp(400,'Selecciona un año válido.');
  return Number(valor);
}
