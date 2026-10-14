import { Router } from 'express';
import { database } from '../config/database.js';
import { crearCatalogoVehiculos } from '../services/catalogo-vehiculos.service.js';
import { crearServicioMiAutomovil } from '../services/mi-automovil.service.js';
export function crearMiAutomovilRouter(catalogo=crearCatalogoVehiculos(), servicio=crearServicioMiAutomovil(database,catalogo)) {
 const router=Router();
 router.use((req,res,next)=>req.usuario?.rol==='conductor' ? next() : res.status(403).json({message:'MiAutomóvil requiere una cuenta de conductor.'}));
 router.get('/catalogo',async(req,res)=>res.json({data:await catalogo.menu(req.query.nivel,req.query)}));
 router.get('/catalogo/:id',async(req,res)=>res.json({data:await catalogo.ficha(req.params.id)}));
 router.get('/vehiculos',async(req,res)=>res.json({data:await servicio.listar(req.usuario)}));
 router.post('/vehiculos',async(req,res)=>res.status(201).json({data:await servicio.agregar(req.usuario,req.body)}));
 router.delete('/vehiculos/:id',async(req,res)=>{await servicio.eliminar(req.usuario,req.params.id);res.status(204).end();});
 return router;
}
