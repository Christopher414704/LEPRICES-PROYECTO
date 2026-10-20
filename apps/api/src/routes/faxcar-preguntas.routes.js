import {Router} from 'express';
import {database} from '../config/database.js';
import {crearPreguntasFaxcar} from '../services/faxcar-preguntas.service.js';
export function crearPreguntasFaxcarRouter(servicio=crearPreguntasFaxcar(database)){
 const router=Router();router.use((req,res,next)=>{res.set('Cache-Control','no-store');if(req.usuario?.debeCambiarContrasena)return res.status(403).json({message:'Cambia tu contraseña inicial para continuar.'});next();});
 router.post('/vehiculos/:id/preguntar',async(req,res)=>res.json({data:await servicio.preguntar(req.usuario,req.params.id,req.body?.pregunta)}));return router;
}
