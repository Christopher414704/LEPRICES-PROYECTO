import { Router } from 'express';
import { crearServicioRutas } from '../services/rutas.service.js';

const solicitudes = new Map();
function limitarRutas(req, res, next) {
  const ahora = Date.now(), ip = req.ip ?? 'local';
  for (const [k, v] of solicitudes) if (v.hasta <= ahora) solicitudes.delete(k);
  let registro = solicitudes.get(ip);
  if (!registro) {
    if (solicitudes.size >= 2000) return res.status(429).json({ message: 'Demasiadas consultas de rutas. Reintenta en un minuto.' });
    registro = { cantidad: 0, hasta: ahora + 60_000 }; solicitudes.set(ip, registro);
  }
  if (++registro.cantidad > 20) return res.set('Retry-After', String(Math.ceil((registro.hasta - ahora) / 1000))).status(429).json({ message: 'Puedes calcular hasta 20 viajes por minuto. Espera un momento.' });
  next();
}

export function crearRutasRouter(servicio = crearServicioRutas(), publico = false) {
  const router = Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  if (!publico) {
    router.use((req, res, next) => req.usuario?.rol === 'conductor' ? next() :
      res.status(403).json({ message: 'Seleccionar tu vehículo requiere una cuenta de conductor.' }));
    router.get('/vehiculos/:id/consumo', async (req, res) => res.json({ data: await servicio.consumoVehiculo(req.usuario, req.params.id) }));
  }
  router.post('/estimar', limitarRutas, async (req, res) => {
    if (publico && req.body?.vehiculoId != null) return res.status(401).json({ message: 'Inicia sesión para usar un vehículo de tu garaje.' });
    res.json({ data: await servicio.estimar(req.body ?? {}, publico ? null : req.usuario) });
  });
  return router;
}
