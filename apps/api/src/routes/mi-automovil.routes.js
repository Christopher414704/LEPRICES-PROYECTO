import { Router } from 'express';
import { database } from '../config/database.js';
import { crearCatalogoVehiculos } from '../services/catalogo-vehiculos.service.js';
import { crearServicioMiAutomovil } from '../services/mi-automovil.service.js';
import { crearServicioConsumoVehiculo } from '../services/consumo-vehiculo.service.js';
export function crearMiAutomovilRouter(catalogo=crearCatalogoVehiculos(), servicio=crearServicioMiAutomovil(database,catalogo), consumo=crearServicioConsumoVehiculo(database)) {
 const router=Router();
 router.use((req,res,next)=>req.usuario?.rol==='conductor' ? next() : res.status(403).json({message:'MiAutomóvil requiere una cuenta de conductor.'}));
 router.get('/catalogo',async(req,res)=>res.json({data:await catalogo.menu(req.query.nivel,req.query)}));
 router.get('/catalogo/:id',async(req,res)=>res.json({data:await catalogo.ficha(req.params.id)}));
 router.get('/vehiculos',async(req,res)=>res.json({data:await servicio.listar(req.usuario)}));
 router.get('/vehiculos/:id/consumo',async(req,res)=>res.json({data:await consumo.obtener(req.usuario,req.params.id)}));
 router.put('/vehiculos/:id/consumo',async(req,res)=>res.json({message:'Medición de consumo guardada.',data:await consumo.guardar(req.usuario,req.params.id,req.body)}));
 router.delete('/vehiculos/:id/consumo',async(req,res)=>res.json({message:'Medición personal eliminada.',data:await consumo.eliminar(req.usuario,req.params.id)}));
 router.post('/vehiculos',async(req,res)=>res.status(201).json({data:await servicio.agregar(req.usuario,req.body)}));
 router.delete('/vehiculos/:id',async(req,res)=>{await servicio.eliminar(req.usuario,req.params.id);res.status(204).end();});
 return router;
}
