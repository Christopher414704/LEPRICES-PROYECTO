import { crearInvestigacionGaraje } from '../services/investigacion-garaje.service.js';
import { Router } from 'express';
import { database } from '../config/database.js';
import { crearCatalogoVehiculos } from '../services/catalogo-vehiculos.service.js';
import { crearServicioMiAutomovil } from '../services/mi-automovil.service.js';
import { crearServicioConsumoVehiculo } from '../services/consumo-vehiculo.service.js';
import { crearServicioBitacoraCombustible } from '../services/bitacora-combustible.service.js';
export function crearMiAutomovilRouter(catalogo=crearCatalogoVehiculos(), servicio=crearServicioMiAutomovil(database,catalogo), consumo=crearServicioConsumoVehiculo(database), bitacora=crearServicioBitacoraCombustible(database), investigacion=crearInvestigacionGaraje(database)) {
 const router=Router();
 router.use((req,res,next)=>req.usuario?.rol==='conductor' ? next() : res.status(403).json({message:'MiAutomóvil requiere una cuenta de conductor.'}));
 router.get('/catalogo',async(req,res)=>res.json({data:await catalogo.menu(req.query.nivel,req.query)}));
 router.get('/catalogo/:id',async(req,res)=>res.json({data:await catalogo.ficha(req.params.id)}));
 router.post('/vehiculos/:id/investigacion',async(req,res)=>{res.set('Cache-Control','no-store');res.status(202).json({data:await investigacion.iniciar(req.usuario,req.params.id)});});
 router.get('/vehiculos/:id/investigacion/:trabajo',async(req,res)=>{res.set('Cache-Control','no-store');res.json({data:await investigacion.consultar(req.usuario,req.params.id,req.params.trabajo)});});
 router.get('/vehiculos',async(req,res)=>res.json({data:await servicio.listar(req.usuario)}));
 router.get('/vehiculos/:id/consumo',async(req,res)=>res.json({data:await consumo.obtener(req.usuario,req.params.id)}));
 router.put('/vehiculos/:id/consumo',async(req,res)=>res.json({message:'Medición de consumo guardada.',data:await consumo.guardar(req.usuario,req.params.id,req.body)}));
 router.delete('/vehiculos/:id/consumo',async(req,res)=>res.json({message:'Medición personal eliminada.',data:await consumo.eliminar(req.usuario,req.params.id)}));
 router.get('/vehiculos/:id/cargas',async(req,res)=>res.json({data:await bitacora.listar(req.usuario,req.params.id)}));
 router.post('/vehiculos/:id/cargas',async(req,res)=>res.status(201).json({message:'Carga de combustible registrada.',data:await bitacora.registrar(req.usuario,req.params.id,req.body)}));
 router.post('/vehiculos',async(req,res)=>res.status(201).json({data:await servicio.agregar(req.usuario,req.body)}));
 router.delete('/vehiculos/:id',async(req,res)=>{await servicio.eliminar(req.usuario,req.params.id);res.status(204).end();});
 return router;
}
