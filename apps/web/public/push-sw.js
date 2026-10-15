self.addEventListener("push", (evento) => {
  const datos = evento.data?.json() ?? {};
  const titulo = typeof datos.titulo === "string" ? datos.titulo : "LEPRICES · precio actualizado";
  const cuerpo = typeof datos.cuerpo === "string" ? datos.cuerpo : "Revisa el precio en el mapa.";
  const codigo = typeof datos.codigo === "string" ? datos.codigo : "";
  evento.waitUntil(self.registration.showNotification(titulo, {
    body: cuerpo,
    icon: `${self.registration.scope}images/leprices-logo.png`,
    badge: `${self.registration.scope}images/ubicacion.png`,
    tag: `leprices-${codigo}`,
    data: { url: `${self.registration.scope}publico.html?gasolinera=${encodeURIComponent(codigo)}` },
  }));
});

self.addEventListener("notificationclick", (evento) => {
  evento.notification.close();
  evento.waitUntil(clients.openWindow(evento.notification.data?.url ?? `${self.registration.scope}publico.html`));
});
