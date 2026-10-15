import { solicitarApi, consultarSesion, urlLogin } from "./auth.js";
import "./style.css";
const $ = id => document.getElementById(id);
const estado = $("estado");
async function api(ruta, opciones) {
 const r = await solicitarApi("/avisos/alertas/" + ruta, opciones);
 const datos = await r.json(); if (!r.ok) throw new Error(datos.message); return datos;
}
let estaciones = [];
function opciones(select, filas) { select.replaceChildren(...filas.map(([valor,nombre]) => new Option(nombre,valor))); }
function modalidades() { const e=estaciones.find(e=>e.codigo===$("estacion").value); const c=e?.combustibles.find(c=>c.codigo===$("combustible").value); opciones($("modalidad"),Object.entries(c?.precios??{}).map(([codigo,p])=>[codigo,p.modalidad??codigo])); }
function combustibles() { const e=estaciones.find(e=>e.codigo===$("estacion").value); opciones($("combustible"),(e?.combustibles??[]).map(c=>[c.codigo,c.nombre])); modalidades(); }
async function favoritos() { const datos=await api("favoritos"); $("favoritos").replaceChildren(...datos.data.map(f=>{ const li=document.createElement("li"); li.textContent=f.codigo_gasolinera+" · "+f.codigo_combustible+" · "+f.codigo_modalidad+(f.precio_objetivo?" · objetivo Q"+f.precio_objetivo:""); return li; })); }
$("estacion").onchange=combustibles; $("combustible").onchange=modalidades;
$("favorito").onsubmit=async e=>{e.preventDefault(); try {
 if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("Este navegador no admite avisos Push.");
 const config=await api("configuracion"); if(!config.disponible) throw new Error("Las notificaciones están pendientes de configuración del servidor.");
 if(await Notification.requestPermission()!=="granted") throw new Error("No autorizaste los avisos. Puedes seguir usando el mapa.");
 const registro=await navigator.serviceWorker.register(import.meta.env.BASE_URL+"push-sw.js");
 await navigator.serviceWorker.ready;
 const clave=Uint8Array.from(atob(config.clavePublica.replace(/-/g,"+").replace(/_/g,"/")),c=>c.charCodeAt(0));
 const suscripcion=await registro.pushManager.getSubscription()??await registro.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:clave});
 const previos=(await api("favoritos")).data;
 const nuevo={codigo:$("estacion").value,combustible:$("combustible").value,modalidad:$("modalidad").value,objetivo:$("objetivo").value||null};
 const guardados=previos.map(f=>({codigo:f.codigo_gasolinera,combustible:f.codigo_combustible,modalidad:f.codigo_modalidad,objetivo:f.precio_objetivo}));
 const lista=guardados.filter(f=>!(f.codigo===nuevo.codigo&&f.combustible===nuevo.combustible&&f.modalidad===nuevo.modalidad)); lista.push(nuevo);
 await api("suscripcion",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({suscripcion,favoritos:lista})});
 estado.textContent="Favorito registrado. Avisos activados para futuras reducciones."; await favoritos();
 }catch(error){estado.textContent=error.message;} };
$("desactivar").onclick=async()=>{try { const r=await navigator.serviceWorker.getRegistration(); const s=await r?.pushManager.getSubscription(); if(s){await api("suscripcion",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({suscripcion:s})});await s.unsubscribe();} estado.textContent="Avisos desactivados.";await favoritos(); }catch(e){estado.textContent=e.message;} };
try { if(!await consultarSesion()) window.location.replace(urlLogin); else {const r=await solicitarApi("/publico/gasolineras");if(!r.ok)throw new Error("No fue posible cargar las estaciones.");const datos=await r.json();estaciones=datos.data;opciones($("estacion"),estaciones.map(e=>[e.codigo,e.nombre]));combustibles();await favoritos();if(datos.hayMas)estado.textContent="Se muestran las primeras 300 estaciones del catálogo.";} }catch(e){estado.textContent=e.message;}
