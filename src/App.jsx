import { useState, useRef, useEffect } from "react";

// ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────
const SUPA_URL  = "https://wnlmzradcwloripcauwi.supabase.co";
const SUPA_KEY  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndubG16cmFkY3dsb3JpcGNhdXdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5MzMwNjYsImV4cCI6MjA5NTUwOTA2Nn0.zjVG9ybyt4wx8FYoH1dekJowITsl6NB3gRH4xH5IY14";
const MODO_DEMO = SUPA_URL.includes("TU_PROJECT_ID");
// ─────────────────────────────────────────────────────────────────────────────

const BRAND = {
  accent:"#FF5C35", accentB:"#FF8A65", green:"#00A37A", blue:"#2563EB",
  purple:"#7C3AED", bg:"#F4F5F7", card:"#FFFFFF", card2:"#FFFFFF",
  border:"#E2E4E9", text:"#1A1C22", muted:"#6B7280", dimmed:"#C4C8D0",
};

const supaHeaders = {
  "Content-Type": "application/json",
  "apikey": SUPA_KEY,
  "Authorization": "Bearer " + SUPA_KEY,
};

const supaAuth = {
  signIn: async (email, password) => {
    try {
      const r = await fetch(SUPA_URL + "/auth/v1/token?grant_type=password", {
        method: "POST", headers: { "Content-Type": "application/json", "apikey": SUPA_KEY },
        body: JSON.stringify({ email, password }),
      });
      const data = await r.json();
      if (data.error || data.error_description) return { error: data.error_description || data.error || "Credenciales incorrectas" };
      return { session: data, user: data.user };
    } catch { return { error: "No se pudo conectar con el servidor." }; }
  },
  signUp: async (email, password, metadata) => {
    try {
      const r = await fetch(SUPA_URL + "/auth/v1/signup", {
        method:"POST", headers:{ "Content-Type":"application/json","apikey":SUPA_KEY },
        body: JSON.stringify({ email, password, data: metadata }),
      });
      const data = await r.json();
      if (data.error || data.error_description || data.msg) return { error: data.error_description || data.error || data.msg || "No se pudo registrar" };
      if (data.access_token) return { session: data, user: data.user };
      return { session: null, user: data.user || data }; // requiere confirmación por correo
    } catch { return { error: "No se pudo conectar con el servidor." }; }
  },
  signOut: async (token) => { try { await fetch(SUPA_URL + "/auth/v1/logout", { method:"POST", headers:{ "Content-Type":"application/json","apikey":SUPA_KEY,"Authorization":"Bearer "+token } }); } catch (_) {} },
  refreshSession: async (refreshToken) => {
    try {
      const r = await fetch(SUPA_URL + "/auth/v1/token?grant_type=refresh_token", {
        method:"POST", headers:{ "Content-Type":"application/json","apikey":SUPA_KEY },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      const data = await r.json();
      if (data.error) return { error: data.error };
      return { session: data };
    } catch { return { error: "Error al refrescar sesión." }; }
  },
};

const supaApi = {
  getPerfil: async (token, uid) => {
    const r = await fetch(SUPA_URL + "/rest/v1/perfiles?id=eq." + uid + "&select=*", { headers:{ ...supaHeaders,"Authorization":"Bearer "+token } });
    const d = await r.json(); return Array.isArray(d) ? d[0] : null;
  },
  verificarTaller: async (codigo) => {
    const r = await fetch(SUPA_URL + "/rest/v1/talleres?codigo=eq." + encodeURIComponent(codigo) + "&select=nombre,codigo", { headers: supaHeaders });
    const d = await r.json(); return Array.isArray(d) ? d[0] : null;
  },
  getUsuariosTaller: async (token, taller) => {
    const r = await fetch(SUPA_URL + "/rest/v1/perfiles?taller=eq." + encodeURIComponent(taller) + "&select=id,nombre,rol,email&order=nombre", { headers:{ ...supaHeaders,"Authorization":"Bearer "+token } });
    return r.json();
  },
  actualizarRol: async (token, uid, rol) => {
    const r = await fetch(SUPA_URL + "/rest/v1/perfiles?id=eq." + uid, { method:"PATCH", headers:{ ...supaHeaders,"Authorization":"Bearer "+token,"Prefer":"return=representation" }, body: JSON.stringify({ rol }) });
    return r.json();
  },
  getOrdenes: async (token) => { const r = await fetch(SUPA_URL + "/rest/v1/ordenes?select=*&order=creado_en.desc", { headers:{ ...supaHeaders,"Authorization":"Bearer "+token } }); return r.json(); },
  upsertOrden: async (token, orden) => {
    const r = await fetch(SUPA_URL + "/rest/v1/ordenes", {
      method:"POST",
      headers:{ ...supaHeaders,"Authorization":"Bearer "+token,"Prefer":"resolution=merge-duplicates,return=minimal" },
      body:JSON.stringify(orden),
    });
    if (!r.ok) { let msg=""; try{ msg=await r.text(); }catch(_){} throw new Error("Error "+r.status+": "+(msg||"no se pudo guardar")); }
    return { ok:true };
  },
};

// ─── STORAGE + UTILIDADES ─────────────────────────────────────────────────────
const BUCKET_FOTOS = "fotos";
const MAX_ARCHIVO_MB = 10;
const PAGE_SIZE = 8;

const supaStorage = {
  subirImagen: async (token, taller, ordenId, blob, nombre) => {
    const safeTaller = String(taller||"taller").replace(/[^a-zA-Z0-9]/g,"_");
    const safeNombre = String(nombre||"foto").replace(/[^a-zA-Z0-9.]/g,"_");
    const path = `${safeTaller}/${ordenId}/${Date.now()}_${safeNombre}`;
    const r = await fetch(`${SUPA_URL}/storage/v1/object/${BUCKET_FOTOS}/${path}`, {
      method:"POST", headers:{ "apikey":SUPA_KEY,"Authorization":"Bearer "+token,"Content-Type":blob.type||"image/jpeg" }, body:blob,
    });
    if (!r.ok) throw new Error("No se pudo subir la imagen al servidor.");
    return `${SUPA_URL}/storage/v1/object/public/${BUCKET_FOTOS}/${path}`;
  },
};

const comprimirImagen = (file, maxAncho=1280, calidad=0.7) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const escala = Math.min(1, maxAncho / img.width);
      const c = document.createElement("canvas");
      c.width = Math.round(img.width*escala); c.height = Math.round(img.height*escala);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(blob => { if(!blob){reject(new Error("No se pudo comprimir la imagen."));return;} resolve({ blob, dataUrl:c.toDataURL("image/jpeg",calidad) }); }, "image/jpeg", calidad);
    };
    img.onerror = () => reject(new Error("El archivo no es una imagen válida."));
    img.src = e.target.result;
  };
  reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
  reader.readAsDataURL(file);
});

const generarIdOrden = (...listas) => {
  let max = 0;
  listas.flat().forEach(o => { const m=/^OT-(\d+)$/.exec((o&&o.id)||""); if(m)max=Math.max(max,parseInt(m[1],10)); });
  return "OT-" + String(max+1).padStart(3,"0");
};

// Mapeo fila de BD (snake_case) → objeto de la app (camelCase)
const dbToOrden = row => ({
  id:row.id, tallerId:row.taller_id||"", cliente:row.cliente||"", telefono:row.telefono||"", vehiculo:row.vehiculo||"", placa:row.placa||"",
  serie:row.serie||"", siniestro:row.siniestro||"", color:row.color||"", servicio:row.servicio||"", tecnico:row.tecnico||"",
  estado:row.estado||"presupuesto", fecha:row.fecha||"", entrega:row.entrega||"", notas:row.notas||"", costo:parseFloat(row.costo)||0,
  fotoPrincipal:row.foto_principal||null,
  fechaPrimerIngreso:row.fecha_primer_ingreso||"", fechaProgramacion:row.fecha_programacion||"", fechaReingreso:row.fecha_reingreso||"",
  fechaInicioReparacion:row.fecha_inicio_rep||"", fechaPromesaEntrega:row.fecha_promesa||"", fechaEntregaReal:row.fecha_entrega_real||"",
  refaccionesCompletas:row.refacciones_completas||"", perfilManoObra:row.perfil_mano_obra||"", perfilPintura:row.perfil_pintura||"", perfilMecanica:row.perfil_mecanica||"",
  clienteEspecial:row.cliente_especial||false, tipoClienteEspecial:row.tipo_cliente_especial||"",
  deducible:row.deducible||"", anioAtencion:row.anio_atencion||"", mesAtencion:row.mes_atencion||"", diaAtencion:row.dia_atencion||"",
  costoManoObra:row.costo_mano_obra||"", costoRefacciones:row.costo_refacciones||"", montoReparacionInterna:row.monto_rep_interna||"", montoTOT:row.monto_tot||"",
  fechaCierre:row.fecha_cierre||"", motivoCierre:row.motivo_cierre||"", fechaTerminado:row.fecha_terminado||"", fechaEnvioCobro:row.fecha_envio_cobro||"",
  descuento:parseFloat(row.descuento)||0, notasCobro:row.notas_cobro||"", fechaPago:row.fecha_pago||"", metodoPago:row.metodo_pago||"", referenciaPago:row.referencia_pago||"",
  fotos:Array.isArray(row.fotos)?row.fotos:[], documentos:Array.isArray(row.documentos)?row.documentos:[],
  novedades:Array.isArray(row.novedades)?row.novedades:[], bitacora:Array.isArray(row.bitacora)?row.bitacora:[],
});

// Mapeo objeto de la app → fila de BD
const ordenToDB = (o, tallerID) => ({
  id:o.id, taller_id:o.tallerId||tallerID, cliente:o.cliente||"", telefono:o.telefono||"", vehiculo:o.vehiculo||"", placa:o.placa||"",
  serie:o.serie||"", siniestro:o.siniestro||"", color:o.color||"", servicio:o.servicio||"", tecnico:o.tecnico||"",
  estado:o.estado||"presupuesto", fecha:o.fecha||null, entrega:o.entrega||null, notas:o.notas||"", costo:o.costo||0,
  foto_principal:o.fotoPrincipal||null,
  fecha_primer_ingreso:o.fechaPrimerIngreso||null, fecha_programacion:o.fechaProgramacion||null, fecha_reingreso:o.fechaReingreso||null,
  fecha_inicio_rep:o.fechaInicioReparacion||null, fecha_promesa:o.fechaPromesaEntrega||null, fecha_entrega_real:o.fechaEntregaReal||null,
  refacciones_completas:o.refaccionesCompletas||null, perfil_mano_obra:o.perfilManoObra||"", perfil_pintura:o.perfilPintura||"", perfil_mecanica:o.perfilMecanica||"",
  cliente_especial:o.clienteEspecial||false, tipo_cliente_especial:o.tipoClienteEspecial||"",
  deducible:parseFloat(o.deducible)||null, anio_atencion:o.anioAtencion||"", mes_atencion:o.mesAtencion||"", dia_atencion:o.diaAtencion||"",
  costo_mano_obra:parseFloat(o.costoManoObra)||null, costo_refacciones:parseFloat(o.costoRefacciones)||null, monto_rep_interna:parseFloat(o.montoReparacionInterna)||null, monto_tot:parseFloat(o.montoTOT)||null,
  fecha_cierre:o.fechaCierre||null, motivo_cierre:o.motivoCierre||null, fecha_terminado:o.fechaTerminado||null, fecha_envio_cobro:o.fechaEnvioCobro||null,
  descuento:o.descuento||0, notas_cobro:o.notasCobro||null, fecha_pago:o.fechaPago||null, metodo_pago:o.metodoPago||null, referencia_pago:o.referenciaPago||null,
  fotos:o.fotos||[], documentos:o.documentos||[], novedades:o.novedades||[], bitacora:o.bitacora||[],
});

// Hook: detecta pantallas anchas (escritorio/tablet horizontal)
function useDesktop(bp=900) {
  const [d, setD] = useState(typeof window!=="undefined" && window.innerWidth>=bp);
  useEffect(() => { const h=()=>setD(window.innerWidth>=bp); window.addEventListener("resize",h); return ()=>window.removeEventListener("resize",h); }, [bp]);
  return d;
}

// Persistencia de sesión en el navegador (solo el token, nunca la contraseña)
const SESION_KEY = "repairx_sesion";
const guardarSesion = u => { try { localStorage.setItem(SESION_KEY, JSON.stringify(u)); } catch(_){} };
const leerSesion   = () => { try { const s=localStorage.getItem(SESION_KEY); return s?JSON.parse(s):null; } catch(_){ return null; } };
const borrarSesion = () => { try { localStorage.removeItem(SESION_KEY); } catch(_){} };
// ─────────────────────────────────────────────────────────────────────────────

const ROLES = {
  admin:    { label:"Administrador", color:"#FF5C35", permisos:["todo"] },
  asesor:   { label:"Asesor",        color:"#3B82F6", permisos:["ver_ordenes","crear_ordenes","editar_ordenes","novedades","documentos","fotos"] },
  valuador: { label:"Valuador",      color:"#8B5CF6", permisos:["ver_ordenes","ficha","novedades","documentos"] },
};

const DEMOS = [
  { id:"u1", nombre:"Carlos Mendoza", email:"admin@taller.com",    pass:"admin123",    rol:"admin",    taller:"Taller AutoPro", av:"A" },
  { id:"u2", nombre:"Roberto Lopez",  email:"asesor@taller.com",   pass:"asesor123",   rol:"asesor",   taller:"Taller AutoPro", av:"R" },
  { id:"u3", nombre:"Ana Ramirez",    email:"valuador@taller.com", pass:"valuador123", rol:"valuador", taller:"Taller AutoPro", av:"V" },
];

const puedePerm = (usr, perm) => { if(!usr)return false; const p=(ROLES[usr.rol]||{}).permisos||[]; return p.includes("todo")||p.includes(perm); };

const ESTADOS = [
  { key:"presupuesto", label:"Presupuesto", color:"#6B7280" },
  { key:"mecanica",    label:"Mecánica",    color:"#3B82F6" },
  { key:"hojalateria", label:"Hojalatería", color:"#F59E0B" },
  { key:"pintura",     label:"Pintura",     color:"#EF4444" },
  { key:"armado",      label:"Armado",      color:"#00C896" },
];
const PASOS    = ESTADOS.map(e=>e.key);
const TECNICOS = ["Carlos M.","Roberto L.","Andrés P.","Miguel T.","Jorge R."];
const SERVICIOS= ["Mecánica General","Hojalatería","Pintura","Frenos","Motor","Suspensión","Eléctrico","A/C"];
const TIPOS_DOC= [
  {key:"inventario", label:"Inventario",           icon:"📦"},
  {key:"valuacion",  label:"Valuación Aseguradora", icon:"🏦"},
  {key:"finiquito",  label:"Finiquito de Entrega",  icon:"✅"},
  {key:"garantia",   label:"Garantía",              icon:"🛡️"},
  {key:"presupuesto",label:"Presupuesto",           icon:"💰"},
  {key:"otro",       label:"Otro",                  icon:"📄"},
];
const CATS_NOV = [
  {key:"pieza",       label:"Piezas",      color:"#F59E0B"},
  {key:"cliente",     label:"Cliente",     color:"#3B82F6"},
  {key:"aseguradora", label:"Aseguradora", color:"#10B981"},
  {key:"pendiente",   label:"Pendiente",   color:"#EF4444"},
  {key:"general",     label:"General",     color:"#6B7280"},
];
const SUPERVISORES = {"SUP001":"Ana Martinez","SUP002":"Ricardo Lopez"};
const DIAS_HIST = 30;
const DIAS_TERM = 365;

const hoy   = () => new Date().toISOString().split("T")[0];
const dDias = f => Math.max(0, Math.floor((Date.now()-new Date(f).getTime())/86400000));
const cDias = f => { if(!f)return 0; const d=new Date(f); if(isNaN(d))return 0; return Math.max(0,Math.floor((Date.now()-d.getTime())/86400000)); };

const EXTRA = () => ({
  fechaPrimerIngreso:"", fechaProgramacion:"", fechaReingreso:"",
  fechaInicioReparacion:"", fechaPromesaEntrega:"", fechaEntregaReal:"",
  refaccionesCompletas:"", perfilManoObra:"", perfilPintura:"", perfilMecanica:"",
  clienteEspecial:false, tipoClienteEspecial:"",
  deducible:"", anioAtencion:"", mesAtencion:"", diaAtencion:"",
  costoManoObra:"", costoRefacciones:"", montoReparacionInterna:"", montoTOT:"",
});

