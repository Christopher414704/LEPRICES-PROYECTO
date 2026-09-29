export function formatearPrecio(valor) {
  if (valor == null || typeof valor === "boolean" ||
      (typeof valor === "string" && !valor.trim())) return "--.--";
  const numero = Number(valor);
  return Number.isFinite(numero) && numero > 0 ? numero.toFixed(2) : "--.--";
}

export function calcularPosicionTarjeta({ x, y, ancho, alto, ventanaAncho, ventanaAlto, techo = 84 }) {
  const margen = 10;
  const izquierda = Math.max(margen, Math.min(x - ancho / 2, ventanaAncho - ancho - margen));
  const arriba = y - alto - 38;
  const colocacion = arriba >= techo ? "arriba" : "abajo";
  const superior = Math.max(techo, Math.min(colocacion === "arriba" ? arriba : y + 34,
    ventanaAlto - alto - margen));
  return {
    izquierda, superior, colocacion,
    flecha: Math.max(22, Math.min(x - izquierda, ancho - 22)),
  };
}
