import { calcularPosicionTarjeta, formatearPrecio } from "./precios.js";

function elemento(etiqueta, clase, texto) {
  const nodo = document.createElement(etiqueta);
  nodo.className = clase;
  if (texto != null) nodo.textContent = texto;
  return nodo;
}

function crearColumna(titulo, modalidad, combustibles) {
  const columna = elemento("section", "columna-modalidad");
  columna.append(elemento("h3", "", titulo));
  for (const combustible of combustibles) {
    const informacion = combustible.precios?.[modalidad];
    const valor = formatearPrecio(informacion?.precio);
    const moneda = informacion?.moneda ?? "GTQ";
    const fila = elemento("div", "fila-precio");
    const celda = elemento("div", "celda-precio");
    celda.append(
      elemento("span", "simbolo-moneda", moneda === "GTQ" ? "Q" : moneda),
      elemento("strong", "precio-digital", valor),
    );
    celda.setAttribute("aria-label", valor === "--.--" ? "Precio no registrado" : `${valor} ${moneda} por ${informacion?.unidadMedida ?? "galón"}`);
    fila.append(elemento("span", "nombre-combustible", combustible.nombreComercial ?? combustible.nombre), celda);
    columna.append(fila);
  }
  return columna;
}

export function crearTableroPrecios(panel, alCerrar) {
  let fichaActual;

  function mostrar(ficha, posicion) {
    if (fichaActual !== ficha || panel.hidden) {
      fichaActual = ficha;
      const encabezado = elemento("header", "encabezado-tablero");
      const titulo = elemento("h2", "", ficha.nombre);
      titulo.id = "nombreGasolinera";
      const cerrar = elemento("button", "cerrar-tablero", "×");
      cerrar.type = "button";
      cerrar.setAttribute("aria-label", "Cerrar precios");
      cerrar.addEventListener("click", alCerrar);
      encabezado.append(titulo, cerrar);

      const combustibles = ficha.combustibles?.length ? ficha.combustibles : [
        { nombreComercial: "Sin precios registrados", precios: {} },
      ];
      const contenido = elemento("div", "contenido-tablero");
      contenido.append(
        crearColumna("Autoservicio", "autoservicio", combustibles),
        crearColumna("Servicio Completo", "servicio_manual", combustibles),
      );
      const unidades = [...new Set(combustibles.flatMap((c) => Object.values(c.precios ?? {})
        .filter((p) => formatearPrecio(p?.precio) !== "--.--").map((p) => p.unidadMedida ?? "galon")))];
      const pie = elemento("p", "pie-tablero", unidades.length
        ? `Precio por ${unidades.map((u) => u === "galon" ? "galón" : u).join(" / ")}`
        : "Precios pendientes de actualización");
      panel.replaceChildren(encabezado, contenido, pie);
      if (ficha.ultimaActualizacion) {
        const fecha = new Date(ficha.ultimaActualizacion);
        if (!Number.isNaN(fecha.getTime())) {
          const formato = new Intl.DateTimeFormat("es-GT", {
            timeZone: "America/Guatemala", day: "numeric", month: "short", year: "numeric",
            hour: "2-digit", minute: "2-digit",
          });
          panel.append(elemento("p", "fecha-tablero", `Último precio reportado: ${formato.format(fecha)} · Guatemala`));
        }
      }
      panel.hidden = false;
      // Solo anima al entrar o cambiar de estación, nunca en cada movimiento del ratón.
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        panel.getAnimations().forEach((animacion) => animacion.cancel());
        panel.animate([
          { opacity: 0, transform: "scale(.88) translateY(8px)" },
          { opacity: 1, transform: "scale(1.025) translateY(-2px)", offset: .72 },
          { opacity: 1, transform: "scale(1) translateY(0)" },
        ], { duration: 210, easing: "cubic-bezier(.2,.8,.2,1)" });
      }
    }
    posicionar(posicion);
  }

  function posicionar({ x, y }) {
    const techo = (document.querySelector(".encabezado")?.getBoundingClientRect().bottom ?? 64) + 10;
    panel.style.maxHeight = `${Math.max(90, window.innerHeight - techo - 12)}px`;
    const posicion = calcularPosicionTarjeta({ x, y, techo,
      ancho: panel.offsetWidth, alto: panel.offsetHeight,
      ventanaAncho: window.innerWidth, ventanaAlto: window.innerHeight });
    panel.style.left = `${posicion.izquierda}px`;
    panel.style.top = `${posicion.superior}px`;
    panel.style.setProperty("--flecha-x", `${posicion.flecha}px`);
    panel.dataset.colocacion = posicion.colocacion;
  }

  function ocultar() {
    panel.hidden = true;
    fichaActual = null;
  }

  return { mostrar, posicionar, ocultar };
}