const ORDENES_INIT = [
  {id:"OT-001",cliente:"Luis García",   telefono:"55 1234 5678",vehiculo:"Honda Civic 2020",    placa:"ABC-123",serie:"1HGBH41JXMN109186",siniestro:"SIN-2026-00123",color:"Blanco",servicio:"Hojalatería", tecnico:"Roberto L.",estado:"hojalateria",fecha:"2026-05-20",entrega:"2026-05-24",notas:"Golpe trasero derecho",   costo:4500, fotos:[],documentos:[],fotoPrincipal:null,novedades:[{id:1,texto:"Fotos enviadas a Zurich.",categoria:"aseguradora",fecha:"20 may.",hora:"09:15",resuelta:false}],bitacora:[{accion:"Orden creada",usuario:"Sistema",fecha:"2026-05-20"}],...EXTRA(),fechaPrimerIngreso:"2026-05-20"},
  {id:"OT-002",cliente:"María Torres",  telefono:"55 9876 5432",vehiculo:"Toyota Corolla 2019", placa:"XYZ-456",serie:"2T1BURHE0JC043821", siniestro:"",               color:"Gris",  servicio:"Mecánica",    tecnico:"Carlos M.", estado:"mecanica",    fecha:"2026-05-21",entrega:"2026-05-23",notas:"Falla en transmisión",    costo:8200, fotos:[],documentos:[],fotoPrincipal:null,novedades:[],bitacora:[{accion:"Orden creada",usuario:"Sistema",fecha:"2026-05-21"}],...EXTRA(),fechaPrimerIngreso:"2026-05-21"},
  {id:"OT-003",cliente:"Pedro Ramírez", telefono:"55 5555 1234",vehiculo:"Nissan Sentra 2021",  placa:"DEF-789",serie:"3N1AB8CV4MY274510", siniestro:"SIN-2026-00089",color:"Rojo",  servicio:"Frenos",      tecnico:"Carlos M.", estado:"armado",      fecha:"2026-05-19",entrega:"2026-05-22",notas:"Cambio de balatas",       costo:3100, fotos:[],documentos:[],fotoPrincipal:null,novedades:[],bitacora:[{accion:"Orden creada",usuario:"Sistema",fecha:"2026-05-19"}],...EXTRA(),fechaPrimerIngreso:"2026-05-19"},
  {id:"OT-004",cliente:"Ana López",     telefono:"55 4444 9999",vehiculo:"Volkswagen Jetta 2018",placa:"GHI-012",serie:"3VWF17AT4JM712345",siniestro:"",               color:"Negro", servicio:"Motor",       tecnico:"Andrés P.", estado:"presupuesto", fecha:"2026-05-22",entrega:"2026-05-26",notas:"Sobrecalentamiento",      costo:0,    fotos:[],documentos:[],fotoPrincipal:null,novedades:[],bitacora:[{accion:"Orden creada",usuario:"Sistema",fecha:"2026-05-22"}],...EXTRA(),fechaPrimerIngreso:"2026-05-22"},
  {id:"OT-005",cliente:"Carlos Vega",   telefono:"55 7777 3333",vehiculo:"Mazda 3 2022",        placa:"JKL-345",serie:"JM1BN1L71N0123456", siniestro:"SIN-2026-00201",color:"Azul",  servicio:"Pintura",     tecnico:"Miguel T.", estado:"pintura",     fecha:"2026-05-22",entrega:"2026-05-28",notas:"Pintura completa",        costo:12000,fotos:[],documentos:[],fotoPrincipal:null,novedades:[],bitacora:[{accion:"Orden creada",usuario:"Sistema",fecha:"2026-05-22"}],...EXTRA(),fechaPrimerIngreso:"2026-05-22"},
];

