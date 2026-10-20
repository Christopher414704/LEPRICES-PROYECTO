import { Router } from 'express';
import { database } from '../config/database.js';
import { crearCampanasVehiculos } from '../services/campanas-vehiculos.service.js';

export function crearCampanasFaxcarRouter(servicio = crearCampanasVehiculos(database)) {
  const router = Router();
  router.get('/vehiculos/:id/campanas', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ data: await servicio.consultar(req.usuario, req.params.id) });
  });
  return router;
}
