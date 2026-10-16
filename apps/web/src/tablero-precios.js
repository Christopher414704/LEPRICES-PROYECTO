import { urlGoogleMaps } from "./publico.js";
import { calcularPosicionTarjeta, formatearPrecio } from "./precios.js";
import { distanciaEnLineaRecta, enlaceNavegacion, formatearDistancia } from "./ubicacion-gasolinera.js";

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

export function crearTableroPrecios(panel, alCerrar, { ubicacionActual = () => null, solicitarUbicacion } = {}) {
  let fichaActual;
  let distanciaVisible;
  let botonDistancia;

  function actualizarDistancia() {
    if (!fichaActual || !distanciaVisible) return;
    const distancia = distanciaEnLineaRecta(ubicacionActual(), fichaActual.ubicacion);
    distanciaVisible.hidden = distancia == null;
    if (botonDistancia) botonDistancia.hidden = distancia != null;
    if (distancia != null) {
      distanciaVisible.textContent = `A ${formatearDistancia(distancia)} en línea recta de tu ubicación.`;
    }
  }

  function crearDetalleUbicacion(ficha) {
    const detalle = elemento("section", "detalle-ubicacion");
    detalle.append(elemento("h3", "", "Ubicación"));
    const direccion = [ficha.direccion, ficha.municipio, ficha.departamento].filter(Boolean).join(", ");
    detalle.append(elemento("p", "direccion-gasolinera", direccion || "Ubicación señalada en el mapa"));
    const enlace = enlaceNavegacion(ficha.ubicacion);
    if (enlace) {
      detalle.append(elemento("p", "coordenadas-gasolinera",
        `${Number(ficha.ubicacion.latitud).toFixed(5)}, ${Number(ficha.ubicacion.longitud).toFixed(5)}`));
    }

    const acciones = elemento("div", "acciones-ubicacion");
    const favorito = elemento("a", "enlace-navegacion", "Guardar favorito");
    favorito.href = `${import.meta.env.BASE_URL}favoritos.html?gasolinera=${encodeURIComponent(ficha.codigo)}`;
    acciones.append(favorito);
    if (enlace) {
      const navegar = elemento("a", "enlace-navegacion", "Cómo llegar");
      navegar.href = enlace;
      navegar.target = "_blank";
      navegar.rel = "noopener noreferrer";
      navegar.setAttribute("aria-label", `Abrir indicaciones hacia ${ficha.nombre} en Google Maps`);
      acciones.append(navegar);
    }
    const mensajeDistancia = elemento("p", "distancia-gasolinera");
    mensajeDistancia.setAttribute("role", "status");
    mensajeDistancia.hidden = true;
    distanciaVisible = mensajeDistancia;
    if (solicitarUbicacion && enlace) {
      const boton = elemento("button", "boton-distancia", "Calcular distancia");
      boton.type = "button";
      boton.addEventListener("click", async () => {
        boton.disabled = true;
        mensajeDistancia.hidden = false;
        mensajeDistancia.textContent = "Consultando tu ubicación…";
        try {
          await solicitarUbicacion();
          if (fichaActual?.codigo === ficha.codigo) actualizarDistancia();
        } catch (error) {
          if (fichaActual?.codigo === ficha.codigo) {
            mensajeDistancia.textContent = error.message || "No fue posible consultar tu ubicación.";
          }
        } finally {
          boton.disabled = false;
        }
      });
      botonDistancia = boton;
      acciones.append(boton);
    } else botonDistancia = null;
    detalle.append(acciones, mensajeDistancia);
    return detalle;
  }

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
      panel.replaceChildren(encabezado, crearDetalleUbicacion(ficha), contenido, pie);
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
      const urlRuta = urlGoogleMaps(ficha.ubicacion);
      if (urlRuta) {
        const enlace = elemento("a", "pie-tablero", "Abrir ruta en Google Maps");
        enlace.href = urlRuta; enlace.target = "_blank"; enlace.rel = "noopener noreferrer";
        panel.append(enlace);
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
    actualizarDistancia();
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

  return { mostrar, posicionar, ocultar, actualizarDistancia };
}