const mkS = () => ({
  card:     {background:BRAND.card,border:"1px solid "+BRAND.border,borderRadius:12,padding:"1rem 1.25rem",boxShadow:"0 1px 3px rgba(16,24,40,0.06)"},
  metric:   {background:BRAND.card,border:"1px solid "+BRAND.border,borderRadius:12,padding:"1rem 1.25rem",textAlign:"center",boxShadow:"0 1px 3px rgba(16,24,40,0.06)"},
  btn:      {background:BRAND.accent,color:"#fff",border:"none",borderRadius:10,padding:"0.5rem 1.1rem",cursor:"pointer",fontSize:13,fontWeight:600},
  btnGreen: {background:BRAND.green, color:"#fff",border:"none",borderRadius:10,padding:"0.5rem 1.1rem",cursor:"pointer",fontSize:13,fontWeight:600},
  btnDanger:{background:"#FEE2E2",   color:"#B91C1C",border:"1px solid #FCA5A5",borderRadius:10,padding:"0.5rem 1.1rem",cursor:"pointer",fontSize:13,fontWeight:500},
  btnSm:    col=>({background:col||"#EEF0F3",color:col?"#fff":BRAND.text,border:"none",borderRadius:7,padding:"4px 10px",cursor:"pointer",fontSize:11,fontWeight:500}),
  input:    {background:"#FFFFFF",border:"1px solid "+BRAND.border,borderRadius:9,padding:"0.5rem 0.8rem",color:BRAND.text,fontSize:13,width:"100%",boxSizing:"border-box"},
  select:   {background:"#FFFFFF",border:"1px solid "+BRAND.border,borderRadius:9,padding:"0.5rem 0.8rem",color:BRAND.text,fontSize:13,width:"100%",boxSizing:"border-box"},
  label:    {fontSize:11,color:BRAND.muted,marginBottom:3,display:"block"},
  overlay:  {position:"fixed",inset:0,background:"rgba(16,24,40,0.45)",zIndex:900,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(4px)"},
  modalBox: {background:BRAND.card,border:"1px solid "+BRAND.border,borderRadius:16,padding:"1.5rem",width:340,maxWidth:"90vw",boxShadow:"0 24px 60px rgba(16,24,40,0.25)"},
});

// ─── Login / Registro ─────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [modo,setModo]=useState("login"); // login | crear | unir
  const [em,setEm]=useState(""); const [pw,setPw]=useState("");
  const [nombre,setNombre]=useState(""); const [tallerNombre,setTallerNombre]=useState(""); const [codigo,setCodigo]=useState("");
  const [logo,setLogo]=useState(null); const logoRef=useRef();
  const [err,setErr]=useState(""); const [info,setInfo]=useState(""); const [loading,setL]=useState(false);

  const onLogo = async e => {
    const f=e.target.files[0]; if(!f){return;}
    if(!f.type.startsWith("image/")){ setErr("El logo debe ser una imagen."); e.target.value=""; return; }
    try{ const { dataUrl }=await comprimirImagen(f,200,0.6); setLogo(dataUrl); setErr(""); }catch{ setErr("No se pudo procesar el logo."); }
    e.target.value="";
  };

  const completarLogin = async (session, user) => {
    let perfil=null; try{ perfil=await supaApi.getPerfil(session.access_token, user.id); }catch(_){}
    onLogin({ id:user.id, email:user.email, nombre:perfil?.nombre||user.email.split("@")[0], av:(perfil?.nombre||user.email)[0].toUpperCase(), rol:perfil?.rol||"asesor", taller:perfil?.taller||"", tallerNombre:perfil?.taller_nombre||perfil?.taller||"Mi Taller", logo:perfil?.taller_logo||null, token:session.access_token, refreshToken:session.refresh_token, expiresAt:Date.now()+(session.expires_in||3600)*1000, modoDemo:false });
  };

  const doLogin = async () => {
    if(!em.trim()||!pw){setErr("Completa todos los campos.");return;}
    setL(true);setErr("");setInfo("");
    if(MODO_DEMO){ setTimeout(()=>{ const u=DEMOS.find(x=>x.email===em.trim().toLowerCase()&&x.pass===pw); if(u)onLogin({...u,modoDemo:true,token:null,refreshToken:null,tallerNombre:u.taller,logo:null}); else {setErr("Email o contraseña incorrectos.");setL(false);} },600); return; }
    const { session, user, error } = await supaAuth.signIn(em.trim().toLowerCase(), pw);
    if(error){setErr(error);setL(false);return;}
    await completarLogin(session, user);
  };

  const doCrear = async () => {
    if(!tallerNombre.trim()||!nombre.trim()||!em.trim()||!pw){setErr("Completa todos los campos.");return;}
    if(pw.length<6){setErr("La contraseña debe tener al menos 6 caracteres.");return;}
    setL(true);setErr("");setInfo("");
    const { session, user, error } = await supaAuth.signUp(em.trim().toLowerCase(), pw, { accion:"crear_taller", nombre:nombre.trim(), taller_nombre:tallerNombre.trim(), logo:logo||"", rol:"admin" });
    if(error){setErr(error);setL(false);return;}
    if(session&&session.access_token) await completarLogin(session, user);
    else { setInfo("¡Taller registrado! Si te pide confirmar el correo, hazlo y luego inicia sesión. Tu código aparecerá en la sección Equipo."); setModo("login"); setL(false); }
  };

  const doUnir = async () => {
    if(!codigo.trim()||!nombre.trim()||!em.trim()||!pw){setErr("Completa todos los campos.");return;}
    if(pw.length<6){setErr("La contraseña debe tener al menos 6 caracteres.");return;}
    setL(true);setErr("");setInfo("");
    const taller = await supaApi.verificarTaller(codigo.trim().toUpperCase());
    if(!taller){ setErr("El código de taller no existe. Verifícalo con tu administrador."); setL(false); return; }
    const { session, user, error } = await supaAuth.signUp(em.trim().toLowerCase(), pw, { accion:"unir", nombre:nombre.trim(), taller_codigo:codigo.trim().toUpperCase(), rol:"asesor" });
    if(error){setErr(error);setL(false);return;}
    if(session&&session.access_token) await completarLogin(session, user);
    else { setInfo("¡Cuenta creada en "+taller.nombre+"! Si te pide confirmar el correo, hazlo y luego inicia sesión."); setModo("login"); setL(false); }
  };

  const submit = () => modo==="login"?doLogin():modo==="crear"?doCrear():doUnir();
  const onKey = e => { if (e.key==="Enter") submit(); };
  const iStyle = { display:"block",width:"100%",boxSizing:"border-box",background:BRAND.bg,border:"0.5px solid "+BRAND.border,borderRadius:9,padding:"0.6rem 0.8rem",color:BRAND.text,fontSize:13,outline:"none",marginBottom:12 };
  const lab = t => <label style={{fontSize:11,color:BRAND.muted,marginBottom:4,display:"block"}}>{t}</label>;
  const cambiarModo = m => { setModo(m); setErr(""); setInfo(""); };

  return (
    <div style={{minHeight:"100vh",background:BRAND.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"1.5rem"}}>
      <div style={{textAlign:"center",marginBottom:28}}>
        <div style={{fontSize:36,fontWeight:900,letterSpacing:3,marginBottom:6}}><span style={{color:BRAND.accent}}>REPAIR</span><span style={{color:BRAND.text}}>X</span></div>
        <div style={{fontSize:12,color:BRAND.muted,letterSpacing:1,textTransform:"uppercase"}}>Gestión inteligente de taller</div>
      </div>

      <div style={{background:BRAND.card2,border:"1px solid "+BRAND.border,borderRadius:16,padding:"1.75rem",width:"100%",maxWidth:380,boxShadow:"0 12px 40px rgba(16,24,40,0.12)"}}>
        {!MODO_DEMO&&(
          <div style={{display:"flex",gap:4,marginBottom:18,background:BRAND.bg,borderRadius:10,padding:3}}>
            {[{k:"login",l:"Entrar"},{k:"crear",l:"Registrar taller"},{k:"unir",l:"Unirme"}].map(t=>(
              <button key={t.k} onClick={()=>cambiarModo(t.k)} style={{flex:1,padding:"7px 4px",fontSize:11,fontWeight:600,borderRadius:8,border:"none",cursor:"pointer",background:modo===t.k?BRAND.accent:"transparent",color:modo===t.k?"#fff":BRAND.muted}}>{t.l}</button>
            ))}
          </div>
        )}

        <div style={{fontSize:15,fontWeight:700,marginBottom:4}}>{modo==="login"?"Iniciar sesión":modo==="crear"?"Registrar un taller":"Unirme a un taller"}</div>
        <div style={{fontSize:12,color:BRAND.muted,marginBottom:18}}>
          {MODO_DEMO?<span style={{color:"#F59E0B"}}>⚠️ Modo demo — configura Supabase para producción</span>
            :modo==="login"?"Ingresa con tu cuenta"
            :modo==="crear"?"Crea tu taller; serás el administrador"
            :"Pide el código a tu administrador"}
        </div>

        {modo==="crear"&&<>
          {lab("Nombre del taller")}
          <input style={iStyle} placeholder="Ej. Taller AutoPro" value={tallerNombre} onChange={e=>setTallerNombre(e.target.value)} onKeyDown={onKey} />
          {lab("Logo del taller (opcional)")}
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
            <div style={{width:56,height:56,borderRadius:12,overflow:"hidden",border:"0.5px solid "+BRAND.border,background:BRAND.bg,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{logo?<img src={logo} alt="logo" style={{width:"100%",height:"100%",objectFit:"cover"}} />:<span style={{fontSize:22}}>🏢</span>}</div>
            <div style={{display:"flex",gap:6}}>
              <button type="button" onClick={()=>logoRef.current?.click()} style={{background:BRAND.accent,color:"#fff",border:"none",borderRadius:9,padding:"0.5rem 0.9rem",fontSize:12,fontWeight:600,cursor:"pointer"}}>Subir logo</button>
              {logo&&<button type="button" onClick={()=>setLogo(null)} style={{background:BRAND.dimmed,color:BRAND.text,border:"none",borderRadius:9,padding:"0.5rem 0.9rem",fontSize:12,cursor:"pointer"}}>Quitar</button>}
            </div>
            <input ref={logoRef} type="file" accept="image/*" style={{display:"none"}} onChange={onLogo} />
          </div>
        </>}
        {modo==="unir"&&<>{lab("Código del taller")}<input style={{...iStyle,letterSpacing:2,textTransform:"uppercase",fontFamily:"monospace"}} placeholder="Ej. AUTOPRO-7F3K" value={codigo} onChange={e=>setCodigo(e.target.value.toUpperCase())} onKeyDown={onKey} /></>}
        {(modo==="crear"||modo==="unir")&&<>{lab("Tu nombre")}<input style={iStyle} placeholder="Nombre y apellido" value={nombre} onChange={e=>setNombre(e.target.value)} onKeyDown={onKey} /></>}

        {lab("Correo electrónico")}
        <input style={iStyle} type="email" placeholder="tu@taller.com" value={em} onChange={e=>setEm(e.target.value)} onKeyDown={onKey} autoComplete="email" />
        {lab("Contraseña")}
        <input style={{...iStyle,marginBottom:18}} type="password" placeholder="••••••••" value={pw} onChange={e=>setPw(e.target.value)} onKeyDown={onKey} autoComplete={modo==="login"?"current-password":"new-password"} />

        {err&&<div style={{background:"#EF444422",border:"0.5px solid #EF444444",borderRadius:8,padding:"8px 12px",fontSize:12,color:"#EF4444",marginBottom:14}}>{err}</div>}
        {info&&<div style={{background:BRAND.green+"22",border:"0.5px solid "+BRAND.green+"44",borderRadius:8,padding:"8px 12px",fontSize:12,color:BRAND.green,marginBottom:14}}>{info}</div>}

        <button style={{width:"100%",background:BRAND.accent,color:"#fff",border:"none",borderRadius:10,padding:"0.75rem",fontSize:14,fontWeight:700,cursor:loading?"not-allowed":"pointer",opacity:loading?0.7:1}} onClick={submit} disabled={loading}>
          {loading?"Procesando...":modo==="login"?"Entrar":modo==="crear"?"Crear taller":"Unirme"}
        </button>
      </div>

      {MODO_DEMO&&(
        <div style={{marginTop:24,width:"100%",maxWidth:380}}>
          <div style={{fontSize:11,color:BRAND.muted,textAlign:"center",marginBottom:10,textTransform:"uppercase",letterSpacing:0.5}}>Cuentas de demostración</div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {DEMOS.map(u=>{const r=ROLES[u.rol]||{label:"",color:BRAND.muted};return(
              <button key={u.id} onClick={()=>{setEm(u.email);setPw(u.pass);}} style={{background:BRAND.card,border:"0.5px solid "+BRAND.border,borderRadius:10,padding:"10px 14px",cursor:"pointer",display:"flex",alignItems:"center",gap:10,textAlign:"left",width:"100%"}}>
                <div style={{width:34,height:34,borderRadius:"50%",background:r.color+"22",border:"1.5px solid "+r.color+"44",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,color:r.color,flexShrink:0}}>{u.av}</div>
                <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:600,color:BRAND.text}}>{u.nombre}</div><div style={{fontSize:10,color:BRAND.muted}}>{r.label} — {u.email}</div></div>
                <span style={{fontSize:10,background:r.color+"22",color:r.color,borderRadius:20,padding:"2px 8px",fontWeight:600,flexShrink:0}}>{r.label}</span>
              </button>
            );})}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Badge usuario ────────────────────────────────────────────────────────────
function UsuarioBadge({ usuario, onLogout }) {
  const [open, setOpen]=useState(false);
  const rol = ROLES[usuario.rol]||{label:"",color:BRAND.muted,permisos:[]};
  return (
    <div style={{position:"relative"}}>
      <button onClick={()=>setOpen(o=>!o)} style={{background:BRAND.card2,border:"0.5px solid "+BRAND.border,borderRadius:20,padding:"4px 10px 4px 6px",cursor:"pointer",display:"flex",alignItems:"center",gap:6}}>
        <div style={{width:26,height:26,borderRadius:"50%",background:rol.color+"22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:rol.color,flexShrink:0}}>{usuario.av}</div>
        <span style={{fontSize:11,color:BRAND.text,fontWeight:600}}>{usuario.nombre.split(" ")[0]}</span>
        <span style={{fontSize:10,background:rol.color+"22",color:rol.color,borderRadius:20,padding:"1px 6px",fontWeight:600}}>{rol.label}</span>
      </button>
      {open&&(
        <>
          <div onClick={()=>setOpen(false)} style={{position:"fixed",inset:0,zIndex:400}} />
          <div style={{position:"absolute",right:0,top:"calc(100% + 6px)",background:BRAND.card2,border:"0.5px solid "+BRAND.border,borderRadius:12,padding:"0.75rem",minWidth:200,zIndex:401,boxShadow:"0 8px 24px #00000066"}}>
            <div style={{fontSize:13,fontWeight:600,marginBottom:2}}>{usuario.nombre}</div>
            <div style={{fontSize:11,color:BRAND.muted,marginBottom:2}}>{usuario.email}</div>
            <div style={{fontSize:11,color:BRAND.muted,marginBottom:2}}>{usuario.tallerNombre||usuario.taller}</div>
            {usuario.taller&&!usuario.modoDemo&&<div style={{fontSize:10,color:BRAND.muted,marginBottom:12}}>Código: <span style={{color:BRAND.accent,fontWeight:700,fontFamily:"monospace"}}>{usuario.taller}</span></div>}
            {(!usuario.taller||usuario.modoDemo)&&<div style={{marginBottom:12}} />}
            <div style={{fontSize:10,color:BRAND.muted,marginBottom:6,textTransform:"uppercase",letterSpacing:0.5}}>Permisos</div>
            {rol.permisos.includes("todo")?<div style={{fontSize:11,color:BRAND.green,marginBottom:12}}>Acceso completo</div>:<div style={{marginBottom:12}}>{rol.permisos.map(p=><div key={p} style={{fontSize:11,color:BRAND.muted,marginBottom:2}}>{p.replace(/_/g," ")}</div>)}</div>}
            <button onClick={()=>{onLogout();setOpen(false);}} style={{width:"100%",background:"#7F1D1D22",color:"#fca5a5",border:"0.5px solid #991b1b44",borderRadius:8,padding:"7px",cursor:"pointer",fontSize:12,fontWeight:500}}>Cerrar sesión</button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Sidebar (drawer en móvil, fijo en escritorio) ─────────────────────────────
function Sidebar({ vista, setVista, setOrdenSel, hLen, tLen, desktop, esAdmin, logo, tallerNombre }) {
  const [open, setOpen] = useState(false);
  const NAV = [
    {id:"dashboard", icon:"📊", label:"Dashboard"},
    {id:"ordenes",   icon:"📋", label:"Órdenes"},
    {id:"terminadas",icon:"🏁", label:"Terminadas"+(tLen?" ("+tLen+")":"")},
    {id:"historial", icon:"🗂️", label:"Historial"+(hLen?" ("+hLen+")":"")},
    {id:"nueva",     icon:"➕", label:"Nueva Orden"},
    {id:"exportar",  icon:"📊", label:"Exportar Excel"},
    ...(esAdmin ? [{id:"equipo", icon:"👥", label:"Equipo"}] : []),
  ];
  const go = id => { setVista(id); setOrdenSel(null); setOpen(false); };
  const panel = (
    <div style={{position:"fixed",top:0,left:0,height:"100%",width:240,background:BRAND.card,borderRight:"0.5px solid "+BRAND.border,zIndex:201,display:"flex",flexDirection:"column",transform:desktop?"none":(open?"translateX(0)":"translateX(-100%)"),transition:desktop?"none":"transform 0.25s ease",boxShadow:(!desktop&&open)?"6px 0 32px #00000099":"none"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"1rem 1.25rem",borderBottom:"0.5px solid "+BRAND.border}}>
        <div>
          <div style={{fontSize:18,fontWeight:900,letterSpacing:2}}><span style={{color:BRAND.accent}}>REPAIR</span><span style={{color:BRAND.text}}>X</span></div>
          <div style={{fontSize:9,color:BRAND.muted,letterSpacing:1,textTransform:"uppercase",marginTop:1}}>Gestión inteligente</div>
        </div>
        {!desktop&&<button onClick={()=>setOpen(false)} style={{background:"none",border:"none",color:BRAND.muted,cursor:"pointer",fontSize:20}}>✕</button>}
      </div>
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"0.85rem 1.25rem",borderBottom:"0.5px solid "+BRAND.border}}>
        {logo?<img src={logo} alt="logo" style={{width:40,height:40,borderRadius:10,objectFit:"cover",border:"0.5px solid "+BRAND.border,flexShrink:0}} />:<div style={{width:40,height:40,borderRadius:10,background:BRAND.bg,border:"0.5px solid "+BRAND.border,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>🏢</div>}
        <div style={{minWidth:0}}><div style={{fontSize:13,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{tallerNombre||"Mi Taller"}</div><div style={{fontSize:10,color:BRAND.muted}}>Taller</div></div>
      </div>
      <div style={{flex:1,paddingTop:"0.5rem",overflowY:"auto"}}>
        {NAV.map(n=>(
          <div key={n.id} style={{display:"flex",alignItems:"center",gap:12,padding:"0.75rem 1.25rem",cursor:"pointer",color:vista===n.id?BRAND.accent:BRAND.muted,background:vista===n.id?"rgba(255,92,53,0.07)":"transparent",borderLeft:vista===n.id?"3px solid "+BRAND.accent:"3px solid transparent",fontSize:13,userSelect:"none",fontWeight:vista===n.id?700:400}} onClick={()=>go(n.id)}>
            <span style={{fontSize:18,flexShrink:0}}>{n.icon}</span><span>{n.label}</span>
          </div>
        ))}
      </div>
      <div style={{padding:"0.85rem 1.25rem",borderTop:"0.5px solid "+BRAND.border}}>
        <div style={{fontSize:10,color:BRAND.muted}}>REPAIRX 2026</div>
        <div style={{fontSize:9,color:BRAND.dimmed,marginTop:2}}>v1.0</div>
      </div>
    </div>
  );
  if (desktop) return panel;
  return (
    <>
      {open&&<div onClick={()=>setOpen(false)} style={{position:"fixed",inset:0,background:"#00000077",zIndex:200,backdropFilter:"blur(2px)"}} />}
      <button onClick={()=>setOpen(o=>!o)} style={{position:"fixed",top:10,left:10,zIndex:300,background:BRAND.card2,border:"0.5px solid "+BRAND.border,borderRadius:10,width:38,height:38,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:4}}>
        <div style={{width:16,height:2,background:BRAND.accent,borderRadius:1}} /><div style={{width:16,height:2,background:BRAND.accent,borderRadius:1}} /><div style={{width:16,height:2,background:BRAND.accent,borderRadius:1}} />
      </button>
      {panel}
    </>
  );
}

// ─── Novedades ────────────────────────────────────────────────────────────────
function Novedades({ orden, ordenes, setOrdenes, setOrdenSel, S }) {
  const [txt,setTxt]=useState(""); const [cat,setCat]=useState("general"); const [fil,setFil]=useState("todos");
  const botRef=useRef();
  const catObj=key=>CATS_NOV.find(c=>c.key===key)||CATS_NOV[4];
  const add=()=>{ if(!txt.trim())return; const nov={id:Date.now(),texto:txt.trim(),categoria:cat,fecha:new Date().toLocaleDateString("es-MX",{day:"2-digit",month:"short",year:"numeric"}),hora:new Date().toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit"}),resuelta:false}; const upd=ordenes.map(x=>x.id===orden.id?{...x,novedades:[...(x.novedades||[]),nov]}:x); setOrdenes(upd); setOrdenSel(upd.find(x=>x.id===orden.id)); setTxt(""); setTimeout(()=>botRef.current?.scrollIntoView({behavior:"smooth"}),50); };
  const toggle=nid=>{ const upd=ordenes.map(x=>x.id===orden.id?{...x,novedades:(x.novedades||[]).map(n=>n.id===nid?{...n,resuelta:!n.resuelta}:n)}:x); setOrdenes(upd); setOrdenSel(upd.find(x=>x.id===orden.id)); };
  const del=nid=>{ if(!confirm("¿Eliminar esta novedad? Esta acción no se puede deshacer."))return; const upd=ordenes.map(x=>x.id===orden.id?{...x,novedades:(x.novedades||[]).filter(n=>n.id!==nid)}:x); setOrdenes(upd); setOrdenSel(upd.find(x=>x.id===orden.id)); };
  const lista=(orden.novedades||[]).filter(n=>fil==="todos"||n.categoria===fil);
  const pend=(orden.novedades||[]).filter(n=>n.categoria==="pendiente"&&!n.resuelta).length;
  return (
    <div style={{display:"flex",flexDirection:"column",gap:10}}>
      <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
        <button onClick={()=>setFil("todos")} style={{...S.btnSm(fil==="todos"?BRAND.accent:null),fontSize:10,padding:"3px 8px"}}>Todos</button>
        {CATS_NOV.map(c=><button key={c.key} onClick={()=>setFil(c.key)} style={{...S.btnSm(fil===c.key?c.color:null),fontSize:10,padding:"3px 8px"}}>{c.label}</button>)}
      </div>
      {pend>0&&<div style={{background:"#EF444422",border:"0.5px solid #EF444444",borderRadius:8,padding:"6px 10px",fontSize:11,color:"#EF4444"}}>{pend} tarea{pend!==1?"s":""} pendiente{pend!==1?"s":""}</div>}
      <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:280,overflowY:"auto"}}>
        {lista.length===0&&<div style={{textAlign:"center",color:BRAND.muted,fontSize:12,padding:"1.5rem 0"}}>Sin novedades</div>}
        {lista.map(n=>{const c=catObj(n.categoria);return(
          <div key={n.id} style={{background:BRAND.bg,borderRadius:10,padding:"0.6rem 0.75rem",borderLeft:"3px solid "+(n.resuelta?BRAND.dimmed:c.color),opacity:n.resuelta?0.55:1}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:5}}>
              <span style={{fontSize:10,color:c.color,fontWeight:600}}>{c.label}{n.resuelta?" - Resuelto":""}</span>
              <div style={{display:"flex",gap:4}}>{n.categoria==="pendiente"&&<button style={{...S.btnSm(n.resuelta?null:BRAND.green),fontSize:10,padding:"2px 6px"}} onClick={()=>toggle(n.id)}>{n.resuelta?"↩":"OK"}</button>}<button style={{...S.btnSm(),fontSize:10,padding:"2px 6px"}} onClick={()=>del(n.id)}>✕</button></div>
            </div>
            <div style={{fontSize:13,color:BRAND.text,lineHeight:1.5,marginBottom:4,whiteSpace:"pre-wrap"}}>{n.texto}</div>
            <div style={{fontSize:10,color:BRAND.muted}}>{n.fecha} {n.hora}</div>
          </div>
        );})}
        <div ref={botRef} />
      </div>
      <div style={{background:BRAND.bg,borderRadius:10,padding:"0.85rem"}}>
        <div style={{fontSize:12,fontWeight:600,color:BRAND.accent,marginBottom:8}}>Nueva novedad</div>
        <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:8}}>{CATS_NOV.map(c=><button key={c.key} onClick={()=>setCat(c.key)} style={{...S.btnSm(cat===c.key?c.color:null),fontSize:10,padding:"3px 8px"}}>{c.label}</button>)}</div>
        <textarea style={{...S.input,minHeight:120,resize:"vertical",fontSize:13,lineHeight:1.5,marginBottom:4}} value={txt} onChange={e=>setTxt(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&(e.ctrlKey||e.metaKey))add();}} placeholder="Escribe una novedad..." />
        <div style={{fontSize:10,color:BRAND.muted,marginBottom:6}}>Ctrl+Enter para enviar</div>
        <button style={{...S.btn,width:"100%",opacity:txt.trim()?1:0.4}} onClick={add} disabled={!txt.trim()}>Agregar novedad</button>
      </div>
    </div>
  );
}

// ─── EditarId ─────────────────────────────────────────────────────────────────
function EditarId({ o, ordenes, setOrdenes, setOrdenSel, fSize, puedeAdmin }) {
  const [edit,setEdit]=useState(false); const [val,setVal]=useState(o.id); const ref=useRef();
  const ok=()=>{ const nv=(val.trim()||o.id); if(nv!==o.id&&ordenes.some(x=>x.id===nv)){alert("Ya existe una orden con ese ID.");return;} const upd=ordenes.map(x=>x.id===o.id?{...x,id:nv}:x); setOrdenes(upd); setOrdenSel(upd.find(x=>x.id===nv)||null); setEdit(false); };
  const cancel=()=>{ setVal(o.id); setEdit(false); };
  useEffect(()=>{ if(edit&&ref.current)ref.current.focus(); },[edit]);
  if (edit) return (
    <div style={{display:"flex",alignItems:"center",gap:4}} onClick={e=>e.stopPropagation()}>
      <input ref={ref} value={val} onChange={e=>setVal(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")ok();if(e.key==="Escape")cancel();}} style={{background:BRAND.bg,border:"1px solid "+BRAND.accent,borderRadius:6,padding:"2px 7px",color:BRAND.accent,fontWeight:700,fontSize:fSize||13,width:Math.max(80,val.length*9)+"px",outline:"none"}} />
      <button onClick={ok} style={{background:BRAND.accent,border:"none",borderRadius:5,color:"#fff",fontSize:11,padding:"2px 7px",cursor:"pointer"}}>OK</button>
      <button onClick={cancel} style={{background:BRAND.dimmed,border:"none",borderRadius:5,color:BRAND.text,fontSize:11,padding:"2px 7px",cursor:"pointer"}}>✕</button>
    </div>
  );
  return (
    <span style={{display:"inline-flex",alignItems:"center",gap:4}}>
      <span style={{color:BRAND.accent,fontWeight:700,fontSize:fSize||13}}>{o.id}</span>
      {puedeAdmin&&<button onClick={e=>{e.stopPropagation();setEdit(true);}} style={{background:"none",border:"none",cursor:"pointer",color:BRAND.muted,fontSize:11,padding:"0 2px"}}>✏️</button>}
    </span>
  );
}

// ─── Campo de fecha: texto + botón de calendario ───────────────────────────────
function CampoFecha({ value, onChange }) {
  const ref = useRef();
  const abrir = () => { const el=ref.current; if(!el)return; try{ el.showPicker(); }catch{ el.focus(); } };
  return (
    <div style={{position:"relative"}}>
      <input ref={ref} type="date" value={value||""} onChange={e=>onChange(e.target.value)}
        style={{background:BRAND.bg,border:"0.5px solid "+BRAND.border,borderRadius:9,padding:"0.5rem 2.2rem 0.5rem 0.8rem",color:BRAND.text,fontSize:12,width:"100%",boxSizing:"border-box"}} />
      <button type="button" onClick={abrir} title="Abrir calendario" style={{position:"absolute",right:2,top:0,height:"100%",background:"none",border:"none",cursor:"pointer",color:BRAND.accent,fontSize:15,padding:"0 8px"}}>📅</button>
    </div>
  );
}

// ─── Subcomponentes de Ficha (fuera del render para no perder el foco) ──────────
function RowFicha({ l, v }) {
  return <div style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:"0.5px solid "+BRAND.border+"44",fontSize:12}}><span style={{color:BRAND.muted}}>{l}</span><span style={{fontWeight:500}}>{v}</span></div>;
}
function SecFicha({ title, children }) {
  return <div style={{background:BRAND.bg,borderRadius:10,padding:"0.85rem"}}><div style={{fontSize:11,fontWeight:700,color:BRAND.accent,textTransform:"uppercase",letterSpacing:0.5,marginBottom:10}}>{title}</div>{children}</div>;
}

// ─── FichaDetalle ─────────────────────────────────────────────────────────────
function FichaDetalle({ o, ordenes, setOrdenes, setOrdenSel, S }) {
  const [editando,setEditando]=useState(false);
  const [d,setD]=useState({});
  // Cargar datos solo al entrar a edición (no en cada render)
  useEffect(() => {
    if (editando) setD({
      fechaPrimerIngreso:o.fechaPrimerIngreso||"",fechaProgramacion:o.fechaProgramacion||"",fechaReingreso:o.fechaReingreso||"",fechaInicioReparacion:o.fechaInicioReparacion||"",fechaPromesaEntrega:o.fechaPromesaEntrega||"",fechaEntregaReal:o.fechaEntregaReal||"",refaccionesCompletas:o.refaccionesCompletas||"",perfilManoObra:o.perfilManoObra||"",perfilPintura:o.perfilPintura||"",perfilMecanica:o.perfilMecanica||"",clienteEspecial:o.clienteEspecial||false,tipoClienteEspecial:o.tipoClienteEspecial||"",deducible:o.deducible||"",anioAtencion:o.anioAtencion||"",mesAtencion:o.mesAtencion||"",diaAtencion:o.diaAtencion||"",costoManoObra:o.costoManoObra||"",costoRefacciones:o.costoRefacciones||"",montoReparacionInterna:o.montoReparacionInterna||"",montoTOT:o.montoTOT||"",
    });
  }, [editando]);
  const set = (k,v) => setD(p=>({...p,[k]:v}));
  const guardar=()=>{ const upd=ordenes.map(x=>x.id===o.id?{...x,...d}:x); setOrdenes(upd); setOrdenSel(upd.find(x=>x.id===o.id)); setEditando(false); };
  const fld=v=>v||"—"; const cur=v=>v?"$"+Number(v).toLocaleString():"—";
  const MESES=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  const TIPES=["Alto perfil","Influencer","Político","Empresa grande","Agencia","VIP","Otro"];
  const totalC=[d.costoManoObra,d.costoRefacciones,d.montoTOT].reduce((a,v)=>a+(parseFloat(v)||0),0);
  const inN=(k,ph)=><input type="number" style={{...S.input,fontSize:12}} placeholder={ph||"0"} value={d[k]||""} onChange={e=>set(k,e.target.value)} />;
  return (
    <div>
      {o.clienteEspecial&&!editando&&<div style={{background:BRAND.purple+"11",border:"1.5px solid "+BRAND.purple,borderRadius:10,padding:"10px 16px",marginBottom:14}}><div style={{fontWeight:700,color:BRAND.purple,fontSize:13}}>Cliente Especial</div><div style={{fontSize:12,color:BRAND.muted}}>{o.tipoClienteEspecial||"Sin clasificar"}</div></div>}
      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:12}}>{editando?<div style={{display:"flex",gap:8}}><button style={{...S.btn,fontSize:12}} onClick={guardar}>Guardar</button><button style={{...S.btnSm(),fontSize:12,padding:"6px 12px"}} onClick={()=>setEditando(false)}>Cancelar</button></div>:<button style={{...S.btnSm(BRAND.blue),fontSize:12,padding:"6px 14px"}} onClick={()=>setEditando(true)}>Editar ficha</button>}</div>
      {editando?(
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <SecFicha title="Fechas">
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>{[{k:"fechaPrimerIngreso",l:"Primer ingreso"},{k:"fechaProgramacion",l:"Programación"},{k:"fechaReingreso",l:"Reingreso"},{k:"fechaInicioReparacion",l:"Inicio reparación"},{k:"fechaPromesaEntrega",l:"Promesa entrega"},{k:"fechaEntregaReal",l:"Entrega real"},{k:"refaccionesCompletas",l:"Refacciones completas"}].map(({k,l})=><div key={k}><label style={S.label}>{l}</label><CampoFecha value={d[k]} onChange={v=>set(k,v)} /></div>)}</div>
            <div style={{background:BRAND.card2,borderRadius:8,padding:"8px 10px",display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:10}}><span style={{fontSize:11,color:BRAND.muted}}>Días en taller</span><span style={{fontWeight:800,fontSize:22,color:BRAND.accent}}>{cDias(d.fechaPrimerIngreso)}</span></div>
          </SecFicha>
          <SecFicha title="Perfiles y Financiero">
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <div><label style={S.label}>Perfil mano de obra</label><input style={{...S.input,fontSize:12}} value={d.perfilManoObra||""} onChange={e=>set("perfilManoObra",e.target.value)} /></div>
              <div><label style={S.label}>Perfil pintura</label><input style={{...S.input,fontSize:12}} value={d.perfilPintura||""} onChange={e=>set("perfilPintura",e.target.value)} /></div>
              <div><label style={S.label}>Perfil mecánica</label><input style={{...S.input,fontSize:12}} value={d.perfilMecanica||""} onChange={e=>set("perfilMecanica",e.target.value)} /></div>
              <div><label style={S.label}>Deducible ($)</label>{inN("deducible")}</div>
              <div><label style={S.label}>Año atención</label><input style={{...S.input,fontSize:12}} maxLength={4} value={d.anioAtencion||""} onChange={e=>set("anioAtencion",e.target.value)} /></div>
              <div><label style={S.label}>Mes atención</label><select style={{...S.select,fontSize:12}} value={d.mesAtencion||""} onChange={e=>set("mesAtencion",e.target.value)}><option value="">Seleccionar</option>{MESES.map(m=><option key={m}>{m}</option>)}</select></div>
              <div><label style={S.label}>Día atención</label><input type="number" style={{...S.input,fontSize:12}} min="1" max="31" value={d.diaAtencion||""} onChange={e=>set("diaAtencion",e.target.value)} /></div>
            </div>
          </SecFicha>
          <SecFicha title="Costos y Cliente">
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
              <div><label style={S.label}>Mano de obra ($)</label>{inN("costoManoObra")}</div>
              <div><label style={S.label}>Refacciones ($)</label>{inN("costoRefacciones")}</div>
              <div><label style={S.label}>Rep. interna ($)</label>{inN("montoReparacionInterna")}</div>
              <div><label style={S.label}>TOT proveedor ($)</label>{inN("montoTOT")}</div>
            </div>
            <div style={{background:BRAND.card2,borderRadius:8,padding:"8px 10px",marginBottom:12,display:"flex",justifyContent:"space-between"}}><span style={{fontSize:11,color:BRAND.muted}}>Total calculado</span><span style={{fontWeight:800,fontSize:16,color:BRAND.green}}>${totalC.toLocaleString()}</span></div>
            <div style={{background:BRAND.purple+"11",border:"0.5px solid "+BRAND.purple+"44",borderRadius:8,padding:"10px"}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}><input type="checkbox" id="ce" checked={!!d.clienteEspecial} onChange={e=>set("clienteEspecial",e.target.checked)} style={{width:16,height:16,accentColor:BRAND.purple}} /><label htmlFor="ce" style={{fontSize:13,color:BRAND.purple,fontWeight:600,cursor:"pointer"}}>Cliente Especial</label></div>
              {d.clienteEspecial&&<div><label style={S.label}>Tipo</label><select style={{...S.select,fontSize:12}} value={d.tipoClienteEspecial||""} onChange={e=>set("tipoClienteEspecial",e.target.value)}><option value="">Seleccionar</option>{TIPES.map(t=><option key={t}>{t}</option>)}</select></div>}
            </div>
          </SecFicha>
        </div>
      ):(
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <SecFicha title="Fechas"><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"4px 24px"}}><RowFicha l="Primer ingreso" v={fld(o.fechaPrimerIngreso)} /><RowFicha l="Programación" v={fld(o.fechaProgramacion)} /><RowFicha l="Reingreso" v={fld(o.fechaReingreso)} /><RowFicha l="Inicio reparación" v={fld(o.fechaInicioReparacion)} /><RowFicha l="Promesa entrega" v={fld(o.fechaPromesaEntrega)} /><RowFicha l="Entrega real" v={fld(o.fechaEntregaReal)} /><RowFicha l="Refacciones compl." v={fld(o.refaccionesCompletas)} /></div><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:12,padding:"8px 10px",background:BRAND.card2,borderRadius:8}}><span style={{fontSize:11,color:BRAND.muted}}>Días en taller</span><span style={{fontWeight:800,fontSize:24,color:BRAND.accent}}>{cDias(o.fechaPrimerIngreso)}</span></div></SecFicha>
          <SecFicha title="Perfiles y Financiero"><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"4px 24px"}}><RowFicha l="Perfil mano de obra" v={fld(o.perfilManoObra)} /><RowFicha l="Perfil pintura" v={fld(o.perfilPintura)} /><RowFicha l="Perfil mecánica" v={fld(o.perfilMecanica)} /><RowFicha l="Deducible" v={cur(o.deducible)} /><RowFicha l="Año atención" v={fld(o.anioAtencion)} /><RowFicha l="Mes atención" v={fld(o.mesAtencion)} /><RowFicha l="Día atención" v={fld(o.diaAtencion)} /></div></SecFicha>
          <SecFicha title="Costos"><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"4px 24px"}}><RowFicha l="Mano de obra" v={cur(o.costoManoObra)} /><RowFicha l="Refacciones" v={cur(o.costoRefacciones)} /><RowFicha l="Rep. interna" v={cur(o.montoReparacionInterna)} /><RowFicha l="TOT (proveedor)" v={cur(o.montoTOT)} /></div><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:12,padding:"8px 10px",background:BRAND.card2,borderRadius:8}}><span style={{fontSize:11,color:BRAND.muted}}>Total calculado</span><span style={{fontWeight:800,fontSize:20,color:BRAND.green}}>${[o.costoManoObra,o.costoRefacciones,o.montoTOT].reduce((a,v)=>a+(parseFloat(v)||0),0).toLocaleString()}</span></div></SecFicha>
        </div>
      )}
    </div>
  );
}

// ─── ExportarExcel ────────────────────────────────────────────────────────────
function ExportarExcel({ ordenes, S }) {
  const [taller,setTaller]=useState("Mi Taller"); const [fuente,setFuente]=useState("todas"); const [ok,setOk]=useState(false);
  const pV=v=>{const p=v.trim().split(" ");const a=p.length&&/^\d{4}$/.test(p[p.length-1])?p.pop():"";const m=p.shift()||"";return{marca:m,modelo:p.join(" "),anio:a};};
  const diasT=o=>{const b=o.fechaReingreso||o.fechaPrimerIngreso;const f=o.fechaEntregaReal||o.fechaPromesaEntrega;if(!b)return"";if(!f)return cDias(b).toString();return Math.max(0,Math.floor((new Date(f)-new Date(b))/86400000)).toString();};
  const COLS=[
    {h:"Taller",v:o=>taller},{h:"Marca",v:o=>pV(o.vehiculo).marca},{h:"ModeloVehiculo",v:o=>pV(o.vehiculo).modelo},{h:"Anio",v:o=>pV(o.vehiculo).anio},{h:"Siniestro",v:o=>o.siniestro||""},{h:"CantPiezas",v:()=>""},{h:"FechaPrimerIngreso",v:o=>o.fechaPrimerIngreso||""},{h:"FechaProgramacion",v:o=>o.fechaProgramacion||""},{h:"FechaReingreso",v:o=>o.fechaReingreso||""},{h:"FechaInicioReparacion",v:o=>o.fechaInicioReparacion||""},{h:"FechaPromesaEntrega",v:o=>o.fechaPromesaEntrega||""},{h:"FechaEntrega",v:o=>o.fechaEntregaReal||""},{h:"FechaRefaccionesCompletas",v:o=>o.refaccionesCompletas||""},{h:"DiasEnTaller",v:o=>diasT(o)},{h:"PerfilManoObra",v:o=>o.perfilManoObra||""},{h:"PerfilPintura",v:o=>o.perfilPintura||""},{h:"PerfilMecanica",v:o=>o.perfilMecanica||""},{h:"Placas",v:o=>o.placa||""},{h:"Serie",v:o=>o.serie||""},{h:"AnioAtencion",v:o=>o.anioAtencion||""},{h:"MesAtencion",v:o=>o.mesAtencion||""},{h:"DiaAtencion",v:o=>o.diaAtencion||""},{h:"CostoManoObra",v:o=>o.costoManoObra||""},{h:"CostoRefacciones",v:o=>o.costoRefacciones||""},{h:"MontoReparacionInterna",v:o=>o.montoReparacionInterna||""},{h:"MontoTOT",v:o=>o.montoTOT||""},{h:"OrdenId",v:o=>o.id||""},{h:"Cliente",v:o=>o.cliente||""},{h:"Tecnico",v:o=>o.tecnico||""},{h:"Estado",v:o=>o.estado||""},{h:"Deducible",v:o=>o.deducible||""},{h:"ClienteEspecial",v:o=>o.clienteEspecial?"SI":"NO"},{h:"TipoClienteEspecial",v:o=>o.tipoClienteEspecial||""},
  ];
  const filt=fuente==="todas"?ordenes:fuente==="activas"?ordenes.filter(o=>!o.fechaCierre&&!o.fechaPago&&!o.fechaTerminado):fuente==="cobradas"?ordenes.filter(o=>!!o.fechaPago):fuente==="terminadas"?ordenes.filter(o=>!!o.fechaTerminado):ordenes.filter(o=>!!o.fechaCierre);
  const esc=v=>{const s=String(v).replace(/\t/g," ");return(s.includes(",")||s.includes('"')||s.includes("\n"))?'"'+s.replace(/"/g,'""')+'"':s;};
  const exportar=()=>{const tsv=[COLS.map(c=>c.h).join("\t"),...filt.map(o=>COLS.map(c=>esc(c.v(o))).join("\t"))].join("\n");const blob=new Blob(["\uFEFF"+tsv],{type:"text/tab-separated-values;charset=utf-8;"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="REPAIRX_"+hoy()+".xls";a.click();URL.revokeObjectURL(url);setOk(true);setTimeout(()=>setOk(false),2500);};
  return (
    <div style={{maxWidth:780,display:"flex",flexDirection:"column",gap:14}}>
      <div style={S.card}>
        <div style={{fontSize:13,fontWeight:700,color:BRAND.green,marginBottom:12}}>Configuración de exportación</div>
        <label style={S.label}>Nombre del taller</label>
        <input style={{...S.input,marginBottom:12}} value={taller} onChange={e=>setTaller(e.target.value)} />
        <label style={S.label}>Órdenes a incluir</label>
        <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:14}}>{[{k:"todas",l:"Todas"},{k:"activas",l:"Solo activas"},{k:"cobradas",l:"Solo cobradas"},{k:"terminadas",l:"Solo terminadas"},{k:"historial",l:"Solo historial"}].map(op=><label key={op.k} style={{display:"flex",alignItems:"center",gap:8,fontSize:13,cursor:"pointer",color:fuente===op.k?BRAND.green:BRAND.muted}}><input type="radio" name="fuente" checked={fuente===op.k} onChange={()=>setFuente(op.k)} style={{accentColor:BRAND.green}} />{op.l}</label>)}</div>
        <div style={{background:BRAND.bg,borderRadius:8,padding:"10px 12px",marginBottom:14,display:"flex",justifyContent:"space-between",alignItems:"center"}}><span style={{fontSize:12,color:BRAND.muted}}>Órdenes seleccionadas</span><span style={{fontSize:20,fontWeight:800,color:BRAND.green}}>{filt.length}</span></div>
        <button style={{...S.btnGreen,width:"100%",fontSize:14,padding:"0.7rem"}} onClick={exportar} disabled={filt.length===0}>{ok?"✅ Archivo descargado":"📥 Descargar Excel (.xls)"}</button>
        <div style={{fontSize:11,color:BRAND.muted,marginTop:6,textAlign:"center"}}>Compatible con Excel y Google Sheets</div>
      </div>
    </div>
  );
}

// ─── OrdenExpandida ───────────────────────────────────────────────────────────
function OrdenExpandida({ o, ordenes, setOrdenes, setOrdenSel, tabDetalle, setTabDetalle, avanzarEstado, setModalRetroceder, setModalCerrar, setModalCobro, setModalTerminar, fotoRef, docRef, docTipo, setDocTipo, docNombre, setDocNombre, agregarFotos, eliminarFoto, agregarDoc, eliminarDoc, setFotoAmpliada, usuario }) {
  const S=mkS(); const idx=PASOS.indexOf(o.estado); const eAct=ESTADOS.find(e=>e.key===o.estado)||ESTADOS[0];
  const puedeEdit=puedePerm(usuario,"editar_ordenes"); const puedeAdmin=puedePerm(usuario,"todo");
  return (
    <div style={{background:BRAND.card,borderRadius:14,border:"0.5px solid "+BRAND.border,overflow:"hidden"}}>
      <div style={{padding:"0.75rem 1rem",background:BRAND.bg,borderBottom:"0.5px solid "+BRAND.border}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
          {o.fotoPrincipal?<img src={o.fotoPrincipal} alt="v" style={{width:36,height:28,objectFit:"cover",borderRadius:6,border:"0.5px solid "+BRAND.border,flexShrink:0}} />:<div style={{width:36,height:28,background:BRAND.card2,borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>🚗</div>}
          <div style={{flex:1,minWidth:0}}><div style={{display:"flex",alignItems:"center",gap:6}}><EditarId o={o} ordenes={ordenes} setOrdenes={setOrdenes} setOrdenSel={setOrdenSel} fSize={14} puedeAdmin={puedeAdmin} /><span style={{fontSize:13,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{o.cliente}</span></div><div style={{fontSize:10,color:BRAND.muted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginTop:1}}>{o.vehiculo} - {o.placa}{o.telefono?" - "+o.telefono:""}</div></div>
          <span style={{background:eAct.color+"22",color:eAct.color,border:"0.5px solid "+eAct.color+"44",borderRadius:20,padding:"3px 8px",fontSize:10,fontWeight:700,flexShrink:0}}>{eAct.label}</span>
        </div>
        <div style={{display:"flex",gap:2,marginBottom:8}}>{ESTADOS.map((es,i)=><div key={es.key} style={{flex:1}}><div style={{height:3,borderRadius:2,background:i<idx?BRAND.accent:i===idx?BRAND.accent+"66":BRAND.dimmed,marginBottom:2}} /><div style={{fontSize:7,color:i===idx?BRAND.accent:i<idx?BRAND.muted:BRAND.dimmed,textAlign:"center",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{es.label.split(" ")[0]}</div></div>)}</div>
        {puedeEdit&&<div style={{display:"flex"}}>{o.estado!=="armado"?<button style={{...S.btn,flex:1,padding:"9px",fontSize:13}} onClick={()=>avanzarEstado(o.id)}>Avanzar al siguiente paso</button>:<button style={{...S.btnGreen,flex:1,padding:"9px",fontSize:13}} onClick={()=>setModalCobro(o)}>Enviar a cobro</button>}</div>}
      </div>
      <div style={{borderBottom:"0.5px solid "+BRAND.border,background:BRAND.card}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)"}}>{[{k:"info",l:"📋 Info"},{k:"fotos",l:"📷 Fotos"+(o.fotos?.length?" ("+o.fotos.length+")":"")},{k:"docs",l:"📁 Docs"+(o.documentos?.length?" ("+o.documentos.length+")":"")},{k:"ficha",l:"📑 Ficha"},{k:"novedades",l:"💬 Nov"+(o.novedades?.length?" ("+o.novedades.length+")":"")},{k:"bitacora",l:"📝 Bitácora"}].map((t,i)=><button key={t.k} style={{padding:"10px 6px",fontSize:12,cursor:"pointer",color:tabDetalle===t.k?BRAND.accent:BRAND.muted,background:tabDetalle===t.k?BRAND.accent+"0D":"none",border:"none",borderBottom:tabDetalle===t.k?"2px solid "+BRAND.accent:"2px solid transparent",borderRight:i%3!==2?"0.5px solid "+BRAND.border:"none",fontWeight:tabDetalle===t.k?700:400,textAlign:"center"}} onClick={()=>setTabDetalle(t.k)}>{t.l}</button>)}</div>
        <button onClick={()=>setOrdenSel(null)} style={{width:"100%",padding:"7px",fontSize:11,cursor:"pointer",color:BRAND.muted,background:"none",border:"none",borderTop:"0.5px solid "+BRAND.border,textAlign:"center"}}>← Volver a lista</button>
      </div>
      <div style={{padding:"1rem"}}>
        {tabDetalle==="info"&&(
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <div style={{background:BRAND.bg,borderRadius:10,padding:"0.85rem"}}>
              <div style={{fontSize:11,color:BRAND.muted,fontWeight:600,textTransform:"uppercase",letterSpacing:0.5,marginBottom:8}}>Vehículo</div>
              <div style={{fontSize:14,fontWeight:700,marginBottom:8}}>{o.vehiculo}</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"6px 16px"}}>{[{l:"Placa",v:o.placa},{l:"Color",v:o.color},{l:"Técnico",v:o.tecnico},{l:"Servicio",v:o.servicio},{l:"Ingreso",v:o.fecha},{l:"Entrega",v:o.entrega}].map(({l,v})=><div key={l}><div style={{fontSize:10,color:BRAND.muted}}>{l}</div><div style={{fontSize:12,fontWeight:500}}>{v||"—"}</div></div>)}</div>
              {o.serie&&<div style={{marginTop:10,paddingTop:10,borderTop:"0.5px solid "+BRAND.border}}><div style={{fontSize:10,color:BRAND.muted,marginBottom:2}}>No. de Serie (VIN)</div><div style={{fontSize:11,fontFamily:"monospace",letterSpacing:1,color:BRAND.accent}}>{o.serie}</div></div>}
              {o.siniestro&&<div style={{marginTop:8}}><div style={{fontSize:10,color:BRAND.muted,marginBottom:2}}>No. de Siniestro</div><div style={{fontSize:12,color:BRAND.blue,fontWeight:600}}>{o.siniestro}</div></div>}
              {o.notas&&<div style={{marginTop:8,background:BRAND.card2,borderRadius:7,padding:"7px 10px",fontSize:12,color:BRAND.muted,fontStyle:"italic"}}>{o.notas}</div>}
            </div>
            <div style={{background:BRAND.bg,borderRadius:10,padding:"0.85rem"}}><div style={{fontSize:11,color:BRAND.muted,fontWeight:600,textTransform:"uppercase",letterSpacing:0.5,marginBottom:8}}>Progreso</div>{ESTADOS.map((es,i)=><div key={es.key} style={{display:"flex",alignItems:"center",gap:10,padding:"5px 0",borderBottom:i<ESTADOS.length-1?"0.5px solid "+BRAND.border+"33":"none"}}><div style={{width:18,height:18,borderRadius:"50%",background:i<idx?BRAND.accent:i===idx?BRAND.accent+"22":BRAND.dimmed,border:i===idx?"1.5px solid "+BRAND.accent:"none",display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,color:i<idx?"#fff":i===idx?BRAND.accent:BRAND.muted,fontWeight:700,flexShrink:0}}>{i<idx?"✓":i+1}</div><span style={{fontSize:12,color:i===idx?BRAND.accent:i<idx?BRAND.text:BRAND.muted,fontWeight:i===idx?700:400}}>{es.label}</span></div>)}</div>
            {o.costo>0&&<div style={{background:BRAND.bg,borderRadius:10,padding:"0.85rem",display:"flex",justifyContent:"space-between",alignItems:"center"}}><span style={{fontSize:12,color:BRAND.muted}}>Costo estimado</span><span style={{fontSize:17,fontWeight:800,color:BRAND.green}}>${o.costo.toLocaleString()}</span></div>}
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>{puedeEdit&&idx>0&&<button style={{flex:1,background:BRAND.blue+"11",color:BRAND.blue,border:"0.5px solid "+BRAND.blue+"33",borderRadius:8,padding:"9px 8px",cursor:"pointer",fontSize:12,fontWeight:500}} onClick={()=>setModalRetroceder(o)}>Retroceder (supervisor)</button>}{puedeAdmin&&<button style={{flex:1,background:"#7F1D1D22",color:"#fca5a5",border:"0.5px solid #991b1b33",borderRadius:8,padding:"9px 8px",cursor:"pointer",fontSize:12,fontWeight:500}} onClick={()=>setModalCerrar(o)}>Cerrar orden</button>}</div>
            {puedeEdit&&<button style={{width:"100%",background:BRAND.green+"11",color:BRAND.green,border:"1.5px solid "+BRAND.green+"55",borderRadius:8,padding:"10px",cursor:"pointer",fontSize:13,fontWeight:700}} onClick={()=>setModalTerminar(o)}>Marcar siniestro como terminado</button>}
          </div>
        )}
        {tabDetalle==="fotos"&&(
          <div>
            <div style={{border:"1.5px dashed "+BRAND.border,borderRadius:10,padding:"0.85rem",textAlign:"center",cursor:"pointer",background:BRAND.bg,marginBottom:12}} onClick={()=>fotoRef.current?.click()}><div style={{fontSize:12,color:BRAND.muted}}>📷 Subir fotos del vehículo</div></div>
            <input ref={fotoRef} type="file" accept="image/*" multiple style={{display:"none"}} onChange={ev=>agregarFotos(ev.target.files)} />
            {(!o.fotos||o.fotos.length===0)&&<div style={{color:BRAND.muted,fontSize:13,textAlign:"center",padding:"1.5rem 0"}}>Sin fotos aún</div>}
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(100px,1fr))",gap:8}}>{(o.fotos||[]).map(f=><div key={f.id} style={{position:"relative",aspectRatio:"4/3",borderRadius:8,overflow:"hidden",border:"0.5px solid "+BRAND.border}}><img src={f.url} alt={f.nombre} style={{width:"100%",height:"100%",objectFit:"cover",cursor:"pointer"}} onClick={()=>setFotoAmpliada(f)} /><button onClick={()=>eliminarFoto(f.id)} style={{position:"absolute",top:4,right:4,background:"#000a",border:"none",color:"#fff",borderRadius:"50%",width:20,height:20,cursor:"pointer",fontSize:11,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button></div>)}</div>
          </div>
        )}
        {tabDetalle==="docs"&&(
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <div style={{background:BRAND.bg,borderRadius:10,padding:"0.85rem"}}>
              <div style={{fontSize:12,fontWeight:600,color:BRAND.accent,marginBottom:10}}>Agregar Documento</div>
              <label style={S.label}>Tipo</label><select style={{...S.select,marginBottom:8,fontSize:12}} value={docTipo} onChange={e=>setDocTipo(e.target.value)}>{TIPOS_DOC.map(t=><option key={t.key} value={t.key}>{t.label}</option>)}</select>
              <label style={S.label}>Nombre (opcional)</label><input style={{...S.input,marginBottom:10,fontSize:12}} placeholder="Ej. Valuación Zurich" value={docNombre} onChange={e=>setDocNombre(e.target.value)} />
              <button style={{...S.btn,width:"100%",fontSize:12}} onClick={()=>docRef.current?.click()}>📎 Seleccionar archivo</button>
              <input ref={docRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.png" style={{display:"none"}} onChange={ev=>{if(ev.target.files.length)agregarDoc(ev.target.files);ev.target.value="";}} />
            </div>
            <div style={{background:BRAND.bg,borderRadius:10,padding:"0.85rem"}}>
              <div style={{fontSize:12,fontWeight:600,color:BRAND.muted,marginBottom:10}}>Documentos adjuntos {(o.documentos||[]).length>0&&<span style={{background:BRAND.card2,borderRadius:10,padding:"1px 8px",fontSize:11,color:BRAND.accent}}>{o.documentos.length}</span>}</div>
              {(!o.documentos||o.documentos.length===0)?<div style={{textAlign:"center",color:BRAND.muted,fontSize:12,padding:"1.5rem 0"}}>Sin documentos adjuntos</div>:TIPOS_DOC.map(t=>{const docs=(o.documentos||[]).filter(d=>d.tipo===t.key);if(!docs.length)return null;return(<div key={t.key} style={{marginBottom:12}}><div style={{fontSize:11,color:BRAND.muted,marginBottom:6}}>{t.label} ({docs.length})</div>{docs.map(d=><div key={d.id} style={{display:"flex",alignItems:"center",gap:8,background:BRAND.card2,borderRadius:8,padding:"0.55rem 0.75rem",marginBottom:6}}><div style={{width:28,height:28,borderRadius:5,background:BRAND.dimmed,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700,color:BRAND.accent,flexShrink:0}}>{d.ext}</div><div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.nombre}</div><div style={{fontSize:10,color:BRAND.muted}}>{d.fecha} - {d.size}</div></div><div style={{display:"flex",gap:4,flexShrink:0}}><a href={d.url} download={d.archivo} target="_blank" rel="noreferrer" style={{...S.btnSm(BRAND.blue),textDecoration:"none",display:"inline-block"}}>⬇</a><button style={S.btnSm()} onClick={()=>eliminarDoc(d.id)}>✕</button></div></div>)}</div>);})}
            </div>
          </div>
        )}
        {tabDetalle==="ficha"&&<FichaDetalle o={o} ordenes={ordenes} setOrdenes={setOrdenes} setOrdenSel={setOrdenSel} S={S} />}
        {tabDetalle==="novedades"&&<Novedades orden={o} ordenes={ordenes} setOrdenes={setOrdenes} setOrdenSel={setOrdenSel} S={S} />}
        {tabDetalle==="bitacora"&&<div><div style={{fontSize:12,color:BRAND.muted,marginBottom:12}}>Historial de cambios</div>{(o.bitacora||[]).slice().reverse().map((b,i)=><div key={i} style={{display:"flex",gap:12,marginBottom:14,alignItems:"flex-start"}}><div style={{width:8,height:8,borderRadius:"50%",background:BRAND.accent,marginTop:5,flexShrink:0}} /><div><div style={{fontSize:13,fontWeight:500}}>{b.accion}</div><div style={{fontSize:11,color:BRAND.muted}}>{b.usuario} - {b.fecha}</div></div></div>)}</div>}
      </div>
    </div>
  );
}

// ─── Tarjeta de orden (reutilizable en listas y resultados de búsqueda) ─────────
function TarjetaOrden({ o, ordenes, setOrdenes, setOrdenSel, onClick, badge }) {
  const S=mkS(); const e=ESTADOS.find(x=>x.key===o.estado)||ESTADOS[0]; const idx=PASOS.indexOf(o.estado);
  return (
    <div style={{...S.card,cursor:"pointer",padding:"0.85rem"}} onClick={onClick}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
        {o.fotoPrincipal?<img src={o.fotoPrincipal} style={{width:48,height:36,objectFit:"cover",borderRadius:7,flexShrink:0}} alt="v" />:<div style={{width:48,height:36,background:BRAND.bg,borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>🚗</div>}
        <div style={{flex:1,minWidth:0}}><div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2,flexWrap:"wrap"}}><span style={{fontSize:12,fontWeight:700,color:BRAND.accent}}>{o.id}</span><span style={{fontSize:13,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{o.cliente}</span></div><div style={{fontSize:11,color:BRAND.muted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{o.vehiculo}</div></div>
        {badge?<span style={{flexShrink:0,background:BRAND.muted+"22",color:BRAND.muted,borderRadius:20,padding:"2px 8px",fontSize:10,fontWeight:600}}>{badge}</span>:<span style={{flexShrink:0,background:e.color+"18",color:e.color,border:"0.5px solid "+e.color+"44",borderRadius:20,padding:"2px 8px",fontSize:10,fontWeight:500}}>{e.label}</span>}
      </div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>{o.placa&&<span style={{fontSize:10,background:BRAND.bg,color:BRAND.muted,borderRadius:5,padding:"2px 7px"}}>{o.placa}</span>}{o.tecnico&&<span style={{fontSize:10,background:BRAND.bg,color:BRAND.muted,borderRadius:5,padding:"2px 7px"}}>{o.tecnico}</span>}{o.costo>0&&<span style={{fontSize:10,background:BRAND.green+"11",color:BRAND.green,border:"0.5px solid "+BRAND.green+"33",borderRadius:5,padding:"2px 7px"}}>${o.costo.toLocaleString()}</span>}{o.siniestro&&<span style={{fontSize:10,background:BRAND.blue+"11",color:BRAND.blue,border:"0.5px solid "+BRAND.blue+"33",borderRadius:5,padding:"2px 7px"}}>{o.siniestro}</span>}</div>
      <div style={{display:"flex",gap:2}}>{PASOS.map((p,j)=><div key={p} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2}}><div style={{height:3,width:"100%",borderRadius:2,background:j<idx?BRAND.accent:j===idx?BRAND.accent+"55":BRAND.dimmed}} /><span style={{fontSize:8,color:j===idx?BRAND.accent:j<idx?BRAND.muted:BRAND.dimmed,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:"100%",textAlign:"center"}}>{ESTADOS[j].label.split(" ")[0]}</span></div>)}</div>
    </div>
  );
}

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
  const S = mkS();
  const desktop = useDesktop();
  const [usuario, setUsuario] = useState(null);
  const [iniciando, setIniciando] = useState(true);

  // Al arrancar: recuperar sesión guardada y validarla con Supabase
  useEffect(() => {
    const u = leerSesion();
    if (!u) { setIniciando(false); return; }
    if (u.modoDemo) { setUsuario(u); setIniciando(false); return; }
    // Refrescar el token por si expiró mientras la app estaba cerrada
    if (u.refreshToken) {
      supaAuth.refreshSession(u.refreshToken).then(({ session, error }) => {
        if (error || !session?.access_token) { borrarSesion(); setIniciando(false); return; }
        setUsuario({ ...u, token:session.access_token, refreshToken:session.refresh_token, expiresAt:Date.now()+(session.expires_in||3600)*1000 });
        setIniciando(false);
      }).catch(() => { borrarSesion(); setIniciando(false); });
    } else { setUsuario(u); setIniciando(false); }
  }, []);

  // Guardar la sesión cada vez que cambia el usuario
  useEffect(() => { if (usuario) guardarSesion(usuario); }, [usuario]);

  useEffect(() => {
    if (!usuario || usuario.modoDemo || !usuario.refreshToken) return;
    const ms = usuario.expiresAt - Date.now() - 60_000;
    if (ms <= 0) return;
    const t = setTimeout(async () => {
      const { session, error } = await supaAuth.refreshSession(usuario.refreshToken);
      if (error) { handleLogout(); return; }
      setUsuario(u => ({ ...u, token:session.access_token, refreshToken:session.refresh_token, expiresAt:Date.now()+(session.expires_in||3600)*1000 }));
    }, ms);
    return () => clearTimeout(t);
  }, [usuario]);

  const handleLogout = async () => { if (usuario && !usuario.modoDemo && usuario.token) await supaAuth.signOut(usuario.token); borrarSesion(); setUsuario(null); };

  const [vista,setVista]=useState("dashboard");
  const [subVista,setSubVista]=useState("activas");
  const [ordenes,setOrdenes]=useState(MODO_DEMO?ORDENES_INIT:[]);
  const [ordenesCobro,setOrdenesCobro]=useState([]);
  const [ordenesCobradas,setOrdenesCobradas]=useState([]);
  const [ordenesTerminadas,setOrdenesTerminadas]=useState([]);
  const [historial,setHistorial]=useState([]);
  const [ordenSel,setOrdenSel]=useState(null);
  const [tabDetalle,setTabDetalle]=useState("info");
  const [filtroEstado,setFiltroEstado]=useState("todos");
  const [busqueda,setBusqueda]=useState("");
  const [gBusqueda,setGBusqueda]=useState("");          // búsqueda global (header)
  const [pagina,setPagina]=useState(1);                 // paginación lista activas
  const [fotoAmpliada,setFotoAmpliada]=useState(null);
  const [docTipo,setDocTipo]=useState("inventario");
  const [docNombre,setDocNombre]=useState("");
  const [camaraActiva,setCamaraActiva]=useState(false);
  const [subiendo,setSubiendo]=useState("");
  const [cargando,setCargando]=useState(false);
  const [errorSync,setErrorSync]=useState("");
  const [usuarios,setUsuarios]=useState([]);
  const [modalCerrar,setModalCerrar]=useState(null);
  const [modalRetroceder,setModalRetroceder]=useState(null);
  const [modalCobro,setModalCobro]=useState(null);
  const [modalPago,setModalPago]=useState(null);
  const [modalTerminar,setModalTerminar]=useState(null);
  const [form,setForm]=useState({cliente:"",telefono:"",vehiculo:"",placa:"",serie:"",siniestro:"",color:"",servicio:"",tecnico:"",entrega:"",notas:"",costo:"",fotoPrincipal:null});

  const fotoRef=useRef(); const docRef=useRef(); const fotoPrincipalRef=useRef(); const videoRef=useRef(); const canvasRef=useRef();

  // Resetear paginación cuando cambian filtros/búsqueda
  useEffect(()=>{ setPagina(1); }, [busqueda, filtroEstado, subVista]);

  // Cargar usuarios del taller al entrar a la sección Equipo
  useEffect(() => {
    if (vista!=="equipo" || !usuario || usuario.modoDemo) return;
    supaApi.getUsuariosTaller(usuario.token, usuario.taller).then(d => { if(Array.isArray(d)) setUsuarios(d); }).catch(()=>{});
  }, [vista, usuario]);

  // Snapshot de lo ya sincronizado (para no re-subir lo que no cambió)
  const syncRef = useRef({});
  const cargadoRef = useRef(false);

  // Cargar órdenes desde Supabase al iniciar sesión
  useEffect(() => {
    if (!usuario || usuario.modoDemo) { cargadoRef.current = false; return; }
    setCargando(true);
    supaApi.getOrdenes(usuario.token).then(rows => {
      if (!Array.isArray(rows)) { setCargando(false); return; }
      const acts=[],cob=[],cobr=[],term=[],hist=[];
      rows.forEach(r => {
        const o = dbToOrden(r);
        if (r.fecha_cierre)          hist.push(o);
        else if (r.fecha_terminado)  term.push(o);
        else if (r.fecha_pago)       cobr.push(o);
        else if (r.fecha_envio_cobro)cob.push(o);
        else                         acts.push(o);
      });
      setOrdenes(acts); setOrdenesCobro(cob); setOrdenesCobradas(cobr); setOrdenesTerminadas(term); setHistorial(hist);
      const snap = {};
      [...acts,...cob,...cobr,...term,...hist].forEach(o => { snap[o.id] = JSON.stringify(ordenToDB(o, usuario.taller)); });
      syncRef.current = snap;
      cargadoRef.current = true;
      setCargando(false);
    }).catch(() => setCargando(false));
  }, [usuario]);

  // Guardar en Supabase cualquier orden cuyo contenido haya cambiado (debounce 800ms)
  useEffect(() => {
    if (!usuario || usuario.modoDemo || !cargadoRef.current) return;
    const t = setTimeout(() => {
      [...ordenes,...ordenesCobro,...ordenesCobradas,...ordenesTerminadas,...historial].forEach(o => {
        const row = ordenToDB(o, usuario.taller);
        const js = JSON.stringify(row);
        if (syncRef.current[o.id] !== js) {
          syncRef.current[o.id] = js;
          supaApi.upsertOrden(usuario.token, row)
            .catch(e => {
              console.error("Error al sincronizar orden:", e);
              delete syncRef.current[o.id]; // permite reintentar en el próximo cambio
              setErrorSync("No se pudo guardar la orden "+o.id+". Verifica tu conexión; se reintentará al siguiente cambio.");
            });
        }
      });
    }, 800);
    return () => clearTimeout(t);
  }, [ordenes, ordenesCobro, ordenesCobradas, ordenesTerminadas, historial, usuario]);

  if (iniciando) return <div style={{minHeight:"100vh",background:BRAND.bg,display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{textAlign:"center"}}><div style={{fontSize:28,fontWeight:900,letterSpacing:3,marginBottom:8}}><span style={{color:BRAND.accent}}>REPAIR</span><span style={{color:BRAND.text}}>X</span></div><div style={{fontSize:12,color:BRAND.muted}}>Cargando...</div></div></div>;
  if (!usuario) return <LoginScreen onLogin={setUsuario} />;

  const estObj=key=>ESTADOS.find(e=>e.key===key)||ESTADOS[0];
  const totalAct=ordenes.length;
  const totCobro=ordenesCobro.reduce((a,o)=>a+Math.max(0,(o.costo||0)-(o.descuento||0)),0);
  const totCobradas=ordenesCobradas.reduce((a,o)=>a+Math.max(0,(o.costo||0)-(o.descuento||0)),0);
  // Total cobrado real: toda orden con pago registrado, esté donde esté (incluye terminadas)
  const totCobradoGlobal=[...ordenes,...ordenesCobro,...ordenesCobradas,...ordenesTerminadas,...historial].filter(o=>o.fechaPago).reduce((a,o)=>a+Math.max(0,(o.costo||0)-(o.descuento||0)),0);
  const proxExp=ordenesTerminadas.filter(o=>{const d=dDias(o.fechaTerminado);return d>=DIAS_TERM-30&&d<=DIAS_TERM;});

  const ordenesActivas=ordenes.filter(o=>{const mE=filtroEstado==="todos"||o.estado===filtroEstado;const mB=busqueda===""||[o.cliente,o.vehiculo,o.placa].some(v=>v.toLowerCase().includes(busqueda.toLowerCase()));return mE&&mB;});
  const totalPaginas=Math.max(1,Math.ceil(ordenesActivas.length/PAGE_SIZE));
  const paginaActual=Math.min(pagina,totalPaginas);
  const activasPagina=ordenesActivas.slice((paginaActual-1)*PAGE_SIZE, paginaActual*PAGE_SIZE);

  // Búsqueda global en todas las colecciones
  const resultadosGlobales=(()=>{
    const q=gBusqueda.trim().toLowerCase(); if(!q)return [];
    const match=o=>[o.id,o.cliente,o.vehiculo,o.placa,o.siniestro,o.serie,o.telefono].some(v=>String(v||"").toLowerCase().includes(q));
    const tag=(arr,origen,dest,sub)=>arr.filter(match).map(o=>({o,origen,dest,sub}));
    return [
      ...tag(ordenes,"Activa","ordenes","activas"),
      ...tag(ordenesCobro,"Para cobro","ordenes","cobro"),
      ...tag(ordenesCobradas,"Cobrada","ordenes","cobradas"),
      ...tag(ordenesTerminadas,"Terminada","terminadas",null),
      ...tag(historial,"Historial","historial",null),
    ];
  })();

  const irAResultado=({o,dest,sub})=>{ setGBusqueda(""); setVista(dest); if(sub)setSubVista(sub); if(dest==="ordenes"&&sub==="activas"){setOrdenSel(o);setTabDetalle("info");} else setOrdenSel(null); };

  const updOrden=(id,cambios,entrada)=>{ const fn=prev=>prev.map(o=>{if(o.id!==id)return o;const n={...o,...cambios};if(entrada)n.bitacora=[...(o.bitacora||[]),{...entrada,fecha:hoy()}];return n;}); setOrdenes(fn); setOrdenSel(prev=>{if(!prev||prev.id!==id)return prev;const n={...prev,...cambios};if(entrada)n.bitacora=[...(prev.bitacora||[]),{...entrada,fecha:hoy()}];return n;}); };
  const avanzarEstado=id=>{const o=ordenes.find(x=>x.id===id);if(!o)return;const i=PASOS.indexOf(o.estado);if(i>=PASOS.length-1)return;const next=PASOS[i+1];updOrden(id,{estado:next},{accion:"Avanzó a: "+estObj(next).label,usuario:usuario.nombre});};
  const retrocederEstado=(id,pin,motivo)=>{const sup=SUPERVISORES[pin];if(!sup)return false;const o=ordenes.find(x=>x.id===id);if(!o)return false;const i=PASOS.indexOf(o.estado);if(i<=0)return false;updOrden(id,{estado:PASOS[i-1]},{accion:"Retrocedió a: "+estObj(PASOS[i-1]).label+" - "+motivo,usuario:"Sup. "+sup});return true;};
  const enviarACobro=(id,desc,notas)=>{const o=ordenes.find(x=>x.id===id);if(!o)return;setOrdenesCobro(p=>[{...o,fechaEnvioCobro:hoy(),descuento:parseFloat(desc)||0,notasCobro:notas,bitacora:[...(o.bitacora||[]),{accion:"Enviada a cobro",usuario:usuario.nombre,fecha:hoy()}]},...p]);setOrdenes(p=>p.filter(x=>x.id!==id));setOrdenSel(null);setModalCobro(null);setSubVista("cobro");};
  const registrarPago=(id,met,ref)=>{const o=ordenesCobro.find(x=>x.id===id);if(!o)return;setOrdenesCobradas(p=>[{...o,fechaPago:hoy(),metodoPago:met,referenciaPago:ref,bitacora:[...(o.bitacora||[]),{accion:"Pago: "+met+(ref?" Ref:"+ref:""),usuario:usuario.nombre,fecha:hoy()}]},...p]);setOrdenesCobro(p=>p.filter(x=>x.id!==id));setModalPago(null);setSubVista("cobradas");};
  const cerrarOrden=(id,motivo)=>{const o=ordenes.find(x=>x.id===id);if(!o)return;setHistorial(p=>[{...o,fechaCierre:hoy(),motivoCierre:motivo,bitacora:[...(o.bitacora||[]),{accion:"Cerrada: "+motivo,usuario:usuario.nombre,fecha:hoy()}]},...p]);setOrdenes(p=>p.filter(x=>x.id!==id));setOrdenSel(null);setModalCerrar(null);};
  const terminarOrden=id=>{const src=ordenesCobradas.find(x=>x.id===id)||ordenesCobro.find(x=>x.id===id)||ordenes.find(x=>x.id===id);if(!src)return;const t={...src,fechaTerminado:hoy(),bitacora:[...(src.bitacora||[]),{accion:"Siniestro terminado",usuario:usuario.nombre,fecha:hoy()}]};setOrdenesTerminadas(p=>[t,...p]);setOrdenesCobradas(p=>p.filter(x=>x.id!==id));setOrdenesCobro(p=>p.filter(x=>x.id!==id));setOrdenes(p=>p.filter(x=>x.id!==id));setOrdenSel(null);setModalTerminar(null);setVista("terminadas");};

  const agregarFotos=async files=>{
    if(!ordenSel||!files.length)return; setSubiendo("Procesando fotos...");
    try{ for(const f of Array.from(files)){ if(!f.type.startsWith("image/")){alert(`«${f.name}» no es una imagen.`);continue;} if(f.size>MAX_ARCHIVO_MB*1024*1024){alert(`«${f.name}» supera el límite de ${MAX_ARCHIVO_MB} MB.`);continue;} const {blob,dataUrl}=await comprimirImagen(f); let url=dataUrl; if(!usuario.modoDemo){setSubiendo(`Subiendo ${f.name}...`);url=await supaStorage.subirImagen(usuario.token,usuario.taller,ordenSel.id,blob,f.name);} const foto={id:Date.now()+Math.random(),nombre:f.name,fecha:hoy(),url,size:(blob.size/1024).toFixed(0)+" KB"}; setOrdenes(p=>{const u=p.map(o=>o.id===ordenSel.id?{...o,fotos:[...(o.fotos||[]),foto]}:o);setOrdenSel(u.find(o=>o.id===ordenSel.id));return u;}); } }catch(e){alert("Error al procesar la foto: "+e.message);}finally{setSubiendo("");}
  };
  const eliminarFoto=fid=>{ if(!confirm("¿Eliminar esta foto? Esta acción no se puede deshacer."))return; const u=ordenes.map(o=>o.id===ordenSel.id?{...o,fotos:o.fotos.filter(f=>f.id!==fid)}:o);setOrdenes(u);setOrdenSel(u.find(o=>o.id===ordenSel.id)); };
  const agregarDoc=async files=>{
    if(!ordenSel||!files.length)return; const f=files[0]; if(f.size>MAX_ARCHIVO_MB*1024*1024){alert(`«${f.name}» supera el límite de ${MAX_ARCHIVO_MB} MB.`);return;} const ext=f.name.split(".").pop().toUpperCase(); setSubiendo("Procesando documento...");
    try{ let url; if(!usuario.modoDemo&&f.type.startsWith("image/")){const {blob}=await comprimirImagen(f,1600,0.75);setSubiendo(`Subiendo ${f.name}...`);url=await supaStorage.subirImagen(usuario.token,usuario.taller,ordenSel.id,blob,f.name);}else{url=await new Promise((res,rej)=>{const r=new FileReader();r.onload=ev=>res(ev.target.result);r.onerror=()=>rej(new Error("lectura"));r.readAsDataURL(f);});} const doc={id:Date.now()+Math.random(),tipo:docTipo,nombre:docNombre||f.name,archivo:f.name,ext,fecha:hoy(),size:(f.size/1024).toFixed(0)+" KB",url}; setOrdenes(p=>{const u=p.map(o=>o.id===ordenSel.id?{...o,documentos:[...(o.documentos||[]),doc]}:o);setOrdenSel(u.find(o=>o.id===ordenSel.id));return u;}); setDocNombre(""); }catch(e){alert("Error al adjuntar el documento: "+e.message);}finally{setSubiendo("");}
  };
  const eliminarDoc=did=>{ if(!confirm("¿Eliminar este documento? Esta acción no se puede deshacer."))return; const u=ordenes.map(o=>o.id===ordenSel.id?{...o,documentos:o.documentos.filter(d=>d.id!==did)}:o);setOrdenes(u);setOrdenSel(u.find(o=>o.id===ordenSel.id)); };

  const abrirCamara=async()=>{setCamaraActiva(true);setTimeout(async()=>{try{const s=await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"}});if(videoRef.current){videoRef.current.srcObject=s;videoRef.current.play();}}catch{setCamaraActiva(false);alert("No se pudo acceder a la cámara.");}},100);};
  const tomarFoto=()=>{const v=videoRef.current,c=canvasRef.current;if(!v||!c)return;c.width=v.videoWidth;c.height=v.videoHeight;c.getContext("2d").drawImage(v,0,0);setForm(f=>({...f,fotoPrincipal:c.toDataURL("image/jpeg",0.75)}));if(v.srcObject)v.srcObject.getTracks().forEach(t=>t.stop());setCamaraActiva(false);};
  const cerrarCamara=()=>{if(videoRef.current?.srcObject)videoRef.current.srcObject.getTracks().forEach(t=>t.stop());setCamaraActiva(false);};

  const crearOrden=()=>{const n={...form,...EXTRA(),fechaPrimerIngreso:hoy(),id:generarIdOrden(ordenes,ordenesCobro,ordenesCobradas,ordenesTerminadas,historial),tallerId:usuario.taller,fecha:hoy(),estado:"presupuesto",costo:parseFloat(form.costo)||0,fotos:[],documentos:[],novedades:[],bitacora:[{accion:"Orden creada",usuario:usuario.nombre,fecha:hoy()}]};setOrdenes(p=>[n,...p]);setForm({cliente:"",telefono:"",vehiculo:"",placa:"",serie:"",siniestro:"",color:"",servicio:"",tecnico:"",entrega:"",notas:"",costo:"",fotoPrincipal:null});setCamaraActiva(false);setVista("ordenes");setSubVista("activas");};

  // ─── Modales ───
  const ModalTerminar=()=>{if(!modalTerminar)return null;return(<div style={S.overlay} onClick={()=>setModalTerminar(null)}><div style={S.modalBox} onClick={e=>e.stopPropagation()}><div style={{fontSize:16,fontWeight:800,color:BRAND.green,marginBottom:6}}>Terminar Siniestro</div><div style={{fontSize:12,color:BRAND.muted,marginBottom:16}}>{modalTerminar.id} - {modalTerminar.cliente}</div><div style={{background:BRAND.bg,borderRadius:10,padding:"0.85rem",marginBottom:16}}>{["Se moverá a la sección Terminadas","Se conservará por 1 año (365 días)","Aviso 30 días antes de expirar"].map((t,i)=><div key={i} style={{fontSize:12,color:BRAND.text,marginBottom:6}}>✓ {t}</div>)}</div><div style={{display:"flex",gap:8}}><button style={{...S.btnGreen,flex:1,padding:"0.65rem",fontSize:14}} onClick={()=>terminarOrden(modalTerminar.id)}>Confirmar terminado</button><button style={S.btnSm()} onClick={()=>setModalTerminar(null)}>Cancelar</button></div></div></div>);};
  const ModalCerrar=()=>{const [m,sm]=useState("");if(!modalCerrar)return null;return(<div style={S.overlay} onClick={()=>setModalCerrar(null)}><div style={S.modalBox} onClick={e=>e.stopPropagation()}><div style={{fontSize:15,fontWeight:700,color:BRAND.accent,marginBottom:4}}>Cerrar Orden {modalCerrar.id}</div><div style={{fontSize:12,color:BRAND.muted,marginBottom:14}}>Se moverá al historial por {DIAS_HIST} días.</div><label style={S.label}>Motivo</label><select style={{...S.select,marginBottom:14}} value={m} onChange={e=>sm(e.target.value)}><option value="">Seleccionar...</option><option>Vehículo entregado al cliente</option><option>Cancelado por el cliente</option><option>Trabajo terminado sin entrega</option><option>Orden duplicada</option><option>Otro</option></select><div style={{display:"flex",gap:8}}><button style={S.btnDanger} disabled={!m} onClick={()=>cerrarOrden(modalCerrar.id,m)}>Confirmar cierre</button><button style={S.btnSm()} onClick={()=>setModalCerrar(null)}>Cancelar</button></div></div></div>);};
  const ModalRetroceder=()=>{const [pin,sp]=useState("");const [mot,sm]=useState("");const [err,se]=useState("");if(!modalRetroceder)return null;const o=modalRetroceder;const i=PASOS.indexOf(o.estado);const ant=i>0?estObj(PASOS[i-1]):null;const esAdmin=puedePerm(usuario,"todo");
    const ok=()=>{ if(!mot){se("Indica el motivo.");return;}
      if(esAdmin){ // El admin retrocede con su propia autoridad, sin PIN
        const oo=ordenes.find(x=>x.id===o.id); const ii=PASOS.indexOf(oo.estado);
        if(ii>0){ updOrden(o.id,{estado:PASOS[ii-1]},{accion:"Retrocedió a: "+estObj(PASOS[ii-1]).label+" - "+mot,usuario:usuario.nombre+" (admin)"}); }
        setModalRetroceder(null); return;
      }
      if(!SUPERVISORES[pin]){se("PIN incorrecto. Pide a un administrador que autorice.");return;}
      if(retrocederEstado(o.id,pin,mot))setModalRetroceder(null);
    };
    return(<div style={S.overlay} onClick={()=>setModalRetroceder(null)}><div style={S.modalBox} onClick={e=>e.stopPropagation()}><div style={{fontSize:15,fontWeight:700,color:BRAND.blue,marginBottom:4}}>Retroceder Proceso</div><div style={{fontSize:12,color:BRAND.muted,marginBottom:14}}>De {estObj(o.estado).label}{ant?" a "+ant.label:""}</div>
      {esAdmin?<div style={{background:BRAND.bg,borderRadius:8,padding:"0.75rem",marginBottom:12,fontSize:12,color:BRAND.green}}>Como administrador, puedes autorizar este retroceso directamente.</div>
        :<><div style={{background:BRAND.bg,borderRadius:8,padding:"0.75rem",marginBottom:12,fontSize:12,color:BRAND.muted}}>Requiere PIN de supervisor</div><label style={S.label}>PIN</label><input style={{...S.input,marginBottom:10,letterSpacing:4,fontSize:18,textAlign:"center"}} type="password" maxLength={6} placeholder="••••••" value={pin} onChange={e=>{sp(e.target.value);se("");}} /></>}
      <label style={S.label}>Motivo</label><textarea style={{...S.input,minHeight:55,resize:"none",marginBottom:10}} value={mot} onChange={e=>sm(e.target.value)} />{err&&<div style={{fontSize:12,color:"#EF4444",marginBottom:10}}>{err}</div>}<div style={{display:"flex",gap:8}}><button style={{...S.btn,background:BRAND.blue}} onClick={ok}>Autorizar</button><button style={S.btnSm()} onClick={()=>setModalRetroceder(null)}>Cancelar</button></div>{!esAdmin&&<div style={{fontSize:10,color:BRAND.muted,marginTop:10}}>PINs demo: SUP001 - SUP002</div>}</div></div>);};
  const ModalCobro=()=>{const [desc,sd]=useState("");const [notas,sn]=useState("");if(!modalCobro)return null;const total=Math.max(0,(modalCobro.costo||0)-(parseFloat(desc)||0));return(<div style={S.overlay} onClick={()=>setModalCobro(null)}><div style={S.modalBox} onClick={e=>e.stopPropagation()}><div style={{fontSize:15,fontWeight:700,color:BRAND.green,marginBottom:4}}>Enviar a Cobro</div><div style={{fontSize:12,color:BRAND.muted,marginBottom:14}}>{modalCobro.id} - {modalCobro.cliente}</div><div style={{background:BRAND.bg,borderRadius:8,padding:"0.75rem",marginBottom:14}}><div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:8}}><span style={{color:BRAND.muted}}>Costo</span><span style={{fontWeight:600}}>${(modalCobro.costo||0).toLocaleString()}</span></div><label style={S.label}>Descuento ($)</label><input style={{...S.input,marginBottom:10}} type="number" placeholder="0" value={desc} onChange={e=>sd(e.target.value)} /><div style={{display:"flex",justifyContent:"space-between",fontSize:15,fontWeight:700,borderTop:"0.5px solid "+BRAND.border,paddingTop:8}}><span style={{color:BRAND.muted}}>Total</span><span style={{color:BRAND.green}}>${total.toLocaleString()}</span></div></div><label style={S.label}>Notas (opcional)</label><textarea style={{...S.input,minHeight:50,resize:"none",marginBottom:14}} value={notas} onChange={e=>sn(e.target.value)} /><div style={{display:"flex",gap:8}}><button style={S.btnGreen} onClick={()=>enviarACobro(modalCobro.id,desc,notas)}>Confirmar</button><button style={S.btnSm()} onClick={()=>setModalCobro(null)}>Cancelar</button></div></div></div>);};
  const ModalPago=()=>{const [met,sm]=useState("Efectivo");const [ref,sr]=useState("");if(!modalPago)return null;const total=Math.max(0,(modalPago.costo||0)-(modalPago.descuento||0));return(<div style={S.overlay} onClick={()=>setModalPago(null)}><div style={S.modalBox} onClick={e=>e.stopPropagation()}><div style={{fontSize:15,fontWeight:700,color:BRAND.purple,marginBottom:4}}>Registrar Pago</div><div style={{fontSize:12,color:BRAND.muted,marginBottom:14}}>{modalPago.id} - {modalPago.cliente}</div><div style={{background:BRAND.bg,borderRadius:8,padding:"0.75rem",marginBottom:14}}><div style={{display:"flex",justifyContent:"space-between",fontSize:15,fontWeight:700}}><span style={{color:BRAND.muted}}>Total</span><span style={{color:BRAND.green}}>${total.toLocaleString()}</span></div></div><label style={S.label}>Método de pago</label><select style={{...S.select,marginBottom:10}} value={met} onChange={e=>sm(e.target.value)}>{["Efectivo","Transferencia","Tarjeta débito","Tarjeta crédito","Cheque","Aseguradora"].map(x=><option key={x}>{x}</option>)}</select><label style={S.label}>Referencia (opcional)</label><input style={{...S.input,marginBottom:14}} value={ref} onChange={e=>sr(e.target.value)} /><div style={{display:"flex",gap:8}}><button style={{...S.btn,background:BRAND.purple}} onClick={()=>registrarPago(modalPago.id,met,ref)}>Confirmar pago</button><button style={S.btnSm()} onClick={()=>setModalPago(null)}>Cancelar</button></div></div></div>);};

  // ─── Renders ───
  const renderBusquedaGlobal=()=>(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div style={{fontSize:13,fontWeight:700,color:BRAND.accent}}>Resultados para «{gBusqueda}»</div>
        <button style={S.btnSm()} onClick={()=>setGBusqueda("")}>Limpiar</button>
      </div>
      {resultadosGlobales.length===0&&<div style={{textAlign:"center",color:BRAND.muted,padding:"3rem",fontSize:13}}>Sin coincidencias en ninguna sección</div>}
      <div style={{display:"flex",flexDirection:"column",gap:10}}>{resultadosGlobales.map(({o,origen,dest,sub},i)=><TarjetaOrden key={o.id+i} o={o} ordenes={ordenes} setOrdenes={setOrdenes} setOrdenSel={setOrdenSel} badge={origen} onClick={()=>irAResultado({o,dest,sub})} />)}</div>
    </div>
  );

  const renderDashboard=()=>{const rec=ordenes.filter(o=>o.estado!=="armado");return(
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <div style={{display:"grid",gridTemplateColumns:desktop?"repeat(4,1fr)":"repeat(2,1fr)",gap:10}}>{[{label:"Órdenes Activas",value:totalAct,color:BRAND.accent},{label:"Para Cobro",value:ordenesCobro.length,color:BRAND.green},{label:"Total Cobrado",value:"$"+totCobradoGlobal.toLocaleString(),color:BRAND.purple},{label:"Terminadas",value:ordenesTerminadas.length,color:BRAND.blue}].map((m,i)=><div key={i} style={{...S.metric,border:"0.5px solid "+m.color+"25"}}><div style={{fontSize:10,color:BRAND.muted,marginBottom:4,textTransform:"uppercase",letterSpacing:0.8}}>{m.label}</div><div style={{fontSize:24,fontWeight:800,color:m.color}}>{m.value}</div></div>)}</div>
      <div style={S.card}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}><div style={{fontSize:13,fontWeight:700,color:BRAND.accent}}>Órdenes en Proceso</div><span style={{fontSize:11,color:BRAND.muted}}>{rec.length} orden{rec.length!==1?"es":""}</span></div>
        {rec.length===0&&<div style={{textAlign:"center",color:BRAND.muted,padding:"1.5rem",fontSize:13}}>Sin órdenes activas</div>}
        <div style={{display:"grid",gridTemplateColumns:desktop?"repeat(2,1fr)":"1fr",gap:10}}>{rec.map(o=><TarjetaOrden key={o.id} o={o} ordenes={ordenes} setOrdenes={setOrdenes} setOrdenSel={setOrdenSel} onClick={()=>{setOrdenSel(o);setTabDetalle("info");setVista("ordenes");setSubVista("activas");}} />)}</div>
      </div>
    </div>
  );};

  const renderOrdenes=()=>{const subTabs=[{k:"activas",l:"Activas",count:ordenes.length,color:BRAND.accent},{k:"cobro",l:"Para Cobro",count:ordenesCobro.length,color:BRAND.green},{k:"cobradas",l:"Cobradas",count:ordenesCobradas.length,color:BRAND.purple}];return(
    <div>
      <div style={{display:"flex",gap:0,marginBottom:14,borderBottom:"0.5px solid "+BRAND.border}}>{subTabs.map(t=><button key={t.k} onClick={()=>{setSubVista(t.k);setOrdenSel(null);}} style={{padding:"10px 16px",fontSize:13,cursor:"pointer",background:"none",border:"none",borderBottom:subVista===t.k?"2px solid "+t.color:"2px solid transparent",color:subVista===t.k?t.color:BRAND.muted,fontWeight:subVista===t.k?700:400,display:"flex",alignItems:"center",gap:6}}>{t.l}{t.count>0&&<span style={{background:subVista===t.k?t.color+"22":BRAND.card2,color:subVista===t.k?t.color:BRAND.muted,borderRadius:10,padding:"0px 7px",fontSize:11}}>{t.count}</span>}</button>)}</div>
      {subVista==="activas"&&(
        <div>
          {!ordenSel&&<div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}><input style={{...S.input,width:180}} placeholder="Buscar en activas..." value={busqueda} onChange={e=>setBusqueda(e.target.value)} /><select style={{...S.select,width:155}} value={filtroEstado} onChange={e=>setFiltroEstado(e.target.value)}><option value="todos">Todos los estados</option>{ESTADOS.map(e=><option key={e.key} value={e.key}>{e.label}</option>)}</select>{puedePerm(usuario,"crear_ordenes")&&<button style={S.btn} onClick={()=>setVista("nueva")}>+ Nueva Orden</button>}</div>}
          {ordenSel?<OrdenExpandida o={ordenSel} ordenes={ordenes} setOrdenes={setOrdenes} setOrdenSel={setOrdenSel} tabDetalle={tabDetalle} setTabDetalle={setTabDetalle} avanzarEstado={avanzarEstado} setModalRetroceder={setModalRetroceder} setModalCerrar={setModalCerrar} setModalCobro={setModalCobro} setModalTerminar={setModalTerminar} fotoRef={fotoRef} docRef={docRef} docTipo={docTipo} setDocTipo={setDocTipo} docNombre={docNombre} setDocNombre={setDocNombre} agregarFotos={agregarFotos} eliminarFoto={eliminarFoto} agregarDoc={agregarDoc} eliminarDoc={eliminarDoc} setFotoAmpliada={setFotoAmpliada} usuario={usuario} />:(
            <div>
              <div style={{display:"grid",gridTemplateColumns:desktop?"repeat(2,1fr)":"1fr",gap:10}}>{activasPagina.map(o=><TarjetaOrden key={o.id} o={o} ordenes={ordenes} setOrdenes={setOrdenes} setOrdenSel={setOrdenSel} onClick={()=>{setOrdenSel(o);setTabDetalle("info");}} />)}</div>
              {ordenesActivas.length===0&&<div style={{textAlign:"center",color:BRAND.muted,padding:"2rem",fontSize:13}}>No se encontraron órdenes</div>}
              {totalPaginas>1&&<div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:10,marginTop:16}}><button style={{...S.btnSm(),opacity:paginaActual<=1?0.4:1}} disabled={paginaActual<=1} onClick={()=>setPagina(p=>Math.max(1,p-1))}>← Anterior</button><span style={{fontSize:12,color:BRAND.muted}}>Página {paginaActual} de {totalPaginas}</span><button style={{...S.btnSm(),opacity:paginaActual>=totalPaginas?0.4:1}} disabled={paginaActual>=totalPaginas} onClick={()=>setPagina(p=>Math.min(totalPaginas,p+1))}>Siguiente →</button></div>}
            </div>
          )}
        </div>
      )}
      {subVista==="cobro"&&(
        <div>
          {ordenesCobro.length>0&&<div style={{background:BRAND.green+"11",border:"0.5px solid "+BRAND.green+"33",borderRadius:8,padding:"8px 14px",marginBottom:12,display:"flex",justifyContent:"space-between"}}><span style={{fontSize:12,color:BRAND.green}}>Total pendiente</span><span style={{fontSize:16,fontWeight:800,color:BRAND.green}}>${totCobro.toLocaleString()}</span></div>}
          {ordenesCobro.length===0&&<div style={{textAlign:"center",color:BRAND.muted,padding:"3rem",fontSize:13}}>Sin órdenes pendientes de cobro</div>}
          <div style={{display:"flex",flexDirection:"column",gap:8}}>{ordenesCobro.map(o=>{const total=Math.max(0,(o.costo||0)-(o.descuento||0));return(<div key={o.id} style={{...S.card,border:"0.5px solid "+BRAND.green+"33"}}><div style={{display:"flex",alignItems:"center",gap:10}}>{o.fotoPrincipal?<img src={o.fotoPrincipal} style={{width:48,height:36,objectFit:"cover",borderRadius:7,flexShrink:0}} alt="v" />:<div style={{width:48,height:36,background:BRAND.bg,borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>🚗</div>}<div style={{flex:1,minWidth:0}}><div style={{display:"flex",gap:8,alignItems:"center",marginBottom:2}}><span style={{fontSize:12,fontWeight:700,color:BRAND.green}}>{o.id}</span><span style={{fontSize:13,fontWeight:500}}>{o.cliente}</span></div><div style={{fontSize:11,color:BRAND.muted}}>{o.vehiculo} - {o.placa}</div></div><div style={{textAlign:"right",flexShrink:0}}><div style={{fontSize:16,fontWeight:800,color:BRAND.green,marginBottom:6}}>${total.toLocaleString()}</div><button style={{...S.btn,background:BRAND.purple,fontSize:12,padding:"5px 12px"}} onClick={()=>setModalPago(o)}>Registrar pago</button></div></div></div>);})}</div>
        </div>
      )}
      {subVista==="cobradas"&&(
        <div>
          {ordenesCobradas.length>0&&<div style={{background:BRAND.purple+"11",border:"0.5px solid "+BRAND.purple+"33",borderRadius:8,padding:"8px 14px",marginBottom:12,display:"flex",justifyContent:"space-between"}}><span style={{fontSize:12,color:BRAND.purple}}>Total cobrado</span><span style={{fontSize:16,fontWeight:800,color:BRAND.purple}}>${totCobradas.toLocaleString()}</span></div>}
          {ordenesCobradas.length===0&&<div style={{textAlign:"center",color:BRAND.muted,padding:"3rem",fontSize:13}}>Sin órdenes cobradas aún</div>}
          <div style={{display:"flex",flexDirection:"column",gap:8}}>{ordenesCobradas.map(o=>{const total=Math.max(0,(o.costo||0)-(o.descuento||0));return(<div key={o.id} style={{...S.card,border:"0.5px solid "+BRAND.purple+"33"}}><div style={{display:"flex",alignItems:"center",gap:10}}>{o.fotoPrincipal?<img src={o.fotoPrincipal} style={{width:48,height:36,objectFit:"cover",borderRadius:7,flexShrink:0}} alt="v" />:<div style={{width:48,height:36,background:BRAND.bg,borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>🚗</div>}<div style={{flex:1,minWidth:0}}><div style={{display:"flex",gap:8,alignItems:"center",marginBottom:2,flexWrap:"wrap"}}><span style={{fontSize:12,fontWeight:700,color:BRAND.purple}}>{o.id}</span><span style={{fontSize:13,fontWeight:500}}>{o.cliente}</span><span style={{fontSize:11,background:BRAND.purple+"22",color:BRAND.purple,borderRadius:10,padding:"1px 8px"}}>✓ Pagado</span></div><div style={{fontSize:11,color:BRAND.muted}}>{o.vehiculo} · {o.placa}</div><div style={{fontSize:11,color:BRAND.muted}}>{o.metodoPago}{o.referenciaPago?" · "+o.referenciaPago:""} · {o.fechaPago}</div></div><div style={{textAlign:"right",flexShrink:0}}><div style={{fontSize:16,fontWeight:800,color:BRAND.purple,marginBottom:6}}>${total.toLocaleString()}</div><button style={{...S.btnGreen,fontSize:11,padding:"5px 10px"}} onClick={()=>setModalTerminar(o)}>Terminar</button></div></div></div>);})}</div>
        </div>
      )}
    </div>
  );};

  const renderTerminadas=()=>(
    <div>
      {proxExp.length>0&&<div style={{background:"#F59E0B11",border:"1.5px solid #F59E0B55",borderRadius:10,padding:"10px 14px",marginBottom:14}}><div style={{fontSize:13,fontWeight:700,color:"#F59E0B",marginBottom:4}}>Órdenes próximas a eliminarse</div>{proxExp.map(o=>{const r=DIAS_TERM-dDias(o.fechaTerminado);return<div key={o.id} style={{fontSize:12,color:BRAND.text,marginBottom:4,display:"flex",justifyContent:"space-between",background:BRAND.bg,borderRadius:7,padding:"5px 10px"}}><span>{o.id} - {o.cliente}</span><span style={{color:"#F59E0B",fontWeight:700}}>{r} días</span></div>;})}</div>}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}><div style={{fontSize:13,fontWeight:700,color:BRAND.green}}>Siniestros Terminados</div><span style={{fontSize:11,color:BRAND.muted}}>{ordenesTerminadas.length} - Historial 1 año</span></div>
      {ordenesTerminadas.length===0&&<div style={{textAlign:"center",color:BRAND.muted,padding:"3rem",fontSize:13}}><div style={{fontSize:32,marginBottom:12}}>🏁</div><div style={{fontWeight:600}}>Sin órdenes terminadas</div></div>}
      <div style={{display:"grid",gridTemplateColumns:desktop?"repeat(2,1fr)":"1fr",gap:10}}>{ordenesTerminadas.map(o=>{const restantes=DIAS_TERM-dDias(o.fechaTerminado);const pExp=restantes<=30;return(<div key={o.id} style={{...S.card,border:"0.5px solid "+(pExp?"#F59E0B44":BRAND.green+"33")}}><div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>{o.fotoPrincipal?<img src={o.fotoPrincipal} style={{width:44,height:33,objectFit:"cover",borderRadius:7,flexShrink:0}} alt="v" />:<div style={{width:44,height:33,background:BRAND.bg,borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>🚗</div>}<div style={{flex:1,minWidth:0}}><div style={{display:"flex",gap:7,alignItems:"center",marginBottom:2,flexWrap:"wrap"}}><span style={{fontSize:12,fontWeight:700,color:BRAND.green}}>{o.id}</span><span style={{fontSize:13,fontWeight:600}}>{o.cliente}</span><span style={{fontSize:10,background:BRAND.green+"22",color:BRAND.green,border:"0.5px solid "+BRAND.green+"44",borderRadius:20,padding:"1px 7px",fontWeight:600}}>Terminado</span></div><div style={{fontSize:11,color:BRAND.muted}}>{o.vehiculo} - {o.placa}</div></div></div><div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><div style={{fontSize:10,color:pExp?"#F59E0B":BRAND.muted,fontWeight:pExp?700:400}}>{pExp?"⚠️ ":""}Se elimina en {restantes} día{restantes!==1?"s":""}</div><div style={{fontSize:10,color:BRAND.muted}}>Completada: {o.fechaTerminado}</div></div></div>);})}</div>
    </div>
  );

  const renderHistorial=()=>(
    <div>
      <div style={{fontSize:13,color:BRAND.muted,marginBottom:14}}>Órdenes cerradas — Se conservan {DIAS_HIST} días — Total: {historial.length}</div>
      {historial.length===0&&<div style={{textAlign:"center",color:BRAND.muted,padding:"3rem",fontSize:13}}>Sin órdenes en historial</div>}
      <div style={{display:"grid",gridTemplateColumns:desktop?"repeat(2,1fr)":"1fr",gap:8}}>{historial.map(o=>{const e=estObj(o.estado);const restantes=DIAS_HIST-dDias(o.fechaCierre);return(<div key={o.id} style={{...S.card,opacity:restantes<5?0.6:1}}><div style={{display:"flex",alignItems:"center",gap:12}}>{o.fotoPrincipal?<img src={o.fotoPrincipal} style={{width:48,height:36,objectFit:"cover",borderRadius:7,flexShrink:0}} alt="v" />:<div style={{width:48,height:36,background:BRAND.bg,borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>🚗</div>}<div style={{flex:1,minWidth:0}}><div style={{display:"flex",gap:8,alignItems:"center",marginBottom:2}}><span style={{fontSize:12,fontWeight:700,color:BRAND.muted}}>{o.id}</span><span style={{fontSize:13,fontWeight:500}}>{o.cliente}</span></div><div style={{fontSize:11,color:BRAND.muted}}>{o.vehiculo} - {o.placa}</div><div style={{fontSize:11,color:BRAND.muted,marginTop:2}}>Cierre: {o.fechaCierre} - {o.motivoCierre}</div></div><div style={{textAlign:"right"}}><span style={{display:"inline-block",background:e.color+"18",color:e.color,border:"0.5px solid "+e.color+"44",borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:600}}>{e.label}</span><div style={{fontSize:10,marginTop:4,color:restantes<5?"#EF4444":BRAND.muted}}>Expira en {restantes} días</div></div></div></div>);})}</div>
    </div>
  );

  const renderNuevaOrden=()=>{
    const err={};
    if(!form.cliente.trim()) err.cliente="Requerido";
    if(!form.vehiculo.trim()) err.vehiculo="Requerido";
    if(!form.placa.trim()) err.placa="Requerido"; else if(!/^[A-Za-z0-9-]{5,10}$/.test(form.placa.trim())) err.placa="5 a 10 caracteres (letras, números o guion)";
    if(!form.servicio) err.servicio="Requerido";
    if(form.telefono.trim()&&form.telefono.replace(/\D/g,"").length<10) err.telefono="Al menos 10 dígitos";
    if(form.serie.trim()&&form.serie.trim().length!==17) err.serie="El VIN debe tener 17 caracteres";
    if(form.costo!==""&&(isNaN(parseFloat(form.costo))||parseFloat(form.costo)<0)) err.costo="Debe ser un número mayor o igual a 0";
    if(form.entrega&&form.entrega<hoy()) err.entrega="No puede ser anterior a hoy";
    const hayErrores=Object.keys(err).length>0;
    const be=f=>err[f]?{border:"0.5px solid #EF4444"}:{};
    const Er=({f})=>err[f]?<div style={{fontSize:10,color:"#EF4444",marginTop:3}}>{err[f]}</div>:null;
    return (
    <div style={{maxWidth:540}}>
      <div style={S.card}>
        <div style={{fontSize:14,fontWeight:700,color:BRAND.accent,marginBottom:14}}>Nueva Orden de Trabajo</div>
        <div style={{marginBottom:14}}>
          <label style={S.label}>Foto del Vehículo</label>
          <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
            <div style={{width:110,height:80,borderRadius:10,overflow:"hidden",border:"0.5px solid "+BRAND.border,background:BRAND.bg,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>{camaraActiva?<video ref={videoRef} style={{width:"100%",height:"100%",objectFit:"cover"}} autoPlay playsInline muted />:form.fotoPrincipal?<img src={form.fotoPrincipal} alt="preview" style={{width:"100%",height:"100%",objectFit:"cover"}} />:<span style={{fontSize:28}}>🚗</span>}</div>
            <canvas ref={canvasRef} style={{display:"none"}} />
            <div style={{display:"flex",flexDirection:"column",gap:6,flex:1}}>{camaraActiva?(<><button style={{...S.btn,fontSize:12}} onClick={tomarFoto}>📸 Tomar foto</button><button style={{...S.btnSm(),fontSize:12,padding:"5px 10px"}} onClick={cerrarCamara}>Cancelar</button></>):(<><button style={{...S.btn,fontSize:12}} onClick={abrirCamara}>📷 Usar cámara</button><button style={{...S.btnSm(),fontSize:12,padding:"5px 10px"}} onClick={()=>fotoPrincipalRef.current?.click()}>🖼️ Subir foto</button>{form.fotoPrincipal&&<button style={{...S.btnSm(),fontSize:11,color:"#fca5a5"}} onClick={()=>setForm(f=>({...f,fotoPrincipal:null}))}>✕ Quitar</button>}</>)}<input ref={fotoPrincipalRef} type="file" accept="image/*" style={{display:"none"}} onChange={async ev=>{const f=ev.target.files[0];if(!f)return;try{const {dataUrl}=await comprimirImagen(f,800,0.7);setForm(p=>({...p,fotoPrincipal:dataUrl}));}catch{alert("No se pudo procesar la imagen.");}ev.target.value="";}} /></div>
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
          <div><label style={S.label}>Cliente *</label><input style={{...S.input,...be("cliente")}} placeholder="Nombre completo" value={form.cliente} onChange={e=>setForm({...form,cliente:e.target.value})} /><Er f="cliente" /></div>
          <div><label style={S.label}>Teléfono</label><input style={{...S.input,...be("telefono")}} placeholder="55 0000 0000" value={form.telefono} onChange={e=>setForm({...form,telefono:e.target.value})} /><Er f="telefono" /></div>
          <div><label style={S.label}>Vehículo *</label><input style={{...S.input,...be("vehiculo")}} placeholder="Marca, Modelo, Año" value={form.vehiculo} onChange={e=>setForm({...form,vehiculo:e.target.value})} /><Er f="vehiculo" /></div>
          <div><label style={S.label}>Placa *</label><input style={{...S.input,...be("placa")}} placeholder="ABC-000" value={form.placa} onChange={e=>setForm({...form,placa:e.target.value})} /><Er f="placa" /></div>
          <div style={{gridColumn:"1/-1"}}><label style={S.label}>No. de Serie / VIN</label><input style={{...S.input,fontFamily:"monospace",letterSpacing:2,textTransform:"uppercase",...be("serie")}} placeholder="Ej. 1HGBH41JXMN109186" maxLength={17} value={form.serie} onChange={e=>setForm({...form,serie:e.target.value.toUpperCase()})} /><Er f="serie" /></div>
          <div style={{gridColumn:"1/-1"}}><label style={S.label}>No. de Siniestro (si aplica)</label><input style={S.input} placeholder="Ej. SIN-2026-00123" value={form.siniestro} onChange={e=>setForm({...form,siniestro:e.target.value})} /></div>
          <div><label style={S.label}>Color</label><input style={S.input} placeholder="Ej. Blanco perla" value={form.color} onChange={e=>setForm({...form,color:e.target.value})} /></div>
          <div><label style={S.label}>Fecha de Entrega</label><input type="date" min={hoy()} style={{...S.input,...be("entrega")}} value={form.entrega} onChange={e=>setForm({...form,entrega:e.target.value})} /><Er f="entrega" /></div>
          <div><label style={S.label}>Servicio *</label><select style={{...S.select,...be("servicio")}} value={form.servicio} onChange={e=>setForm({...form,servicio:e.target.value})}><option value="">Seleccionar...</option>{SERVICIOS.map(sv=><option key={sv}>{sv}</option>)}</select><Er f="servicio" /></div>
          <div><label style={S.label}>Técnico</label><select style={S.select} value={form.tecnico} onChange={e=>setForm({...form,tecnico:e.target.value})}><option value="">Seleccionar...</option>{TECNICOS.map(t=><option key={t}>{t}</option>)}</select></div>
        </div>
        <div style={{marginBottom:10}}><label style={S.label}>Costo Estimado ($)</label><input style={{...S.input,...be("costo")}} type="number" min="0" step="0.01" placeholder="0.00" value={form.costo} onChange={e=>setForm({...form,costo:e.target.value})} /><Er f="costo" /></div>
        <div style={{marginBottom:14}}><label style={S.label}>Notas</label><textarea style={{...S.input,minHeight:60,resize:"vertical"}} placeholder="Describe el problema..." value={form.notas} onChange={e=>setForm({...form,notas:e.target.value})} /></div>
        {hayErrores&&<div style={{background:"#EF444415",border:"0.5px solid #EF444433",borderRadius:8,padding:"7px 10px",fontSize:11,color:"#EF4444",marginBottom:12}}>Corrige los campos marcados antes de crear la orden.</div>}
        <div style={{display:"flex",gap:8}}><button style={{...S.btn,opacity:hayErrores?0.5:1,cursor:hayErrores?"not-allowed":"pointer"}} onClick={crearOrden} disabled={hayErrores}>Crear Orden</button><button style={S.btnSm()} onClick={()=>setVista("ordenes")}>Cancelar</button></div>
      </div>
    </div>
    );
  };

  const cambiarRol = async (uid, rol) => {
    if (usuario.modoDemo) { alert("La gestión de roles requiere Supabase configurado."); return; }
    setUsuarios(us => us.map(u => u.id===uid ? {...u, rol} : u));
    try { const r = await supaApi.actualizarRol(usuario.token, uid, rol); if (r && r.code && r.message) throw new Error(r.message); }
    catch { alert("No se pudo actualizar el rol. Verifica tu conexión y los permisos."); }
  };

  const renderEquipo = () => {
    const lista = usuario.modoDemo ? DEMOS.map(d=>({id:d.id,nombre:d.nombre,email:d.email,rol:d.rol})) : usuarios;
    return (
      <div style={{maxWidth:640,display:"flex",flexDirection:"column",gap:14}}>
        <div style={S.card}>
          <div style={{fontSize:13,fontWeight:700,color:BRAND.accent,marginBottom:8}}>Código del taller</div>
          <div style={{fontSize:12,color:BRAND.muted,marginBottom:10}}>Compártelo con tus colaboradores para que se registren en {usuario.tallerNombre||"tu taller"}. Entrarán como Asesor y aquí podrás ajustar su rol.</div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <div style={{flex:1,background:BRAND.bg,border:"0.5px solid "+BRAND.border,borderRadius:9,padding:"0.6rem 0.9rem",fontSize:18,fontWeight:800,letterSpacing:3,color:BRAND.accent,fontFamily:"monospace",overflow:"hidden",textOverflow:"ellipsis"}}>{usuario.taller||"—"}</div>
            <button style={S.btn} onClick={()=>{ try{navigator.clipboard?.writeText(usuario.taller);}catch(_){} }}>Copiar</button>
          </div>
          {usuario.modoDemo&&<div style={{fontSize:11,color:"#F59E0B",marginTop:8}}>En modo demo el código es de ejemplo y la gestión de roles está deshabilitada.</div>}
        </div>
        <div style={S.card}>
          <div style={{fontSize:13,fontWeight:700,color:BRAND.accent,marginBottom:12}}>Usuarios del taller ({lista.length})</div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {lista.map(u=>{ const r=ROLES[u.rol]||{label:u.rol,color:BRAND.muted}; const yo=u.id===usuario.id; return (
              <div key={u.id} style={{display:"flex",alignItems:"center",gap:10,background:BRAND.bg,borderRadius:10,padding:"0.6rem 0.85rem"}}>
                <div style={{width:34,height:34,borderRadius:"50%",background:r.color+"22",border:"1.5px solid "+r.color+"44",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,color:r.color,flexShrink:0}}>{(u.nombre||u.email||"?")[0].toUpperCase()}</div>
                <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:600}}>{u.nombre||"(sin nombre)"}{yo&&<span style={{fontSize:10,color:BRAND.muted,fontWeight:400}}> · tú</span>}</div><div style={{fontSize:11,color:BRAND.muted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.email}</div></div>
                <select value={u.rol} disabled={yo} onChange={e=>cambiarRol(u.id,e.target.value)} style={{...S.select,width:140,opacity:yo?0.5:1,cursor:yo?"not-allowed":"pointer"}}>
                  {Object.keys(ROLES).map(k=><option key={k} value={k}>{ROLES[k].label}</option>)}
                </select>
              </div>
            );})}
            {lista.length===0&&<div style={{textAlign:"center",color:BRAND.muted,fontSize:13,padding:"1.5rem 0"}}>Aún no hay otros usuarios. Comparte el código para que se unan.</div>}
          </div>
          <div style={{fontSize:10,color:BRAND.muted,marginTop:10}}>No puedes cambiar tu propio rol para evitar quedarte sin acceso de administrador.</div>
        </div>
      </div>
    );
  };

  const titulos={dashboard:"",ordenes:"Órdenes de Trabajo",historial:"Historial",nueva:"Nueva Orden",terminadas:"Siniestros Terminados",exportar:"Exportar a Excel",equipo:"Equipo"};

  return (
    <div style={{fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",minHeight:"100vh",width:"100%",background:BRAND.bg,color:BRAND.text}}>
      <ModalTerminar /><ModalCerrar /><ModalRetroceder /><ModalCobro /><ModalPago />
      {errorSync&&<div style={{position:"fixed",bottom:16,left:"50%",transform:"translateX(-50%)",zIndex:960,background:"#7F1D1D",border:"0.5px solid #991b1b",borderRadius:10,padding:"10px 14px",display:"flex",alignItems:"center",gap:12,maxWidth:"90vw",boxShadow:"0 8px 24px #00000088"}}><span style={{fontSize:12,color:"#fca5a5"}}>⚠️ {errorSync}</span><button onClick={()=>setErrorSync("")} style={{background:"none",border:"none",color:"#fca5a5",cursor:"pointer",fontSize:14,flexShrink:0}}>✕</button></div>}
      {cargando&&<div style={{position:"fixed",inset:0,background:"#000000cc",zIndex:980,display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{background:BRAND.card2,border:"0.5px solid "+BRAND.border,borderRadius:14,padding:"1.5rem 2rem",textAlign:"center"}}><div style={{fontSize:24,marginBottom:8}}>⏳</div><div style={{fontSize:14,fontWeight:600,color:BRAND.text}}>Cargando órdenes...</div></div></div>}
      {subiendo&&<div style={{position:"fixed",inset:0,background:"#000000aa",zIndex:950,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(3px)"}}><div style={{background:BRAND.card2,border:"0.5px solid "+BRAND.border,borderRadius:14,padding:"1.25rem 1.75rem",textAlign:"center"}}><div style={{fontSize:22,marginBottom:8}}>⏳</div><div style={{fontSize:13,fontWeight:600,color:BRAND.text}}>{subiendo}</div></div></div>}
      {fotoAmpliada&&<div style={S.overlay} onClick={()=>setFotoAmpliada(null)}><img src={fotoAmpliada.url} alt="" style={{maxWidth:"90vw",maxHeight:"85vh",borderRadius:12,objectFit:"contain"}} /><button style={{position:"absolute",top:16,right:16,background:"#222",border:"none",color:"#fff",borderRadius:"50%",width:32,height:32,cursor:"pointer",fontSize:16}} onClick={()=>setFotoAmpliada(null)}>✕</button></div>}
      <Sidebar vista={vista} setVista={(v)=>{setVista(v);setGBusqueda("");}} setOrdenSel={setOrdenSel} hLen={historial.length} tLen={ordenesTerminadas.length} desktop={desktop} esAdmin={puedePerm(usuario,"todo")} logo={usuario.logo} tallerNombre={usuario.tallerNombre||usuario.taller} />
      <div style={{marginLeft:desktop?240:0,display:"flex",flexDirection:"column",minHeight:"100vh",minWidth:0}}>
        <div style={{position:"sticky",top:0,zIndex:100,flexShrink:0,boxShadow:"0 1px 8px rgba(16,24,40,0.08)"}}>
          <div style={{padding:desktop?"0 1rem":"0 1rem 0 58px",minHeight:48,borderBottom:"0.5px solid "+BRAND.border,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,background:BRAND.card}}>
            <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
              {!desktop&&<span style={{fontSize:15,fontWeight:900,letterSpacing:2}}><span style={{color:BRAND.accent}}>REPAIR</span><span style={{color:BRAND.text}}>X</span></span>}
              {titulos[vista]&&desktop&&<span style={{fontSize:13,fontWeight:600,color:BRAND.text}}>{titulos[vista]}</span>}
              {MODO_DEMO&&<span style={{fontSize:10,background:"#F59E0B22",color:"#F59E0B",borderRadius:10,padding:"2px 8px",border:"0.5px solid #F59E0B44"}}>DEMO</span>}
            </div>
            <UsuarioBadge usuario={usuario} onLogout={handleLogout} />
          </div>
          <div style={{padding:"6px 1rem",borderBottom:"0.5px solid "+BRAND.border,background:BRAND.card,display:"flex",alignItems:"center",gap:8}}>
            {usuario.logo&&<img src={usuario.logo} alt="" style={{width:22,height:22,borderRadius:6,objectFit:"cover",flexShrink:0}} />}
            <span style={{fontSize:12,fontWeight:700,color:BRAND.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{usuario.tallerNombre||usuario.taller||"Mi Taller"}</span>
          </div>
          <div style={{padding:"8px 1rem",borderBottom:"0.5px solid "+BRAND.border,background:BRAND.card}}>
            <input style={{...S.input,width:"100%",padding:"6px 10px"}} placeholder="🔍 Buscar en todo..." value={gBusqueda} onChange={e=>setGBusqueda(e.target.value)} />
          </div>
        </div>
        <div style={{flex:1,padding:"1rem",overflowY:"auto"}}>
          {gBusqueda.trim()
            ? renderBusquedaGlobal()
            : <>
                {vista==="dashboard"  && renderDashboard()}
                {vista==="ordenes"    && renderOrdenes()}
                {vista==="terminadas" && renderTerminadas()}
                {vista==="historial"  && renderHistorial()}
                {vista==="nueva"      && renderNuevaOrden()}
                {vista==="equipo"     && puedePerm(usuario,"todo") && renderEquipo()}
                {vista==="exportar"   && <ExportarExcel ordenes={[...ordenes,...ordenesCobro,...ordenesCobradas,...ordenesTerminadas,...historial]} S={S} />}
              </>}
        </div>
      </div>
    </div>
  );
}