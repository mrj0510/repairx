import { useState, useRef, useEffect } from "react";

// ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────
const SUPA_URL  = import.meta.env.VITE_SUPABASE_URL;
const SUPA_KEY  = import.meta.env.VITE_SUPABASE_ANON_KEY;
const MODO_DEMO = !SUPA_URL || SUPA_URL.includes("TU_PROJECT_ID");
// Captcha de Cloudflare Turnstile. La site key es pública; la secret key vive solo en Supabase.
// Si está vacía (p. ej. una copia local sin configurar), la app funciona sin captcha.
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || "";
// Documentos legales (viven en el sitio). Si publicas una versión nueva de los términos o del aviso,
// cambia VERSION_LEGAL: cada cuenta nueva guarda la versión que aceptó al registrarse.
const URL_PRIVACIDAD = "https://repairx.com.mx/privacidad";
const URL_TERMINOS   = "https://repairx.com.mx/terminos";
const VERSION_LEGAL  = "2026-10-20";
// Suscripción con Mercado Pago: pega en "liga" el link de cada plan
// (Mercado Pago → Planes de suscripción → Compartir → Copiar link). Un plan sin link no se muestra.
// En "precio" escribe el texto tal como quieres que se lea, p. ej. "$499 al mes + IVA".
const PLANES_PAGO = [
  { nombre: "RepairX mensual", precio: "", liga: "" },
];
const PLANES_CON_LIGA = PLANES_PAGO.filter(p => /^https:\/\/\S+$/.test(String(p.liga || "").trim()));
// ─────────────────────────────────────────────────────────────────────────────

// ─── Identidad: fuente Archivo (alojada en /fonts, licencia SIL OFL) y favicon ─
const FUENTE_APP = '"Archivo", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
if (typeof document !== "undefined" && !document.getElementById("identidad-repairx")) {
  const estilo = document.createElement("style");
  estilo.id = "identidad-repairx";
  estilo.textContent =
    '@font-face{font-family:"Archivo";src:url("/fonts/archivo-variable.woff2") format("woff2");font-weight:100 900;font-stretch:62% 125%;font-style:normal;font-display:swap}' +
    "body{font-family:" + FUENTE_APP + "}button,input,select,textarea{font-family:inherit}";
  document.head.appendChild(estilo);
  let icono = document.querySelector('link[rel="icon"]');
  if (!icono) { icono = document.createElement("link"); icono.rel = "icon"; document.head.appendChild(icono); }
  icono.type = "image/svg+xml"; icono.href = "/favicon.svg";
}

function LogoRX({ alto = 20, centrado = false }) {
  return <img src="/img/logo-repairx.svg" alt="RepairX" style={{ height: alto, width: "auto", display: "block", margin: centrado ? "0 auto" : 0 }} />;
}

// Neutros: #FFFFFF (tarjetas) · #EEF2F6 (fondo) · #C8D2E0 (bordes) · #5A6B7F (texto secundario) · #1D2733 (texto).
// El naranja es el de la marca; verde, azul, rojo y ámbar indican estados.
const BRAND = {
  accent:"#FF5C35", accentB:"#FF8A65", green:"#00A37A", blue:"#2563EB",
  purple:"#7C3AED", bg:"#EEF2F6", card:"#FFFFFF", card2:"#FFFFFF",
  border:"#C8D2E0", text:"#1D2733", muted:"#5A6B7F", dimmed:"#C8D2E0",
};

const supaHeaders = {
  "Content-Type": "application/json",
  "apikey": SUPA_KEY,
  "Authorization": "Bearer " + SUPA_KEY,
};

// ─── Reglas de contraseña (deben coincidir con Supabase → Auth → Email) ─────────
// Supabase: Minimum length = 8 · Requirements = "Lowercase, uppercase letters and digits"
const REGLAS_PASSWORD = "Mínimo 8 caracteres, con mayúscula, minúscula y número.";
const validarPassword = pw => {
  if (pw.length < 8)       return "La contraseña debe tener al menos 8 caracteres.";
  if (!/[a-z]/.test(pw))   return "La contraseña debe incluir al menos una letra minúscula.";
  if (!/[A-Z]/.test(pw))   return "La contraseña debe incluir al menos una letra mayúscula.";
  if (!/[0-9]/.test(pw))   return "La contraseña debe incluir al menos un número.";
  return "";
};

// ─── Errores de Supabase Auth en español ──────────────────────────────────────
// Supabase responde en dos formatos: el clásico {error, error_description} y el
// nuevo {code, error_code, msg}. Se aceptan ambos.
const ERRORES_AUTH = {
  invalid_credentials:        "Correo o contraseña incorrectos.",
  weak_password:              "La contraseña no cumple los requisitos. " + REGLAS_PASSWORD,
  user_already_exists:        "Ya existe una cuenta con ese correo. Inicia sesión.",
  email_exists:               "Ya existe una cuenta con ese correo. Inicia sesión.",
  email_not_confirmed:        "Confirma tu correo antes de iniciar sesión.",
  over_request_rate_limit:    "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.",
  over_email_send_rate_limit: "Se alcanzó el límite de correos por hora. Inténtalo más tarde.",
  signup_disabled:            "El registro de cuentas está deshabilitado.",
  email_address_invalid:      "El correo no es válido.",
  same_password:              "La contraseña nueva debe ser distinta de la anterior.",
  captcha_failed:             "No pudimos confirmar que no eres un robot. Espera unos segundos e inténtalo de nuevo.",
};
const traducirErrorAuth = (data, status) => {
  const codigo = (data && data.error_code) || "";
  if (ERRORES_AUTH[codigo]) return ERRORES_AUTH[codigo];
  const txt = String((data && (data.error_description || data.msg || data.message || data.error)) || "");
  if (/invalid login credentials/i.test(txt))               return ERRORES_AUTH.invalid_credentials;
  if (/already (been )?registered|already exists/i.test(txt)) return ERRORES_AUTH.user_already_exists;
  if (/email not confirmed/i.test(txt))                     return ERRORES_AUTH.email_not_confirmed;
  if (/captcha/i.test(txt))                                 return ERRORES_AUTH.captcha_failed;
  if (/database error saving new user/i.test(txt))          return "No se pudo crear la cuenta. Si te estás uniendo a un taller, verifica el código e inténtalo de nuevo.";
  if (status === 429 || /rate limit/i.test(txt))            return ERRORES_AUTH.over_request_rate_limit;
  if (/password/i.test(txt) && /(at least|should|weak|contain|characters)/i.test(txt)) return ERRORES_AUTH.weak_password;
  return txt || "No se pudo completar la operación. Inténtalo de nuevo.";
};

// Supabase recibe el token del captcha dentro de gotrue_meta_security
const conCaptcha = token => token ? { gotrue_meta_security: { captcha_token: token } } : {};

// Corta una petición que no responde (red caída a medias) para poder reintentar
const limiteDeTiempo = ms => {
  if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) return AbortSignal.timeout(ms);
  const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal;
};

const supaAuth = {
  signIn: async (email, password, captcha) => {
    try {
      const r = await fetch(SUPA_URL + "/auth/v1/token?grant_type=password", {
        method: "POST", headers: { "Content-Type": "application/json", "apikey": SUPA_KEY },
        body: JSON.stringify({ email, password, ...conCaptcha(captcha) }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.access_token) return { error: traducirErrorAuth(data, r.status) };
      return { session: data, user: data.user };
    } catch { return { error: "No se pudo conectar con el servidor." }; }
  },
  signUp: async (email, password, metadata, captcha) => {
    try {
      const r = await fetch(SUPA_URL + "/auth/v1/signup", {
        method:"POST", headers:{ "Content-Type":"application/json","apikey":SUPA_KEY },
        body: JSON.stringify({ email, password, data: metadata, ...conCaptcha(captcha) }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return { error: traducirErrorAuth(data, r.status) };
      if (data.access_token) return { session: data, user: data.user };
      return { session: null, user: data.user || data };
    } catch { return { error: "No se pudo conectar con el servidor." }; }
  },
  // Envía el correo de recuperación. Supabase responde igual exista o no la cuenta
  // (así nadie puede averiguar qué correos están registrados).
  recuperar: async (email, captcha) => {
    try {
      const volverA = window.location.origin + "/";
      const r = await fetch(SUPA_URL + "/auth/v1/recover?redirect_to=" + encodeURIComponent(volverA), {
        method:"POST", headers:{ "Content-Type":"application/json","apikey":SUPA_KEY },
        body: JSON.stringify({ email, ...conCaptcha(captcha) }),
      });
      if (!r.ok) { const data = await r.json().catch(() => ({})); return { error: traducirErrorAuth(data, r.status) }; }
      return { ok: true };
    } catch { return { error: "No se pudo conectar con el servidor." }; }
  },
  // Cambia la contraseña usando el token temporal que trae el enlace del correo
  cambiarPassword: async (token, password) => {
    try {
      const r = await fetch(SUPA_URL + "/auth/v1/user", {
        method:"PUT", headers:{ "Content-Type":"application/json","apikey":SUPA_KEY,"Authorization":"Bearer "+token },
        body: JSON.stringify({ password }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.status === 401) return { error: "El enlace expiró. Solicita uno nuevo desde «¿Olvidaste tu contraseña?»." };
      if (!r.ok) return { error: traducirErrorAuth(data, r.status) };
      return { ok: true };
    } catch { return { error: "No se pudo conectar con el servidor." }; }
  },
  // alcance "local": solo esta sesión (este navegador) · "global": todos los dispositivos de la cuenta.
  // Devuelve true si el servidor la aceptó.
  signOut: async (token, alcance = "local") => {
    try {
      const r = await fetch(SUPA_URL + "/auth/v1/logout?scope=" + alcance, {
        method:"POST", headers:{ "Content-Type":"application/json","apikey":SUPA_KEY,"Authorization":"Bearer "+token },
        signal: limiteDeTiempo(15000),
      });
      return r.ok;
    } catch (_) { return false; }
  },
  // Renueva la sesión. Si falla, `definitivo` dice si la llave ya no sirve (hay que volver a entrar)
  // o si fue un problema pasajero (sin internet, servidor ocupado) y conviene reintentar.
  refreshSession: async (refreshToken) => {
    try {
      const r = await fetch(SUPA_URL + "/auth/v1/token?grant_type=refresh_token", {
        method:"POST", headers:{ "Content-Type":"application/json","apikey":SUPA_KEY },
        body: JSON.stringify({ refresh_token: refreshToken }),
        signal: limiteDeTiempo(15000),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data.access_token) return { session: data };
      const definitivo = r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429;
      return { error: traducirErrorAuth(data, r.status), definitivo };
    } catch { return { error: "No se pudo conectar con el servidor.", definitivo: false }; }
  },
};

const supaApi = {
  getPerfil: async (token, uid) => {
    const r = await fetch(SUPA_URL + "/rest/v1/perfiles?id=eq." + uid + "&select=*", { headers:{ ...supaHeaders,"Authorization":"Bearer "+token } });
    const d = await r.json(); return Array.isArray(d) ? d[0] : null;
  },
  // Confirma que un código existe y devuelve solo el nombre del taller.
  // No permite listar códigos: la tabla talleres ya no es legible sin sesión.
  verificarTaller: async (codigo) => {
    try {
      const r = await fetch(SUPA_URL + "/rest/v1/rpc/verificar_codigo_taller", {
        method:"POST", headers: supaHeaders, body: JSON.stringify({ p_codigo: codigo }),
      });
      if (!r.ok) return null;
      const nombre = await r.json();
      return nombre ? { nombre, codigo } : null;
    } catch { return null; }
  },
  // El servidor asigna el folio: dos personas creando órdenes a la vez nunca reciben el mismo número
  siguienteFolio: async (token) => {
    const r = await fetch(SUPA_URL + "/rest/v1/rpc/siguiente_folio", {
      method:"POST", headers:{ ...supaHeaders,"Authorization":"Bearer "+token }, body:"{}",
    });
    if (!r.ok) { let msg=""; try{ msg=await r.text(); }catch(_){} throw new Error("Error "+r.status+": "+(msg||"no se pudo generar el folio")); }
    const folio = await r.json();
    if (typeof folio !== "string" || !/^OT-\d+$/.test(folio)) throw new Error("Respuesta inesperada del servidor al generar el folio.");
    return folio;
  },
  // Renombra la MISMA fila (antes se creaba una fila nueva y la vieja quedaba como duplicado)
  renombrarOrden: async (token, tallerId, idViejo, idNuevo) => {
    const r = await fetch(SUPA_URL + "/rest/v1/ordenes?taller_id=eq." + encodeURIComponent(tallerId) + "&id=eq." + encodeURIComponent(idViejo) + "&select=version", {
      method:"PATCH",
      headers:{ ...supaHeaders,"Authorization":"Bearer "+token,"Prefer":"return=representation" },
      body: JSON.stringify({ id: idNuevo }),
    });
    if (r.status === 409) throw new Error("DUPLICADO");
    if (!r.ok) { let msg=""; try{ msg=await r.text(); }catch(_){} throw new Error("Error "+r.status+": "+(msg||"no se pudo renombrar")); }
    const d = await r.json().catch(() => []);
    return Array.isArray(d) && d[0] ? d[0].version : null;
  },
  getUsuariosTaller: async (token, taller) => {
    const r = await fetch(SUPA_URL + "/rest/v1/perfiles?taller=eq." + encodeURIComponent(taller) + "&select=id,nombre,rol,email&order=nombre", { headers:{ ...supaHeaders,"Authorization":"Bearer "+token } });
    return r.json();
  },
  actualizarRol: async (token, uid, rol) => {
    const r = await fetch(SUPA_URL + "/rest/v1/perfiles?id=eq." + uid, { method:"PATCH", headers:{ ...supaHeaders,"Authorization":"Bearer "+token,"Prefer":"return=representation" }, body: JSON.stringify({ rol }) });
    const data = await r.json().catch(() => null);
    if (!r.ok) throw new Error((data && data.message) || ("Error " + r.status));
    if (!Array.isArray(data) || data.length === 0) throw new Error("No tienes permiso para modificar a este usuario.");
    return data;
  },
  getOrdenes: async (token) => { const r = await fetch(SUPA_URL + "/rest/v1/ordenes?select=*&order=creado_en.desc", { headers:{ ...supaHeaders,"Authorization":"Bearer "+token } }); return r.json(); },
  // Crea una orden nueva. Si ya existe, avisa (no la sobrescribe).
  insertarOrden: async (token, fila) => {
    const r = await fetch(SUPA_URL + "/rest/v1/ordenes?select=version,actualizado_en", {
      method:"POST", headers:{ ...supaHeaders,"Authorization":"Bearer "+token,"Prefer":"return=representation" }, body: JSON.stringify(fila),
    });
    if (r.status === 409) { const e = new Error("La orden ya existe"); e.codigo = "EXISTE"; throw e; }
    if (!r.ok) { let msg=""; try{ msg=await r.text(); }catch(_){} throw new Error("Error "+r.status+": "+(msg||"no se pudo guardar")); }
    const d = await r.json().catch(() => null);
    return Array.isArray(d) ? d[0] : d;
  },
  // Guarda SOLO los campos que cambiaron, y solo si la orden sigue en la versión que conocemos.
  // Devuelve null si otra persona la modificó antes (hay que fusionar).
  actualizarOrden: async (token, tallerId, id, version, cambios) => {
    const url = SUPA_URL + "/rest/v1/ordenes?taller_id=eq." + encodeURIComponent(tallerId) + "&id=eq." + encodeURIComponent(id) + "&version=eq." + encodeURIComponent(version) + "&select=version,actualizado_en";
    const r = await fetch(url, { method:"PATCH", headers:{ ...supaHeaders,"Authorization":"Bearer "+token,"Prefer":"return=representation" }, body: JSON.stringify(cambios) });
    if (!r.ok) { let msg=""; try{ msg=await r.text(); }catch(_){} const e=new Error("Error "+r.status+": "+(msg||"no se pudo guardar"));
      // 403: la base de datos no le permite ese cambio a este usuario (p. ej. regresar de etapa sin ser administrador)
      if (r.status===403) { e.codigo="SIN_PERMISO"; try{ const j=JSON.parse(msg); if(j&&/administrador|permiso/i.test(j.message||"")) e.detalle=j.message; }catch(_){} }
      throw e; }
    const d = await r.json().catch(() => []);
    return Array.isArray(d) && d.length ? d[0] : null;
  },
  leerOrden: async (token, tallerId, id) => {
    const r = await fetch(SUPA_URL + "/rest/v1/ordenes?taller_id=eq." + encodeURIComponent(tallerId) + "&id=eq." + encodeURIComponent(id) + "&select=*", { headers:{ ...supaHeaders,"Authorization":"Bearer "+token } });
    if (!r.ok) throw new Error("Error " + r.status + " al leer la orden");
    const d = await r.json();
    return Array.isArray(d) && d.length ? d[0] : null;
  },
  // Órdenes que alguien modificó después de cierto momento
  ordenesDesde: async (token, desdeISO) => {
    const r = await fetch(SUPA_URL + "/rest/v1/ordenes?select=*&actualizado_en=gt." + encodeURIComponent(desdeISO) + "&order=actualizado_en.asc", { headers:{ ...supaHeaders,"Authorization":"Bearer "+token } });
    if (!r.ok) throw new Error("Error " + r.status);
    return r.json();
  },
  // Pizarrón de la TV: solo las unidades activas y solo lo que se muestra (ver migracion_pizarron_pantalla.sql).
  // Con la marca de la consulta anterior, si nada cambió la respuesta no trae la lista.
  pizarron: async (token, marca) => {
    const r = await fetch(SUPA_URL + "/rest/v1/rpc/pizarron", {
      method:"POST", headers:{ ...supaHeaders,"Authorization":"Bearer "+token }, body: JSON.stringify({ p_marca: marca || null }),
      signal: limiteDeTiempo(20000),
    });
    const datos = await r.json().catch(() => null);
    if (!r.ok) { const e = new Error((datos && datos.message) || ("Error " + r.status)); e.status = r.status; e.codigo = datos && datos.code; throw e; }
    return datos;
  },
};

// ─── STORAGE + UTILIDADES ─────────────────────────────────────────────────────
const BUCKET_FOTOS = "fotos";
const MAX_ARCHIVO_MB = 20;
const PAGE_SIZE = 8;

// ─── Archivos privados (bucket "fotos") ──────────────────────────────────────────
// El bucket es privado. Cada foto o documento guarda solo su RUTA (<taller>/<orden>/<archivo>);
// para mostrarlo, la app pide a Supabase un enlace temporal firmado. Solo los usuarios aprobados
// del taller dueño de la carpeta pueden obtenerlo (reglas en migracion_fotos_privadas.sql).
const VIGENCIA_ENLACE_S = 3600;            // cada enlace temporal dura 1 hora
const RENOVAR_ANTES_MS = 10 * 60 * 1000;   // se pide uno nuevo cuando le quedan menos de 10 minutos
const LOTE_FIRMAS = 100;                   // enlaces por pedido a Supabase
const TIPOS_ARCHIVO = {
  jpg:"image/jpeg", jpeg:"image/jpeg", png:"image/png", webp:"image/webp",
  pdf:"application/pdf", doc:"application/msword",
  docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls:"application/vnd.ms-excel",
  xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
const EXT_DOCUMENTO = ["pdf", "doc", "docx", "xls", "xlsx"];

// Las fotos subidas antes de este cambio guardaban la dirección pública completa:
// de ella se obtiene la ruta, sin migrar datos y sin importar de qué proyecto sea la dirección.
const RE_RUTA_STORAGE = new RegExp(`/storage/v1/object/(?:public|sign|authenticated)/${BUCKET_FOTOS}/([^?#]+)`);
const rutaArchivo = item => {
  if (!item) return null;
  if (item.ruta) return item.ruta;
  const m = RE_RUTA_STORAGE.exec(item.url || "");
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch (_) { return m[1]; }
};

const enlacesFirmados = new Map();   // ruta → { url, vence }
const sinAcceso = new Map();         // ruta → cuándo dijo Supabase que no existe o no se puede ver
const SIN_ACCESO_MS = 5 * 60 * 1000; // durante 5 minutos no se vuelve a preguntar por esa ruta
const sinAccesoReciente = ruta => { const t = sinAcceso.get(ruta); return !!t && Date.now() - t < SIN_ACCESO_MS; };
let colaFirmas = new Map();          // ruta → funciones que esperan su enlace
let loteProgramado = null;

const enlaceVigente = ruta => {
  const e = enlacesFirmados.get(ruta);
  return e && e.vence - Date.now() > RENOVAR_ANTES_MS ? e.url : null;
};

const firmarLote = async (token, rutas) => {
  for (let i = 0; i < rutas.length; i += LOTE_FIRMAS) {
    const parte = rutas.slice(i, i + LOTE_FIRMAS);
    const pedido = Date.now();
    const r = await fetch(`${SUPA_URL}/storage/v1/object/sign/${BUCKET_FOTOS}`, {
      method:"POST",
      headers:{ "apikey":SUPA_KEY, "Authorization":"Bearer "+token, "Content-Type":"application/json" },
      body:JSON.stringify({ expiresIn:VIGENCIA_ENLACE_S, paths:parte }),
    });
    if (!r.ok) continue;   // falla general (red, sesión): el componente vuelve a intentar
    const datos = await r.json().catch(() => []);
    (Array.isArray(datos) ? datos : []).forEach((d, j) => {
      const ruta = (d && d.path) || parte[j];
      if (d && d.signedURL && !d.error) {
        enlacesFirmados.set(ruta, { url:encodeURI(`${SUPA_URL}/storage/v1${d.signedURL}`), vence:pedido + VIGENCIA_ENLACE_S * 1000 });
        sinAcceso.delete(ruta);
      } else if (d && d.error) sinAcceso.set(ruta, Date.now());
    });
  }
};

// Las imágenes que se dibujan al mismo tiempo piden su enlace juntas: un solo pedido para todas.
const pedirEnlace = (token, ruta) => {
  const vigente = enlaceVigente(ruta);
  if (vigente) return Promise.resolve(vigente);
  if (sinAccesoReciente(ruta)) return Promise.resolve(null);
  return new Promise(resolve => {
    if (!colaFirmas.has(ruta)) colaFirmas.set(ruta, []);
    colaFirmas.get(ruta).push(resolve);
    if (loteProgramado) return;
    loteProgramado = setTimeout(async () => {
      const lote = colaFirmas;
      colaFirmas = new Map();
      loteProgramado = null;
      try { await firmarLote(token, [...lote.keys()]); } catch (_) { /* sin conexión: se reintenta */ }
      lote.forEach((esperan, r) => { const url = enlaceVigente(r); esperan.forEach(fn => fn(url)); });
    }, 0);
  });
};

const supaStorage = {
  // Sube un archivo a <taller>/<orden>/<fecha>_<nombre> y devuelve su ruta (no una dirección pública)
  subirArchivo: async (token, taller, ordenId, blob, nombre) => {
    const safeTaller = String(taller||"taller").replace(/[^a-zA-Z0-9]/g,"_");
    const safeOrden = String(ordenId||"orden").replace(/[^a-zA-Z0-9_-]/g,"_");
    const safeNombre = String(nombre||"archivo").replace(/[^a-zA-Z0-9.]/g,"_");
    const ruta = `${safeTaller}/${safeOrden}/${Date.now()}_${safeNombre}`;
    const ext = safeNombre.includes(".") ? safeNombre.split(".").pop().toLowerCase() : "";
    const r = await fetch(`${SUPA_URL}/storage/v1/object/${BUCKET_FOTOS}/${ruta}`, {
      method:"POST",
      headers:{ "apikey":SUPA_KEY, "Authorization":"Bearer "+token, "Content-Type":TIPOS_ARCHIVO[ext]||blob.type||"application/octet-stream" },
      body:blob,
    });
    if (!r.ok) {
      let detalle = "";
      try { const j = await r.json(); detalle = String(j.message || j.error || ""); } catch (_) {}
      if (r.status === 413 || /size|large|exceed/i.test(detalle)) throw new Error(`supera el límite de ${MAX_ARCHIVO_MB} MB del servidor.`);
      if (/mime|type/i.test(detalle)) throw new Error("el servidor no acepta este tipo de archivo.");
      throw new Error("no se pudo subir al servidor. Revisa tu conexión e inténtalo de nuevo.");
    }
    return ruta;
  },
  // Borra archivos del bucket. Solo funciona en la carpeta del propio taller.
  borrarArchivos: async (token, rutas) => {
    const lista = (rutas || []).filter(Boolean);
    if (!lista.length) return 0;
    lista.forEach(x => enlacesFirmados.delete(x));
    const r = await fetch(`${SUPA_URL}/storage/v1/object/${BUCKET_FOTOS}`, {
      method:"DELETE",
      headers:{ "apikey":SUPA_KEY, "Authorization":"Bearer "+token, "Content-Type":"application/json" },
      body:JSON.stringify({ prefixes:lista }),
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const borrados = await r.json().catch(() => []);
    return Array.isArray(borrados) ? borrados.length : 0;
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// PIPELINE UNIVERSAL DE IMÁGENES
// Recibe cualquier formato (incluido HEIC de iPhone) y siempre devuelve un
// JPEG comprimido a un objetivo de peso. Un solo punto de entrada para toda
// la app: fotos de orden, foto principal, logo y documentos-imagen.
// ═══════════════════════════════════════════════════════════════════════════

// Presets: lado mayor en px + peso objetivo en KB
const PRESET_IMG = {
  foto:    { maxLado: 1920, objetivoKB: 350 },  // fotos del vehículo (ver daños)
  portada: { maxLado:  900, objetivoKB: 120 },  // foto principal de la orden
  logo:    { maxLado:  240, objetivoKB:  30 },  // logo del taller
  doc:     { maxLado: 1600, objetivoKB: 300 },  // documentos escaneados
};
const CALIDAD_INICIAL = 0.85;
const CALIDAD_MINIMA  = 0.45;   // por debajo de esto la foto ya no sirve para peritaje

const obtenerExtension = (nombre) => {
  const m = /\.([a-zA-Z0-9]+)$/.exec(nombre || "");
  return m ? m[1].toLowerCase() : "";
};

const EXTS_HEIC   = ["heic","heif"];
const EXTS_IMAGEN = ["jpg","jpeg","png","webp","gif","bmp","avif","tif","tiff","heic","heif"];

// Windows manda MIME vacío en HEIC → hay que revisar también la extensión
const esHEIC = (f) => {
  if (f.type === "image/heic" || f.type === "image/heif") return true;
  return EXTS_HEIC.includes(obtenerExtension(f.name));
};

const pareceImagen = (f) => {
  if (f.type && f.type.startsWith("image/")) return true;
  return EXTS_IMAGEN.includes(obtenerExtension(f.name));
};

// Windows no lista archivos .heic bajo "image/*": hay que nombrarlos aparte
const ACCEPT_IMG = "image/*,.heic,.heif";

const nombreJpg = (nombre) => String(nombre || "foto").replace(/\.[^.]+$/, "") + ".jpg";

// ── HEIC/HEIF: fotos de iPhone y de muchos Android ──
// Safari las abre solo; Chrome, Edge, Brave y Firefox no. Para ellos se usa heic-to en su
// versión para CSP estricta: decodifica en un worker (blob:) sin eval ni new Function, así que
// funciona con la política de seguridad de vercel.json sin aflojarla.
// Pesa ~3 MB: se descarga solo la primera vez que alguien sube una HEIC (import dinámico).
const TIMEOUT_HEIC_MS = 60000;   // margen para fotos de 24 a 48 MP en celulares lentos

const MENSAJE_HEIC = (nombre) =>
  `No se pudo convertir «${nombre}» (formato HEIC/HEIF): puede estar dañada o en una variante poco común.\n\n` +
  `Cómo resolverlo:\n\n` +
  `1. Ábrela en el celular o en la app "Fotos" de Windows, guárdala como JPEG y súbela otra vez.\n\n` +
  `2. Para que no vuelva a pasar, configura tu cámara en JPEG:\n` +
  `   • iPhone: Ajustes → Cámara → Formatos → "Más compatible"\n` +
  `   • Samsung: Cámara → Ajustes → Opciones avanzadas → desactivar "Imágenes HEIF"`;

const errorHEIC = (nombre) => {
  const e = new Error(MENSAJE_HEIC(nombre));
  e.codigo = "HEIC_NO_SOPORTADO";
  return e;
};

// Una HEIC empieza con la caja "ftyp" y una marca HEIF: así se reconoce aunque llegue con otra
// extensión o sin tipo (pasa al copiar fotos de Android a Windows).
const MARCAS_HEIF = ["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"];
const contenidoEsHEIF = async (file) => {
  try {
    const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const txt = String.fromCharCode(...b);
    return txt.slice(4, 8) === "ftyp" && MARCAS_HEIF.includes(txt.slice(8, 12));
  } catch { return false; }
};

// Red de seguridad: un archivo corrupto o un worker que muere nunca deben dejar la app colgada
const conTimeout = (promesa, ms) => {
  let timer;
  const limite = new Promise((_, rechazar) => {
    timer = setTimeout(() => rechazar(new Error("TIMEOUT")), ms);
  });
  return Promise.race([promesa, limite]).finally(() => clearTimeout(timer));
};

let _heicTo = null;
const cargarConvertidorHEIC = () => {
  if (!_heicTo) _heicTo = import("heic-to/csp").then(m => m.heicTo).catch(e => { _heicTo = null; throw e; });
  return _heicTo;
};

// HEIC → ImageBitmap listo para dibujar en canvas (sin pasar por un JPEG intermedio)
const convertirHEIC = async (file) => {
  if (typeof Worker !== "function" || typeof createImageBitmap !== "function") throw errorHEIC(file.name);
  let heicTo;
  try {
    heicTo = await cargarConvertidorHEIC();
  } catch {
    throw new Error("no se pudo descargar el convertidor de fotos HEIC. Revisa tu conexión e inténtalo de nuevo.");
  }
  try {
    const bitmap = await conTimeout(heicTo({ blob: file, type: "bitmap" }), TIMEOUT_HEIC_MS);
    if (!bitmap || !bitmap.width) throw new Error("CONVERSION_VACIA");
    return bitmap;
  } catch {
    throw errorHEIC(file.name);
  }
};

// Carga un archivo en un <img> listo para dibujar en canvas
const cargarEnImagen = (file) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("El navegador no pudo decodificar este archivo.")); };
  img.src = url;
});

// Redimensiona y baja la calidad por pasos hasta alcanzar el objetivo de KB
const comprimirAObjetivo = async (img, maxLado, objetivoKB) => {
  const ladoMayor = Math.max(img.width, img.height) || 1;
  const escala = Math.min(1, maxLado / ladoMayor);
  const c = document.createElement("canvas");
  c.width  = Math.max(1, Math.round(img.width  * escala));
  c.height = Math.max(1, Math.round(img.height * escala));
  const ctx = c.getContext("2d");
  // Fondo blanco: sin esto, los PNG/WebP con transparencia salen con fondo negro en JPEG
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);

  const aBlob = (q) => new Promise(res => c.toBlob(res, "image/jpeg", q));

  let calidad = CALIDAD_INICIAL;
  let blob = await aBlob(calidad);
  while (blob && blob.size > objetivoKB * 1024 && calidad > CALIDAD_MINIMA) {
    calidad = Math.max(CALIDAD_MINIMA, Math.round((calidad - 0.1) * 100) / 100);
    blob = await aBlob(calidad);
  }
  if (!blob) throw new Error("No se pudo comprimir la imagen.");
  return { blob, dataUrl: c.toDataURL("image/jpeg", calidad), calidad, ancho: c.width, alto: c.height };
};

// ── Punto de entrada único ──
// procesarImagen(archivo, "foto" | "portada" | "logo" | "doc") → { blob, dataUrl, ... }
// Abre cualquier imagen: primero con el navegador (Safari abre HEIC solo) y, si no puede y es
// HEIC por nombre o por contenido, con el convertidor.
const abrirImagen = async (file) => {
  try {
    return await cargarEnImagen(file);
  } catch (errorNavegador) {
    if (esHEIC(file) || await contenidoEsHEIF(file)) return convertirHEIC(file);
    throw errorNavegador;
  }
};

const procesarImagen = async (file, preset = "foto") => {
  const cfg = PRESET_IMG[preset] || PRESET_IMG.foto;
  const img = await abrirImagen(file);
  try {
    return await comprimirAObjetivo(img, cfg.maxLado, cfg.objetivoKB);
  } finally {
    if (typeof img.close === "function") img.close();   // libera la memoria de la foto decodificada
  }
};
// ═══════════════════════════════════════════════════════════════════════════

const generarIdOrden = (...listas) => {
  let max = 0;
  listas.flat().forEach(o => { const m=/^OT-(\d+)$/.exec((o&&o.id)||""); if(m)max=Math.max(max,parseInt(m[1],10)); });
  return "OT-" + String(max+1).padStart(3,"0");
};

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
  refacciones:Array.isArray(row.refacciones)?row.refacciones:[],
  enTransito:!!row.en_transito, fechaTransito:row.fecha_transito||"", llegada:row.llegada||"",
});

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
  refacciones:o.refacciones||[],
  en_transito:!!o.enTransito, fecha_transito:o.fechaTransito||null, llegada:o.llegada||null,
});

// ─── Edición simultánea: guardar solo cambios + fusionar ─────────────────────
// Cada orden tiene un número de versión en la base de datos. Al guardar se envían
// SOLO los campos que cambiaron, y solo si la versión sigue siendo la que teníamos.
// Si otra persona guardó antes, se descarga su versión y se combinan ambas:
//   · fotos, documentos, novedades, refacciones: se suman los elementos que agregó
//     cada quien y se respetan los borrados;
//   · bitácora: se juntan las entradas nuevas de ambos;
//   · campos simples: si solo uno lo cambió, gana ese cambio; si ambos cambiaron el
//     mismo campo a valores distintos, se conserva el de la otra persona y se avisa.
const CAMPOS_FIJOS  = ["id", "taller_id"];
const LISTAS_CON_ID = ["fotos", "documentos", "novedades", "refacciones"];
const ETIQUETAS_CAMPO = {
  en_transito:"la ubicación (piso o tránsito)", llegada:"cómo llegó la unidad", fecha_transito:"la fecha de tránsito", fecha_reingreso:"la fecha de reingreso",
  estado:"el estado", notas:"las notas", costo:"el costo", tecnico:"el técnico", cliente:"el cliente",
  telefono:"el teléfono", vehiculo:"el vehículo", placa:"la placa", serie:"el VIN", siniestro:"el siniestro",
  color:"el color", servicio:"el servicio", entrega:"la fecha de entrega", fecha_promesa:"la fecha de entrega", foto_principal:"la foto principal",
  fotos:"una foto", documentos:"un documento", novedades:"una novedad", refacciones:"una refacción",
  descuento:"el descuento", motivo_cierre:"el motivo de cierre", metodo_pago:"el método de pago",
};

// JSON con llaves ordenadas: la base devuelve las llaves en otro orden que el navegador
const estable = v => {
  if (Array.isArray(v)) return "[" + v.map(estable).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ":" + estable(v[k])).join(",") + "}";
  return JSON.stringify(v === undefined ? null : v);
};
const igual = (a, b) => estable(a) === estable(b);
const comoLista = v => Array.isArray(v) ? v : [];
const claveItem = x => (x && x.id != null) ? "id:" + String(x.id) : "js:" + estable(x);

const fusionarLista = (base, local, remota) => {
  base = comoLista(base); local = comoLista(local); remota = comoLista(remota);
  const B = new Map(base.map(x => [claveItem(x), x]));
  const L = new Map(local.map(x => [claveItem(x), x]));
  const R = new Map(remota.map(x => [claveItem(x), x]));
  const lista = []; let conflicto = false;
  for (const r of remota) {
    const k = claveItem(r);
    if (B.has(k) && !L.has(k)) {                       // yo lo borré…
      if (!igual(r, B.get(k))) { lista.push(r); conflicto = true; }   // …pero el otro lo modificó: se conserva
      continue;
    }
    if (B.has(k) && L.has(k)) {
      const l = L.get(k), b = B.get(k);
      if (igual(l, b) || igual(l, r)) lista.push(r);   // no lo toqué, o ambos igual
      else if (igual(r, b)) lista.push(l);             // solo yo lo modifiqué
      else { lista.push(r); conflicto = true; }        // ambos distinto: gana el otro
      continue;
    }
    lista.push(r);                                     // lo agregó el otro
  }
  for (const l of local) {
    const k = claveItem(l);
    if (R.has(k)) continue;
    if (!B.has(k)) lista.push(l);                                   // lo agregué yo
    else if (!igual(l, B.get(k))) { lista.push(l); conflicto = true; } // el otro lo borró, pero yo lo modifiqué: se conserva
  }
  return { lista, conflicto };
};

// a − b contando repeticiones (dos entradas idénticas en la bitácora son dos eventos)
const restarMultiset = (a, b) => {
  const cuenta = new Map();
  for (const x of b) { const k = estable(x); cuenta.set(k, (cuenta.get(k) || 0) + 1); }
  return a.filter(x => { const k = estable(x); const n = cuenta.get(k) || 0; if (n > 0) { cuenta.set(k, n - 1); return false; } return true; });
};
const fusionarBitacora = (base, local, remota) => {
  base = comoLista(base); local = comoLista(local); remota = comoLista(remota);
  const mias = restarMultiset(local, base), suyas = restarMultiset(remota, base);
  return remota.concat(restarMultiset(mias, suyas));   // sin duplicar si ya se guardaron
};

const fusionarOrden = (base, local, remota) => {
  base = base || {};
  const fila = { ...remota }; const conflictos = [];
  for (const c of Object.keys(local)) {
    if (CAMPOS_FIJOS.includes(c)) continue;
    if (LISTAS_CON_ID.includes(c)) {
      const { lista, conflicto } = fusionarLista(base[c], local[c], remota[c]);
      fila[c] = lista; if (conflicto) conflictos.push(c);
    } else if (c === "bitacora") {
      fila[c] = fusionarBitacora(base[c], local[c], remota[c]);
    } else {
      const l = local[c], b = base[c], r = remota[c];
      if (igual(l, b)) continue;                                   // no lo cambié: se queda lo del otro
      if (igual(r, b) || igual(l, r)) { fila[c] = l; continue; }   // solo yo lo cambié
      conflictos.push(c);                                          // ambos, distinto: se queda lo del otro
    }
  }
  return { fila, conflictos };
};

const diferencias = (base, fila) => {
  const cambios = {};
  for (const c of Object.keys(fila)) {
    if (CAMPOS_FIJOS.includes(c)) continue;
    if (!igual(fila[c], base ? base[c] : undefined)) cambios[c] = fila[c];
  }
  return cambios;
};

// Guarda una orden enviando solo lo que cambió. Si otra persona guardó antes,
// descarga su versión, fusiona y reintenta. Devuelve la nueva base y versión, y la
// fila fusionada (para mostrarla) cuando hubo que combinar cambios.
const sincronizarFila = async (token, filaLocal, entrada) => {
  let base, version, fila = filaLocal, fusionada = null, conflictos = [];
  if (!entrada) {
    try {
      const r = await supaApi.insertarOrden(token, filaLocal);
      return { base: filaLocal, version: (r && r.version) || 1, actualizadoEn: r ? r.actualizado_en : null, fusionada: null, conflictos };
    } catch (e) {
      if (e.codigo !== "EXISTE") throw e;
      base = {}; version = null;          // ya existía (p. ej. un reintento): se fusiona
    }
  } else { base = entrada.base; version = entrada.version; }
  const baseOriginal = base;
  for (let intento = 0; intento < 4; intento++) {
    if (version !== null) {
      const cambios = diferencias(base, fila);
      if (!Object.keys(cambios).length) return { base: fila, version, actualizadoEn: null, fusionada, conflictos };
      const r = await supaApi.actualizarOrden(token, filaLocal.taller_id, filaLocal.id, version, cambios);
      if (r) return { base: fila, version: r.version, actualizadoEn: r.actualizado_en, fusionada, conflictos };
    }
    // Otra persona guardó antes: se descarga su versión y se combinan los cambios
    const remotaRaw = await supaApi.leerOrden(token, filaLocal.taller_id, filaLocal.id);
    if (!remotaRaw) { const e = new Error(`La orden ${filaLocal.id} ya no existe en el servidor (quizá fue renombrada). Recarga la página.`); e.codigo = "NO_EXISTE"; throw e; }
    const remota = ordenToDB(dbToOrden(remotaRaw), filaLocal.taller_id);
    const res = fusionarOrden(baseOriginal, filaLocal, remota);
    base = remota; version = remotaRaw.version; fila = res.fila; fusionada = res.fila; conflictos = res.conflictos;
  }
  throw new Error(`Demasiados cambios simultáneos en ${filaLocal.id}; se reintentará.`);
};

function useDesktop(bp=900) {
  const [d, setD] = useState(typeof window!=="undefined" && window.innerWidth>=bp);
  useEffect(() => { const h=()=>setD(window.innerWidth>=bp); window.addEventListener("resize",h); return ()=>window.removeEventListener("resize",h); }, [bp]);
  return d;
}

const SESION_KEY = "repairx_sesion";
// Guarda la sesión de esta pestaña sin regresar nunca a una llave más vieja que la guardada
// (otra pestaña pudo haberla renovado mientras tanto).
const guardarSesion = u => {
  try {
    const previa = leerSesion();
    const datos = previa && u && previa.id === u.id && previa.refreshToken && (previa.expiresAt || 0) > (u.expiresAt || 0)
      ? { ...u, token: previa.token, refreshToken: previa.refreshToken, expiresAt: previa.expiresAt }
      : u;
    const texto = JSON.stringify(datos);
    if (localStorage.getItem(SESION_KEY) !== texto) localStorage.setItem(SESION_KEY, texto);
  } catch (_) {}
};
const leerSesion   = () => { try { const s=localStorage.getItem(SESION_KEY); return s?JSON.parse(s):null; } catch(_){ return null; } };
// Los enlaces de Supabase regresan a la app con los datos en la URL:
//   #access_token=...&type=recovery          (enlace válido)
//   #error=...&error_code=otp_expired        (enlace vencido o ya usado)
const leerHashAuth = () => {
  try {
    const hash  = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
    const query = new URLSearchParams(window.location.search || "");
    const get = k => hash.get(k) || query.get(k);
    const accessToken = hash.get("access_token");
    const error = get("error_description") || get("error");
    if (!accessToken && !error) return null;
    return { tipo: hash.get("type"), accessToken, error, errorCode: get("error_code") };
  } catch { return null; }
};
// Quita tokens de la barra de direcciones y del historial del navegador
const limpiarHash = () => { try { window.history.replaceState(null, "", window.location.pathname); } catch (_) {} };

const borrarSesion = () => { try { localStorage.removeItem(SESION_KEY); } catch(_){} };

// ─── Sesión compartida entre pestañas ────────────────────────────────────────────
// Todas las pestañas usan la sesión guardada en este navegador. Supabase entrega una llave de
// renovación nueva cada vez y, si alguien vuelve a usar una llave vieja, cierra la sesión completa
// (lo trata como un robo). Por eso las pestañas se turnan para renovar (navigator.locks) y, antes
// de hacerlo, leen la llave más reciente: si otra pestaña ya renovó, usan la suya sin pedir nada.
const RENOVAR_SESION_ANTES_MS = 2 * 60 * 1000;   // se renueva cuando a la llave le quedan menos de 2 minutos
const REVISAR_SESION_MS = 30 * 1000;
const INACTIVIDAD_MAX_MS = 12 * 60 * 60 * 1000;  // 12 horas sin usar la app: se cierra la sesión
const ACTIVIDAD_KEY = "repairx_ultima_actividad"; // compartida: usar cualquier pestaña cuenta para todas
const CIERRE_KEY = "repairx_cierre";              // por qué se cerró la sesión, para avisar en las demás pestañas
const MENSAJES_CIERRE = {
  inactividad: "Se cerró tu sesión después de 12 horas sin uso. Vuelve a iniciar sesión.",
  vencida:     "Tu sesión terminó. Vuelve a iniciar sesión.",
  todos:       "Cerraste la sesión en todos tus dispositivos.",
  rol:         "La cuenta de esta pantalla cambió de rol. Vuelve a iniciar sesión.",
};

const sesionVigente = (u, margen = RENOVAR_SESION_ANTES_MS) => !!(u && u.token && u.expiresAt && u.expiresAt - Date.now() > margen);
const llavesDe = session => ({ token: session.access_token, refreshToken: session.refresh_token, expiresAt: Date.now() + (session.expires_in || 3600) * 1000 });

const leerActividad = () => { try { return Number(localStorage.getItem(ACTIVIDAD_KEY)) || 0; } catch (_) { return 0; } };
const marcarActividad = (t = Date.now()) => { try { localStorage.setItem(ACTIVIDAD_KEY, String(t)); } catch (_) {} };
const inactivoDemasiado = () => { const t = leerActividad(); return t > 0 && Date.now() - t > INACTIVIDAD_MAX_MS; };

const avisarCierre = motivo => { try { localStorage.setItem(CIERRE_KEY, JSON.stringify({ motivo, t: Date.now() })); } catch (_) {} };
const avisoDeCierre = () => {
  try {
    const c = JSON.parse(localStorage.getItem(CIERRE_KEY) || "null");
    const texto = c && Date.now() - c.t < 60 * 1000 ? MENSAJES_CIERRE[c.motivo] : null;
    return texto ? { tipo: "info", texto } : null;
  } catch (_) { return null; }
};

const conTurnoDeSesion = tarea =>
  typeof navigator !== "undefined" && navigator.locks && navigator.locks.request
    ? navigator.locks.request("repairx-sesion", tarea)
    : tarea();

// Renueva la sesión de `actual`, o adopta la que otra pestaña ya renovó. Devuelve:
//   { usuario }                     sesión renovada
//   { definitivo: true }            la sesión ya no existe en el servidor: hay que volver a entrar
//   { definitivo: false }           falla pasajera (sin internet, servidor ocupado): reintentar después
//   { ajena: true, definitivo: true } en este navegador ya no está esta sesión (se cerró o entró otra cuenta)
const renovarSesionCompartida = actual => conTurnoDeSesion(async () => {
  const guardada = leerSesion();
  if (!guardada || guardada.id !== actual.id || !guardada.refreshToken) return { ajena: true, definitivo: true };
  if (guardada.refreshToken !== actual.refreshToken && sesionVigente(guardada))
    return { usuario: { ...actual, token: guardada.token, refreshToken: guardada.refreshToken, expiresAt: guardada.expiresAt } };
  // Se usa siempre la llave más reciente (la de mayor vencimiento) entre la guardada y la de esta pestaña
  const llave = (actual.expiresAt || 0) > (guardada.expiresAt || 0) ? actual.refreshToken : guardada.refreshToken;
  const { session, error, definitivo } = await supaAuth.refreshSession(llave);
  if (session) {
    const llaves = llavesDe(session);
    guardarSesion({ ...guardada, ...llaves });   // todavía con el turno: la siguiente pestaña ya ve la llave nueva
    return { usuario: { ...actual, ...llaves } };
  }
  if (definitivo) { avisarCierre("vencida"); borrarSesion(); }
  return { error, definitivo: !!definitivo };
});

const ROLES = {
  admin:    { label:"Administrador", color:"#FF5C35", permisos:["todo"] },
  asesor:   { label:"Asesor",        color:"#3B82F6", permisos:["ver_ordenes","crear_ordenes","editar_ordenes","novedades","documentos","fotos"] },
  valuador: { label:"Valuador",      color:"#8B5CF6", permisos:["ver_ordenes","ficha","novedades","documentos"] },
  // Cuenta para la TV del taller: solo ve el pizarrón (sin teléfonos, costos ni fotos) y no modifica nada
  pantalla: { label:"Pantalla (TV)", color:"#0F766E", permisos:[] },
};
const ROLES_EQUIPO = ["admin", "asesor", "valuador"];

const DEMOS = [
  { id:"u1", nombre:"Carlos Mendoza", email:"admin@taller.com",    pass:"admin123",    rol:"admin",    taller:"Taller AutoPro", av:"A" },
  { id:"u2", nombre:"Roberto Lopez",  email:"asesor@taller.com",   pass:"asesor123",   rol:"asesor",   taller:"Taller AutoPro", av:"R" },
  { id:"u3", nombre:"Ana Ramirez",    email:"valuador@taller.com", pass:"valuador123", rol:"valuador", taller:"Taller AutoPro", av:"V" },
];

const puedePerm = (usr, perm) => { if(!usr)return false; const p=(ROLES[usr.rol]||{}).permisos||[]; return p.includes("todo")||p.includes(perm); };

const ESTADOS = [
  { key:"presupuesto", label:"Presupuesto", color:"#5A6B7F" },
  { key:"mecanica",    label:"Mecánica",    color:"#3B82F6" },
  { key:"hojalateria", label:"Hojalatería", color:"#F59E0B" },
  { key:"pintura",     label:"Pintura",     color:"#EF4444" },
  { key:"armado",      label:"Armado",      color:"#00C896" },
];
const PASOS    = ESTADOS.map(e=>e.key);
// CAMBIO 1: ya no se precargan nombres de técnicos. El campo "Técnico" es de texto libre.
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
  {key:"general",     label:"General",     color:"#5A6B7F"},
];
const DIAS_HIST = 30;
const DIAS_TERM = 365;

// Fecha de hoy "AAAA-MM-DD" según el reloj del dispositivo (hora de México). Antes se tomaba la fecha UTC
// y, desde las 6 p. m., las órdenes, la bitácora y los cierres quedaban con la fecha del día siguiente.
const hoy   = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
// Días completos desde una fecha "AAAA-MM-DD" hasta hoy (0 si es hoy, futura o no es una fecha)
const dDias = f => difDias(f, hoy()) || 0;
const cDias = f => (f ? difDias(f, hoy()) || 0 : 0);

// ─── Contador de días desde el alta ───────────────────────────────────────────
const DIAS_ALERTA = 20;   // a partir de aquí la orden se marca en rojo

// Orden de las listas por fecha de alta; empata por número de folio
const fechaAlta = o => (o && (o.fecha || o.fechaPrimerIngreso)) || "";
const numFolio = o => { const m = /(\d+)$/.exec((o && o.id) || ""); return m ? parseInt(m[1], 10) : 0; };
const ordenarPorAlta = (lista, sentido) => lista.slice().sort((a, b) => {
  const c = fechaAlta(a).localeCompare(fechaAlta(b)) || (numFolio(a) - numFolio(b));
  return sentido === "antiguas" ? c : -c;
});
const diasEnTransito = o => (o && o.enTransito && o.fechaTransito) ? difDias(o.fechaTransito, hoyLocal()) : null;   // días que la unidad lleva fuera del taller esperando piezas

// Diferencia en días entre dos fechas "YYYY-MM-DD", sin líos de zona horaria
const difDias = (desde, hasta) => {
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(desde || "");
  const b = /^(\d{4})-(\d{2})-(\d{2})/.exec(hasta || "");
  if (!a || !b) return null;
  const ta = Date.UTC(+a[1], +a[2] - 1, +a[3]);
  const tb = Date.UTC(+b[1], +b[2] - 1, +b[3]);
  return Math.max(0, Math.round((tb - ta) / 86400000));
};

const hoyLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Cuenta desde el alta hasta hoy; si la orden ya terminó o se cerró, se congela en esa fecha
const diasDesdeAlta = o => {
  const alta = o && (o.fecha || o.fechaPrimerIngreso);
  if (!alta) return null;
  const fin = (o.fechaTerminado || o.fechaCierre) || hoyLocal();
  return difDias(alta, fin);
};

// Gama de color: verde (día 0) → amarillo → naranja (día 20) → rojo (más de 20)
const colorDias = d => {
  if (d > DIAS_ALERTA) return { texto: "hsl(0, 75%, 42%)", fondo: "hsla(0, 85%, 50%, 0.14)", borde: "hsla(0, 85%, 45%, 0.55)" };
  const h = Math.round(140 - (125 * d) / DIAS_ALERTA);          // 140 (verde) → 15 (naranja-rojo)
  const l = h > 35 && h < 85 ? 34 : 38;                          // amarillos más oscuros para que se lean sobre blanco
  return { texto: `hsl(${h}, 75%, ${l}%)`, fondo: `hsla(${h}, 85%, 50%, 0.13)`, borde: `hsla(${h}, 80%, 42%, 0.40)` };
};

// ─── Integración futura con Perito Valuador ───────────────────────────────────
// Mientras esté vacío, el botón aparece como "Próximamente".
// Al lanzar, pon aquí la URL de la app y el botón se activa solo.
const PERITO_VALUADOR_URL = "";

// Días en taller: desde el ingreso (o el último reingreso) hasta la entrega
const diasEnTaller = o => {
  const ini = (o && (o.fechaReingreso || o.fechaPrimerIngreso)) || "";
  if (!ini) return 0;
  const fin = (o && (o.fechaEntregaReal || fechaEntregaOrden(o))) || hoy();
  const d = difDias(ini, fin);
  return d === null ? cDias(ini) : d;
};

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
  card:     {background:BRAND.card,border:"1px solid "+BRAND.border,borderRadius:12,padding:"1rem 1.25rem",boxShadow:"0 1px 3px rgba(29,39,51,0.06)"},
  metric:   {background:BRAND.card,border:"1px solid "+BRAND.border,borderRadius:12,padding:"1rem 1.25rem",textAlign:"center",boxShadow:"0 1px 3px rgba(29,39,51,0.06)"},
  btn:      {background:BRAND.accent,color:"#fff",border:"none",borderRadius:10,padding:"0.5rem 1.1rem",cursor:"pointer",fontSize:13,fontWeight:600},
  btnGreen: {background:BRAND.green, color:"#fff",border:"none",borderRadius:10,padding:"0.5rem 1.1rem",cursor:"pointer",fontSize:13,fontWeight:600},
  btnDanger:{background:"#FEE2E2",   color:"#B91C1C",border:"1px solid #FCA5A5",borderRadius:10,padding:"0.5rem 1.1rem",cursor:"pointer",fontSize:13,fontWeight:500},
  btnSm:    col=>({background:col||BRAND.bg,color:col?"#fff":BRAND.text,border:"none",borderRadius:7,padding:"4px 10px",cursor:"pointer",fontSize:11,fontWeight:500}),
  input:    {background:"#FFFFFF",border:"1px solid "+BRAND.border,borderRadius:9,padding:"0.5rem 0.8rem",color:BRAND.text,fontSize:13,width:"100%",boxSizing:"border-box"},
  select:   {background:"#FFFFFF",border:"1px solid "+BRAND.border,borderRadius:9,padding:"0.5rem 0.8rem",color:BRAND.text,fontSize:13,width:"100%",boxSizing:"border-box"},
  label:    {fontSize:11,color:BRAND.muted,marginBottom:3,display:"block"},
  overlay:  {position:"fixed",inset:0,background:"rgba(29,39,51,0.45)",zIndex:900,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(4px)"},
  modalBox: {background:BRAND.card,border:"1px solid "+BRAND.border,borderRadius:16,padding:"1.5rem",width:340,maxWidth:"90vw",boxShadow:"0 24px 60px rgba(29,39,51,0.25)"},
});

// ─── Login / Registro ─────────────────────────────────────────────────────────
// ─── Captcha (Cloudflare Turnstile) ────────────────────────────────────────────
let promesaTurnstile = null;
const cargarTurnstile = () => {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!promesaTurnstile) {
    promesaTurnstile = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("sin turnstile")));
      script.onerror = () => { promesaTurnstile = null; reject(new Error("bloqueado")); };
      document.head.appendChild(script);
    });
  }
  return promesaTurnstile;
};

// Invisible casi siempre: Cloudflare solo pide interacción si algo le parece sospechoso.
// Cada token sirve una sola vez; al cambiar "reinicio" se pide uno nuevo.
function Captcha({ onToken, reinicio }) {
  const cajaRef = useRef(null);
  const widgetRef = useRef(null);
  const [falla, setFalla] = useState("");
  useEffect(() => {
    let vivo = true;
    cargarTurnstile().then(ts => {
      if (!vivo || !cajaRef.current) return;
      widgetRef.current = ts.render(cajaRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        language: "es",
        theme: "light",
        size: "flexible",
        appearance: "interaction-only",
        callback: token => { setFalla(""); onToken(token); },
        "expired-callback": () => onToken(""),
        "timeout-callback": () => onToken(""),
        "error-callback": codigo => {
          onToken("");
          setFalla("La verificación de seguridad falló" + (codigo ? ` (código ${codigo})` : "") + ". Recarga la página e inténtalo de nuevo.");
        },
      });
    }).catch(() => {
      if (vivo) setFalla("No se pudo cargar la verificación de seguridad. Si usas un bloqueador de anuncios o los escudos de Brave, desactívalos para este sitio y recarga la página.");
    });
    return () => {
      vivo = false;
      if (widgetRef.current !== null && window.turnstile) { try { window.turnstile.remove(widgetRef.current); } catch (_) {} }
    };
  }, []);
  useEffect(() => {
    if (!reinicio || widgetRef.current === null || !window.turnstile) return;
    onToken("");
    try { window.turnstile.reset(widgetRef.current); } catch (_) {}
  }, [reinicio]);
  return (
    <div style={{marginBottom:12}}>
      <div ref={cajaRef} />
      {falla && <div role="alert" style={{background:"#F59E0B1A",border:"0.5px solid #F59E0B66",borderRadius:8,padding:"8px 12px",fontSize:12,color:"#92400E",marginTop:8}}>{falla}</div>}
    </div>
  );
}

// ─── Mostrar y descargar archivos privados ───────────────────────────────────────
// Las fotos del modo demostración y los documentos guardados antes dentro de la orden ya traen su
// contenido (data:) y se usan tal cual; todo lo demás pide un enlace temporal y lo renueva solo.
function useEnlaceArchivo(item, token) {
  const ruta = rutaArchivo(item);
  const directo = ruta ? null : (item && item.url) || null;
  const inicial = directo || (ruta ? enlaceVigente(ruta) : null);
  const [url, setUrl] = useState(inicial);
  const [estado, setEstado] = useState(inicial ? "listo" : ruta && !sinAccesoReciente(ruta) ? "cargando" : "no-disponible");
  // Si el componente pasa a mostrar otro archivo, nunca se queda con el enlace del anterior
  useEffect(() => {
    const u = directo || (ruta ? enlaceVigente(ruta) : null);
    setUrl(u);
    setEstado(u ? "listo" : ruta && !sinAccesoReciente(ruta) ? "cargando" : "no-disponible");
  }, [ruta, directo]);
  useEffect(() => {
    if (!ruta || !token) return;
    let vivo = true, reloj = null;
    const cargar = () => pedirEnlace(token, ruta).then(u => {
      if (!vivo) return;
      if (u) {
        setUrl(u); setEstado("listo");
        const e = enlacesFirmados.get(ruta);
        // Se renueva antes de vencer: la descarga sigue funcionando aunque la orden quede abierta horas.
        reloj = setTimeout(cargar, Math.max(60000, (e ? e.vence : Date.now()) - Date.now() - RENOVAR_ANTES_MS + 1000));
      } else if (sinAccesoReciente(ruta)) {
        setUrl(null); setEstado("no-disponible");
      } else {
        reloj = setTimeout(cargar, 15000);   // sin conexión o sesión renovándose: se vuelve a intentar
      }
    });
    cargar();
    return () => { vivo = false; clearTimeout(reloj); };
  }, [ruta, token]);
  return { url, estado };
}

function ImagenArchivo({ item, token, alt, style, onClick }) {
  const { url, estado } = useEnlaceArchivo(item, token);
  if (url) return <img src={url} alt={alt || ""} style={style} onClick={onClick} />;
  return (
    <div role="img" aria-label={alt || "Archivo"} onClick={onClick}
      style={{ ...style, minWidth:80, minHeight:60, display:"flex", alignItems:"center", justifyContent:"center",
        background:BRAND.bg, color:BRAND.muted, fontSize:11, textAlign:"center", padding:6, boxSizing:"border-box" }}>
      {estado === "no-disponible" ? "Archivo no disponible" : "Cargando…"}
    </div>
  );
}

function EnlaceArchivo({ item, token, nombre, style, children }) {
  const { url, estado } = useEnlaceArchivo(item, token);
  // En un enlace firmado, el parámetro download hace que el archivo se descargue con su nombre original.
  const href = !url ? undefined : url.startsWith("data:") ? url : `${url}&download=${encodeURIComponent(nombre || "archivo")}`;
  return (
    <a href={href} download={nombre} target="_blank" rel="noreferrer" aria-disabled={!url}
      title={url ? "Descargar" : estado === "no-disponible" ? "Archivo no disponible" : "Preparando descarga…"}
      style={{ ...style, opacity:url ? 1 : 0.45, pointerEvents:url ? "auto" : "none" }}>{children}</a>
  );
}

function ReglasPassword({ pw }) {
  const reglas = [
    { ok: pw.length >= 8,   t: "8+ caracteres" },
    { ok: /[A-Z]/.test(pw), t: "Mayúscula" },
    { ok: /[a-z]/.test(pw), t: "Minúscula" },
    { ok: /[0-9]/.test(pw), t: "Número" },
  ];
  return (
    <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:16}}>
      {reglas.map(r => (
        <span key={r.t} style={{fontSize:11,padding:"2px 9px",borderRadius:20,fontWeight:600,background:r.ok?BRAND.green+"1A":BRAND.bg,color:r.ok?BRAND.green:BRAND.muted,border:"1px solid "+(r.ok?BRAND.green+"55":BRAND.border)}}>
          {r.ok ? "✓" : "○"} {r.t}
        </span>
      ))}
    </div>
  );
}

function NuevaPasswordScreen({ token, onListo, onCancelar }) {
  const [pw,setPw]=useState(""); const [pw2,setPw2]=useState("");
  const [err,setErr]=useState(""); const [loading,setL]=useState(false);
  const iStyle = { display:"block",width:"100%",boxSizing:"border-box",background:BRAND.bg,border:"0.5px solid "+BRAND.border,borderRadius:9,padding:"0.6rem 0.8rem",color:BRAND.text,fontSize:13,outline:"none",marginBottom:12 };
  const lab = t => <label style={{fontSize:11,color:BRAND.muted,marginBottom:4,display:"block"}}>{t}</label>;
  const guardar = async () => {
    const ep = validarPassword(pw); if (ep) { setErr(ep); return; }
    if (pw !== pw2) { setErr("Las contraseñas no coinciden."); return; }
    setL(true); setErr("");
    const { error } = await supaAuth.cambiarPassword(token, pw);
    if (error) { setErr(error); setL(false); return; }
    await supaAuth.signOut(token, "global");   // con la contraseña nueva, se cierran las sesiones en todos los dispositivos
    onListo();
  };
  const onKey = e => { if (e.key === "Enter") guardar(); };
  return (
    <div style={{minHeight:"100vh",background:BRAND.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"1.5rem"}}>
      <div style={{fontSize:36,fontWeight:900,letterSpacing:3,marginBottom:28}}><LogoRX alto={30} centrado /></div>
      <div style={{background:BRAND.card2,border:"1px solid "+BRAND.border,borderRadius:16,padding:"1.75rem",width:"100%",maxWidth:380,boxShadow:"0 12px 40px rgba(29,39,51,0.12)"}}>
        <div style={{fontSize:15,fontWeight:700,marginBottom:4}}>Crea tu nueva contraseña</div>
        <div style={{fontSize:12,color:BRAND.muted,marginBottom:18}}>Al guardarla se cerrará la sesión en todos tus dispositivos.</div>
        {lab("Nueva contraseña")}
        <input style={{...iStyle,marginBottom:8}} type="password" autoComplete="new-password" autoFocus placeholder="••••••••" value={pw} onChange={e=>setPw(e.target.value)} onKeyDown={onKey} />
        <ReglasPassword pw={pw} />
        {lab("Confirma la contraseña")}
        <input style={iStyle} type="password" autoComplete="new-password" placeholder="••••••••" value={pw2} onChange={e=>setPw2(e.target.value)} onKeyDown={onKey} />
        {pw2 && pw !== pw2 && <div style={{fontSize:11,color:"#EF4444",marginTop:-6,marginBottom:12}}>Las contraseñas no coinciden</div>}
        {err&&<div style={{background:"#EF444422",border:"0.5px solid #EF444444",borderRadius:8,padding:"8px 12px",fontSize:12,color:"#EF4444",marginBottom:14}}>{err}</div>}
        <button style={{width:"100%",background:BRAND.accent,color:"#fff",border:"none",borderRadius:10,padding:"0.75rem",fontSize:14,fontWeight:700,cursor:loading?"not-allowed":"pointer",opacity:loading?0.7:1}} onClick={guardar} disabled={loading}>{loading?"Guardando...":"Guardar contraseña"}</button>
        <button type="button" onClick={onCancelar} style={{width:"100%",marginTop:10,background:"none",border:"none",color:BRAND.muted,fontSize:12,cursor:"pointer"}}>Cancelar</button>
      </div>
    </div>
  );
}

function PantallaPendiente({ usuario, onActualizar, onLogout }) {
  const [revisando, setRevisando] = useState(false);
  const [nota, setNota] = useState("");
  const rechazado = usuario.rol === "rechazado";
  const taller = usuario.tallerNombre || "el taller";
  const revisar = async (silencioso = false) => {
    if (!silencioso) { setRevisando(true); setNota(""); }
    try {
      const perfil = await supaApi.getPerfil(usuario.token, usuario.id);
      if (perfil && perfil.rol && perfil.rol !== usuario.rol) {
        onActualizar({ ...usuario, rol: perfil.rol, taller: perfil.taller || usuario.taller, tallerNombre: perfil.taller_nombre || usuario.tallerNombre });
        return;
      }
      if (!silencioso) setNota("Tu solicitud sigue en espera. Vuelve a revisar más tarde.");
    } catch { if (!silencioso) setNota("No se pudo consultar. Revisa tu conexión."); }
    finally { if (!silencioso) setRevisando(false); }
  };
  // Revisa sola cada minuto: así la pantalla del taller abre el pizarrón en cuanto el administrador la aprueba
  // (o la vuelve a aprobar después de haberle quitado el acceso)
  useEffect(() => {
    if (usuario.modoDemo) return;
    const iv = setInterval(() => { if (!document.hidden) revisar(true); }, 60 * 1000);
    return () => clearInterval(iv);
  }, [rechazado, usuario.token]);
  return (
    <div style={{minHeight:"100vh",background:BRAND.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"1.5rem"}}>
      <div style={{fontSize:36,fontWeight:900,letterSpacing:3,marginBottom:28}}><LogoRX alto={30} centrado /></div>
      <div style={{background:BRAND.card2,border:"1px solid "+BRAND.border,borderRadius:16,padding:"1.75rem",width:"100%",maxWidth:380,boxShadow:"0 12px 40px rgba(29,39,51,0.12)",textAlign:"center"}}>
        <div style={{fontSize:40,marginBottom:10}}>{rechazado ? "⛔" : "⏳"}</div>
        <div style={{fontSize:16,fontWeight:700,marginBottom:8}}>{rechazado ? "Solicitud no aprobada" : "Solicitud en espera"}</div>
        <div style={{fontSize:13,color:BRAND.muted,lineHeight:1.55,marginBottom:18}}>
          {rechazado
            ? <>El administrador de <b style={{color:BRAND.text}}>{taller}</b> no aprobó tu acceso. Si crees que es un error, comunícate con él.</>
            : <>Tu solicitud para unirte a <b style={{color:BRAND.text}}>{taller}</b> está esperando la aprobación del administrador. Cuando te apruebe, pulsa «Revisar de nuevo».</>}
        </div>
        {nota && <div style={{fontSize:12,color:BRAND.muted,background:BRAND.bg,borderRadius:8,padding:"8px 12px",marginBottom:12}}>{nota}</div>}
        {!rechazado && <button onClick={()=>revisar()} disabled={revisando} style={{width:"100%",background:BRAND.accent,color:"#fff",border:"none",borderRadius:10,padding:"0.7rem",fontSize:14,fontWeight:700,cursor:revisando?"wait":"pointer",opacity:revisando?0.7:1,marginBottom:8}}>{revisando ? "Revisando..." : "Revisar de nuevo"}</button>}
        <button onClick={onLogout} style={{width:"100%",background:"none",border:"1px solid "+BRAND.border,color:BRAND.muted,borderRadius:10,padding:"0.6rem",fontSize:13,cursor:"pointer"}}>Cerrar sesión</button>
      </div>
    </div>
  );
}

function LoginScreen({ onLogin, aviso }) {
  const [modo,setModo]=useState("login");
  const [em,setEm]=useState(""); const [pw,setPw]=useState("");
  const [nombre,setNombre]=useState(""); const [tallerNombre,setTallerNombre]=useState(""); const [codigo,setCodigo]=useState("");
  const [logo,setLogo]=useState(null); const logoRef=useRef();
  const [acepto,setAcepto]=useState(false);
  const faltaAceptar = () => { if (!acepto) { setErr("Para registrarte, acepta los Términos y condiciones y el Aviso de privacidad."); return true; } return false; };
  const aceptacionLegal = () => ({ acepto_terminos: VERSION_LEGAL, acepto_terminos_en: new Date().toISOString() });
  const captchaActivo = !!TURNSTILE_SITE_KEY && !MODO_DEMO;
  const [captcha,setCaptcha]=useState(""); const [reinicioCaptcha,setReinicioCaptcha]=useState(0);
  const nuevoCaptcha = () => { if (captchaActivo) setReinicioCaptcha(n => n + 1); };
  const faltaCaptcha = () => { if (captchaActivo && !captcha) { setErr("Espera un momento: estamos verificando que no eres un robot."); return true; } return false; };
  const [err,setErr]=useState(aviso&&aviso.tipo==="error"?aviso.texto:""); const [info,setInfo]=useState(aviso&&aviso.tipo==="info"?aviso.texto:""); const [loading,setL]=useState(false);

  const onLogo = async e => {
    const f=e.target.files[0]; if(!f){return;}
    if(!f.type.startsWith("image/")){ setErr("El logo debe ser una imagen."); e.target.value=""; return; }
    try{ const { dataUrl }=await procesarImagen(f,"logo"); setLogo(dataUrl); setErr(""); }catch(ex){ setErr(ex.codigo==="HEIC_NO_SOPORTADO" ? ex.message : "No se pudo procesar el logo: "+ex.message); }
    e.target.value="";
  };

  // CAMBIO 3: completarLogin con reintento robusto para esperar al trigger on_auth_user_created
  const completarLogin = async (session, user) => {
    let perfil = null;
    for (let i = 0; i < 3; i++) {
      try {
        perfil = await supaApi.getPerfil(session.access_token, user.id);
        if (perfil?.taller) break; // Si ya tiene taller, salir del loop
      } catch(_) {}
      if (i < 2) await new Promise(r => setTimeout(r, 800)); // esperar 800ms antes de reintentar
    }
    onLogin({
      id: user.id, email: user.email,
      nombre: perfil?.nombre || user.email.split("@")[0],
      av: (perfil?.nombre || user.email)[0].toUpperCase(),
      rol: perfil?.rol || "pendiente",
      taller: perfil?.taller || "",
      tallerNombre: perfil?.taller_nombre || perfil?.taller || "Mi Taller",
      logo: perfil?.taller_logo || null,
      token: session.access_token,
      refreshToken: session.refresh_token,
      expiresAt: Date.now() + (session.expires_in || 3600) * 1000,
      modoDemo: false
    });
  };

  const doLogin = async () => {
    if(!em.trim()||!pw){setErr("Completa todos los campos.");return;}
    if(faltaCaptcha()) return;
    setL(true);setErr("");setInfo("");
    if(MODO_DEMO){ setTimeout(()=>{ const u=DEMOS.find(x=>x.email===em.trim().toLowerCase()&&x.pass===pw); if(u)onLogin({...u,modoDemo:true,token:null,refreshToken:null,tallerNombre:u.taller,logo:null}); else {setErr("Email o contraseña incorrectos.");setL(false);} },600); return; }
    const { session, user, error } = await supaAuth.signIn(em.trim().toLowerCase(), pw, captcha);
    nuevoCaptcha();
    if(error){setErr(error);setL(false);return;}
    await completarLogin(session, user);
  };

  const doCrear = async () => {
    if(!tallerNombre.trim()||!nombre.trim()||!em.trim()||!pw){setErr("Completa todos los campos.");return;}
    { const ep=validarPassword(pw); if(ep){setErr(ep);return;} }
    if(faltaAceptar()) return;
    if(faltaCaptcha()) return;
    setL(true);setErr("");setInfo("");
    const { session, user, error } = await supaAuth.signUp(em.trim().toLowerCase(), pw, { accion:"crear_taller", nombre:nombre.trim(), taller_nombre:tallerNombre.trim(), logo:logo||"", ...aceptacionLegal() }, captcha);
    nuevoCaptcha();
    if(error){setErr(error);setL(false);return;}
    if(session&&session.access_token) await completarLogin(session, user);
    else { setInfo("¡Taller registrado! Si te pide confirmar el correo, hazlo y luego inicia sesión. Tu código aparecerá en la sección Equipo."); setModo("login"); setL(false); }
  };

  const doUnir = async () => {
    if(!codigo.trim()||!nombre.trim()||!em.trim()||!pw){setErr("Completa todos los campos.");return;}
    { const ep=validarPassword(pw); if(ep){setErr(ep);return;} }
    if(faltaAceptar()) return;
    if(faltaCaptcha()) return;
    setL(true);setErr("");setInfo("");
    const taller = await supaApi.verificarTaller(codigo.trim().toUpperCase());
    if(!taller){ setErr("El código de taller no existe. Verifícalo con tu administrador."); setL(false); return; }
    const { session, user, error } = await supaAuth.signUp(em.trim().toLowerCase(), pw, { accion:"unir", nombre:nombre.trim(), taller_codigo:codigo.trim().toUpperCase(), ...aceptacionLegal() }, captcha);
    nuevoCaptcha();
    if(error){setErr(error);setL(false);return;}
    if(session&&session.access_token) await completarLogin(session, user);
    else { setInfo("¡Solicitud enviada a "+taller.nombre+"! Si te pide confirmar el correo, hazlo. Podrás entrar cuando el administrador del taller te apruebe."); setModo("login"); setL(false); }
  };

  const doRecuperar = async () => {
    const correo = em.trim().toLowerCase();
    if (!correo || !correo.includes("@")) { setErr("Escribe el correo con el que te registraste."); return; }
    if (faltaCaptcha()) return;
    setL(true); setErr(""); setInfo("");
    const { error } = await supaAuth.recuperar(correo, captcha);
    nuevoCaptcha();
    setL(false);
    if (error) { setErr(error); return; }
    setInfo("Si ese correo tiene una cuenta, te enviamos un enlace para crear una contraseña nueva. Revisa también la carpeta de spam. El enlace vence en 1 hora.");
  };

  const submit = () => modo==="recuperar"?doRecuperar():modo==="login"?doLogin():modo==="crear"?doCrear():doUnir();
  const onKey = e => { if (e.key==="Enter") submit(); };
  const iStyle = { display:"block",width:"100%",boxSizing:"border-box",background:BRAND.bg,border:"0.5px solid "+BRAND.border,borderRadius:9,padding:"0.6rem 0.8rem",color:BRAND.text,fontSize:13,outline:"none",marginBottom:12 };
  const lab = t => <label style={{fontSize:11,color:BRAND.muted,marginBottom:4,display:"block"}}>{t}</label>;
  const cambiarModo = m => { setModo(m); setErr(""); setInfo(""); };

  return (
    <div style={{minHeight:"100vh",background:BRAND.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"1.5rem"}}>
      <div style={{textAlign:"center",marginBottom:28}}>
        <div style={{fontSize:36,fontWeight:900,letterSpacing:3,marginBottom:6}}><LogoRX alto={30} centrado /></div>
        <div style={{fontSize:12,color:BRAND.muted,letterSpacing:1,textTransform:"uppercase"}}>Gestión inteligente de taller</div>
      </div>
      <div style={{background:BRAND.card2,border:"1px solid "+BRAND.border,borderRadius:16,padding:"1.75rem",width:"100%",maxWidth:380,boxShadow:"0 12px 40px rgba(29,39,51,0.12)"}}>
        {!MODO_DEMO&&(
          <div style={{display:"flex",gap:4,marginBottom:18,background:BRAND.bg,borderRadius:10,padding:3}}>
            {[{k:"login",l:"Entrar"},{k:"crear",l:"Registrar taller"},{k:"unir",l:"Unirme"}].map(t=>(
              <button key={t.k} onClick={()=>cambiarModo(t.k)} style={{flex:1,padding:"7px 4px",fontSize:11,fontWeight:600,borderRadius:8,border:"none",cursor:"pointer",background:(modo===t.k||(t.k==="login"&&modo==="recuperar"))?BRAND.accent:"transparent",color:(modo===t.k||(t.k==="login"&&modo==="recuperar"))?"#fff":BRAND.muted}}>{t.l}</button>
            ))}
          </div>
        )}
        <div style={{fontSize:15,fontWeight:700,marginBottom:4}}>{modo==="recuperar"?"Recuperar contraseña":modo==="login"?"Iniciar sesión":modo==="crear"?"Registrar un taller":"Unirme a un taller"}</div>
        <div style={{fontSize:12,color:BRAND.muted,marginBottom:18}}>
          {MODO_DEMO?<span style={{color:"#F59E0B"}}>⚠️ Modo demo — configura Supabase para producción</span>
            :modo==="recuperar"?"Te enviaremos un enlace a tu correo para crear una contraseña nueva":modo==="login"?"Ingresa con tu cuenta"
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
            <input ref={logoRef} type="file" accept={ACCEPT_IMG} style={{display:"none"}} onChange={onLogo} />
          </div>
        </>}
        {modo==="unir"&&<>{lab("Código del taller")}<input style={{...iStyle,letterSpacing:2,textTransform:"uppercase",fontFamily:"monospace"}} placeholder="Ej. AUTOPRO-7F3K" value={codigo} onChange={e=>setCodigo(e.target.value.toUpperCase())} onKeyDown={onKey} /></>}
        {(modo==="crear"||modo==="unir")&&<>{lab("Tu nombre")}<input style={iStyle} placeholder="Nombre y apellido" value={nombre} onChange={e=>setNombre(e.target.value)} onKeyDown={onKey} /></>}
        {lab("Correo electrónico")}
        <input style={iStyle} type="email" placeholder="tu@taller.com" value={em} onChange={e=>setEm(e.target.value)} onKeyDown={onKey} autoComplete="email" />
        {modo!=="recuperar"&&<>
        {lab("Contraseña")}
        <input style={{...iStyle,marginBottom:modo==="login"?(MODO_DEMO?18:6):8}} type="password" placeholder="••••••••" value={pw} onChange={e=>setPw(e.target.value)} onKeyDown={onKey} autoComplete={modo==="login"?"current-password":"new-password"} />
        {modo==="login"&&!MODO_DEMO&&<div style={{textAlign:"right",marginBottom:14}}><button type="button" onClick={()=>cambiarModo("recuperar")} style={{background:"none",border:"none",color:BRAND.accent,fontSize:12,fontWeight:600,cursor:"pointer",padding:0}}>¿Olvidaste tu contraseña?</button></div>}
        {modo!=="login"&&<ReglasPassword pw={pw} />}
        </>}
        {err&&<div style={{background:"#EF444422",border:"0.5px solid #EF444444",borderRadius:8,padding:"8px 12px",fontSize:12,color:"#EF4444",marginBottom:14}}>{err}</div>}
        {info&&<div style={{background:BRAND.green+"22",border:"0.5px solid "+BRAND.green+"44",borderRadius:8,padding:"8px 12px",fontSize:12,color:BRAND.green,marginBottom:14}}>{info}</div>}
        {(modo==="crear"||modo==="unir")&&(
          <label style={{display:"flex",gap:9,alignItems:"flex-start",fontSize:12,color:BRAND.text,lineHeight:1.45,marginBottom:14,cursor:"pointer"}}>
            <input type="checkbox" checked={acepto} onChange={e=>{ setAcepto(e.target.checked); if (e.target.checked) setErr(""); }} style={{margin:"1px 0 0",width:16,height:16,flexShrink:0,accentColor:BRAND.accent,cursor:"pointer"}} />
            <span>Acepto los <a href={URL_TERMINOS} target="_blank" rel="noopener noreferrer" style={{color:BRAND.accent,fontWeight:600}}>Términos y condiciones</a> y el <a href={URL_PRIVACIDAD} target="_blank" rel="noopener noreferrer" style={{color:BRAND.accent,fontWeight:600}}>Aviso de privacidad</a> de RepairX.</span>
          </label>
        )}
        {captchaActivo&&<Captcha onToken={setCaptcha} reinicio={reinicioCaptcha} />}
        <button style={{width:"100%",background:BRAND.accent,color:"#fff",border:"none",borderRadius:10,padding:"0.75rem",fontSize:14,fontWeight:700,cursor:(loading||(captchaActivo&&!captcha))?"not-allowed":"pointer",opacity:(loading||(captchaActivo&&!captcha))?0.7:1}} onClick={submit} disabled={loading||(captchaActivo&&!captcha)}>
          {loading?"Procesando...":modo==="recuperar"?"Enviar enlace":modo==="login"?"Entrar":modo==="crear"?"Crear taller":"Unirme"}
        </button>
        {captchaActivo&&!captcha&&!loading&&<div style={{fontSize:11,color:BRAND.muted,textAlign:"center",marginTop:8}}>Verificando que no eres un robot…</div>}
        {modo==="recuperar"&&<button type="button" onClick={()=>cambiarModo("login")} style={{width:"100%",marginTop:10,background:"none",border:"none",color:BRAND.muted,fontSize:12,cursor:"pointer"}}>← Volver a iniciar sesión</button>}
      </div>
      <div style={{marginTop:18,fontSize:11,color:BRAND.muted,textAlign:"center"}}>
        <a href={URL_PRIVACIDAD} target="_blank" rel="noopener noreferrer" style={{color:BRAND.muted}}>Aviso de privacidad</a>
        <span aria-hidden="true"> · </span>
        <a href={URL_TERMINOS} target="_blank" rel="noopener noreferrer" style={{color:BRAND.muted}}>Términos y condiciones</a>
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

function UsuarioBadge({ usuario, onLogout, onLogoutTodos }) {
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
          <div style={{position:"absolute",right:0,top:"calc(100% + 6px)",background:BRAND.card2,border:"0.5px solid "+BRAND.border,borderRadius:12,padding:"0.75rem",minWidth:240,zIndex:401,boxShadow:"0 8px 24px #00000066"}}>
            <div style={{fontSize:13,fontWeight:600,marginBottom:2}}>{usuario.nombre}</div>
            <div style={{fontSize:11,color:BRAND.muted,marginBottom:2}}>{usuario.email}</div>
            <div style={{fontSize:11,color:BRAND.muted,marginBottom:2}}>{usuario.tallerNombre||usuario.taller}</div>
            {usuario.taller&&!usuario.modoDemo&&<div style={{fontSize:10,color:BRAND.muted,marginBottom:12}}>Código: <span style={{color:BRAND.accent,fontWeight:700,fontFamily:"monospace"}}>{usuario.taller}</span></div>}
            {(!usuario.taller||usuario.modoDemo)&&<div style={{marginBottom:12}} />}
            <div style={{fontSize:10,color:BRAND.muted,marginBottom:6,textTransform:"uppercase",letterSpacing:0.5}}>Permisos</div>
            {rol.permisos.includes("todo")?<div style={{fontSize:11,color:BRAND.green,marginBottom:12}}>Acceso completo</div>:<div style={{marginBottom:12}}>{rol.permisos.map(p=><div key={p} style={{fontSize:11,color:BRAND.muted,marginBottom:2}}>{p.replace(/_/g," ")}</div>)}</div>}
            <button onClick={()=>{onLogout();setOpen(false);}} style={{width:"100%",background:"#FEF2F2",color:"#B91C1C",border:"0.5px solid #FECACA",borderRadius:8,padding:"7px",cursor:"pointer",fontSize:12,fontWeight:600}}>Cerrar sesión</button>
            {!usuario.modoDemo&&onLogoutTodos&&<button onClick={()=>{setOpen(false);onLogoutTodos();}} style={{width:"100%",background:"none",border:"none",color:BRAND.muted,padding:"8px 0 0",cursor:"pointer",fontSize:11,textDecoration:"underline"}}>Cerrar sesión en todos mis dispositivos</button>}
          </div>
        </>
      )}
    </div>
  );
}

function Sidebar({ vista, setVista, setOrdenSel, hLen, tLen, desktop, esAdmin, logo, tallerNombre, pendientes, refPend, refAtrasadas, pizAlertas }) {
  const [open, setOpen] = useState(false);
  const NAV = [
    {id:"dashboard", icon:"📊", label:"Dashboard"},
    {id:"ordenes",   icon:"📋", label:"Órdenes"},
    {id:"pizarron",  icon:"📺", label:"Pizarrón"+(pizAlertas?" ("+pizAlertas+") ⚠":"")},
    {id:"refacciones", icon:"📦", label:"Refacciones"+(refPend?" ("+refPend+")":"")+(refAtrasadas?" ⚠":"")},
    {id:"terminadas",icon:"🏁", label:"Terminadas"+(tLen?" ("+tLen+")":"")},
    {id:"historial", icon:"🗂️", label:"Historial"+(hLen?" ("+hLen+")":"")},
    {id:"nueva",     icon:"➕", label:"Nueva Orden"},
    {id:"exportar",  icon:"📊", label:"Exportar Excel"},
    ...(esAdmin ? [{id:"equipo", icon:"👥", label:"Equipo"+(pendientes?" 🔔 "+pendientes:"")}] : []),
  ];
  const go = id => { setVista(id); setOrdenSel(null); setOpen(false); };
  const panel = (
    <div style={{position:"fixed",top:0,left:0,height:"100%",width:240,background:BRAND.card,borderRight:"0.5px solid "+BRAND.border,zIndex:201,display:"flex",flexDirection:"column",transform:desktop?"none":(open?"translateX(0)":"translateX(-100%)"),transition:desktop?"none":"transform 0.25s ease",boxShadow:(!desktop&&open)?"6px 0 32px #00000099":"none"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"1rem 1.25rem",borderBottom:"0.5px solid "+BRAND.border}}>
        <div>
          <div style={{fontSize:18,fontWeight:900,letterSpacing:2}}><LogoRX alto={17} /></div>
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
        <div style={{fontSize:9,color:BRAND.dimmed,marginTop:2}}>v1.2</div>
        <div style={{fontSize:10,marginTop:6,display:"flex",gap:10,flexWrap:"wrap"}}>
          <a href={URL_PRIVACIDAD} target="_blank" rel="noopener noreferrer" style={{color:BRAND.muted}}>Privacidad</a>
          <a href={URL_TERMINOS} target="_blank" rel="noopener noreferrer" style={{color:BRAND.muted}}>Términos</a>
        </div>
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

function EditarId({ o, ordenes, setOrdenes, setOrdenSel, fSize, puedeAdmin, usuario, onRenombrado }) {
  const [edit,setEdit]=useState(false); const [val,setVal]=useState(o.id); const ref=useRef();
  const [guardandoId,setGuardandoId]=useState(false);
  const ok=async()=>{
    const nv=val.trim()||o.id;
    if(nv===o.id){ setEdit(false); return; }
    if(!/^[A-Za-z0-9_-]{1,20}$/.test(nv)){ alert("Usa solo letras, números y guiones (máximo 20 caracteres)."); return; }
    if(ordenes.some(x=>x.id===nv)){ alert("Ya existe una orden con ese número."); return; }
    if(usuario&&!usuario.modoDemo){
      setGuardandoId(true);
      try{ const version = await supaApi.renombrarOrden(usuario.token, o.tallerId||usuario.taller, o.id, nv); if (onRenombrado) onRenombrado(o.id, nv, version); }
      catch(e){ setGuardandoId(false); alert(e.message==="DUPLICADO"?"Ya existe una orden con ese número en tu taller (puede estar en Cobro, Terminadas o Historial).":"No se pudo renombrar la orden. "+e.message); return; }
      setGuardandoId(false);
    }
    const upd=ordenes.map(x=>x.id===o.id?{...x,id:nv}:x); setOrdenes(upd); setOrdenSel(upd.find(x=>x.id===nv)||null); setEdit(false);
  };
  const cancel=()=>{ setVal(o.id); setEdit(false); };
  useEffect(()=>{ if(edit&&ref.current)ref.current.focus(); },[edit]);
  if (edit) return (
    <div style={{display:"flex",alignItems:"center",gap:4}} onClick={e=>e.stopPropagation()}>
      <input ref={ref} value={val} onChange={e=>setVal(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")ok();if(e.key==="Escape")cancel();}} style={{background:BRAND.bg,border:"1px solid "+BRAND.accent,borderRadius:6,padding:"2px 7px",color:BRAND.accent,fontWeight:700,fontSize:fSize||13,width:Math.max(80,val.length*9)+"px",outline:"none"}} />
      <button onClick={ok} disabled={guardandoId} style={{background:BRAND.accent,border:"none",borderRadius:5,color:"#fff",fontSize:11,padding:"2px 7px",cursor:guardandoId?"wait":"pointer",opacity:guardandoId?0.6:1}}>{guardandoId?"…":"OK"}</button>
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

function CampoFecha({ value, onChange, min }) {
  const ref = useRef();
  const abrir = () => { const el=ref.current; if(!el)return; try{ el.showPicker(); }catch{ el.focus(); } };
  return (
    <div style={{position:"relative"}}>
      <input ref={ref} type="date" value={value||""} min={min} onChange={e=>onChange(e.target.value)}
        style={{background:BRAND.bg,border:"0.5px solid "+BRAND.border,borderRadius:9,padding:"0.5rem 2.2rem 0.5rem 0.8rem",color:BRAND.text,fontSize:12,width:"100%",boxSizing:"border-box"}} />
      <button type="button" onClick={abrir} title="Abrir calendario" style={{position:"absolute",right:2,top:0,height:"100%",background:"none",border:"none",cursor:"pointer",color:BRAND.accent,fontSize:15,padding:"0 8px"}}>📅</button>
    </div>
  );
}

function RowFicha({ l, v }) {
  return <div style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:"0.5px solid "+BRAND.border+"44",fontSize:12}}><span style={{color:BRAND.muted}}>{l}</span><span style={{fontWeight:500}}>{v}</span></div>;
}
function SecFicha({ title, children }) {
  return <div style={{background:BRAND.bg,borderRadius:10,padding:"0.85rem"}}><div style={{fontSize:11,fontWeight:700,color:BRAND.accent,textTransform:"uppercase",letterSpacing:0.5,marginBottom:10}}>{title}</div>{children}</div>;
}

function FichaDetalle({ o, ordenes, setOrdenes, setOrdenSel, S, usuario }) {
  const [editando,setEditando]=useState(false);
  const [d,setD]=useState({});
  useEffect(() => {
    if (editando) setD({
      fechaPrimerIngreso:o.fechaPrimerIngreso||"",fechaProgramacion:o.fechaProgramacion||"",fechaReingreso:o.fechaReingreso||"",fechaInicioReparacion:o.fechaInicioReparacion||"",fechaPromesaEntrega:fechaEntregaOrden(o),fechaEntregaReal:o.fechaEntregaReal||"",refaccionesCompletas:o.refaccionesCompletas||"",perfilManoObra:o.perfilManoObra||"",perfilPintura:o.perfilPintura||"",perfilMecanica:o.perfilMecanica||"",clienteEspecial:o.clienteEspecial||false,tipoClienteEspecial:o.tipoClienteEspecial||"",deducible:o.deducible||"",anioAtencion:o.anioAtencion||"",mesAtencion:o.mesAtencion||"",diaAtencion:o.diaAtencion||"",costoManoObra:o.costoManoObra||"",costoRefacciones:o.costoRefacciones||"",montoReparacionInterna:o.montoReparacionInterna||"",montoTOT:o.montoTOT||"",
    });
  }, [editando]);
  const set = (k,v) => setD(p=>({...p,[k]:v}));
  // La promesa de entrega de la ficha es la misma del pizarrón: se guarda en ambos campos y su cambio va a la bitácora
  const guardar=()=>{ const upd=ordenes.map(x=>x.id===o.id?conFechaEntrega({...x,...d}, d.fechaPromesaEntrega||"", { usuario, antes: fechaEntregaOrden(x) }):x); setOrdenes(upd); setOrdenSel(upd.find(x=>x.id===o.id)); setEditando(false); };
  const fld=v=>v||"—"; const cur=v=>v?"$"+Number(v).toLocaleString("es-MX"):"—";
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
            <div style={{background:BRAND.card2,borderRadius:8,padding:"8px 10px",display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:10}}><span style={{fontSize:11,color:BRAND.muted}}>Días en taller</span><span style={{fontWeight:800,fontSize:22,color:BRAND.accent}}>{diasEnTaller(d)}</span></div>
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
            <div style={{background:BRAND.card2,borderRadius:8,padding:"8px 10px",marginBottom:12,display:"flex",justifyContent:"space-between"}}><span style={{fontSize:11,color:BRAND.muted}}>Total calculado</span><span style={{fontWeight:800,fontSize:16,color:BRAND.green}}>${totalC.toLocaleString("es-MX")}</span></div>
            <div style={{background:BRAND.purple+"11",border:"0.5px solid "+BRAND.purple+"44",borderRadius:8,padding:"10px"}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}><input type="checkbox" id="ce" checked={!!d.clienteEspecial} onChange={e=>set("clienteEspecial",e.target.checked)} style={{width:16,height:16,accentColor:BRAND.purple}} /><label htmlFor="ce" style={{fontSize:13,color:BRAND.purple,fontWeight:600,cursor:"pointer"}}>Cliente Especial</label></div>
              {d.clienteEspecial&&<div><label style={S.label}>Tipo</label><select style={{...S.select,fontSize:12}} value={d.tipoClienteEspecial||""} onChange={e=>set("tipoClienteEspecial",e.target.value)}><option value="">Seleccionar</option>{TIPES.map(t=><option key={t}>{t}</option>)}</select></div>}
            </div>
          </SecFicha>
        </div>
      ):(
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <SecFicha title="Fechas"><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"4px 24px"}}><RowFicha l="Primer ingreso" v={fld(o.fechaPrimerIngreso)} /><RowFicha l="Programación" v={fld(o.fechaProgramacion)} /><RowFicha l="Reingreso" v={fld(o.fechaReingreso)} /><RowFicha l="Inicio reparación" v={fld(o.fechaInicioReparacion)} /><RowFicha l="Promesa entrega" v={fld(fechaEntregaOrden(o))} /><RowFicha l="Entrega real" v={fld(o.fechaEntregaReal)} /><RowFicha l="Refacciones compl." v={fld(o.refaccionesCompletas)} /></div><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:12,padding:"8px 10px",background:BRAND.card2,borderRadius:8}}><span style={{fontSize:11,color:BRAND.muted}}>Días en taller</span><span style={{fontWeight:800,fontSize:24,color:BRAND.accent}}>{diasEnTaller(o)}</span></div></SecFicha>
          <SecFicha title="Perfiles y Financiero"><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"4px 24px"}}><RowFicha l="Perfil mano de obra" v={fld(o.perfilManoObra)} /><RowFicha l="Perfil pintura" v={fld(o.perfilPintura)} /><RowFicha l="Perfil mecánica" v={fld(o.perfilMecanica)} /><RowFicha l="Deducible" v={cur(o.deducible)} /><RowFicha l="Año atención" v={fld(o.anioAtencion)} /><RowFicha l="Mes atención" v={fld(o.mesAtencion)} /><RowFicha l="Día atención" v={fld(o.diaAtencion)} /></div></SecFicha>
          <SecFicha title="Costos"><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"4px 24px"}}><RowFicha l="Mano de obra" v={cur(o.costoManoObra)} /><RowFicha l="Refacciones" v={cur(o.costoRefacciones)} /><RowFicha l="Rep. interna" v={cur(o.montoReparacionInterna)} /><RowFicha l="TOT (proveedor)" v={cur(o.montoTOT)} /></div><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:12,padding:"8px 10px",background:BRAND.card2,borderRadius:8}}><span style={{fontSize:11,color:BRAND.muted}}>Total calculado</span><span style={{fontWeight:800,fontSize:20,color:BRAND.green}}>${[o.costoManoObra,o.costoRefacciones,o.montoTOT].reduce((a,v)=>a+(parseFloat(v)||0),0).toLocaleString("es-MX")}</span></div></SecFicha>
        </div>
      )}
    </div>
  );
}

function ExportarExcel({ ordenes, S }) {
  const [taller,setTaller]=useState("Mi Taller"); const [fuente,setFuente]=useState("todas"); const [ok,setOk]=useState(false);
  // El formulario pide «Marca, Modelo, Año»: con comas, cada parte es un campo; sin comas, se separa por espacios
  const pV=v=>{
    const porEspacios=t=>{const p=t.split(/\s+/).filter(Boolean);const a=p.length&&/^\d{4}$/.test(p[p.length-1])?p.pop():"";const m=p.shift()||"";return{marca:m,modelo:p.join(" "),anio:a};};
    const p=String(v||"").split(",").map(x=>x.trim()).filter(Boolean);
    if(p.length<2) return porEspacios(p[0]||"");
    let a="";
    if(/^(19|20)\d{2}$/.test(p[p.length-1])) a=p.pop();
    else { const m=/^(.*\S)\s+((?:19|20)\d{2})$/.exec(p[p.length-1]); if(m){ p[p.length-1]=m[1]; a=m[2]; } }
    if(p.length===1){ const r=porEspacios(p[0]); return{marca:r.marca,modelo:r.modelo,anio:a||r.anio}; }   // «Nissan Versa, 2019»
    return{marca:p.shift(),modelo:p.join(" "),anio:a};
  };
  const diasT=o=>{const b=o.fechaReingreso||o.fechaPrimerIngreso;const f=o.fechaEntregaReal||fechaEntregaOrden(o);if(!b)return"";if(!f)return cDias(b).toString();const d=difDias(b,f);return String(d===null?cDias(b):d);};
  const COLS=[
    {h:"Taller",v:o=>taller},{h:"Marca",v:o=>pV(o.vehiculo).marca},{h:"ModeloVehiculo",v:o=>pV(o.vehiculo).modelo},{h:"Anio",v:o=>pV(o.vehiculo).anio},{h:"Siniestro",v:o=>o.siniestro||""},{h:"CantPiezas",v:o=>{const n=(o.refacciones||[]).reduce((a,r)=>a+cantidadRef(r),0);return n||"";}},{h:"FechaPrimerIngreso",v:o=>o.fechaPrimerIngreso||""},{h:"FechaProgramacion",v:o=>o.fechaProgramacion||""},{h:"FechaReingreso",v:o=>o.fechaReingreso||""},{h:"FechaInicioReparacion",v:o=>o.fechaInicioReparacion||""},{h:"FechaPromesaEntrega",v:o=>fechaEntregaOrden(o)},{h:"FechaEntrega",v:o=>o.fechaEntregaReal||""},{h:"FechaRefaccionesCompletas",v:o=>o.refaccionesCompletas||""},{h:"DiasEnTaller",v:o=>diasT(o)},{h:"PerfilManoObra",v:o=>o.perfilManoObra||""},{h:"PerfilPintura",v:o=>o.perfilPintura||""},{h:"PerfilMecanica",v:o=>o.perfilMecanica||""},{h:"Placas",v:o=>o.placa||""},{h:"Serie",v:o=>o.serie||""},{h:"AnioAtencion",v:o=>o.anioAtencion||""},{h:"MesAtencion",v:o=>o.mesAtencion||""},{h:"DiaAtencion",v:o=>o.diaAtencion||""},{h:"CostoManoObra",v:o=>o.costoManoObra||""},{h:"CostoRefacciones",v:o=>o.costoRefacciones||""},{h:"MontoReparacionInterna",v:o=>o.montoReparacionInterna||""},{h:"MontoTOT",v:o=>o.montoTOT||""},{h:"OrdenId",v:o=>o.id||""},{h:"Cliente",v:o=>o.cliente||""},{h:"Tecnico",v:o=>o.tecnico||""},{h:"Estado",v:o=>o.estado||""},{h:"Deducible",v:o=>o.deducible||""},{h:"ClienteEspecial",v:o=>o.clienteEspecial?"SI":"NO"},{h:"TipoClienteEspecial",v:o=>o.tipoClienteEspecial||""},{h:"Ubicacion",v:o=>o.enTransito?"Transito":"Piso"},{h:"Llegada",v:o=>o.llegada==="grua"?"Grua":o.llegada==="circulando"?"Circulando":""},{h:"FechaTransito",v:o=>o.fechaTransito||""},
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

function ContadorDias({ o, grande }) {
  const d = diasDesdeAlta(o);
  if (d === null) return null;
  const c = colorDias(d);
  const alerta = d > DIAS_ALERTA;
  const alta = o.fecha || o.fechaPrimerIngreso;
  return (
    <span title={`Alta: ${alta}${alerta ? ` · rebasa ${DIAS_ALERTA} días` : ""}`}
      style={{display:"inline-flex",alignItems:"center",gap:4,background:c.fondo,color:c.texto,border:"1px solid "+c.borde,borderRadius:20,padding:grande?"3px 10px":"2px 8px",fontSize:grande?12:10,fontWeight:700,whiteSpace:"nowrap",flexShrink:0}}>
      {alerta ? "⚠" : "⏱"} {d} día{d !== 1 ? "s" : ""}
    </span>
  );
}

const REFACCIONES_RAPIDAS = ["Fascia delantera","Fascia trasera","Faro","Calavera","Salpicadera","Cofre","Puerta","Espejo lateral","Parrilla","Parabrisas"];

// ─── Refacciones: estado, pedido y seguimiento ───────────────────────────────────
// Como en los sistemas de taller (CCC ONE, Tekmetric): cada refacción va de "por pedir"
// a "pedida" y a "recibida", con dos desvíos frecuentes: back order (el proveedor no la
// tiene) y devolución (llegó dañada o equivocada y se repone). El campo "recibida" se
// sigue guardando igual que antes, así las órdenes existentes se leen sin cambios.
const ESTADOS_REFACCION = [
  { key:"por_pedir",  label:"Por pedir",  icono:"🛒", color:"#eb6834" },
  { key:"pedida",     label:"Pedida",     icono:"📦", color:"#2a78d6" },
  { key:"back_order", label:"Back order", icono:"⏳", color:"#eda100" },
  { key:"devolucion", label:"Devolución", icono:"↩️", color:"#6250d6" },
  { key:"recibida",   label:"Recibida",   icono:"✅", color:"#0ca30c" },
];
const ESTADOS_REF_PENDIENTES = ["por_pedir", "pedida", "back_order", "devolucion"];
const COLOR_ATRASO = "#d03b3b";
const TEXTO_ATRASO = "hsl(0, 75%, 38%)";
const infoEstadoRef = k => ESTADOS_REFACCION.find(e => e.key === k) || ESTADOS_REFACCION[0];
const estadoRefaccion = r => {
  if (!r) return "por_pedir";
  if (r.recibida) return "recibida";
  if (ESTADOS_REF_PENDIENTES.includes(r.estado)) return r.estado;
  return (r.pedido || r.ordenCompra || r.fechaPedido) ? "pedida" : "por_pedir";
};
// Días de atraso: la fecha promesa ya pasó y la refacción no ha llegado
const diasAtrasoRef = r => (!r || r.recibida || !r.fechaPromesa || r.fechaPromesa >= hoyLocal()) ? 0 : (difDias(r.fechaPromesa, hoyLocal()) || 0);
// Cambia el estado manteniendo en orden "recibida" y sus fechas
const conEstadoRef = (r, estado) => estado === "recibida"
  ? { ...r, estado, recibida: true, fechaRecibida: r.fechaRecibida || hoyLocal() }
  : { ...r, estado, recibida: false, fechaRecibida: "", ...(estado === "pedida" && !r.fechaPedido ? { fechaPedido: hoyLocal() } : {}) };
// Al desmarcar "recibida" regresa a pedida (si tiene pedido) o a por pedir
const estadoAlDesmarcar = r => (r.pedido || r.ordenCompra || r.fechaPedido) ? "pedida" : "por_pedir";
const MESES_CORTOS = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
const fechaCorta = f => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(f || ""); return m ? `${+m[3]} ${MESES_CORTOS[+m[2] - 1]}` : ""; };
const cantidadRef = r => Math.max(1, parseInt(r && r.cantidad, 10) || 1);

// Aplica una lista nueva de refacciones a la orden. Si con ella quedan todas recibidas,
// anota la fecha de "Refacciones completas" (si estaba vacía) y lo registra en la bitácora.
const ordenConRefacciones = (o, nueva, usuario, nota) => {
  const antes = o.refacciones || [];
  const estabaCompleta = antes.length > 0 && antes.every(r => r.recibida);
  const quedaCompleta = nueva.length > 0 && nueva.every(r => r.recibida);
  const n = { ...o, refacciones: nueva };
  const quien = (usuario && usuario.nombre) || "";
  const entradas = [];
  if (nota) entradas.push({ accion: nota, usuario: quien, fecha: hoy() });
  if (quedaCompleta && !estabaCompleta) {
    if (!o.refaccionesCompletas) n.refaccionesCompletas = hoyLocal();
    entradas.push({ accion: `Refacciones completas (${nueva.length})`, usuario: quien, fecha: hoy() });
  }
  if (entradas.length) n.bitacora = [...(o.bitacora || []), ...entradas];
  return n;
};

// Las cifras que muestran el dashboard, la sección Refacciones y el menú
const resumenRefacciones = ordenes => {
  const res = { total: 0, pendientes: 0, recibidas: 0, atrasadas: 0, backOrderSinFecha: 0, unidadesEsperando: 0,
    porEstado: {}, piso: { pendientes: 0, unidades: 0 }, transito: { pendientes: 0, unidades: 0 }, listasReingreso: [] };
  ESTADOS_REFACCION.forEach(e => { res.porEstado[e.key] = 0; });
  (ordenes || []).forEach(o => {
    const lista = o.refacciones || [];
    if (!lista.length) return;
    let pend = 0;
    lista.forEach(r => {
      const e = estadoRefaccion(r);
      res.total++; res.porEstado[e]++;
      if (e === "recibida") { res.recibidas++; return; }
      pend++; res.pendientes++;
      if (diasAtrasoRef(r) > 0) res.atrasadas++;
      if (e === "back_order" && !r.fechaPromesa) res.backOrderSinFecha++;
    });
    const lugar = o.enTransito ? res.transito : res.piso;
    lugar.pendientes += pend;
    if (pend) { lugar.unidades++; res.unidadesEsperando++; }
    else if (o.enTransito) res.listasReingreso.push(o);   // en tránsito y ya llegó todo: hay que llamar al cliente
  });
  return res;
};

function ChipEstadoRef({ estado }) {
  const e = infoEstadoRef(estado);
  return (
    <span style={{display:"inline-flex",alignItems:"center",gap:5,background:e.color+"14",border:"0.5px solid "+e.color+"66",borderRadius:20,padding:"2px 8px",fontSize:10,fontWeight:600,color:BRAND.text,whiteSpace:"nowrap",flexShrink:0}}>
      <span aria-hidden="true" style={{width:7,height:7,borderRadius:"50%",background:e.color,flexShrink:0}} />{e.label}
    </span>
  );
}

function ChipAtraso({ dias }) {
  return <span style={{display:"inline-flex",alignItems:"center",gap:4,background:COLOR_ATRASO+"12",border:"0.5px solid "+COLOR_ATRASO+"66",borderRadius:20,padding:"2px 8px",fontSize:10,fontWeight:700,color:TEXTO_ATRASO,whiteSpace:"nowrap",flexShrink:0}}>⚠ {dias} día{dias !== 1 ? "s" : ""} de atraso</span>;
}

// Dona de refacciones pendientes por estado: el número del centro es el total pendiente.
// Al pasar el cursor (o con el teclado) sobre un tramo, el centro muestra ese estado.
function DonaRefacciones({ segmentos, size = 180, grosor = 18, etiqueta = "pendientes" }) {
  const [activo, setActivo] = useState(null);
  const total = segmentos.reduce((a, s) => a + s.valor, 0);
  const visibles = segmentos.filter(s => s.valor > 0);
  const cx = size / 2, r = (size - grosor) / 2 - 3, circ = 2 * Math.PI * r;
  const separacion = visibles.length > 1 ? 2 : 0;   // 2 px de aire entre tramos, sin bordes
  let acumulado = 0;
  const arcos = visibles.map(s => { const largo = (s.valor / total) * circ; const a = { ...s, inicio: acumulado, largo }; acumulado += largo; return a; });
  const sel = arcos.find(a => a.key === activo);
  const resumen = segmentos.map(s => `${s.label}: ${s.valor}`).join(", ");
  return (
    <div style={{position:"relative",width:size,height:size,flexShrink:0}}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${total} refacciones ${etiqueta}. ${resumen}`}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke={BRAND.bg} strokeWidth={grosor} />
        <g transform={`rotate(-90 ${cx} ${cx})`}>
          {arcos.map(a => (
            <g key={a.key}>
              <circle cx={cx} cy={cx} r={r} fill="none" stroke={a.color} strokeWidth={activo === a.key ? grosor + 4 : grosor}
                strokeDasharray={`${Math.max(0.01, a.largo - separacion)} ${circ}`} strokeDashoffset={-a.inicio}
                style={{opacity: activo && activo !== a.key ? 0.4 : 1, transition: "opacity 0.15s, stroke-width 0.15s"}} />
              <circle cx={cx} cy={cx} r={r} fill="none" stroke="transparent" strokeWidth={grosor + 16}
                strokeDasharray={`${Math.max(0.01, a.largo - separacion)} ${circ}`} strokeDashoffset={-a.inicio}
                tabIndex={0} aria-label={`${a.label}: ${a.valor}`} style={{cursor:"default",outline:"none"}}
                onMouseEnter={() => setActivo(a.key)} onMouseLeave={() => setActivo(null)}
                onFocus={() => setActivo(a.key)} onBlur={() => setActivo(null)}>
                <title>{`${a.label}: ${a.valor}`}</title>
              </circle>
            </g>
          ))}
        </g>
      </svg>
      <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",textAlign:"center",pointerEvents:"none"}}>
        <div style={{fontSize:size >= 160 ? 44 : 30,fontWeight:800,color:BRAND.text,lineHeight:1}}>{sel ? sel.valor : total}</div>
        <div style={{fontSize:11,color:BRAND.muted,marginTop:5,maxWidth:size - 2 * grosor - 16,lineHeight:1.3}}>
          {sel ? `${sel.label} · ${Math.round((sel.valor * 100) / total)} %` : total ? etiqueta : "sin pendientes"}
        </div>
      </div>
    </div>
  );
}

// Leyenda de la dona: también es la tabla con los números (nada depende solo del color)
function LeyendaRefacciones({ segmentos, onElegir, activo }) {
  const total = segmentos.reduce((a, s) => a + s.valor, 0);
  return (
    <div style={{display:"flex",flexDirection:"column",gap:2,minWidth:0,flex:"1 1 230px"}}>
      {segmentos.map(s => {
        const sel = activo === s.key;
        return (
          <button key={s.key} type="button" onClick={onElegir ? () => onElegir(s.key) : undefined} aria-pressed={onElegir ? sel : undefined}
            style={{display:"flex",alignItems:"center",gap:8,background:sel?BRAND.bg:"none",border:"none",borderRadius:8,padding:"6px 8px",cursor:onElegir?"pointer":"default",textAlign:"left",width:"100%"}}>
            <span aria-hidden="true" style={{width:10,height:10,borderRadius:2,background:s.color,flexShrink:0}} />
            <span style={{fontSize:12,color:BRAND.text,flex:1,minWidth:0}}>{s.icono} {s.label}</span>
            <span style={{fontSize:13,fontWeight:700,color:BRAND.text,fontVariantNumeric:"tabular-nums"}}>{s.valor}</span>
            <span style={{fontSize:11,color:BRAND.muted,width:38,textAlign:"right",fontVariantNumeric:"tabular-nums"}}>{total ? Math.round((s.valor * 100) / total) + " %" : "—"}</span>
          </button>
        );
      })}
    </div>
  );
}

function MedidorRecibidas({ recibidas, total }) {
  const pct = total ? Math.round((recibidas * 100) / total) : 0;
  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:8,marginBottom:7}}>
        <span style={{fontSize:12,fontWeight:700,color:BRAND.text}}>✅ Recibidas</span>
        <span style={{fontSize:12,color:BRAND.muted}}><b style={{fontSize:20,color:BRAND.text}}>{pct} %</b> · {recibidas} de {total}</span>
      </div>
      <div role="meter" aria-label="Refacciones recibidas" aria-valuemin={0} aria-valuemax={total} aria-valuenow={recibidas}
        style={{height:10,background:"#0ca30c24",borderRadius:5,overflow:"hidden"}}>
        <div style={{height:"100%",width:pct + "%",background:"#0ca30c",borderRadius:5,transition:"width 0.25s"}} />
      </div>
    </div>
  );
}

// Datos del pedido de una refacción: se editan en un borrador y se guardan con un botón
const CAMPOS_PEDIDO = [
  { k:"proveedor",   l:"Proveedor",               ph:"Ej. Refaccionaria del Valle" },
  { k:"pedido",      l:"No. de pedido",           ph:"Ej. PED-4512" },
  { k:"ordenCompra", l:"No. de orden de compra",  ph:"Ej. OC-88213" },
  { k:"numeroParte", l:"No. de parte",            ph:"Ej. 84045632" },
];

function EditorRefaccion({ r, onGuardar, onCancelar }) {
  const S = mkS();
  const [b, setB] = useState(() => ({ nombre: r.nombre || "", cantidad: String(cantidadRef(r)), proveedor: r.proveedor || "", pedido: r.pedido || "",
    ordenCompra: r.ordenCompra || "", numeroParte: r.numeroParte || "", fechaPedido: r.fechaPedido || "", fechaPromesa: r.fechaPromesa || "", notas: r.notas || "" }));
  const set = (k, v) => setB(p => ({ ...p, [k]: v }));
  const guardar = () => {
    const limpio = Object.fromEntries(Object.entries(b).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]));
    let n = { ...r, ...limpio, nombre: limpio.nombre || r.nombre, cantidad: Math.max(1, parseInt(limpio.cantidad, 10) || 1) };
    if (estadoRefaccion(r) === "por_pedir" && (n.pedido || n.ordenCompra)) n = conEstadoRef(n, "pedida");   // capturar el pedido la marca como pedida
    onGuardar(n);
  };
  return (
    <div style={{background:BRAND.bg,borderRadius:9,padding:"0.75rem",marginTop:8,display:"flex",flexDirection:"column",gap:10}}>
      <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) 72px",gap:8}}>
        <div><label style={S.label}>Refacción</label><input style={{...S.input,fontSize:12}} value={b.nombre} onChange={e=>set("nombre", e.target.value)} /></div>
        <div><label style={S.label}>Cantidad</label><input type="number" min="1" style={{...S.input,fontSize:12,textAlign:"center"}} value={b.cantidad} onChange={e=>set("cantidad", e.target.value)} /></div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(170px, 1fr))",gap:8}}>
        {CAMPOS_PEDIDO.map(c => <div key={c.k}><label style={S.label}>{c.l}</label><input style={{...S.input,fontSize:12}} placeholder={c.ph} value={b[c.k]} onChange={e=>set(c.k, e.target.value)} /></div>)}
        <div><label style={S.label}>Fecha de pedido</label><CampoFecha value={b.fechaPedido} onChange={v=>set("fechaPedido", v)} /></div>
        <div><label style={S.label}>Fecha promesa de llegada</label><CampoFecha value={b.fechaPromesa} onChange={v=>set("fechaPromesa", v)} /></div>
      </div>
      <div><label style={S.label}>Notas</label><input style={{...S.input,fontSize:12}} placeholder="Ej. viene sin soportes; el proveedor confirma el lunes" value={b.notas} onChange={e=>set("notas", e.target.value)} /></div>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
        <button type="button" onClick={onCancelar} style={{...S.btnSm(),fontSize:12,padding:"6px 12px"}}>Cancelar</button>
        <button type="button" onClick={guardar} style={{...S.btn,fontSize:12,padding:"6px 14px"}}>Guardar</button>
      </div>
    </div>
  );
}

// Una refacción: estado, datos del pedido, fecha promesa o atraso, y acciones rápidas
function FilaRefaccion({ r, puedeEdit, onCambiar, onQuitar, encabezado }) {
  const S = mkS();
  const [editando, setEditando] = useState(false);
  const estado = estadoRefaccion(r), atraso = diasAtrasoRef(r), recibida = estado === "recibida";
  const datos = [r.pedido && `Pedido ${r.pedido}`, r.ordenCompra && `OC ${r.ordenCompra}`, r.proveedor, r.numeroParte && `No. parte ${r.numeroParte}`].filter(Boolean).join(" · ");
  const fecha = recibida ? (r.fechaRecibida ? `Recibida el ${fechaCorta(r.fechaRecibida)}` : "Recibida")
    : atraso > 0 ? `Debía llegar el ${fechaCorta(r.fechaPromesa)}`
    : r.fechaPromesa ? `Llega el ${fechaCorta(r.fechaPromesa)}`
    : estado === "back_order" ? "Sin fecha promesa: pídela al proveedor"
    : r.fechaPedido ? `Pedida el ${fechaCorta(r.fechaPedido)}` : "";
  const alternarRecibida = () => onCambiar(conEstadoRef(r, recibida ? estadoAlDesmarcar(r) : "recibida"));
  return (
    <div style={{background:recibida?BRAND.green+"0D":BRAND.card,border:"1px solid "+(atraso>0?COLOR_ATRASO+"66":recibida?BRAND.green+"44":BRAND.border),borderRadius:9,padding:"0.6rem 0.75rem"}}>
      {encabezado}
      <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
        <input type="checkbox" checked={recibida} disabled={!puedeEdit} onChange={alternarRecibida} aria-label={`${r.nombre}: recibida`}
          style={{width:20,height:20,accentColor:BRAND.green,flexShrink:0,marginTop:1,cursor:puedeEdit?"pointer":"default"}} />
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
            <span style={{fontSize:13,fontWeight:600,color:recibida?BRAND.muted:BRAND.text,overflowWrap:"anywhere"}}>{r.nombre}{cantidadRef(r) > 1 && <span style={{color:BRAND.accent,fontWeight:700}}> ×{cantidadRef(r)}</span>}</span>
            <ChipEstadoRef estado={estado} />
            {atraso > 0 && <ChipAtraso dias={atraso} />}
          </div>
          {datos && <div style={{fontSize:11,color:BRAND.muted,marginTop:3,overflowWrap:"anywhere"}}>{datos}</div>}
          {(fecha || r.notas) && <div style={{fontSize:11,color:atraso>0?TEXTO_ATRASO:BRAND.muted,marginTop:2,overflowWrap:"anywhere"}}>{fecha}{fecha && r.notas ? " · " : ""}{r.notas ? <i>{r.notas}</i> : null}</div>}
        </div>
      </div>
      {puedeEdit && !editando && (
        <div style={{display:"flex",gap:6,marginTop:8,marginLeft:30,flexWrap:"wrap",alignItems:"center"}}>
          <select value={estado} onChange={e=>onCambiar(conEstadoRef(r, e.target.value))} aria-label={`Estado de ${r.nombre}`}
            style={{...S.select,width:"auto",fontSize:11,padding:"4px 8px",borderRadius:7}}>
            {ESTADOS_REFACCION.map(e => <option key={e.key} value={e.key}>{e.icono} {e.label}</option>)}
          </select>
          <button type="button" onClick={()=>setEditando(true)} style={{...S.btnSm(),fontSize:11,padding:"4px 10px"}}>✏️ Datos del pedido</button>
          {onQuitar && <button type="button" onClick={onQuitar} title="Quitar" aria-label={`Quitar ${r.nombre}`} style={{...S.btnSm(),fontSize:11,padding:"4px 8px",marginLeft:"auto"}}>✕</button>}
        </div>
      )}
      {editando && <EditorRefaccion r={r} onCancelar={()=>setEditando(false)} onGuardar={n=>{ onCambiar(n); setEditando(false); }} />}
    </div>
  );
}

// Registrar UN pedido para varias refacciones a la vez (lo normal: un proveedor, un pedido)
function RegistrarPedido({ lista, onGuardar, onCancelar }) {
  const S = mkS();
  const candidatas = lista.filter(r => ["por_pedir", "devolucion"].includes(estadoRefaccion(r)));
  const [sel, setSel] = useState(() => new Set(candidatas.filter(r => estadoRefaccion(r) === "por_pedir").map(r => r.id)));
  const [d, setD] = useState({ proveedor: "", pedido: "", ordenCompra: "", fechaPromesa: "" });
  const set = (k, v) => setD(p => ({ ...p, [k]: v }));
  const alternar = id => setSel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const listo = sel.size > 0 && (d.pedido.trim() || d.ordenCompra.trim() || d.proveedor.trim());
  return (
    <div style={{background:BRAND.blue+"0A",border:"1px solid "+BRAND.blue+"33",borderRadius:10,padding:"0.85rem",display:"flex",flexDirection:"column",gap:10}}>
      <div style={{fontSize:12,fontWeight:700,color:BRAND.blue}}>📦 Registrar pedido</div>
      <div style={{display:"flex",flexDirection:"column",gap:4}}>
        <div style={{fontSize:11,color:BRAND.muted}}>Refacciones que incluye:</div>
        {candidatas.map(r => (
          <label key={r.id} style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:BRAND.text,cursor:"pointer"}}>
            <input type="checkbox" checked={sel.has(r.id)} onChange={()=>alternar(r.id)} style={{width:17,height:17,accentColor:BRAND.blue}} />
            <span>{r.nombre}{cantidadRef(r) > 1 ? ` ×${cantidadRef(r)}` : ""}</span>
            {estadoRefaccion(r) === "devolucion" && <ChipEstadoRef estado="devolucion" />}
          </label>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(170px, 1fr))",gap:8}}>
        {CAMPOS_PEDIDO.filter(c => c.k !== "numeroParte").map(c => <div key={c.k}><label style={S.label}>{c.l}</label><input style={{...S.input,fontSize:12}} placeholder={c.ph} value={d[c.k]} onChange={e=>set(c.k, e.target.value)} /></div>)}
        <div><label style={S.label}>Fecha promesa de llegada</label><CampoFecha value={d.fechaPromesa} onChange={v=>set("fechaPromesa", v)} /></div>
      </div>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end",flexWrap:"wrap"}}>
        <button type="button" onClick={onCancelar} style={{...S.btnSm(),fontSize:12,padding:"6px 12px"}}>Cancelar</button>
        <button type="button" disabled={!listo} onClick={()=>onGuardar([...sel], { proveedor: d.proveedor.trim(), pedido: d.pedido.trim(), ordenCompra: d.ordenCompra.trim(), fechaPromesa: d.fechaPromesa })}
          style={{...S.btn,background:BRAND.blue,fontSize:12,padding:"6px 14px",opacity:listo?1:0.45,cursor:listo?"pointer":"not-allowed"}}>Guardar pedido ({sel.size})</button>
      </div>
    </div>
  );
}

function ChecklistRefacciones({ o, setOrdenes, setOrdenSel, puedeEdit, usuario, S }) {
  const [txt, setTxt] = useState("");
  const [cant, setCant] = useState("1");
  const [pidiendo, setPidiendo] = useState(false);
  const lista = o.refacciones || [];
  const total = lista.length;
  const recibidas = lista.filter(r => r.recibida).length;
  const pct = total ? Math.round((recibidas * 100) / total) : 0;
  const completa = total > 0 && recibidas === total;
  const atrasadas = lista.filter(r => diasAtrasoRef(r) > 0).length;
  const porPedir = lista.filter(r => ["por_pedir", "devolucion"].includes(estadoRefaccion(r))).length;

  // Siempre sobre la versión más reciente de la orden (dos clics rápidos no se pisan)
  const aplicar = (cambiarLista, nota) => {
    const fn = x => ordenConRefacciones(x, cambiarLista(x.refacciones || []), usuario, nota);
    setOrdenes(prev => prev.map(x => x.id === o.id ? fn(x) : x));
    setOrdenSel(prev => prev && prev.id === o.id ? fn(prev) : prev);
  };

  const agregar = (nombreDirecto) => {
    const nombre = (nombreDirecto || txt).trim();
    if (!nombre) return;
    if (lista.some(r => r.nombre.toLowerCase() === nombre.toLowerCase())) { alert(`«${nombre}» ya está en la lista.`); return; }
    const cantidad = nombreDirecto ? 1 : Math.max(1, parseInt(cant, 10) || 1);
    aplicar(l => [...l, { id: Date.now() + Math.random(), nombre, cantidad, estado: "por_pedir", recibida: false, fechaRecibida: "" }]);
    if (!nombreDirecto) { setTxt(""); setCant("1"); }
  };
  const cambiar = n => aplicar(l => l.map(r => r.id === n.id ? n : r));
  const quitar = id => { if (!confirm("¿Quitar esta refacción de la lista?")) return; aplicar(l => l.filter(r => r.id !== id)); };
  const marcarTodas = () => aplicar(l => l.map(r => r.recibida ? r : conEstadoRef(r, "recibida")));
  const registrarPedido = (ids, d) => {
    const nota = `Pedido registrado: ${ids.length} refacción${ids.length !== 1 ? "es" : ""}` + (d.pedido ? ` · Pedido ${d.pedido}` : "") + (d.ordenCompra ? ` · OC ${d.ordenCompra}` : "") + (d.proveedor ? ` · ${d.proveedor}` : "");
    aplicar(l => l.map(r => !ids.includes(r.id) ? r : conEstadoRef({ ...r,
      proveedor: d.proveedor || r.proveedor || "", pedido: d.pedido || r.pedido || "", ordenCompra: d.ordenCompra || r.ordenCompra || "",
      fechaPromesa: d.fechaPromesa || r.fechaPromesa || "", fechaPedido: hoyLocal() }, "pedida")), nota);
    setPidiendo(false);
  };

  const colorBarra = completa ? BRAND.green : pct >= 50 ? "#F59E0B" : BRAND.accent;
  const rapidasDisponibles = REFACCIONES_RAPIDAS.filter(n => !lista.some(r => r.nombre.toLowerCase() === n.toLowerCase()));
  const ordenadas = lista.slice().sort((a, b) => (diasAtrasoRef(b) - diasAtrasoRef(a)) || ((a.recibida ? 1 : 0) - (b.recibida ? 1 : 0)));

  return (
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <div style={{background:BRAND.bg,borderRadius:10,padding:"0.85rem"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:8}}>
          <span style={{fontSize:12,fontWeight:700,color:BRAND.text}}>Avance de refacciones</span>
          <span style={{fontSize:12,color:BRAND.muted}}><b style={{color:colorBarra,fontSize:15}}>{recibidas}</b> de {total} recibidas</span>
        </div>
        <div style={{height:8,background:BRAND.dimmed+"66",borderRadius:4,overflow:"hidden"}}>
          <div style={{height:"100%",width:pct+"%",background:colorBarra,borderRadius:4,transition:"width 0.25s"}} />
        </div>
        {(atrasadas > 0 || porPedir > 0) && !completa && (
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:10}}>
            {atrasadas > 0 && <span style={{fontSize:11,fontWeight:700,color:TEXTO_ATRASO}}>⚠ {atrasadas} atrasada{atrasadas !== 1 ? "s" : ""}</span>}
            {porPedir > 0 && <span style={{fontSize:11,fontWeight:600,color:BRAND.muted}}>🛒 {porPedir} sin pedir</span>}
          </div>
        )}
        {completa && <div style={{marginTop:10,fontSize:12,color:BRAND.green,fontWeight:700}}>✓ Todas las refacciones recibidas{o.refaccionesCompletas ? ` · ${o.refaccionesCompletas}` : ""}{o.enTransito ? " · la unidad está en tránsito: avisa al cliente para su reingreso" : ""}</div>}
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {total === 0 && <div style={{textAlign:"center",color:BRAND.muted,fontSize:12,padding:"1.25rem 0"}}>Sin refacciones registradas</div>}
        {ordenadas.map(r => <FilaRefaccion key={r.id} r={r} puedeEdit={puedeEdit} onCambiar={cambiar} onQuitar={()=>quitar(r.id)} />)}
      </div>

      {puedeEdit && porPedir > 0 && (pidiendo
        ? <RegistrarPedido lista={lista} onGuardar={registrarPedido} onCancelar={()=>setPidiendo(false)} />
        : <button type="button" onClick={()=>setPidiendo(true)} style={{background:BRAND.blue+"0D",border:"1px dashed "+BRAND.blue,color:BRAND.blue,borderRadius:8,padding:"8px",fontSize:12,fontWeight:700,cursor:"pointer"}}>📦 Registrar pedido ({porPedir} sin pedir)</button>)}

      {puedeEdit && total > 0 && !completa && (
        <button onClick={marcarTodas} style={{background:"none",border:"1px dashed "+BRAND.green,color:BRAND.green,borderRadius:8,padding:"7px",fontSize:12,fontWeight:600,cursor:"pointer"}}>Marcar todas como recibidas</button>
      )}

      {puedeEdit && (
        <div style={{background:BRAND.bg,borderRadius:10,padding:"0.85rem"}}>
          <div style={{fontSize:12,fontWeight:600,color:BRAND.accent,marginBottom:8}}>Agregar refacción</div>
          <div style={{display:"flex",gap:6,marginBottom:10}}>
            <input style={{...S.input,flex:1,fontSize:12}} placeholder="Ej. Fascia delantera" value={txt} onChange={e=>setTxt(e.target.value)} onKeyDown={e=>{ if (e.key === "Enter") agregar(); }} />
            <input type="number" min="1" title="Cantidad" style={{...S.input,width:58,fontSize:12,textAlign:"center"}} value={cant} onChange={e=>setCant(e.target.value)} onKeyDown={e=>{ if (e.key === "Enter") agregar(); }} />
            <button style={{...S.btn,fontSize:12,padding:"0.5rem 0.85rem",opacity:txt.trim()?1:0.45}} disabled={!txt.trim()} onClick={()=>agregar()}>Agregar</button>
          </div>
          {rapidasDisponibles.length > 0 && <>
            <div style={{fontSize:10,color:BRAND.muted,marginBottom:6}}>Agregar rápido:</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
              {rapidasDisponibles.map(n => <button key={n} onClick={()=>agregar(n)} style={{fontSize:11,background:"#fff",border:"1px solid "+BRAND.border,color:BRAND.muted,borderRadius:20,padding:"3px 10px",cursor:"pointer"}}>+ {n}</button>)}
            </div>
          </>}
        </div>
      )}
    </div>
  );
}

// ─── Sección Refacciones (menú lateral) ───────────────────────────────────────────
const ORDEN_FILAS_REF = { devolucion: 0, back_order: 1, por_pedir: 2, pedida: 3, recibida: 4 };
const FILTROS_ESTADO_REF = [
  { k:"pendientes", l:"Pendientes" }, { k:"por_pedir", l:"🛒 Por pedir" }, { k:"pedida", l:"📦 Pedidas" },
  { k:"back_order", l:"⏳ Back order" }, { k:"devolucion", l:"↩️ Devolución" }, { k:"atrasadas", l:"⚠ Atrasadas" },
  { k:"recibida", l:"✅ Recibidas" }, { k:"todas", l:"Todas" },
];

function TarjetaCifra({ icono, titulo, valor, detalle, color, onClick, activo }) {
  const S = mkS();
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
      style={{...S.metric,textAlign:"left",padding:"0.8rem 0.9rem",cursor:onClick?"pointer":"default",border:"1px solid "+(activo?color:BRAND.border),display:"flex",flexDirection:"column",gap:2,minWidth:0,font:"inherit"}}>
      <span style={{fontSize:11,color:BRAND.muted,fontWeight:600}}>{icono} {titulo}</span>
      <span style={{fontSize:24,fontWeight:800,color:BRAND.text,lineHeight:1.15}}>{valor}</span>
      {detalle && <span style={{fontSize:11,color:color === COLOR_ATRASO && valor ? TEXTO_ATRASO : BRAND.muted}}>{detalle}</span>}
    </button>
  );
}

function SeccionRefacciones({ ordenes, desktop, puedeEdit, onCambiar, onAbrirOrden, filtroInicial }) {
  const S = mkS();
  const [ubicacion, setUbicacion] = useState("todas");
  const [estadoF, setEstadoF] = useState(filtroInicial || "pendientes");
  const [busca, setBusca] = useState("");
  const [agrupar, setAgrupar] = useState("orden");
  const resTodas = resumenRefacciones(ordenes);
  const enUbicacion = ordenes.filter(o => ubicacion === "todas" || (ubicacion === "transito" ? o.enTransito : !o.enTransito));
  const res = resumenRefacciones(enUbicacion);
  const segmentos = ESTADOS_REF_PENDIENTES.map(k => ({ ...infoEstadoRef(k), valor: res.porEstado[k] }));

  const q = busca.trim().toLowerCase();
  const pasaEstado = r => {
    const e = estadoRefaccion(r);
    if (estadoF === "todas") return true;
    if (estadoF === "pendientes") return e !== "recibida";
    if (estadoF === "atrasadas") return diasAtrasoRef(r) > 0;
    return e === estadoF;
  };
  const pasaBusqueda = (o, r) => !q || [r.nombre, r.numeroParte, r.pedido, r.ordenCompra, r.proveedor, r.notas, o.id, o.cliente, o.vehiculo, o.placa, o.siniestro]
    .some(v => String(v || "").toLowerCase().includes(q));
  const filas = enUbicacion.flatMap(o => (o.refacciones || []).filter(r => pasaEstado(r) && pasaBusqueda(o, r)).map(r => ({ o, r })));
  const ordenarFilas = (a, b) => (diasAtrasoRef(b.r) - diasAtrasoRef(a.r)) || (ORDEN_FILAS_REF[estadoRefaccion(a.r)] - ORDEN_FILAS_REF[estadoRefaccion(b.r)]) || String(a.r.nombre).localeCompare(String(b.r.nombre));
  const grupos = new Map();
  filas.forEach(f => {
    const k = agrupar === "orden" ? f.o.id : ((f.r.proveedor || "").trim() || "Sin proveedor");
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(f);
  });
  const listaGrupos = [...grupos.entries()]
    .map(([k, fs]) => ({ k, filas: fs.sort(ordenarFilas), atraso: Math.max(0, ...fs.map(f => diasAtrasoRef(f.r))) }))
    .sort((a, b) => ((a.k === "Sin proveedor") - (b.k === "Sin proveedor")) || (b.atraso - a.atraso) || (b.filas.length - a.filas.length) || a.k.localeCompare(b.k));

  const opcionesUbicacion = [
    { k:"todas", l:"Todas", d:`${resTodas.pendientes} pendientes` },
    { k:"piso", l:"🔧 En piso", d:`${resTodas.piso.pendientes} pendientes · ${resTodas.piso.unidades} unidad${resTodas.piso.unidades !== 1 ? "es" : ""}` },
    { k:"transito", l:"🚗 En tránsito", d:`${resTodas.transito.pendientes} pendientes · ${resTodas.transito.unidades} unidad${resTodas.transito.unidades !== 1 ? "es" : ""}` },
  ];
  const vacio = estadoF === "pendientes" && !q
    ? (res.total ? "No hay refacciones pendientes aquí. 🎉" : "No hay refacciones registradas en estas órdenes. Agrégalas en la pestaña 🔧 Refacciones de cada orden.")
    : "Ninguna refacción coincide con el filtro.";

  return (
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <div role="group" aria-label="Ubicación de la unidad" style={{display:"grid",gridTemplateColumns:desktop?"repeat(3, minmax(0, 220px))":"repeat(3, minmax(0, 1fr))",gap:6}}>
        {opcionesUbicacion.map(op => { const sel = ubicacion === op.k; return (
          <button key={op.k} type="button" aria-pressed={sel} onClick={()=>setUbicacion(op.k)}
            style={{textAlign:"left",border:"1px solid "+(sel?BRAND.accent:BRAND.border),background:sel?BRAND.accent+"0D":BRAND.card,borderRadius:10,padding:"8px 10px",cursor:"pointer",minWidth:0}}>
            <div style={{fontSize:12,fontWeight:700,color:sel?BRAND.accent:BRAND.text}}>{op.l}</div>
            <div style={{fontSize:10,color:BRAND.muted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:desktop?"nowrap":"normal"}}>{op.d}</div>
          </button>); })}
      </div>

      <div style={{display:"grid",gridTemplateColumns:desktop?"minmax(0, 1.1fr) minmax(0, 1fr)":"1fr",gap:12,alignItems:"stretch"}}>
        <div style={S.card}>
          <div style={{fontSize:13,fontWeight:700,color:BRAND.accent,marginBottom:2}}>Refacciones pendientes</div>
          <div style={{fontSize:11,color:BRAND.muted,marginBottom:12}}>De {res.unidadesEsperando} unidad{res.unidadesEsperando !== 1 ? "es" : ""} que esperan piezas · toca un estado para ver solo esas</div>
          <div style={{display:"flex",alignItems:"center",gap:18,flexWrap:"wrap",justifyContent:"center"}}>
            <DonaRefacciones segmentos={segmentos} size={desktop ? 184 : 168} />
            <LeyendaRefacciones segmentos={segmentos} activo={estadoF} onElegir={k=>setEstadoF(estadoF === k ? "pendientes" : k)} />
          </div>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div style={S.card}><MedidorRecibidas recibidas={res.recibidas} total={res.total} /></div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(2, minmax(0, 1fr))",gap:10}}>
            <TarjetaCifra icono="⚠" titulo="Atrasadas" valor={res.atrasadas} color={COLOR_ATRASO} activo={estadoF === "atrasadas"}
              detalle={res.atrasadas ? "ya pasó su fecha promesa" : "ninguna fuera de fecha"} onClick={()=>setEstadoF(estadoF === "atrasadas" ? "pendientes" : "atrasadas")} />
            <TarjetaCifra icono="⏳" titulo="Back order" valor={res.porEstado.back_order} color="#eda100" activo={estadoF === "back_order"}
              detalle={res.backOrderSinFecha ? `${res.backOrderSinFecha} sin fecha promesa` : "con fecha promesa"} onClick={()=>setEstadoF(estadoF === "back_order" ? "pendientes" : "back_order")} />
            <TarjetaCifra icono="🛒" titulo="Por pedir" valor={res.porEstado.por_pedir} color="#eb6834" activo={estadoF === "por_pedir"}
              detalle="aún sin pedido" onClick={()=>setEstadoF(estadoF === "por_pedir" ? "pendientes" : "por_pedir")} />
            <TarjetaCifra icono="🚗" titulo="Listas para reingreso" valor={res.listasReingreso.length} color={BRAND.blue}
              detalle={res.listasReingreso.length ? "en tránsito con todo recibido" : "ninguna por ahora"} />
          </div>
        </div>
      </div>

      {res.listasReingreso.length > 0 && (
        <div style={{background:BRAND.blue+"10",border:"1px solid "+BRAND.blue+"44",borderRadius:10,padding:"10px 14px"}}>
          <div style={{fontSize:13,fontWeight:700,color:BRAND.blue,marginBottom:6}}>🚗 Ya llegaron todas sus refacciones: llama al cliente para el reingreso</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {res.listasReingreso.map(o => (
              <button key={o.id} type="button" onClick={()=>onAbrirOrden(o)} style={{background:"#fff",border:"1px solid "+BRAND.blue+"55",borderRadius:20,padding:"4px 10px",fontSize:12,cursor:"pointer",color:BRAND.text}}>
                <b style={{color:BRAND.blue}}>{o.id}</b> · {o.cliente}{o.telefono ? ` · 📞 ${o.telefono}` : ""}
              </button>))}
          </div>
        </div>
      )}

      <div style={S.card}>
        <div style={{display:"flex",flexWrap:"wrap",gap:8,alignItems:"center",marginBottom:10}}>
          <input style={{...S.input,flex:"1 1 220px",fontSize:12}} placeholder="Buscar refacción, pedido, OC, proveedor, OT o placa…" value={busca} onChange={e=>setBusca(e.target.value)} />
          <div role="group" aria-label="Agrupar" style={{display:"inline-flex",background:BRAND.bg,border:"1px solid "+BRAND.border,borderRadius:9,padding:2,gap:2,flexShrink:0}}>
            {[{k:"orden",l:"Por orden"},{k:"proveedor",l:"Por proveedor"}].map(op => { const sel = agrupar === op.k; return (
              <button key={op.k} type="button" aria-pressed={sel} onClick={()=>setAgrupar(op.k)}
                style={{border:"none",borderRadius:7,padding:"5px 11px",fontSize:11,fontWeight:600,cursor:"pointer",background:sel?"#fff":"transparent",color:sel?BRAND.text:BRAND.muted,boxShadow:sel?"0 1px 2px rgba(29,39,51,0.12)":"none"}}>{op.l}</button>); })}
          </div>
        </div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
          {FILTROS_ESTADO_REF.map(f => { const sel = estadoF === f.k; return (
            <button key={f.k} type="button" aria-pressed={sel} onClick={()=>setEstadoF(f.k)}
              style={{border:"1px solid "+(sel?BRAND.accent:BRAND.border),background:sel?BRAND.accent+"12":"#fff",color:sel?BRAND.accent:BRAND.muted,borderRadius:20,padding:"4px 11px",fontSize:11,fontWeight:sel?700:500,cursor:"pointer"}}>{f.l}</button>); })}
        </div>

        {listaGrupos.length === 0 && <div style={{textAlign:"center",color:BRAND.muted,fontSize:12,padding:"2rem 1rem"}}>{vacio}</div>}
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          {listaGrupos.map(g => {
            const o = agrupar === "orden" ? g.filas[0].o : null;
            const todas = o ? (o.refacciones || []) : [];
            const rec = todas.filter(r => r.recibida).length;
            return (
              <div key={g.k} style={{border:"1px solid "+BRAND.border,borderRadius:12,overflow:"hidden"}}>
                {o ? (
                  <button type="button" onClick={()=>onAbrirOrden(o)} title="Abrir la orden"
                    style={{width:"100%",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",background:BRAND.bg,border:"none",borderBottom:"1px solid "+BRAND.border,padding:"9px 12px",cursor:"pointer",textAlign:"left"}}>
                    <span style={{fontSize:12,fontWeight:800,color:BRAND.accent}}>{o.id}</span>
                    <span style={{fontSize:12,fontWeight:600,color:BRAND.text,minWidth:0}}>{o.cliente}</span>
                    <span style={{fontSize:11,color:BRAND.muted,minWidth:0}}>{[o.vehiculo, o.placa].filter(Boolean).join(" · ")}</span>
                    <span style={{fontSize:10,fontWeight:600,borderRadius:5,padding:"2px 7px",background:o.enTransito?BRAND.blue+"12":BRAND.accent+"10",color:o.enTransito?BRAND.blue:BRAND.accent}}>
                      {o.enTransito ? `🚗 Tránsito${diasEnTransito(o) !== null ? " · " + diasEnTransito(o) + " d" : ""}` : "🔧 En piso"}</span>
                    <span style={{marginLeft:"auto",fontSize:11,color:BRAND.muted,whiteSpace:"nowrap"}}>{rec} de {todas.length} recibidas · Abrir →</span>
                  </button>
                ) : (
                  <div style={{display:"flex",alignItems:"center",gap:10,background:BRAND.bg,borderBottom:"1px solid "+BRAND.border,padding:"9px 12px"}}>
                    <span style={{fontSize:12,fontWeight:800,color:BRAND.text}}>🏪 {g.k}</span>
                    <span style={{marginLeft:"auto",fontSize:11,color:BRAND.muted}}>{g.filas.length} refacci{g.filas.length !== 1 ? "ones" : "ón"}</span>
                  </div>
                )}
                <div style={{display:"flex",flexDirection:"column",gap:6,padding:8}}>
                  {g.filas.map(({ o: ord, r }) => (
                    <FilaRefaccion key={ord.id + "·" + r.id} r={r} puedeEdit={puedeEdit} onCambiar={n=>onCambiar(ord.id, n)}
                      encabezado={agrupar === "proveedor" ? (
                        <button type="button" onClick={()=>onAbrirOrden(ord)} style={{display:"block",background:"none",border:"none",padding:0,marginBottom:4,cursor:"pointer",fontSize:11,color:BRAND.muted,textAlign:"left"}}>
                          <b style={{color:BRAND.accent}}>{ord.id}</b> · {ord.cliente} · {ord.enTransito ? "🚗 Tránsito" : "🔧 En piso"}
                        </button>) : null} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Resumen para el dashboard: lo esencial y un acceso directo a la sección
function ResumenRefaccionesDashboard({ ordenes, desktop, onIr }) {
  const S = mkS();
  const res = resumenRefacciones(ordenes);
  const segmentos = ESTADOS_REF_PENDIENTES.map(k => ({ ...infoEstadoRef(k), valor: res.porEstado[k] }));
  const linea = (icono, texto, valor, extra, color, onClick) => (
    <button type="button" onClick={onClick} disabled={!onClick}
      style={{display:"flex",alignItems:"center",gap:8,width:"100%",background:"none",border:"none",borderBottom:"0.5px solid "+BRAND.border,padding:"7px 2px",cursor:onClick?"pointer":"default",textAlign:"left"}}>
      <span style={{fontSize:14,width:20,textAlign:"center",flexShrink:0}}>{icono}</span>
      <span style={{fontSize:12,color:color || BRAND.text,flex:1,minWidth:0}}>{texto}{extra ? <span style={{color:BRAND.muted}}> · {extra}</span> : null}</span>
      <span style={{fontSize:15,fontWeight:800,color:color || BRAND.text}}>{valor}</span>
    </button>
  );
  return (
    <div style={S.card}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,marginBottom:res.total?10:4}}>
        <div style={{fontSize:13,fontWeight:700,color:BRAND.accent}}>📦 Refacciones <span style={{fontSize:11,color:BRAND.muted,fontWeight:400}}>{res.total ? `(${res.pendientes} pendientes de ${res.total})` : ""}</span></div>
        <button type="button" onClick={()=>onIr()} style={{...S.btnSm(),fontSize:11,flexShrink:0}}>Ver refacciones →</button>
      </div>
      {!res.total ? (
        <div style={{fontSize:12,color:BRAND.muted}}>Aún no hay refacciones en las órdenes activas. Agrégalas en la pestaña 🔧 Refacciones de cada orden y aquí verás cuántas faltan, cuáles están atrasadas y qué unidades ya pueden regresar.</div>
      ) : (
        <div style={{display:"flex",alignItems:"center",gap:18,flexWrap:"wrap",justifyContent:"center"}}>
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:10,flexShrink:0}}>
            <DonaRefacciones segmentos={segmentos} size={132} grosor={14} />
            <div style={{display:"grid",gridTemplateColumns:"repeat(2, auto)",gap:"4px 12px"}}>
              {segmentos.map(sg => (
                <span key={sg.key} style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:11,color:BRAND.text,whiteSpace:"nowrap"}}>
                  <span aria-hidden="true" style={{width:8,height:8,borderRadius:2,background:sg.color,flexShrink:0}} />{sg.label} <b>{sg.valor}</b>
                </span>))}
            </div>
          </div>
          <div style={{flex:"1 1 240px",minWidth:0}}>
            {linea("🔧", "En piso", res.piso.pendientes, `${res.piso.unidades} unidad${res.piso.unidades !== 1 ? "es" : ""}`, null, ()=>onIr())}
            {linea("🚗", "En tránsito", res.transito.pendientes, `${res.transito.unidades} unidad${res.transito.unidades !== 1 ? "es" : ""}`, null, ()=>onIr())}
            {linea("⚠", "Atrasadas", res.atrasadas, res.atrasadas ? "fecha promesa vencida" : null, res.atrasadas ? TEXTO_ATRASO : null, ()=>onIr("atrasadas"))}
            {linea("⏳", "Back order", res.porEstado.back_order, res.backOrderSinFecha ? `${res.backOrderSinFecha} sin fecha` : null, null, ()=>onIr("back_order"))}
            {res.listasReingreso.length > 0 && linea("✅", "Listas para reingreso", res.listasReingreso.length, "llama al cliente", BRAND.blue, ()=>onIr())}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PIZARRÓN DEL TALLER
// · Sección "Pizarrón" (equipo): las unidades activas de la más antigua a la más reciente,
//   la fecha de entrega (poner, cambiar con motivo, quitar), contacto con el cliente y alertas.
// · Modo pantalla (TV): se abre con /?pizarron, o solo con una cuenta de rol "pantalla".
//   Es de solo lectura y apto para que lo vean los clientes: sin teléfonos, costos ni
//   apellidos. Los datos llegan de la función pizarron() de la base, que ya los entrega
//   recortados (ver migracion_pizarron_pantalla.sql).
// ═══════════════════════════════════════════════════════════════════════════

// La fecha prometida al cliente vivía en dos campos: "entrega" (se captura al crear la orden)
// y "fechaPromesaEntrega" (en la ficha). Ahora se guardan juntos; en las órdenes viejas, si no
// coinciden, gana la de la ficha (igual que en pizarron() de la base).
const fechaEntregaOrden = o => (o && (o.fechaPromesaEntrega || o.entrega)) || "";

// Días de una fecha "AAAA-MM-DD" a otra, con signo (negativo si la segunda es anterior)
const diasEntre = (desde, hasta) => {
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(desde || ""), b = /^(\d{4})-(\d{2})-(\d{2})/.exec(hasta || "");
  if (!a || !b) return null;
  return Math.round((Date.UTC(+b[1], +b[2] - 1, +b[3]) - Date.UTC(+a[1], +a[2] - 1, +a[3])) / 86400000);
};
const diasParaEntrega = (o, hoyStr) => { const f = fechaEntregaOrden(o); return f ? diasEntre(hoyStr || hoyLocal(), f) : null; };
const sumarDias = (f, n) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(f || "");
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n)).toISOString().slice(0, 10) : "";
};

// Semáforo de entrega. "tv" es el color sobre el fondo oscuro de la pantalla.
const ESTADOS_ENTREGA = {
  vencida: { label:"Vencidas",        texto:"#B91C1C", fondo:"#FEF2F2", borde:"#FCA5A5", tv:"#F0524A" },
  hoy:     { label:"Para hoy",        texto:"#B45309", fondo:"#FFFBEB", borde:"#FCD34D", tv:"#F5B027" },
  manana:  { label:"Para mañana",     texto:"#1D4ED8", fondo:"#EFF6FF", borde:"#93C5FD", tv:"#5B9BFF" },
  semana:  { label:"Próximos 6 días", texto:"#1D4ED8", fondo:"#EFF6FF", borde:"#BFDBFE", tv:"#5B9BFF" },
  despues: { label:"Más adelante",    texto:"#047857", fondo:"#ECFDF5", borde:"#6EE7B7", tv:"#34C77B" },
  sin:     { label:"Sin fecha",       texto:"#5A6B7F", fondo:"#EEF2F6", borde:"#C8D2E0", tv:"#919EB0" },
};
const estadoEntrega = (o, hoyStr) => {
  const d = diasParaEntrega(o, hoyStr);
  if (d === null) return "sin";
  if (d < 0) return "vencida";
  if (d === 0) return "hoy";
  if (d === 1) return "manana";
  return d <= 6 ? "semana" : "despues";
};

const DIAS_CORTOS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const DIAS_LARGOS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES_LARGOS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const partesFecha = f => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(f || "");
  return m ? { mes: +m[2] - 1, dia: +m[3], semana: new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay() } : null;
};
const fechaConDia = f => { const p = partesFecha(f); return p ? `${DIAS_CORTOS[p.semana]} ${p.dia} ${MESES_CORTOS[p.mes]}` : ""; };    // "jue 23 oct"
const fechaLarga  = f => { const p = partesFecha(f); return p ? `${DIAS_LARGOS[p.semana]} ${p.dia} de ${MESES_LARGOS[p.mes]}` : ""; }; // "jueves 23 de octubre"
const conMayuscula = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

// Cómo se lee una entrega: etiqueta corta ("Hoy", "Mañana", "jue 23 oct", "Vencida") y un detalle
const describirEntrega = (o, hoyStr) => {
  const f = fechaEntregaOrden(o), estado = estadoEntrega(o, hoyStr), info = ESTADOS_ENTREGA[estado];
  if (!f) return { estado, info, corta: "Sin fecha", detalle: "" };
  const d = diasEntre(hoyStr || hoyLocal(), f);
  if (d < 0)   return { estado, info, corta: "Vencida", detalle: `hace ${-d} día${d === -1 ? "" : "s"}` };
  if (d === 0) return { estado, info, corta: "Hoy", detalle: fechaConDia(f) };
  if (d === 1) return { estado, info, corta: "Mañana", detalle: fechaConDia(f) };
  return { estado, info, corta: fechaConDia(f), detalle: `en ${d} días` };
};

// Cambios de fecha en la bitácora. Solo cuentan como reprogramación los que mueven la entrega a más tarde.
const RE_BITACORA_ENTREGA = /^(Fecha de entrega|Entrega reprogramada|Entrega adelantada|Se quitó la fecha de entrega)/;
const reprogramacionesDe = o => typeof (o && o.reprogramaciones) === "number"
  ? o.reprogramaciones
  : ((o && o.bitacora) || []).filter(b => b && typeof b.accion === "string" && b.accion.indexOf("Entrega reprogramada") === 0).length;
const MOTIVOS_REPROGRAMACION = ["Refacciones atrasadas", "Trabajo adicional", "Autorización de la aseguradora", "Petición del cliente", "Falta de personal o equipo", "Otro"];

// Pone (o quita) la fecha de entrega en los dos campos y lo anota en la bitácora
const conFechaEntrega = (o, fecha, { motivo = "", usuario = null, antes = fechaEntregaOrden(o) } = {}) => {
  const nueva = fecha || "", previa = antes || "";
  const n = { ...o, entrega: nueva, fechaPromesaEntrega: nueva };
  if (previa === nueva) return n;
  const extra = motivo ? " · " + motivo : "";
  const accion = !nueva ? `Se quitó la fecha de entrega (era el ${fechaCorta(previa)})${extra}`
    : !previa ? `Fecha de entrega: ${fechaCorta(nueva)}`
    : nueva > previa ? `Entrega reprogramada: ${fechaCorta(previa)} → ${fechaCorta(nueva)}${extra}`
    : `Entrega adelantada: ${fechaCorta(previa)} → ${fechaCorta(nueva)}${extra}`;
  n.bitacora = [...(o.bitacora || []), { accion, usuario: (usuario && usuario.nombre) || "", fecha: hoy() }];
  return n;
};

// El vehículo se captura como «Marca, Modelo, Año»: en el pizarrón se muestra sin comas
// ("Chevrolet, Aveo, 2025" → "Chevrolet Aveo 2025") y, donde no cabe, sin el año.
const textoVehiculo = v => String(v || "").replace(/\s*,\s*/g, " ").replace(/\s+/g, " ").trim();
const sinAnio = v => textoVehiculo(v).replace(/\s+(19|20)\d{2}$/, "");

// ─── Contacto con el cliente ────────────────────────────────────────────────────
// WhatsApp: 10 dígitos de México → 52 + número (wa.me ya no usa el "1" de los celulares)
const numeroWhatsApp = tel => {
  let d = String(tel || "").replace(/\D/g, "");
  if (d.length === 13 && d.indexOf("521") === 0) d = "52" + d.slice(3);
  if (d.length === 10) d = "52" + d;
  return d.length >= 11 && d.length <= 15 ? d : "";
};
const RE_TITULO = /^(lic|ing|sr|sra|srta|dr|dra|arq|mtro|mtra|c)\.?$/i;
const capitalizar = s => s.toLowerCase().replace(/(^|[\s-])(\S)/g, (m, a, b) => a + b.toUpperCase());
const primerNombre = n => { const p = String(n || "").trim().split(/\s+/).filter(x => x && !RE_TITULO.test(x)); return p[0] ? capitalizar(p[0]) : ""; };
// Igual que pizarron_nombre_corto() de la base: "kevin sánchez ruiz" → "Kevin S." (solo para el modo demo)
const nombreCorto = n => {
  const v = String(n || "").trim().split(/\s+/).filter(Boolean);
  if (!v.length) return "";
  let i = 0;
  while (i < v.length - 1 && RE_TITULO.test(v[i])) i++;
  return capitalizar(v[i]) + (v[i + 1] ? " " + v[i + 1].charAt(0).toUpperCase() + "." : "");
};
const mensajeCliente = (o, taller, tipo) => {
  const nombre = primerNombre(o.cliente);
  const saludo = `Hola${nombre ? " " + nombre : ""}, te escribimos de ${taller || "tu taller"}.`;
  const auto = (textoVehiculo(o.vehiculo) || "unidad") + (o.placa ? ` (placas ${o.placa})` : "");
  const f = fechaEntregaOrden(o), d = f ? diasEntre(hoyLocal(), f) : null;
  const cierre = " Cualquier duda, estamos a tus órdenes.";
  if (f && d !== null && d >= 0) {
    const cuando = d === 0 ? `hoy, ${fechaLarga(f)}` : d === 1 ? `mañana, ${fechaLarga(f)}` : `el ${fechaLarga(f)}`;
    if (tipo === "reprogramada") return `${saludo} La entrega de tu ${auto} se reprogramó para ${cuando}. Gracias por tu paciencia.${cierre}`;
    return `${saludo} La entrega de tu ${auto} está programada para ${cuando}.${cierre}`;
  }
  if (f) return `${saludo} Queremos darte una actualización sobre la entrega de tu ${auto}.`;
  return `${saludo} Te contactamos sobre tu ${auto}.`;
};

// ─── Cifras, alertas y cambios del pizarrón ─────────────────────────────────────
const resumenPizarron = (ordenes, hoyStr) => {
  const r = { total: 0, piso: 0, transito: 0, vencida: 0, hoy: 0, manana: 0, semana: 0, despues: 0, sin: 0 };
  (ordenes || []).forEach(o => { r.total++; if (o.enTransito) r.transito++; else r.piso++; r[estadoEntrega(o, hoyStr)]++; });
  return r;
};

const TIPOS_ALERTA = {
  vencida:   { label: "Entrega vencida",      tv: "#F0524A" },
  hoy:       { label: "Se entrega hoy",       tv: "#F5B027" },
  cambio:    { label: "Cambio reciente",      tv: "#FF5C35" },
  manana:    { label: "Se entrega mañana",    tv: "#5B9BFF" },
  refaccion: { label: "Refacción atrasada",   tv: "#F28C38" },
  reingreso: { label: "Lista para reingreso", tv: "#34C77B" },
};
const alertasPizarron = (ordenes, hoyStr, cambios) => {
  const lista = [];
  (ordenes || []).forEach(o => {
    const d = diasParaEntrega(o, hoyStr);
    if (d !== null && d < 0) lista.push({ clave: o.id + ":v", tipo: "vencida", o, detalle: `hace ${-d} día${d === -1 ? "" : "s"}`, orden: 0, peso: d });
    else if (d === 0) lista.push({ clave: o.id + ":h", tipo: "hoy", o, detalle: o.cliente || "", orden: 1, peso: 0 });
    else if (d === 1) lista.push({ clave: o.id + ":m", tipo: "manana", o, detalle: o.cliente || "", orden: 3, peso: 0 });
    const c = cambios && cambios[o.id];
    if (c) lista.push({ clave: o.id + ":c" + c.t, tipo: "cambio", o, detalle: c.texto, orden: 2, peso: -c.t });
    const refs = o.refacciones || [];
    const peor = refs.reduce((m, r) => diasAtrasoRef(r) > (m ? diasAtrasoRef(m) : 0) ? r : m, null);
    if (peor) {
      const n = refs.filter(r => diasAtrasoRef(r) > 0).length, dias = diasAtrasoRef(peor);
      lista.push({ clave: o.id + ":r", tipo: "refaccion", o, orden: 4, peso: -dias,
        detalle: n === 1 ? `${peor.nombre || "Refacción"}, ${dias} día${dias === 1 ? "" : "s"} de atraso` : `${n} refacciones atrasadas` });
    }
    if (o.enTransito && refs.length && refs.every(r => estadoRefaccion(r) === "recibida"))
      lista.push({ clave: o.id + ":i", tipo: "reingreso", o, detalle: "Ya llegaron todas sus refacciones", orden: 5, peso: 0 });
  });
  return lista.sort((a, b) => a.orden - b.orden || a.peso - b.peso || numFolio(a.o) - numFolio(b.o));
};

// Lo que cambió en una unidad entre dos consultas, solo de lo que se ve en el pizarrón
const cambioVisible = (antes, ahora) => {
  if (!antes) return "Nueva unidad en el taller";
  if (antes.estado !== ahora.estado) return "Pasó a " + (ESTADOS.find(e => e.key === ahora.estado) || ESTADOS[0]).label;
  const fa = fechaEntregaOrden(antes), fn = fechaEntregaOrden(ahora);
  if (fa !== fn) return fn ? (fa ? "Nueva fecha: " : "Entrega: ") + fechaConDia(fn) : "Sin fecha de entrega";
  if (!!antes.enTransito !== !!ahora.enTransito) return ahora.enTransito ? "Salió a tránsito" : "Regresó al taller";
  const recibidas = o => (o.refacciones || []).filter(r => estadoRefaccion(r) === "recibida").length;
  if (recibidas(ahora) > recibidas(antes)) return recibidas(ahora) === (ahora.refacciones || []).length ? "Llegaron todas sus refacciones" : "Llegó una refacción";
  return null;
};

// Lo que la pantalla puede mostrar de una orden (en modo demo; en producción lo recorta la base)
const vistaPublica = o => ({
  id: o.id, vehiculo: o.vehiculo || "", placa: o.placa || "", color: o.color || "", cliente: nombreCorto(o.cliente),
  estado: o.estado || "presupuesto", servicio: o.servicio || "", tecnico: o.tecnico || "",
  fecha: o.fecha || "", fechaPrimerIngreso: o.fechaPrimerIngreso || "", entrega: fechaEntregaOrden(o),
  enTransito: !!o.enTransito, fechaTransito: o.fechaTransito || "", reprogramaciones: reprogramacionesDe(o),
  refacciones: (o.refacciones || []).map(r => ({ nombre: r.nombre || "", cantidad: cantidadRef(r), estado: estadoRefaccion(r),
    recibida: estadoRefaccion(r) === "recibida", fechaPromesa: r.fechaPromesa || "" })),
});

// ─── Colores ───────────────────────────────────────────────────────────────────
const COLORES_AUTO = {
  blanco:"#F4F4F1", perla:"#ECE9E0", negro:"#16171A", gris:"#8A9099", grafito:"#4B5058", plata:"#C3C7CC", plateado:"#C3C7CC",
  rojo:"#C62828", vino:"#6D1A2A", guinda:"#6D1A2A", azul:"#1E4FA3", marino:"#1B2A4A", celeste:"#7CB4E6", verde:"#2E7D4F",
  amarillo:"#F2C531", naranja:"#EF7A22", dorado:"#C8A24A", cafe:"#6B4A2E", marron:"#6B4A2E", beige:"#D6C5A0", arena:"#CDBA92",
  champagne:"#E0D1AE", morado:"#5B3A8C", rosa:"#E58FB0", turquesa:"#1FA4A4",
};
const colorDeAuto = c => COLORES_AUTO[String(c || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim().split(/\s+/)[0]] || null;
const COLOR_ETAPA_TV = { presupuesto:"#919EB0", mecanica:"#4F8EF7", hojalateria:"#F5A524", pintura:"#F25555", armado:"#1FD1A5" };
const colorDiasTV = d => d > DIAS_ALERTA ? "hsl(0, 85%, 66%)" : `hsl(${Math.round(140 - (125 * d) / DIAS_ALERTA)}, 72%, 58%)`;

function useMedia(consulta) {
  const leer = () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(consulta).matches;
  const [coincide, setCoincide] = useState(leer);
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(consulta), h = () => setCoincide(mq.matches);
    h();
    if (mq.addEventListener) mq.addEventListener("change", h); else mq.addListener(h);
    return () => { if (mq.removeEventListener) mq.removeEventListener("change", h); else mq.removeListener(h); };
  }, [consulta]);
  return coincide;
}

// ─── Datos de la pantalla ──────────────────────────────────────────────────────
const CONSULTA_PIZARRON_MS = 30 * 1000;     // la TV pregunta cada 30 s; si nada cambió, la respuesta es mínima
const CAMBIO_VISIBLE_MS = 15 * 60 * 1000;   // cuánto tiempo se marca como "Actualizado" una unidad que cambió
const REVISAR_PERFIL_PANTALLA_MS = 10 * 60 * 1000;

function usePizarron({ usuario, ordenesDemo, onSinAcceso }) {
  const [estado, setEstado] = useState({ ordenes: [], cargado: false, sinConexion: false, sinAcceso: false, faltaActivar: false, ultimaOk: 0, cambios: {} });
  const tokenRef = useRef(null); tokenRef.current = usuario && usuario.token;
  const sinAccesoRef = useRef(onSinAcceso); sinAccesoRef.current = onSinAcceso;
  const marcaRef = useRef(null);
  const previasRef = useRef(null);
  const vigentes = (cambios, ahora) => { const c = {}; Object.keys(cambios).forEach(id => { if (ahora - cambios[id].t < CAMBIO_VISIBLE_MS) c[id] = cambios[id]; }); return c; };

  useEffect(() => {
    if (!ordenesDemo) return;
    setEstado(s => ({ ...s, ordenes: ordenesDemo.map(vistaPublica), cargado: true, ultimaOk: Date.now() }));
  }, [ordenesDemo]);

  const idUsuario = usuario && usuario.id;
  useEffect(() => {
    if (ordenesDemo || !idUsuario) return;
    let vivo = true, enCurso = false, reintento = null;
    const aplicar = filas => {
      const ahora = Date.now(), previas = previasRef.current;
      const lista = filas.map(f => ({ ...f, refacciones: Array.isArray(f.refacciones) ? f.refacciones : [] }));
      previasRef.current = new Map(lista.map(o => [o.id, o]));
      setEstado(s => {
        const cambios = vigentes(s.cambios, ahora);
        if (previas) lista.forEach(o => { const t = cambioVisible(previas.get(o.id), o); if (t) cambios[o.id] = { texto: t, t: ahora }; });
        return { ...s, ordenes: lista, cargado: true, sinConexion: false, sinAcceso: false, faltaActivar: false, ultimaOk: ahora, cambios };
      });
    };
    const consultar = async () => {
      if (!vivo || enCurso || document.hidden || !tokenRef.current) return;
      enCurso = true; clearTimeout(reintento);
      try {
        const r = await supaApi.pizarron(tokenRef.current, marcaRef.current);
        if (!vivo) return;
        if (r && Array.isArray(r.ordenes)) { marcaRef.current = r.marca || null; aplicar(r.ordenes); }
        else if (r && r.sin_cambios) { const ahora = Date.now(); setEstado(s => ({ ...s, cargado: true, sinConexion: false, sinAcceso: false, ultimaOk: ahora, cambios: vigentes(s.cambios, ahora) })); }
        else throw new Error("Respuesta inesperada del servidor");
      } catch (e) {
        if (!vivo) return;
        if (e.status === 403 || e.codigo === "42501") {
          marcaRef.current = null;
          setEstado(s => ({ ...s, cargado: true, sinAcceso: true }));
          if (sinAccesoRef.current) sinAccesoRef.current();
        } else if (e.status === 404 || e.codigo === "PGRST202") {
          setEstado(s => ({ ...s, cargado: true, faltaActivar: true }));
        } else {
          setEstado(s => ({ ...s, sinConexion: true }));        // se siguen mostrando los últimos datos
          if (e.status === 401) reintento = setTimeout(consultar, 5000);   // la llave se está renovando
        }
      } finally { enCurso = false; }
    };
    consultar();
    const iv = setInterval(consultar, CONSULTA_PIZARRON_MS);
    const alVolver = () => { if (!document.hidden) consultar(); };
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("online", consultar);
    return () => {
      vivo = false; clearInterval(iv); clearTimeout(reintento);
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("online", consultar);
    };
  }, [ordenesDemo ? "demo" : idUsuario]);
  return estado;
}

// ─── Modo pantalla (TV) ────────────────────────────────────────────────────────
// Todo se dibuja en un cuadro 16:9 medido en "u" (1 % de su ancho), así se ve igual en
// una TV de 32" o de 75", en 720p o en 4K. En un celular se muestra una versión en lista.
const CSS_PIZARRON = `
.pz-raiz{--bg:#1D2733;--panel:#26313E;--panel2:#2D3948;--linea:#374453;--texto:#EEF2F6;--texto2:#C8D2E0;--texto3:#919EB0;
  --acento:#FF5C35;--placa:#FFFFFF;--tinta:#1D2733;--u:1vw;
  position:fixed;top:0;left:0;right:0;bottom:0;background:var(--bg);color:var(--texto);overflow:hidden;
  display:flex;align-items:center;justify-content:center;font-family:"Archivo",system-ui,sans-serif;-webkit-font-smoothing:antialiased;z-index:1000}
@supports (width:min(1px,2px)){.pz-raiz{--u:min(1vw,1.7778vh)}}
.pz-raiz.sin-cursor,.pz-raiz.sin-cursor *{cursor:none!important}
.pz-raiz button{font-family:inherit}
.pz-tablero{width:calc(var(--u)*100);height:calc(var(--u)*56.25);box-sizing:border-box;padding:calc(var(--u)*1.6) calc(var(--u)*2.2) calc(var(--u)*1.4);
  display:grid;grid-template-rows:auto auto minmax(0,1fr) auto;row-gap:calc(var(--u)*1.25);transition:transform 2s ease}
.pz-cab{display:flex;align-items:center;justify-content:space-between}
.pz-marca{display:flex;align-items:center;min-width:0}
.pz-logo-rx{height:calc(var(--u)*2.1);width:auto;display:block;flex-shrink:0}
.pz-sep{width:1px;height:calc(var(--u)*3.6);background:var(--linea);margin:0 calc(var(--u)*1.7);flex-shrink:0}
.pz-logo-taller{width:calc(var(--u)*3.4);height:calc(var(--u)*3.4);border-radius:calc(var(--u)*0.7);object-fit:cover;flex-shrink:0;background:var(--panel2)}
.pz-inicial{display:flex;align-items:center;justify-content:center;font-weight:800;font-size:calc(var(--u)*1.9);color:var(--texto2)}
.pz-taller{margin-left:calc(var(--u)*1.1);min-width:0}
.pz-taller-nombre{font-size:calc(var(--u)*2.1);font-weight:800;font-stretch:112%;line-height:1.05;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:calc(var(--u)*50)}
.pz-taller-sub{font-size:calc(var(--u)*1.1);color:var(--texto2);margin-top:calc(var(--u)*0.25)}
.pz-reloj{text-align:right;flex-shrink:0}
.pz-hora{font-size:calc(var(--u)*3.1);font-weight:800;font-stretch:118%;line-height:1;font-variant-numeric:tabular-nums}
.pz-hora small{font-size:.4em;font-weight:600;color:var(--texto2);margin-left:.35em;font-stretch:100%}
.pz-fecha{font-size:calc(var(--u)*1.15);color:var(--texto2);margin-top:calc(var(--u)*0.35)}
.pz-cifras{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));background:var(--panel);border-radius:calc(var(--u)*0.9);overflow:hidden}
.pz-cifra{display:flex;align-items:center;padding:calc(var(--u)*0.8) calc(var(--u)*1.4);border-left:1px solid var(--linea);min-width:0}
.pz-cifra:first-child{border-left:none}
.pz-cifra b{font-size:calc(var(--u)*3.2);font-weight:800;font-stretch:122%;line-height:1;font-variant-numeric:tabular-nums;margin-right:calc(var(--u)*0.85)}
.pz-cifra span{font-size:calc(var(--u)*1.3);color:var(--texto2);line-height:1.15}
.pz-cifra.llena{border-left-color:transparent}
.pz-cifra.llena b,.pz-cifra.llena span{color:var(--tinta)}
.pz-cifra.llena span{font-weight:600}
.pz-escenario{position:relative;min-height:0}
.pz-diapo{position:absolute;top:0;left:0;right:0;bottom:0;display:grid;grid-template-rows:auto minmax(0,1fr);row-gap:calc(var(--u)*0.9);animation:pz-entra .6s ease both}
@keyframes pz-entra{from{opacity:0}to{opacity:1}}
.pz-titulo{display:flex;align-items:baseline;justify-content:space-between}
.pz-titulo h2{margin:0;font-size:calc(var(--u)*2.1);font-weight:800;font-stretch:115%;display:flex;align-items:center}
.pz-titulo p{margin:0;font-size:calc(var(--u)*1.15);color:var(--texto2)}
.pz-pausa{font-size:calc(var(--u)*1);font-weight:700;font-stretch:100%;color:var(--tinta);background:var(--texto2);border-radius:calc(var(--u)*0.4);padding:calc(var(--u)*0.2) calc(var(--u)*0.6);margin-left:calc(var(--u)*1)}
.pz-tabla{display:grid;grid-template-rows:auto repeat(8,minmax(0,1fr));min-height:0}
.pz-fila{display:grid;grid-template-columns:calc(var(--u)*11.4) minmax(0,1fr) calc(var(--u)*17) calc(var(--u)*7) calc(var(--u)*13.5) calc(var(--u)*11);
  column-gap:calc(var(--u)*1.4);align-items:center;padding:0 calc(var(--u)*1.1);border-bottom:1px solid var(--linea);min-height:0}
.pz-fila.enc{font-size:calc(var(--u)*1.02);color:var(--texto3);padding-bottom:calc(var(--u)*0.5);border-bottom-color:transparent}
.pz-fila.cambio{box-shadow:inset calc(var(--u)*0.32) 0 0 var(--acento);background:rgba(255,92,53,.07)}
.pz-der{text-align:right;justify-self:end}
.pz-placa{display:inline-flex;align-items:center;justify-content:center;position:relative;box-sizing:border-box;min-width:calc(var(--u)*9.8);
  height:calc(var(--u)*2.9);padding:0 calc(var(--u)*1);background:var(--placa);color:var(--tinta);border-radius:calc(var(--u)*0.45);
  font-weight:800;font-stretch:108%;font-size:calc(var(--u)*1.55);letter-spacing:.06em;white-space:nowrap;max-width:100%;overflow:hidden;
  box-shadow:inset 0 0 0 calc(var(--u)*0.11) var(--tinta),inset 0 0 0 calc(var(--u)*0.26) var(--placa),0 calc(var(--u)*0.14) 0 rgba(0,0,0,.45)}
.pz-placa::before,.pz-placa::after{content:"";position:absolute;top:calc(var(--u)*0.42);width:calc(var(--u)*0.26);height:calc(var(--u)*0.26);border-radius:50%;background:#919EB0}
.pz-placa::before{left:calc(var(--u)*0.42)}.pz-placa::after{right:calc(var(--u)*0.42)}
.pz-placa.sin{background:transparent;color:var(--texto2);box-shadow:inset 0 0 0 calc(var(--u)*0.11) var(--linea);font-weight:700;letter-spacing:.02em}
.pz-placa.sin::before,.pz-placa.sin::after{display:none}
.pz-placa.chica{min-width:calc(var(--u)*7.6);height:calc(var(--u)*2.15);font-size:calc(var(--u)*1.12);padding:0 calc(var(--u)*0.8)}
.pz-placa.chica::before,.pz-placa.chica::after{top:calc(var(--u)*0.3);width:calc(var(--u)*0.2);height:calc(var(--u)*0.2)}
.pz-celda{display:flex;flex-direction:column;justify-content:center;min-width:0}
.pz-auto{font-size:calc(var(--u)*1.6);font-weight:700;font-stretch:96%;display:flex;align-items:center;min-width:0;line-height:1.15}
.pz-recorte{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.pz-color{width:calc(var(--u)*1.05);height:calc(var(--u)*1.05);border-radius:50%;margin-right:calc(var(--u)*0.65);flex-shrink:0;box-shadow:0 0 0 1px rgba(255,255,255,.4)}
.pz-sub{font-size:calc(var(--u)*1.15);color:var(--texto2);display:flex;align-items:center;min-width:0;margin-top:calc(var(--u)*0.3);line-height:1.15;white-space:nowrap}
.pz-folio{flex-shrink:0;font-size:.85em;border:1px solid var(--linea);border-radius:calc(var(--u)*0.3);padding:0 calc(var(--u)*0.4);margin-left:calc(var(--u)*0.6);color:var(--texto3)}
.pz-tag{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;color:var(--acento);font-weight:700;margin-left:calc(var(--u)*0.7)}
.pz-pasos{display:inline-grid;grid-template-columns:repeat(5,minmax(0,1fr));column-gap:calc(var(--u)*0.22);width:calc(var(--u)*5.4);margin-right:calc(var(--u)*0.8);flex-shrink:0}
.pz-pasos i{height:calc(var(--u)*0.55);border-radius:calc(var(--u)*0.3);background:var(--linea)}
.pz-pasos i.hecho{background:var(--texto3)}
.pz-etapa-nombre{font-size:calc(var(--u)*1.45);font-weight:700;line-height:1.15;display:flex;align-items:center;min-width:0;white-space:nowrap}
.pz-transito{color:#8DB8FF;font-weight:700}
.pz-dias b{display:block;font-size:calc(var(--u)*2.4);font-weight:800;font-stretch:115%;line-height:1;font-variant-numeric:tabular-nums}
.pz-dias small{display:block;font-size:calc(var(--u)*1);color:var(--texto2);margin-top:calc(var(--u)*0.2)}
.pz-pildora{display:inline-flex;align-items:center;align-self:flex-start;height:calc(var(--u)*2.0);padding:0 calc(var(--u)*0.95);border-radius:calc(var(--u)*1.1);
  font-size:calc(var(--u)*1.3);font-weight:800;color:var(--tinta);white-space:nowrap}
.pz-pildora.sin{background:transparent!important;color:var(--texto2);box-shadow:inset 0 0 0 1px var(--linea);font-weight:600}
.pz-ref b{font-size:calc(var(--u)*1.4);font-weight:700;font-variant-numeric:tabular-nums}
.pz-barra{height:calc(var(--u)*0.5);background:var(--linea);border-radius:calc(var(--u)*0.3);overflow:hidden;flex:1 1 auto;max-width:calc(var(--u)*5);min-width:calc(var(--u)*2);margin-left:calc(var(--u)*0.8)}
.pz-ref-linea{display:flex;align-items:center;line-height:1.15}
.pz-barra i{display:block;height:100%;background:#34C77B}
.pz-atraso{color:#FF7B73;font-weight:700}
.pz-nada{color:var(--texto3);font-size:calc(var(--u)*1.3)}
.pz-etapas{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));column-gap:calc(var(--u)*1.1);min-height:0}
.pz-columna{background:var(--panel);border-radius:calc(var(--u)*0.9);display:grid;grid-template-rows:auto minmax(0,1fr);min-height:0;overflow:hidden}
.pz-col-cab{display:flex;align-items:center;justify-content:space-between;padding:calc(var(--u)*0.9) calc(var(--u)*1.2) calc(var(--u)*0.8);border-top:calc(var(--u)*0.42) solid var(--c)}
.pz-col-nombre{font-size:calc(var(--u)*1.5);font-weight:800;font-stretch:110%}
.pz-col-num{font-size:calc(var(--u)*2.5);font-weight:800;font-stretch:122%;font-variant-numeric:tabular-nums;line-height:1}
.pz-col-cuerpo{display:grid;grid-auto-rows:min-content;row-gap:calc(var(--u)*0.65);padding:0 calc(var(--u)*0.85) calc(var(--u)*0.85);min-height:0;overflow:hidden;align-content:start}
.pz-tarjeta{background:var(--panel2);border-radius:calc(var(--u)*0.6);padding:calc(var(--u)*0.7) calc(var(--u)*0.8);display:grid;row-gap:calc(var(--u)*0.45);min-width:0}
.pz-tarjeta.fuera{background:transparent;box-shadow:inset 0 0 0 1px var(--linea)}
.pz-tarjeta-fila{display:flex;align-items:center;justify-content:space-between;min-width:0}
.pz-tarjeta .pz-auto{font-size:calc(var(--u)*1.25)}
.pz-tarjeta .pz-sub{margin-top:0;font-size:calc(var(--u)*1.05)}
.pz-mini{font-size:calc(var(--u)*1.15);font-weight:800;font-variant-numeric:tabular-nums;flex-shrink:0;margin-left:calc(var(--u)*0.6)}
.pz-pildora.chica{height:calc(var(--u)*1.75);font-size:calc(var(--u)*1.05);padding:0 calc(var(--u)*0.75)}
.pz-mas{font-size:calc(var(--u)*1.15);color:var(--texto2);padding:calc(var(--u)*0.2) calc(var(--u)*0.3)}
.pz-vacio-col{font-size:calc(var(--u)*1.15);color:var(--texto3);padding:calc(var(--u)*0.6) calc(var(--u)*0.3)}
.pz-salidas .pz-fila{grid-template-columns:calc(var(--u)*12.5) calc(var(--u)*11.4) minmax(0,1fr) calc(var(--u)*15) calc(var(--u)*13.5)}
.pz-salida b{display:block;font-size:calc(var(--u)*1.75);font-weight:800;font-stretch:112%;line-height:1.05}
.pz-salida small{display:block;font-size:calc(var(--u)*1.1);color:var(--texto2);margin-top:calc(var(--u)*0.3)}
.pz-nota{font-size:calc(var(--u)*1.15);color:var(--texto2);padding:calc(var(--u)*0.6) calc(var(--u)*1.1) 0}
.pz-refs{display:grid;grid-template-columns:calc(var(--u)*29) minmax(0,1fr);column-gap:calc(var(--u)*1.6);min-height:0}
.pz-refs-resumen{background:var(--panel);border-radius:calc(var(--u)*0.9);padding:calc(var(--u)*1.6) calc(var(--u)*1.8);display:flex;flex-direction:column;min-height:0}
.pz-refs-total{display:flex;align-items:baseline}
.pz-refs-total b{font-size:calc(var(--u)*6);font-weight:800;font-stretch:122%;line-height:.95;font-variant-numeric:tabular-nums;margin-right:calc(var(--u)*1)}
.pz-refs-total span{font-size:calc(var(--u)*1.5);color:var(--texto2);line-height:1.2}
.pz-apilada{display:flex;height:calc(var(--u)*1.4);border-radius:calc(var(--u)*0.7);overflow:hidden;margin:calc(var(--u)*1.5) 0 calc(var(--u)*1.2);background:var(--linea)}
.pz-apilada i{display:block;height:100%}.pz-apilada i+i{margin-left:2px}
.pz-leyenda{display:grid;row-gap:calc(var(--u)*0.6);font-size:calc(var(--u)*1.3)}
.pz-leyenda div{display:flex;align-items:center}
.pz-leyenda i{width:calc(var(--u)*1.05);height:calc(var(--u)*1.05);border-radius:50%;margin-right:calc(var(--u)*0.75);flex-shrink:0}
.pz-leyenda b{margin-left:auto;font-variant-numeric:tabular-nums}
.pz-refs-aviso{margin-top:auto;font-size:calc(var(--u)*1.3);font-weight:700;color:#FF7B73}
.pz-refs-lista .pz-fila{grid-template-columns:calc(var(--u)*11.4) minmax(0,1fr) calc(var(--u)*11) calc(var(--u)*17)}
.pz-refs-lista{grid-template-rows:auto repeat(7,minmax(0,1fr))}
.pz-vacio{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;min-height:0}
.pz-vacio b{font-size:calc(var(--u)*2.4);font-weight:800;font-stretch:112%}
.pz-vacio span{font-size:calc(var(--u)*1.4);color:var(--texto2);margin-top:calc(var(--u)*0.8);max-width:calc(var(--u)*60)}
.pz-progreso{position:absolute;left:0;bottom:calc(var(--u)*-0.7);height:2px;width:0;background:var(--acento);animation:pz-avanza linear forwards}
@keyframes pz-avanza{from{width:0}to{width:100%}}
.pz-pie{display:grid;grid-template-columns:minmax(0,1fr) auto auto;column-gap:calc(var(--u)*1.8);align-items:center;background:var(--panel);
  border-radius:calc(var(--u)*0.9);padding:0 calc(var(--u)*1.2);height:calc(var(--u)*3.9);box-sizing:border-box}
.pz-alerta{display:flex;align-items:center;min-width:0;animation:pz-entra .5s ease both}
.pz-alerta-etq{flex-shrink:0;font-size:calc(var(--u)*1.15);font-weight:800;color:var(--tinta);padding:calc(var(--u)*0.32) calc(var(--u)*0.8);border-radius:calc(var(--u)*0.4);margin-right:calc(var(--u)*1)}
.pz-alerta-auto{font-size:calc(var(--u)*1.45);font-weight:700;white-space:nowrap;margin-left:calc(var(--u)*1);flex-shrink:0;max-width:calc(var(--u)*24);overflow:hidden;text-overflow:ellipsis}
.pz-alerta-txt{font-size:calc(var(--u)*1.35);color:var(--texto2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-left:calc(var(--u)*1);min-width:0}
.pz-alerta-n{flex-shrink:0;font-size:calc(var(--u)*1);color:var(--texto3);margin-left:calc(var(--u)*1.2)}
.pz-ok{font-size:calc(var(--u)*1.35);color:var(--texto2)}
.pz-red{font-size:calc(var(--u)*1.02);color:var(--texto3);white-space:nowrap}
.pz-red.mal{color:#F5B027;font-weight:700}
.pz-puntos{display:flex;align-items:center}
.pz-puntos i{width:calc(var(--u)*0.65);height:calc(var(--u)*0.65);border-radius:50%;background:var(--linea);margin-left:calc(var(--u)*0.45)}
.pz-puntos i.on{background:var(--acento)}
.pz-controles{position:absolute;left:50%;bottom:calc(var(--u)*6.4);transform:translate(-50%,10px);display:flex;align-items:center;background:rgba(38,49,62,.97);
  border:1px solid var(--linea);border-radius:999px;padding:6px;opacity:0;pointer-events:none;transition:opacity .25s,transform .25s;box-shadow:0 12px 40px rgba(0,0,0,.55);z-index:5}
.pz-controles.visible{opacity:1;pointer-events:auto;transform:translate(-50%,0)}
.pz-controles button{background:transparent;color:var(--texto);border:none;border-radius:999px;padding:0 18px;height:44px;font-size:15px;font-weight:600;cursor:pointer;white-space:nowrap}
.pz-controles button:hover{background:var(--panel2)}
.pz-controles .flecha{font-size:22px;padding:0 14px}
.pz-controles .peligro{color:#FF9C8F}
.pz-controles hr{width:1px;height:24px;border:none;background:var(--linea);margin:0 4px}
.pz-raiz button:focus-visible{outline:3px solid var(--acento);outline-offset:2px}
.pz-mensaje{width:calc(var(--u)*62);max-width:92vw;text-align:center}
.pz-mensaje img{height:calc(var(--u)*2.8);min-height:24px;width:auto;margin:0 auto calc(var(--u)*2.4);display:block}
.pz-mensaje h1{font-size:calc(var(--u)*2.6);font-weight:800;font-stretch:112%;margin:0 0 calc(var(--u)*1)}
.pz-mensaje p{font-size:calc(var(--u)*1.45);color:var(--texto2);line-height:1.45;margin:0 0 calc(var(--u)*2)}
.pz-boton{background:var(--acento);color:#fff;border:none;border-radius:12px;padding:12px 22px;font-size:16px;font-weight:700;cursor:pointer;margin:0 6px}
.pz-boton.sec{background:transparent;color:var(--texto);box-shadow:inset 0 0 0 1px var(--linea)}
@media (max-width:760px){
  .pz-raiz{position:fixed;display:block;overflow-y:auto;-webkit-overflow-scrolling:touch;--u:4.2px}
  .pz-mensaje{margin:22vh auto 0;width:auto;padding:0 20px}
  .pz-mensaje h1{font-size:22px}.pz-mensaje p{font-size:15px}
}
.pz-compacta{padding:16px 16px 28px;max-width:560px;margin:0 auto}
.pz-c-cab{margin-bottom:16px}
.pz-c-cab .pz-c-fila{display:flex;align-items:center;justify-content:space-between}
.pz-c-cab .pz-logo-rx{height:17px}
.pz-c-cab .pz-hora{font-size:22px}
.pz-c-taller{display:flex;align-items:center;margin-top:14px;min-width:0}
.pz-c-taller .pz-logo-taller{width:40px;height:40px;border-radius:10px}
.pz-c-taller .pz-taller{margin-left:12px}
.pz-c-taller .pz-taller-nombre{font-size:19px;max-width:calc(100vw - 100px)}
.pz-c-taller .pz-taller-sub{font-size:12px;margin-top:2px}
.pz-compacta .pz-cifras{grid-template-columns:repeat(2,minmax(0,1fr));border-radius:12px}
.pz-compacta .pz-cifra{padding:12px 14px;border-left:none;border-top:1px solid var(--linea)}
.pz-compacta .pz-cifra b{font-size:26px;margin-right:8px}.pz-compacta .pz-cifra span{font-size:13px}
.pz-c-titulo{font-size:17px;font-weight:800;font-stretch:112%;margin:22px 0 10px}
.pz-c-alerta{display:flex;align-items:center;flex-wrap:wrap;background:var(--panel);border-radius:12px;padding:10px 12px;margin-bottom:8px}
.pz-c-alerta .pz-alerta-etq{font-size:12px;padding:3px 8px;border-radius:6px;margin-right:8px}
.pz-c-alerta span{font-size:14px;margin-top:4px}
.pz-c-tarjeta{background:var(--panel);border-radius:12px;padding:12px 14px;margin-bottom:8px}
.pz-c-fila{display:flex;align-items:center;justify-content:space-between}
.pz-c-tarjeta .pz-placa{min-width:0;height:30px;font-size:15px;padding:0 13px;border-radius:5px;
  box-shadow:inset 0 0 0 1.5px var(--tinta),inset 0 0 0 3.5px var(--placa),0 1px 0 rgba(0,0,0,.45)}
.pz-c-tarjeta .pz-placa::before,.pz-c-tarjeta .pz-placa::after{top:5px;width:3.5px;height:3.5px}
.pz-c-tarjeta .pz-placa::before{left:5px}.pz-c-tarjeta .pz-placa::after{right:5px}
.pz-c-auto{font-size:15px;font-weight:700;margin-top:10px;display:flex;align-items:center}
.pz-c-auto .pz-color{width:11px;height:11px;margin-right:7px}
.pz-c-sub{font-size:13px;color:var(--texto2);margin-top:4px}
.pz-c-tarjeta .pz-pildora{height:26px;font-size:13px;padding:0 10px;border-radius:13px}
.pz-c-salir{display:block;width:100%;margin-top:18px;background:transparent;color:var(--texto2);border:1px solid var(--linea);border-radius:12px;padding:12px;font-size:14px}
@media (prefers-reduced-motion:reduce){
  .pz-diapo,.pz-alerta{animation:none}
  .pz-progreso{display:none}
  .pz-tablero,.pz-controles{transition:none}
}
`;

function RelojPizarron({ sinFecha = false }) {
  const [t, setT] = useState(() => new Date());
  useEffect(() => { const iv = setInterval(() => setT(new Date()), 5000); return () => clearInterval(iv); }, []);
  const h = t.getHours();
  return (
    <div className="pz-reloj" aria-label="Hora actual">
      <div className="pz-hora">{h % 12 || 12}:{String(t.getMinutes()).padStart(2, "0")}<small>{h < 12 ? "a. m." : "p. m."}</small></div>
      {!sinFecha && <div className="pz-fecha">{conMayuscula(DIAS_LARGOS[t.getDay()])} {t.getDate()} de {MESES_LARGOS[t.getMonth()]}</div>}
    </div>
  );
}

function PlacaTV({ o, chica }) {
  return o.placa
    ? <span className={"pz-placa" + (chica ? " chica" : "")} title={"Placas " + o.placa}>{o.placa.toUpperCase()}</span>
    : <span className={"pz-placa sin" + (chica ? " chica" : "")} title="Sin placas registradas">{o.id}</span>;
}

function PildoraEntrega({ o, hoyStr, chica }) {
  const e = describirEntrega(o, hoyStr);
  return <span className={"pz-pildora" + (chica ? " chica" : "") + (e.estado === "sin" ? " sin" : "")} style={{ background: e.info.tv }}>{e.corta}</span>;
}

function AutoTV({ o, recortar = true, corto = false }) {
  const color = colorDeAuto(o.color);
  return (
    <span className="pz-auto">
      {color && <i className="pz-color" style={{ background: color }} aria-hidden="true" />}
      <span className={recortar ? "pz-recorte" : ""}>{(corto ? sinAnio(o.vehiculo) : textoVehiculo(o.vehiculo)) || "Unidad sin datos"}</span>
    </span>
  );
}

function FilaUnidadTV({ o, hoyStr, cambio }) {
  const idx = Math.max(0, PASOS.indexOf(o.estado));
  const etapa = ESTADOS[idx];
  const dias = diasDesdeAlta(o);
  const dT = diasEnTransito(o);
  const e = describirEntrega(o, hoyStr);
  const rep = reprogramacionesDe(o);
  const refs = o.refacciones || [];
  const recibidas = refs.filter(r => estadoRefaccion(r) === "recibida").length;
  const atrasadas = refs.filter(r => diasAtrasoRef(r) > 0).length;
  const proxima = refs.filter(r => estadoRefaccion(r) !== "recibida" && r.fechaPromesa).sort((a, b) => a.fechaPromesa.localeCompare(b.fechaPromesa))[0];
  return (
    <div className={"pz-fila" + (cambio ? " cambio" : "")} role="row" data-orden={o.id}>
      <span role="cell"><PlacaTV o={o} /></span>
      <span role="cell" className="pz-celda">
        <AutoTV o={o} />
        <span className="pz-sub"><span className="pz-recorte">{o.cliente || "Cliente"}</span><span className="pz-folio">{o.id}</span>{cambio && <span className="pz-tag">{cambio.texto}</span>}</span>
      </span>
      <span role="cell" className="pz-celda">
        <span className="pz-etapa-nombre"><span className="pz-pasos" aria-hidden="true">{PASOS.map((p, j) => <i key={p} className={j < idx ? "hecho" : ""} style={j === idx ? { background: COLOR_ETAPA_TV[p] } : undefined} />)}</span>{etapa.label}</span>
        <span className="pz-sub" style={{ paddingLeft: "calc(var(--u)*6.2)" }}>{o.enTransito ? <span className="pz-transito">En tránsito{dT !== null ? `, ${dT} d` : ""}</span> : <span className="pz-recorte">{o.tecnico || "\u00a0"}</span>}</span>
      </span>
      <span role="cell" className="pz-dias pz-der">{dias === null ? <b style={{ color: "var(--texto3)" }}>–</b> : <b style={{ color: colorDiasTV(dias) }}>{dias > DIAS_ALERTA ? "⚠" : ""}{dias}</b>}<small>{dias === 1 ? "día" : "días"}</small></span>
      <span role="cell" className="pz-celda">
        <PildoraEntrega o={o} hoyStr={hoyStr} />
        <span className="pz-sub">{(e.detalle + (rep > 0 ? `${e.detalle ? ", " : ""}${rep === 1 ? "1 cambio" : rep + " cambios"}` : "")) || "\u00a0"}</span>
      </span>
      <span role="cell" className="pz-celda pz-ref">
        {refs.length === 0 ? <span className="pz-nada">Sin piezas</span> : <>
          <span className="pz-ref-linea"><b>{recibidas} de {refs.length}</b><span className="pz-barra" aria-hidden="true"><i style={{ width: (100 * recibidas / refs.length) + "%" }} /></span></span>
          <span className="pz-sub">{atrasadas ? <span className="pz-atraso">⚠ {atrasadas} atrasada{atrasadas === 1 ? "" : "s"}</span>
            : recibidas === refs.length ? "Completas" : proxima ? `Llega ${fechaConDia(proxima.fechaPromesa)}` : "Por llegar"}</span>
        </>}
      </span>
    </div>
  );
}

function DiapoUnidades({ filas, pagina, paginas, hoyStr, cambios, pausa }) {
  return (
    <section className="pz-diapo" aria-label="Unidades en el taller">
      <div className="pz-titulo"><h2>Unidades en el taller{pausa && <span className="pz-pausa">En pausa</span>}</h2>
        <p>De la más antigua a la más reciente{paginas > 1 ? `, página ${pagina + 1} de ${paginas}` : ""}</p></div>
      <div className="pz-tabla" role="table">
        <div className="pz-fila enc" role="row"><span role="columnheader">Placas</span><span role="columnheader">Unidad y cliente</span><span role="columnheader">Etapa</span><span role="columnheader" className="pz-der">En taller</span><span role="columnheader">Entrega</span><span role="columnheader">Refacciones</span></div>
        {filas.map(o => <FilaUnidadTV key={o.id} o={o} hoyStr={hoyStr} cambio={cambios[o.id]} />)}
      </div>
    </section>
  );
}

const MAX_TARJETAS_ETAPA = 4;
function DiapoEtapas({ unidades, hoyStr, pausa }) {
  return (
    <section className="pz-diapo" aria-label="Unidades por etapa">
      <div className="pz-titulo"><h2>Por etapa{pausa && <span className="pz-pausa">En pausa</span>}</h2><p>Las unidades en tránsito van al final de su etapa, con contorno</p></div>
      <div className="pz-etapas">
        {ESTADOS.map(e => {
          const lista = unidades.filter(o => (PASOS.includes(o.estado) ? o.estado : "presupuesto") === e.key);
          const orden = [...lista.filter(o => !o.enTransito), ...lista.filter(o => o.enTransito)];
          return (
            <div className="pz-columna" key={e.key}>
              <div className="pz-col-cab" style={{ "--c": COLOR_ETAPA_TV[e.key] }}><span className="pz-col-nombre">{e.label}</span><span className="pz-col-num">{lista.length}</span></div>
              <div className="pz-col-cuerpo">
                {orden.slice(0, MAX_TARJETAS_ETAPA).map(o => { const d = diasDesdeAlta(o); return (
                  <div key={o.id} className={"pz-tarjeta" + (o.enTransito ? " fuera" : "")}>
                    <div className="pz-tarjeta-fila"><PlacaTV o={o} chica /><PildoraEntrega o={o} hoyStr={hoyStr} chica /></div>
                    <div className="pz-tarjeta-fila"><AutoTV o={o} corto />{o.enTransito
                      ? <span className="pz-mini pz-transito">Tránsito</span>
                      : d !== null && <span className="pz-mini" style={{ color: colorDiasTV(d) }}>{d} d</span>}</div>
                  </div>); })}
                {orden.length > MAX_TARJETAS_ETAPA && <div className="pz-mas">y {orden.length - MAX_TARJETAS_ETAPA} más</div>}
                {orden.length === 0 && <div className="pz-vacio-col">Sin unidades</div>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

const FILAS_ENTREGAS = 8;
function DiapoEntregas({ unidades, hoyStr, pausa }) {
  const conFecha = unidades.filter(o => fechaEntregaOrden(o))
    .sort((a, b) => fechaEntregaOrden(a).localeCompare(fechaEntregaOrden(b)) || fechaAlta(a).localeCompare(fechaAlta(b)) || numFolio(a) - numFolio(b));
  const sinFecha = unidades.length - conFecha.length;
  const visibles = conFecha.slice(0, FILAS_ENTREGAS);
  const resto = conFecha.length - visibles.length;
  return (
    <section className="pz-diapo" aria-label="Próximas entregas">
      <div className="pz-titulo"><h2>Entregas{pausa && <span className="pz-pausa">En pausa</span>}</h2><p>Fechas prometidas a los clientes, de la más próxima a la más lejana</p></div>
      {conFecha.length === 0
        ? <div className="pz-vacio"><b>Aún no hay fechas de entrega</b><span>Se ponen desde la sección Pizarrón de la app. En cuanto alguien agregue una, aparecerá aquí.</span></div>
        : <div className="pz-tabla pz-salidas" role="table">
            <div className="pz-fila enc" role="row"><span role="columnheader">Fecha</span><span role="columnheader">Placas</span><span role="columnheader">Unidad y cliente</span><span role="columnheader">Etapa</span><span role="columnheader">Estado</span></div>
            {visibles.map(o => {
              const e = describirEntrega(o, hoyStr), f = fechaEntregaOrden(o), rep = reprogramacionesDe(o);
              const etapa = ESTADOS[Math.max(0, PASOS.indexOf(o.estado))];
              return (
                <div className="pz-fila" role="row" key={o.id}>
                  <span role="cell" className="pz-salida"><b>{conMayuscula(fechaConDia(f))}</b><small>{rep > 0 ? (rep === 1 ? "Reprogramada 1 vez" : `Reprogramada ${rep} veces`) : "Fecha original"}</small></span>
                  <span role="cell"><PlacaTV o={o} /></span>
                  <span role="cell" className="pz-celda"><AutoTV o={o} /><span className="pz-sub"><span className="pz-recorte">{o.cliente || "Cliente"}</span><span className="pz-folio">{o.id}</span></span></span>
                  <span role="cell" className="pz-celda"><span className="pz-etapa-nombre">{etapa.label}</span><span className="pz-sub">{o.enTransito ? <span className="pz-transito">En tránsito</span> : <span className="pz-recorte">{o.tecnico || "\u00a0"}</span>}</span></span>
                  <span role="cell" className="pz-celda"><span className="pz-pildora" style={{ background: e.info.tv }}>{e.estado === "vencida" ? "Vencida" : e.estado === "hoy" ? "Hoy" : e.estado === "manana" ? "Mañana" : e.estado === "semana" ? conMayuscula(e.detalle) : "A tiempo"}</span>
                    <span className="pz-sub">{e.estado === "vencida" || e.estado === "despues" ? e.detalle : "\u00a0"}</span></span>
                </div>
              );
            })}
            {(sinFecha > 0 || resto > 0) && <div className="pz-nota">{[resto > 0 ? `${resto} entrega${resto === 1 ? "" : "s"} más adelante` : "", sinFecha > 0 ? `${sinFecha} unidad${sinFecha === 1 ? "" : "es"} sin fecha de entrega` : ""].filter(Boolean).join(" y ")}</div>}
          </div>}
    </section>
  );
}

const FILAS_REFACCIONES = 7;
function DiapoRefacciones({ unidades, pausa }) {
  const res = resumenRefacciones(unidades);
  const segmentos = ESTADOS_REFACCION.filter(e => e.key !== "recibida").map(e => ({ ...e, valor: res.porEstado[e.key] || 0 }));
  const esperando = unidades.filter(o => (o.refacciones || []).some(r => estadoRefaccion(r) !== "recibida"))
    .map(o => { const refs = o.refacciones; const atraso = Math.max(0, ...refs.map(diasAtrasoRef)); return { o, atraso, recibidas: refs.filter(r => estadoRefaccion(r) === "recibida").length }; })
    .sort((a, b) => b.atraso - a.atraso || fechaAlta(a.o).localeCompare(fechaAlta(b.o)));
  const visibles = esperando.slice(0, FILAS_REFACCIONES);
  return (
    <section className="pz-diapo" aria-label="Refacciones pendientes">
      <div className="pz-titulo"><h2>Esperando refacciones{pausa && <span className="pz-pausa">En pausa</span>}</h2><p>{res.unidadesEsperando} unidad{res.unidadesEsperando === 1 ? "" : "es"} con piezas por llegar</p></div>
      <div className="pz-refs">
        <div className="pz-refs-resumen">
          <div className="pz-refs-total"><b>{res.pendientes}</b><span>refacciones<br />pendientes</span></div>
          <div className="pz-apilada" role="img" aria-label={segmentos.map(s => `${s.label}: ${s.valor}`).join(", ")}>
            {segmentos.filter(s => s.valor > 0).map(s => <i key={s.key} style={{ width: (100 * s.valor / Math.max(1, res.pendientes)) + "%", background: s.color }} />)}
          </div>
          <div className="pz-leyenda">{segmentos.map(s => <div key={s.key}><i style={{ background: s.color }} />{s.label}<b>{s.valor}</b></div>)}</div>
          {res.atrasadas > 0 && <div className="pz-refs-aviso">⚠ {res.atrasadas} con la fecha de llegada vencida</div>}
        </div>
        <div className="pz-tabla pz-refs-lista" role="table">
          <div className="pz-fila enc" role="row"><span role="columnheader">Placas</span><span role="columnheader">Unidad</span><span role="columnheader">Recibidas</span><span role="columnheader">Lo que falta</span></div>
          {visibles.map(({ o, atraso, recibidas }) => {
            const pend = o.refacciones.filter(r => estadoRefaccion(r) !== "recibida");
            const peor = atraso > 0 ? pend.find(r => diasAtrasoRef(r) === atraso) : pend.filter(r => r.fechaPromesa).sort((a, b) => a.fechaPromesa.localeCompare(b.fechaPromesa))[0];
            return (
              <div className="pz-fila" role="row" key={o.id}>
                <span role="cell"><PlacaTV o={o} /></span>
                <span role="cell" className="pz-celda"><AutoTV o={o} /><span className="pz-sub">{o.enTransito ? <span className="pz-transito">En tránsito</span> : <span className="pz-recorte">{o.cliente || ""}</span>}</span></span>
                <span role="cell" className="pz-celda pz-ref"><span className="pz-ref-linea"><b>{recibidas} de {o.refacciones.length}</b><span className="pz-barra" aria-hidden="true"><i style={{ width: (100 * recibidas / o.refacciones.length) + "%" }} /></span></span></span>
                <span role="cell" className="pz-celda">
                  <span className="pz-auto" style={{ fontSize: "calc(var(--u)*1.35)" }}><span className="pz-recorte">{peor ? peor.nombre || "Refacción" : pend[0].nombre || "Refacción"}{pend.length > 1 ? ` y ${pend.length - 1} más` : ""}</span></span>
                  <span className="pz-sub">{atraso > 0 ? <span className="pz-atraso">⚠ {atraso} día{atraso === 1 ? "" : "s"} de atraso</span> : peor ? `Llega ${fechaConDia(peor.fechaPromesa)}` : infoEstadoRef(estadoRefaccion(pend[0])).label}</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// Versión en lista para pantallas angostas (un celular): mismas cifras, alertas y unidades
function PizarronCompacto({ marca, cifras, alertas, unidades, hoyStr, salir }) {
  return (
    <div className="pz-compacta">
      {marca}
      {cifras}
      {alertas.length > 0 && <>
        <div className="pz-c-titulo">Alertas</div>
        {alertas.map(a => (
          <div className="pz-c-alerta" key={a.clave}>
            <span className="pz-alerta-etq" style={{ background: TIPOS_ALERTA[a.tipo].tv }}>{TIPOS_ALERTA[a.tipo].label}</span>
            <span><b>{a.o.placa || a.o.id}</b> {textoVehiculo(a.o.vehiculo)}{a.detalle ? `: ${a.detalle}` : ""}</span>
          </div>
        ))}
      </>}
      <div className="pz-c-titulo">Unidades, de la más antigua a la más reciente</div>
      {unidades.length === 0 && <div className="pz-c-sub">No hay unidades activas en el taller.</div>}
      {unidades.map(o => { const d = diasDesdeAlta(o); const color = colorDeAuto(o.color); return (
        <div className="pz-c-tarjeta" key={o.id}>
          <div className="pz-c-fila"><PlacaTV o={o} /><PildoraEntrega o={o} hoyStr={hoyStr} /></div>
          <div className="pz-c-auto">{color && <i className="pz-color" style={{ background: color }} />}{textoVehiculo(o.vehiculo) || "Unidad sin datos"}</div>
          <div className="pz-c-sub">{[o.cliente, (ESTADOS.find(e => e.key === o.estado) || ESTADOS[0]).label, d !== null ? `${d} día${d === 1 ? "" : "s"} en taller` : "", o.enTransito ? "en tránsito" : ""].filter(Boolean).join(", ")}</div>
        </div>); })}
      {salir}
    </div>
  );
}

function PizarronPantalla({ usuario, esPantalla, ordenesDemo, onSalir, onCerrarSesion, onRevisarPerfil }) {
  const datos = usePizarron({ usuario, ordenesDemo, onSinAcceso: onRevisarPerfil });
  const [, setPulso] = useState(0);                  // vuelve a dibujar cada 30 s (cambia el día, vencen fechas)
  const [indice, setIndice] = useState(0);
  const [pausa, setPausa] = useState(false);
  const [vuelta, setVuelta] = useState(0);            // reinicia la barra de avance al reanudar
  const [controles, setControles] = useState(true);
  const [iAlerta, setIAlerta] = useState(0);
  const [desfase, setDesfase] = useState(0);
  const compacta = useMedia("(max-width: 760px)");
  const hoyStr = hoyLocal();

  useEffect(() => { const iv = setInterval(() => setPulso(p => p + 1), 30 * 1000); return () => clearInterval(iv); }, []);
  // Mueve el tablero 1–2 px cada 3 minutos para que las TV no se "quemen" con la imagen fija
  useEffect(() => { const iv = setInterval(() => setDesfase(d => (d + 1) % 4), 3 * 60 * 1000); return () => clearInterval(iv); }, []);
  // La pantalla no se apaga sola mientras el pizarrón está abierto
  useEffect(() => {
    let candado = null;
    const pedir = () => {
      if (!navigator.wakeLock || document.hidden) return;
      navigator.wakeLock.request("screen").then(c => { candado = c; }).catch(() => {});
    };
    pedir();
    const alVolver = () => { if (!document.hidden) pedir(); };
    document.addEventListener("visibilitychange", alVolver);
    return () => { document.removeEventListener("visibilitychange", alVolver); try { if (candado) candado.release(); } catch (_) {} };
  }, []);
  // Las cuentas de pantalla confirman su rol cada 10 minutos (si se lo cambian, la TV cierra la sesión)
  useEffect(() => {
    if (!esPantalla || !onRevisarPerfil) return;
    const iv = setInterval(() => { if (!document.hidden) onRevisarPerfil(); }, REVISAR_PERFIL_PANTALLA_MS);
    return () => clearInterval(iv);
  }, [esPantalla]);
  // Controles y cursor: aparecen al mover el mouse, tocar o usar el control remoto; se ocultan solos
  useEffect(() => {
    let t = null;
    const mostrar = () => { setControles(true); clearTimeout(t); t = setTimeout(() => setControles(false), 4000); };
    mostrar();
    const ev = ["pointermove", "pointerdown", "keydown"];
    ev.forEach(e => window.addEventListener(e, mostrar));
    return () => { clearTimeout(t); ev.forEach(e => window.removeEventListener(e, mostrar)); };
  }, []);

  const unidades = ordenarPorAlta(datos.ordenes, "antiguas");
  const paginas = Math.max(1, Math.ceil(unidades.length / 8));
  const diapos = [];
  for (let p = 0; p < paginas; p++) diapos.push({ clave: "u" + p, tipo: "unidades", pagina: p, ms: 15000 });
  if (unidades.length) diapos.push({ clave: "etapas", tipo: "etapas", ms: 18000 }, { clave: "entregas", tipo: "entregas", ms: 18000 });
  if (unidades.some(o => (o.refacciones || []).some(r => estadoRefaccion(r) !== "recibida"))) diapos.push({ clave: "refacciones", tipo: "refacciones", ms: 15000 });
  const n = diapos.length, i = indice % n, actual = diapos[i];
  const siguiente = () => { setIndice(x => (x % n + 1) % n); setVuelta(v => v + 1); };
  const anterior = () => { setIndice(x => (x % n - 1 + n) % n); setVuelta(v => v + 1); };
  const alternarPausa = () => { setPausa(p => !p); setVuelta(v => v + 1); };
  useEffect(() => {
    if (pausa || n <= 1 || compacta) return;
    const t = setTimeout(() => setIndice(x => (x % n + 1) % n), actual.ms);
    return () => clearTimeout(t);
  }, [i, pausa, n, actual.clave, vuelta, compacta]);

  const pantallaCompleta = () => {
    try {
      if (document.fullscreenElement) { const p = document.exitFullscreen(); if (p && p.catch) p.catch(() => {}); }
      else if (document.documentElement.requestFullscreen) { const p = document.documentElement.requestFullscreen({ navigationUI: "hide" }); if (p && p.catch) p.catch(() => {}); }
    } catch (_) {}
  };
  const cerrar = () => { if (confirm("¿Cerrar la sesión de esta pantalla? Para volver a mostrar el pizarrón habrá que iniciar sesión otra vez.")) onCerrarSesion(); };
  useEffect(() => {
    const tecla = e => {
      const enBoton = e.target && (e.target.tagName === "BUTTON" || e.target.tagName === "A");
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === "MediaTrackNext") siguiente();
      else if (e.key === "ArrowLeft" || e.key === "PageUp" || e.key === "MediaTrackPrevious") anterior();
      else if ((e.key === " " || e.key === "Enter" || e.key === "MediaPlayPause") && !enBoton) { e.preventDefault(); alternarPausa(); }
      else if (e.key === "f" || e.key === "F") pantallaCompleta();
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [n]);

  const alertas = alertasPizarron(unidades, hoyStr, datos.cambios);
  useEffect(() => {
    if (alertas.length <= 1) return;
    const iv = setInterval(() => setIAlerta(x => x + 1), 6000);
    return () => clearInterval(iv);
  }, [alertas.length]);
  const alerta = alertas.length ? alertas[iAlerta % alertas.length] : null;

  const tallerNombre = usuario.tallerNombre || usuario.taller || "Mi taller";
  const marca = (
    <header className="pz-cab">
      <div className="pz-marca">
        <img src="/img/logo-repairx-blanco.svg" alt="RepairX" className="pz-logo-rx" />
        <span className="pz-sep" aria-hidden="true" />
        {usuario.logo ? <img src={usuario.logo} alt="" className="pz-logo-taller" /> : <span className="pz-logo-taller pz-inicial" aria-hidden="true">{tallerNombre.charAt(0).toUpperCase()}</span>}
        <div className="pz-taller"><div className="pz-taller-nombre">{tallerNombre}</div><div className="pz-taller-sub">Pizarrón del taller</div></div>
      </div>
      <RelojPizarron />
    </header>
  );
  const marcaCompacta = (
    <header className="pz-c-cab">
      <div className="pz-c-fila"><img src="/img/logo-repairx-blanco.svg" alt="RepairX" className="pz-logo-rx" /><RelojPizarron sinFecha /></div>
      <div className="pz-c-taller">
        {usuario.logo ? <img src={usuario.logo} alt="" className="pz-logo-taller" /> : <span className="pz-logo-taller pz-inicial" aria-hidden="true">{tallerNombre.charAt(0).toUpperCase()}</span>}
        <div className="pz-taller"><div className="pz-taller-nombre">{tallerNombre}</div><div className="pz-taller-sub">Pizarrón del taller</div></div>
      </div>
    </header>
  );
  const res = resumenPizarron(unidades, hoyStr);
  const cifras = (
    <div className="pz-cifras" role="list">
      {[{ n: res.piso, l: "en el taller" }, { n: res.transito, l: "en tránsito" },
        { n: res.hoy, l: res.hoy === 1 ? "entrega hoy" : "entregas hoy", color: res.hoy ? ESTADOS_ENTREGA.hoy.tv : null },
        { n: res.vencida, l: res.vencida === 1 ? "entrega vencida" : "entregas vencidas", color: res.vencida ? ESTADOS_ENTREGA.vencida.tv : null },
        { n: res.sin, l: "sin fecha de entrega" }].map((c, k) => (
        <div key={k} role="listitem" className={"pz-cifra" + (c.color ? " llena" : "")} style={c.color ? { background: c.color } : undefined}><b>{c.n}</b><span>{c.l}</span></div>
      ))}
    </div>
  );
  const DESFASES = [[0, 0], [2, 1], [1, 2], [-1, 1]];
  const claseRaiz = "pz-raiz" + (!controles && !compacta ? " sin-cursor" : "");
  const mensaje = (titulo, texto, botones) => (
    <div className={claseRaiz}><style>{CSS_PIZARRON}</style>
      <div className="pz-mensaje"><img src="/img/logo-repairx-blanco.svg" alt="RepairX" /><h1>{titulo}</h1><p>{texto}</p>{botones}</div>
    </div>
  );
  const botonSalida = esPantalla
    ? <button className="pz-boton sec" onClick={cerrar}>Cerrar sesión</button>
    : <button className="pz-boton sec" onClick={onSalir}>Volver a la app</button>;

  if (datos.sinAcceso) return mensaje("Esta pantalla no tiene acceso",
    "La cuenta ya no está aprobada para ver el pizarrón. El administrador puede aprobarla otra vez en Equipo, con el rol «Pantalla (TV)».", botonSalida);
  if (datos.faltaActivar) return mensaje("Falta activar el pizarrón",
    "El servidor todavía no tiene el pizarrón. El administrador debe correr la migración «migracion_pizarron_pantalla.sql» en Supabase; después esta pantalla se abrirá sola.", botonSalida);
  if (!datos.cargado) return mensaje("Cargando el pizarrón", datos.sinConexion ? "Sin conexión con el servidor. Se reintentará en cuanto regrese el internet." : `${tallerNombre}`, null);

  const horaOk = datos.ultimaOk ? new Date(datos.ultimaOk) : null;
  const h12 = horaOk ? horaOk.getHours() % 12 || 12 : 0;
  const horaTxt = horaOk ? `${h12}:${String(horaOk.getMinutes()).padStart(2, "0")} ${horaOk.getHours() < 12 ? "a. m." : "p. m."}` : "";

  if (compacta) return (
    <div className={claseRaiz}><style>{CSS_PIZARRON}</style>
      <PizarronCompacto marca={marcaCompacta} cifras={cifras} alertas={alertas} unidades={unidades} hoyStr={hoyStr}
        salir={<button className="pz-c-salir" onClick={esPantalla ? cerrar : onSalir}>{esPantalla ? "Cerrar sesión" : "Volver a la app"}</button>} />
    </div>
  );

  let diapo;
  if (!unidades.length) diapo = <section className="pz-diapo"><div className="pz-titulo"><h2>Unidades en el taller</h2></div><div className="pz-vacio"><b>No hay unidades en el taller</b><span>Las órdenes activas aparecerán aquí en cuanto se registren.</span></div></section>;
  else if (actual.tipo === "unidades") diapo = <DiapoUnidades filas={unidades.slice(actual.pagina * 8, actual.pagina * 8 + 8)} pagina={actual.pagina} paginas={paginas} hoyStr={hoyStr} cambios={datos.cambios} pausa={pausa} />;
  else if (actual.tipo === "etapas") diapo = <DiapoEtapas unidades={unidades} hoyStr={hoyStr} pausa={pausa} />;
  else if (actual.tipo === "entregas") diapo = <DiapoEntregas unidades={unidades} hoyStr={hoyStr} pausa={pausa} />;
  else diapo = <DiapoRefacciones unidades={unidades} pausa={pausa} />;

  return (
    <div className={claseRaiz}>
      <style>{CSS_PIZARRON}</style>
      <div className="pz-tablero" style={{ transform: `translate(${DESFASES[desfase][0]}px, ${DESFASES[desfase][1]}px)` }}>
        {marca}
        {cifras}
        <div className="pz-escenario">
          <div key={actual.clave + ":" + i} style={{ display: "contents" }}>{diapo}</div>
          {!pausa && n > 1 && <div key={"p" + i + ":" + vuelta} className="pz-progreso" style={{ animationDuration: actual.ms + "ms" }} />}
        </div>
        <footer className="pz-pie">
          {alerta
            ? <div className="pz-alerta" key={alerta.clave} role="status">
                <span className="pz-alerta-etq" style={{ background: TIPOS_ALERTA[alerta.tipo].tv }}>{TIPOS_ALERTA[alerta.tipo].label}</span>
                <PlacaTV o={alerta.o} chica />
                <span className="pz-alerta-auto">{textoVehiculo(alerta.o.vehiculo) || alerta.o.id}</span>
                {alerta.detalle && <span className="pz-alerta-txt">{alerta.detalle}</span>}
                {alertas.length > 1 && <span className="pz-alerta-n">{(iAlerta % alertas.length) + 1} de {alertas.length}</span>}
              </div>
            : <div className="pz-ok" role="status">Sin alertas por ahora: ninguna entrega vencida ni refacciones atrasadas.</div>}
          <span className={"pz-red" + (datos.sinConexion ? " mal" : "")}>{datos.sinConexion ? `Sin conexión, datos de ${h12 === 1 ? "la" : "las"} ${horaTxt}` : (ordenesDemo ? "Modo demo" : `Actualizado ${horaTxt}`)}</span>
          <span className="pz-puntos" aria-hidden="true">{diapos.map((d, k) => <i key={d.clave} className={k === i ? "on" : ""} />)}</span>
        </footer>
      </div>
      <div className={"pz-controles" + (controles ? " visible" : "")} role="toolbar" aria-label="Controles del pizarrón">
        <button className="flecha" onClick={anterior} aria-label="Vista anterior">‹</button>
        <button onClick={alternarPausa}>{pausa ? "Reanudar" : "Pausar"}</button>
        <button className="flecha" onClick={siguiente} aria-label="Vista siguiente">›</button>
        <hr />
        <button onClick={pantallaCompleta}>Pantalla completa</button>
        {esPantalla ? <button className="peligro" onClick={cerrar}>Cerrar sesión</button> : <button onClick={onSalir}>Volver a la app</button>}
      </div>
    </div>
  );
}

// ─── Sección "Pizarrón" para el equipo ─────────────────────────────────────────
const FILTROS_PIZARRON = [
  { k: "todas", l: "Todas" }, { k: "vencida", l: "Vencidas" }, { k: "hoy", l: "Hoy" },
  { k: "manana", l: "Mañana" }, { k: "semana", l: "Próximos 6 días" }, { k: "sin", l: "Sin fecha" },
];

function PlacaClara({ o }) {
  const base = { display:"inline-flex", alignItems:"center", justifyContent:"center", minWidth:96, height:32, padding:"0 10px", borderRadius:6,
    fontWeight:800, fontSize:14, letterSpacing:"0.06em", fontStretch:"108%", whiteSpace:"nowrap", flexShrink:0, boxSizing:"border-box" };
  return o.placa
    ? <span title={"Placas " + o.placa} style={{ ...base, background:"#FFFFFF", color:BRAND.text, border:"2px solid " + BRAND.text, boxShadow:"0 1px 0 rgba(29,39,51,.25)" }}>{o.placa.toUpperCase()}</span>
    : <span title="Sin placas registradas" style={{ ...base, background:"transparent", color:BRAND.muted, border:"1.5px dashed " + BRAND.dimmed, letterSpacing:"0.02em" }}>{o.id}</span>;
}

function ChipEntrega({ o, hoyStr }) {
  const e = describirEntrega(o, hoyStr);
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:6, background:e.info.fondo, border:"1px solid " + e.info.borde, color:e.info.texto,
      borderRadius:20, padding:"3px 10px", fontSize:12, fontWeight:700, whiteSpace:"nowrap" }}>
      <span aria-hidden="true" style={{ width:8, height:8, borderRadius:"50%", background:e.info.texto }} />
      {e.estado === "sin" ? "Sin fecha" : e.corta}{e.detalle && e.estado !== "sin" ? <span style={{ fontWeight:500 }}>· {e.detalle}</span> : null}
    </span>
  );
}

function EditorEntrega({ o, hoyStr, onGuardar, onCancelar }) {
  const S = mkS();
  const antes = fechaEntregaOrden(o);
  const [fecha, setFecha] = useState(antes || "");
  const [motivo, setMotivo] = useState("");
  const [detalle, setDetalle] = useState("");
  const cambia = fecha !== (antes || "");
  const pospone = !!antes && !!fecha && fecha > antes;
  const motivoFinal = motivo === "Otro" ? (detalle.trim() ? "Otro: " + detalle.trim() : "Otro") : motivo;
  const error = cambia && fecha && fecha < hoyStr ? "La fecha de entrega no puede ser anterior a hoy." : "";
  const falta = !error && pospone && !motivo ? "Elige el motivo del cambio: queda en la bitácora." : "";
  const base = antes && antes >= hoyStr ? antes : hoyStr;
  const historial = (o.bitacora || []).filter(b => b && RE_BITACORA_ENTREGA.test(b.accion || "")).slice(-4).reverse();
  const guardar = () => onGuardar(fecha, antes ? motivoFinal : "", pospone ? "reprogramada" : "entrega");
  const quitar = () => { if (confirm(`¿Quitar la fecha de entrega de ${o.id}? La unidad aparecerá como «Sin fecha» en el pizarrón.`)) onGuardar("", motivoFinal, null); };
  return (
    <div style={{ background:BRAND.bg, borderRadius:10, padding:"0.85rem", marginTop:12, display:"flex", flexDirection:"column", gap:10 }}>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(190px, 1fr))", gap:10 }}>
        <div><label style={S.label}>{antes ? "Nueva fecha de entrega" : "Fecha de entrega"}</label><CampoFecha value={fecha} min={hoyStr} onChange={setFecha} /></div>
        {antes && <div><label style={S.label}>Motivo del cambio{pospone ? "" : " (opcional)"}</label>
          <select style={S.select} value={motivo} onChange={e => setMotivo(e.target.value)}><option value="">Seleccionar…</option>{MOTIVOS_REPROGRAMACION.map(m => <option key={m}>{m}</option>)}</select></div>}
        {motivo === "Otro" && <div><label style={S.label}>¿Cuál?</label><input style={S.input} value={detalle} maxLength={80} placeholder="Ej. Falla en la cabina de pintura" onChange={e => setDetalle(e.target.value)} /></div>}
      </div>
      <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
        <span style={{ fontSize:11, color:BRAND.muted }}>{antes && antes >= hoyStr ? "Recorrer:" : "Desde hoy:"}</span>
        {[{ l:"+1 día", n:1 }, { l:"+2 días", n:2 }, { l:"+3 días", n:3 }, { l:"+1 semana", n:7 }].map(r =>
          <button key={r.n} type="button" style={{ ...S.btnSm(), padding:"5px 10px", fontSize:12 }} onClick={() => setFecha(sumarDias(base, r.n))}>{r.l}</button>)}
      </div>
      {fecha && !error && <div style={{ fontSize:12, color:BRAND.text }}>{antes && cambia ? <>{conMayuscula(fechaLarga(antes))} <span style={{ color:BRAND.muted }}>→</span> <b>{fechaLarga(fecha)}</b></> : <b>{conMayuscula(fechaLarga(fecha))}</b>}</div>}
      {error && <div role="alert" style={{ fontSize:12, color:"#B91C1C", fontWeight:600 }}>{error}</div>}
      {falta && <div style={{ fontSize:12, color:"#92400E", fontWeight:600 }}>{falta}</div>}
      <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
        <button type="button" style={{ ...S.btn, opacity:(!fecha || !cambia || error || falta) ? 0.5 : 1, cursor:(!fecha || !cambia || error || falta) ? "not-allowed" : "pointer" }}
          disabled={!fecha || !cambia || !!error || !!falta} onClick={guardar}>Guardar fecha</button>
        {antes && <button type="button" style={S.btnDanger} onClick={quitar}>Quitar fecha</button>}
        <button type="button" style={{ ...S.btnSm(), padding:"0.5rem 0.9rem", fontSize:12 }} onClick={onCancelar}>Cancelar</button>
      </div>
      {historial.length > 0 && (
        <div style={{ borderTop:"1px solid " + BRAND.border, paddingTop:8 }}>
          <div style={{ fontSize:11, fontWeight:700, color:BRAND.muted, marginBottom:4 }}>Cambios anteriores</div>
          {historial.map((b, k) => <div key={k} style={{ fontSize:11, color:BRAND.muted, lineHeight:1.5 }}>{b.accion}{b.usuario ? ` (${b.usuario}, ${b.fecha})` : ` (${b.fecha})`}</div>)}
        </div>
      )}
    </div>
  );
}

function FilaPizarron({ o, hoyStr, puedeEditar, abierto, onAbrir, onCerrar, onGuardar, onAbrirOrden, taller, aviso, onCerrarAviso }) {
  const S = mkS();
  const e = describirEntrega(o, hoyStr);
  const tel = numeroWhatsApp(o.telefono);
  const rep = reprogramacionesDe(o);
  const etapa = ESTADOS.find(x => x.key === o.estado) || ESTADOS[0];
  const color = colorDeAuto(o.color);
  const dT = diasEnTransito(o);
  const borde = e.estado === "vencida" ? "#DC2626" : e.estado === "hoy" ? "#F59E0B" : e.estado === "manana" ? "#3B82F6" : null;
  const enlaceWA = tipo => "https://wa.me/" + tel + "?text=" + encodeURIComponent(mensajeCliente(o, taller, tipo));
  const boton = { display:"inline-flex", alignItems:"center", gap:5, borderRadius:8, padding:"6px 11px", fontSize:12, fontWeight:600, cursor:"pointer", textDecoration:"none", whiteSpace:"nowrap" };
  return (
    <div data-orden={o.id} style={{ ...S.card, padding:"0.85rem 1rem", ...(borde ? { borderLeft:"4px solid " + borde } : {}) }}>
      <div style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
        <PlacaClara o={o} />
        <div style={{ flex:"1 1 220px", minWidth:0 }}>
          <div style={{ fontSize:14, fontWeight:700, display:"flex", alignItems:"center", gap:7, minWidth:0 }}>
            {color && <span aria-hidden="true" style={{ width:11, height:11, borderRadius:"50%", background:color, boxShadow:"0 0 0 1px rgba(29,39,51,.25)", flexShrink:0 }} />}
            <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{textoVehiculo(o.vehiculo) || "Unidad sin datos"}</span>
            {o.color && !color && <span style={{ fontSize:11, color:BRAND.muted, fontWeight:500 }}>{o.color}</span>}
          </div>
          <div style={{ fontSize:12, color:BRAND.muted, marginTop:2 }}>{o.cliente || "Sin nombre"}{o.telefono ? <span> · {o.telefono}</span> : null}</div>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center", marginTop:6 }}>
            <span style={{ fontSize:10, fontWeight:700, color:BRAND.accent }}>{o.id}</span>
            <span style={{ background:etapa.color + "18", color:etapa.color, border:"0.5px solid " + etapa.color + "44", borderRadius:20, padding:"2px 8px", fontSize:10, fontWeight:600 }}>{etapa.label}</span>
            <ContadorDias o={o} />
            {o.enTransito && <span style={{ fontSize:10, background:BRAND.blue + "12", color:BRAND.blue, border:"0.5px solid " + BRAND.blue + "44", borderRadius:5, padding:"2px 7px", fontWeight:600 }}>🚗 Tránsito{dT !== null ? ` · ${dT} d` : ""}</span>}
          </div>
        </div>
        <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4, marginLeft:"auto" }}>
          <ChipEntrega o={o} hoyStr={hoyStr} />
          {rep > 0 && <span style={{ fontSize:11, color:"#B45309", fontWeight:600 }}>Reprogramada {rep === 1 ? "1 vez" : rep + " veces"}</span>}
        </div>
      </div>
      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:10 }}>
        {puedeEditar && <button type="button" onClick={abierto ? onCerrar : onAbrir} style={{ ...boton, border:"1px solid " + BRAND.accent + "66", background:abierto ? BRAND.accent : BRAND.accent + "10", color:abierto ? "#fff" : BRAND.accent }}>📅 {fechaEntregaOrden(o) ? "Cambiar fecha" : "Poner fecha"}</button>}
        {tel
          ? <><a href={enlaceWA(e.estado === "vencida" ? "actualizacion" : "entrega")} target="_blank" rel="noopener noreferrer" style={{ ...boton, background:"#E8F8EE", color:"#0B7A3B", border:"1px solid #A7E3BE" }}>WhatsApp</a>
              <a href={"tel:+" + tel} style={{ ...boton, background:BRAND.bg, color:BRAND.text, border:"1px solid " + BRAND.border }}>Llamar</a></>
          : <span style={{ ...boton, cursor:"default", color:BRAND.muted, background:"transparent", border:"1px dashed " + BRAND.border }} title="Agrega el teléfono del cliente en la orden">Sin teléfono válido</span>}
        <button type="button" onClick={() => onAbrirOrden(o)} style={{ ...boton, background:"transparent", color:BRAND.muted, border:"1px solid " + BRAND.border }}>Ver orden</button>
      </div>
      {abierto && <EditorEntrega o={o} hoyStr={hoyStr} onCancelar={onCerrar} onGuardar={onGuardar} />}
      {aviso && !abierto && (
        <div role="status" style={{ marginTop:10, background:"#ECFDF5", border:"1px solid #A7F3D0", borderRadius:10, padding:"8px 12px", display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
          <span style={{ fontSize:12, color:"#047857", fontWeight:600, flex:"1 1 200px" }}>Fecha guardada. La pantalla del taller la mostrará en menos de un minuto.</span>
          {tel && aviso.tipo && <a href={enlaceWA(aviso.tipo)} target="_blank" rel="noopener noreferrer" onClick={onCerrarAviso} style={{ ...boton, background:"#0B7A3B", color:"#fff", border:"none" }}>Avisar a {primerNombre(o.cliente) || "el cliente"} por WhatsApp</a>}
          <button type="button" onClick={onCerrarAviso} style={{ ...boton, background:"transparent", border:"none", color:"#047857" }}>Listo</button>
        </div>
      )}
    </div>
  );
}

function SeccionPizarron({ ordenes, usuario, desktop, puedeEditar, onFecha, onAbrirOrden, filtroInicial }) {
  const S = mkS();
  const hoyStr = hoyLocal();
  const [filtro, setFiltro] = useState(filtroInicial || "todas");
  const [orden, setOrden] = useState("antiguas");
  const [abierto, setAbierto] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [ayuda, setAyuda] = useState(false);
  const res = resumenPizarron(ordenes, hoyStr);
  const todas = ordenarPorAlta(ordenes, "antiguas");
  const filtradas = filtro === "todas" ? todas : todas.filter(o => estadoEntrega(o, hoyStr) === filtro);
  const lista = orden === "entrega"
    ? filtradas.slice().sort((a, b) => { const fa = fechaEntregaOrden(a), fb = fechaEntregaOrden(b); return (!fa) - (!fb) || fa.localeCompare(fb) || fechaAlta(a).localeCompare(fechaAlta(b)); })
    : filtradas;
  const urgentes = alertasPizarron(ordenes, hoyStr).filter(a => a.tipo === "vencida" || a.tipo === "hoy");
  const esAdmin = puedePerm(usuario, "todo");
  const abrirPantalla = () => { const w = window.open("/?pizarron", "_blank", "noopener"); if (w) w.opener = null; };
  const guardar = o => (fecha, motivo, tipo) => { onFecha(o.id, fecha, motivo); setAbierto(null); setAviso(fecha ? { id: o.id, tipo } : null); };
  const n = k => k === "todas" ? res.total : res[k];
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12, maxWidth:980 }}>
      <div style={S.card}>
        <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12, flexWrap:"wrap" }}>
          <div style={{ flex:"1 1 320px", minWidth:0 }}>
            <div style={{ fontSize:15, fontWeight:800, marginBottom:4 }}>📺 Pizarrón del taller</div>
            <div style={{ fontSize:12, color:BRAND.muted, lineHeight:1.55 }}>Todas las unidades activas, de la más antigua a la más reciente. Aquí pones o cambias la fecha de entrega; la pantalla del taller se actualiza sola en menos de un minuto.</div>
          </div>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            <button type="button" style={S.btn} onClick={abrirPantalla}>Abrir modo pantalla</button>
            <button type="button" aria-expanded={ayuda} style={{ ...S.btnSm(), padding:"0.5rem 0.9rem", fontSize:12 }} onClick={() => setAyuda(a => !a)}>{ayuda ? "Ocultar instrucciones" : "Cómo dejarlo en la TV"}</button>
          </div>
        </div>
        {ayuda && (
          <div style={{ marginTop:12, background:BRAND.bg, borderRadius:10, padding:"0.85rem 1rem", fontSize:12, color:BRAND.text, lineHeight:1.6 }}>
            <div style={{ fontWeight:700, marginBottom:6 }}>Una cuenta de solo lectura para la pantalla</div>
            <ol style={{ margin:0, paddingLeft:18 }}>
              <li>En la TV (o la computadora conectada a ella) abre <b>app.repairx.com.mx</b>, elige «Unirme a un taller» y usa el código <b style={{ color:BRAND.accent, fontFamily:"monospace" }}>{usuario.taller || "de tu taller"}</b>.</li>
              <li>Regístrala con un correo propio para la pantalla. Puedes usar tu mismo correo con «+pantalla» (por ejemplo, <i>tucorreo+pantalla@gmail.com</i>): Gmail y Outlook lo entregan en tu bandeja. Confirma el correo.</li>
              <li>{esAdmin ? "Aquí, en Equipo, aprueba la solicitud con el rol «Pantalla (TV)»." : "Pide al administrador que, en Equipo, apruebe la solicitud con el rol «Pantalla (TV)»."}</li>
              <li>La TV abrirá el pizarrón sola. Pulsa «Pantalla completa» (o la tecla F).</li>
            </ol>
            <div style={{ marginTop:8, color:BRAND.muted }}>Esa cuenta no puede modificar nada, no ve teléfonos, costos, fotos ni documentos, y su sesión no se cierra por inactividad. En la pantalla los clientes aparecen como «Kevin S.». Para quitarle el acceso, en Equipo elige «Quitar acceso».</div>
          </div>
        )}
      </div>

      {urgentes.length > 0 && (
        <div role="alert" style={{ background:"#FEF2F2", border:"1px solid #FCA5A5", borderRadius:10, padding:"10px 14px" }}>
          <div style={{ fontSize:13, fontWeight:700, color:"#B91C1C", marginBottom:4 }}>
            ⚠ {[res.vencida ? `${res.vencida} entrega${res.vencida === 1 ? "" : "s"} vencida${res.vencida === 1 ? "" : "s"}` : "", res.hoy ? `${res.hoy} para hoy` : ""].filter(Boolean).join(" y ")}
          </div>
          <div style={{ fontSize:12, color:"#7F1D1D", lineHeight:1.5 }}>{res.vencida ? "Ponles una fecha nueva con su motivo y avisa al cliente. " : ""}{urgentes.slice(0, 4).map(a => `${a.o.placa || a.o.id} (${textoVehiculo(a.o.vehiculo) || "unidad"})`).join(", ")}{urgentes.length > 4 ? ` y ${urgentes.length - 4} más` : ""}.</div>
        </div>
      )}

      <div style={{ display:"grid", gridTemplateColumns:desktop ? "repeat(5, 1fr)" : "repeat(2, 1fr)", gap:8 }}>
        {["vencida", "hoy", "manana", "semana", "sin"].map(k => { const info = ESTADOS_ENTREGA[k], sel = filtro === k; return (
          <button key={k} type="button" aria-pressed={sel} onClick={() => setFiltro(sel ? "todas" : k)}
            style={{ ...S.metric, cursor:"pointer", padding:"0.75rem", textAlign:"left", border:"1px solid " + (sel ? info.texto : BRAND.border), background:sel ? info.fondo : BRAND.card, boxShadow:sel ? "none" : S.metric.boxShadow }}>
            <div style={{ fontSize:22, fontWeight:800, color:res[k] ? info.texto : BRAND.dimmed, lineHeight:1.1 }}>{res[k]}</div>
            <div style={{ fontSize:11, color:BRAND.muted, marginTop:2 }}>{info.label}</div>
          </button>); })}
      </div>

      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, flexWrap:"wrap" }}>
        <div role="group" aria-label="Filtrar por entrega" style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          {FILTROS_PIZARRON.map(f => { const sel = filtro === f.k; return (
            <button key={f.k} type="button" aria-pressed={sel} onClick={() => setFiltro(f.k)}
              style={{ border:"1px solid " + (sel ? BRAND.accent : BRAND.border), background:sel ? BRAND.accent + "12" : BRAND.card, color:sel ? BRAND.accent : BRAND.muted, borderRadius:20, padding:"5px 12px", fontSize:12, fontWeight:600, cursor:"pointer" }}>
              {f.l} ({n(f.k)})</button>); })}
        </div>
        <div role="group" aria-label="Ordenar" style={{ display:"inline-flex", background:BRAND.bg, border:"1px solid " + BRAND.border, borderRadius:9, padding:2, gap:2 }}>
          {[{ k:"antiguas", l:"Más antiguas primero" }, { k:"entrega", l:"Por fecha de entrega" }].map(op => { const sel = orden === op.k; return (
            <button key={op.k} type="button" aria-pressed={sel} onClick={() => setOrden(op.k)}
              style={{ border:"none", borderRadius:7, padding:"5px 11px", fontSize:11, fontWeight:600, cursor:"pointer", background:sel ? "#fff" : "transparent", color:sel ? BRAND.text : BRAND.muted, boxShadow:sel ? "0 1px 2px rgba(29,39,51,0.12)" : "none" }}>{op.l}</button>); })}
        </div>
      </div>

      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {lista.map(o => (
          <FilaPizarron key={o.id} o={o} hoyStr={hoyStr} puedeEditar={puedeEditar} taller={usuario.tallerNombre || ""}
            abierto={abierto === o.id} onAbrir={() => { setAbierto(o.id); setAviso(null); }} onCerrar={() => setAbierto(null)}
            onGuardar={guardar(o)} onAbrirOrden={onAbrirOrden}
            aviso={aviso && aviso.id === o.id ? aviso : null} onCerrarAviso={() => setAviso(null)} />
        ))}
        {lista.length === 0 && (
          <div style={{ ...S.card, textAlign:"center", color:BRAND.muted, fontSize:13, padding:"2rem 1rem" }}>
            {ordenes.length === 0 ? "No hay órdenes activas. Las unidades aparecerán aquí en cuanto registres una orden." : "Ninguna unidad coincide con este filtro."}
            {filtro !== "todas" && <div style={{ marginTop:10 }}><button type="button" style={{ ...S.btnSm(), padding:"6px 12px", fontSize:12 }} onClick={() => setFiltro("todas")}>Ver todas</button></div>}
          </div>
        )}
      </div>
    </div>
  );
}

function OrdenExpandida({ o, ordenes, setOrdenes, setOrdenSel, tabDetalle, setTabDetalle, avanzarEstado, setModalRetroceder, setModalCerrar, setModalCobro, setModalTerminar, fotoRef, docRef, docTipo, setDocTipo, docNombre, setDocNombre, agregarFotos, eliminarFoto, agregarDoc, eliminarDoc, setFotoAmpliada, usuario , onRenombrado}) {
  const S=mkS(); const idx=PASOS.indexOf(o.estado); const eAct=ESTADOS.find(e=>e.key===o.estado)||ESTADOS[0];
  const puedeEdit=puedePerm(usuario,"editar_ordenes"); const puedeAdmin=puedePerm(usuario,"todo");
  const cambiarUbicacion = aTransito => {
    if (aTransito && o.llegada === "grua" && !confirm("Esta unidad llegó en grúa. ¿Confirmas que puede circular para mandarla a tránsito?")) return;
    if (!aTransito && !confirm("¿Registrar que la unidad regresó al taller? Se guardará hoy como fecha de reingreso.")) return;
    const cambios = aTransito ? { enTransito: true, fechaTransito: hoyLocal() } : { enTransito: false, fechaReingreso: hoyLocal() };
    const entrada = { accion: aTransito ? "Unidad enviada a tránsito en espera de piezas" : "Reingreso de la unidad al taller", usuario: usuario.nombre, fecha: hoy() };
    const upd = ordenes.map(x => x.id === o.id ? { ...x, ...cambios, bitacora: [...(x.bitacora || []), entrada] } : x);
    setOrdenes(upd); setOrdenSel(upd.find(x => x.id === o.id));
  };
  return (
    <div style={{background:BRAND.card,borderRadius:14,border:"0.5px solid "+BRAND.border,overflow:"hidden"}}>
      <div style={{padding:"0.75rem 1rem",background:BRAND.bg,borderBottom:"0.5px solid "+BRAND.border}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
          {o.fotoPrincipal?<img src={o.fotoPrincipal} alt="v" style={{width:36,height:28,objectFit:"cover",borderRadius:6,border:"0.5px solid "+BRAND.border,flexShrink:0}} />:<div style={{width:36,height:28,background:BRAND.card2,borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>🚗</div>}
          <div style={{flex:1,minWidth:0}}><div style={{display:"flex",alignItems:"center",gap:6}}><EditarId o={o} ordenes={ordenes} setOrdenes={setOrdenes} setOrdenSel={setOrdenSel} fSize={14} puedeAdmin={puedeAdmin} usuario={usuario} onRenombrado={onRenombrado} /><span style={{fontSize:13,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{o.cliente}</span></div><div style={{fontSize:10,color:BRAND.muted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginTop:1}}>{o.vehiculo} - {o.placa}{o.telefono?" - "+o.telefono:""}</div></div>
          <ContadorDias o={o} grande /><span style={{background:eAct.color+"22",color:eAct.color,border:"0.5px solid "+eAct.color+"44",borderRadius:20,padding:"3px 8px",fontSize:10,fontWeight:700,flexShrink:0}}>{eAct.label}</span>
        </div>
        <div style={{display:"flex",gap:2,marginBottom:8}}>{ESTADOS.map((es,i)=><div key={es.key} style={{flex:1}}><div style={{height:3,borderRadius:2,background:i<idx?BRAND.accent:i===idx?BRAND.accent+"66":BRAND.dimmed,marginBottom:2}} /><div style={{fontSize:7,color:i===idx?BRAND.accent:i<idx?BRAND.muted:BRAND.dimmed,textAlign:"center",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{es.label.split(" ")[0]}</div></div>)}</div>
        {puedeEdit&&<div style={{display:"flex"}}>{o.estado!=="armado"?<button style={{...S.btn,flex:1,padding:"9px",fontSize:13}} onClick={()=>avanzarEstado(o.id)}>Avanzar al siguiente paso</button>:<button style={{...S.btnGreen,flex:1,padding:"9px",fontSize:13}} onClick={()=>setModalCobro(o)}>Enviar a cobro</button>}</div>}
      </div>
      <div style={{borderBottom:"0.5px solid "+BRAND.border,background:BRAND.card}}>
        {/* CAMBIO: etiqueta "💬 Novedades" completa */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)"}}>{[{k:"info",l:"📋 Info"},{k:"fotos",l:"📷 Fotos"+(o.fotos?.length?" ("+o.fotos.length+")":"")},{k:"docs",l:"📁 Docs"+(o.documentos?.length?" ("+o.documentos.length+")":"")},{k:"ficha",l:"📑 Ficha"},{k:"refacciones",l:"🔧 Refacciones"+((o.refacciones||[]).length?" ("+(o.refacciones||[]).filter(r=>r.recibida).length+"/"+(o.refacciones||[]).length+")":"")},{k:"novedades",l:"💬 Novedades"+(o.novedades?.length?" ("+o.novedades.length+")":"")},{k:"bitacora",l:"📝 Bitácora"}].map((t,i)=><button key={t.k} style={{padding:"10px 6px",fontSize:12,cursor:"pointer",color:tabDetalle===t.k?BRAND.accent:BRAND.muted,background:tabDetalle===t.k?BRAND.accent+"0D":"none",border:"none",borderBottom:tabDetalle===t.k?"2px solid "+BRAND.accent:"2px solid transparent",borderRight:i%4!==3?"0.5px solid "+BRAND.border:"none",borderTop:i>=4?"0.5px solid "+BRAND.border:"none",fontWeight:tabDetalle===t.k?700:400,textAlign:"center"}} onClick={()=>setTabDetalle(t.k)}>{t.l}</button>)}</div>
        <button onClick={()=>setOrdenSel(null)} style={{width:"100%",padding:"7px",fontSize:11,cursor:"pointer",color:BRAND.muted,background:"none",border:"none",borderTop:"0.5px solid "+BRAND.border,textAlign:"center"}}>← Volver a lista</button>
      </div>
      <div style={{padding:"1rem"}}>
        {tabDetalle==="info"&&(
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            {(()=>{ const dT=diasEnTransito(o); return (
              <div style={{background:o.enTransito?BRAND.blue+"0D":BRAND.bg,border:"1px solid "+(o.enTransito?BRAND.blue+"44":BRAND.border),borderRadius:10,padding:"0.75rem 0.85rem",display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
                <div>
                  <div style={{fontSize:11,color:BRAND.muted}}>Ubicación de la unidad</div>
                  <div style={{fontSize:14,fontWeight:700,color:o.enTransito?BRAND.blue:BRAND.text}}>{o.enTransito?`🚗 En tránsito${dT!==null?` · ${dT} día${dT!==1?"s":""}`:""}`:"🔧 En piso"}</div>
                  {o.enTransito&&<div style={{fontSize:11,color:BRAND.muted}}>Esperando piezas fuera del taller{o.fechaTransito?` desde el ${o.fechaTransito}`:""}</div>}
                </div>
                {puedeEdit&&(o.enTransito
                  ?<button style={{...S.btnSm(BRAND.green),padding:"7px 12px",fontSize:12}} onClick={()=>cambiarUbicacion(false)}>Registrar reingreso</button>
                  :<button style={{...S.btnSm(BRAND.blue),padding:"7px 12px",fontSize:12}} onClick={()=>cambiarUbicacion(true)}>Mandar a tránsito</button>)}
              </div>); })()}
            <div style={{background:BRAND.bg,borderRadius:10,padding:"0.85rem"}}>
              <div style={{fontSize:11,color:BRAND.muted,fontWeight:600,textTransform:"uppercase",letterSpacing:0.5,marginBottom:8}}>Vehículo</div>
              <div style={{fontSize:14,fontWeight:700,marginBottom:8}}>{o.vehiculo}</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"6px 16px"}}>{[{l:"Placa",v:o.placa},{l:"Color",v:o.color},{l:"Técnico",v:o.tecnico},{l:"Servicio",v:o.servicio},{l:"Ingreso",v:o.fecha},{l:"Entrega",v:fechaEntregaOrden(o)},{l:"Llegó",v:o.llegada==="grua"?"🚛 En grúa":o.llegada==="circulando"?"🚗 Circulando":""}].map(({l,v})=><div key={l}><div style={{fontSize:10,color:BRAND.muted}}>{l}</div><div style={{fontSize:12,fontWeight:500}}>{v||"—"}</div></div>)}</div>
              {o.serie&&<div style={{marginTop:10,paddingTop:10,borderTop:"0.5px solid "+BRAND.border}}><div style={{fontSize:10,color:BRAND.muted,marginBottom:2}}>No. de Serie (VIN)</div><div style={{fontSize:11,fontFamily:"monospace",letterSpacing:1,color:BRAND.accent}}>{o.serie}</div></div>}
              {o.siniestro&&<div style={{marginTop:8}}><div style={{fontSize:10,color:BRAND.muted,marginBottom:2}}>No. de Siniestro</div><div style={{fontSize:12,color:BRAND.blue,fontWeight:600}}>{o.siniestro}</div></div>}
              {o.notas&&<div style={{marginTop:8,background:BRAND.card2,borderRadius:7,padding:"7px 10px",fontSize:12,color:BRAND.muted,fontStyle:"italic"}}>{o.notas}</div>}
            </div>
            <div style={{background:BRAND.bg,borderRadius:10,padding:"0.85rem"}}><div style={{fontSize:11,color:BRAND.muted,fontWeight:600,textTransform:"uppercase",letterSpacing:0.5,marginBottom:8}}>Progreso</div>{ESTADOS.map((es,i)=><div key={es.key} style={{display:"flex",alignItems:"center",gap:10,padding:"5px 0",borderBottom:i<ESTADOS.length-1?"0.5px solid "+BRAND.border+"33":"none"}}><div style={{width:18,height:18,borderRadius:"50%",background:i<idx?BRAND.accent:i===idx?BRAND.accent+"22":BRAND.dimmed,border:i===idx?"1.5px solid "+BRAND.accent:"none",display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,color:i<idx?"#fff":i===idx?BRAND.accent:BRAND.muted,fontWeight:700,flexShrink:0}}>{i<idx?"✓":i+1}</div><span style={{fontSize:12,color:i===idx?BRAND.accent:i<idx?BRAND.text:BRAND.muted,fontWeight:i===idx?700:400}}>{es.label}</span></div>)}</div>
            {o.costo>0&&<div style={{background:BRAND.bg,borderRadius:10,padding:"0.85rem",display:"flex",justifyContent:"space-between",alignItems:"center"}}><span style={{fontSize:12,color:BRAND.muted}}>Costo estimado</span><span style={{fontSize:17,fontWeight:800,color:BRAND.green}}>${o.costo.toLocaleString("es-MX")}</span></div>}
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>{puedeAdmin&&idx>0&&<button style={{flex:1,background:BRAND.blue+"11",color:BRAND.blue,border:"0.5px solid "+BRAND.blue+"33",borderRadius:8,padding:"9px 8px",cursor:"pointer",fontSize:12,fontWeight:500}} onClick={()=>setModalRetroceder(o)}>Regresar etapa</button>}{!puedeAdmin&&puedeEdit&&idx>0&&<div style={{flex:"1 1 100%",fontSize:11,color:BRAND.muted,textAlign:"center",padding:"2px 0"}}>Solo un administrador puede regresar una orden a la etapa anterior.</div>}{puedeAdmin&&<button style={{flex:1,background:"#7F1D1D22",color:"#fca5a5",border:"0.5px solid #991b1b33",borderRadius:8,padding:"9px 8px",cursor:"pointer",fontSize:12,fontWeight:500}} onClick={()=>setModalCerrar(o)}>Cerrar orden</button>}</div>
            {puedeEdit&&<button style={{width:"100%",background:BRAND.green+"11",color:BRAND.green,border:"1.5px solid "+BRAND.green+"55",borderRadius:8,padding:"10px",cursor:"pointer",fontSize:13,fontWeight:700}} onClick={()=>setModalTerminar(o)}>Marcar siniestro como terminado</button>}
            {(()=>{ const listo=!!PERITO_VALUADOR_URL; return (
              <button disabled={!listo} title={listo?"Abrir Perito Valuador":"Disponible próximamente"}
                onClick={()=>{ if(listo) window.open(PERITO_VALUADOR_URL+"?orden="+encodeURIComponent(o.id),"_blank","noopener,noreferrer"); }}
                style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:8,flexWrap:"wrap",background:listo?BRAND.purple:BRAND.bg,color:listo?"#fff":BRAND.muted,border:(listo?"1.5px solid ":"1.5px dashed ")+(listo?BRAND.purple:BRAND.purple+"55"),borderRadius:8,padding:"10px",cursor:listo?"pointer":"not-allowed",fontSize:13,fontWeight:600}}>
                🧮 Realizar valuación en Perito Valuador
                {!listo&&<span style={{fontSize:10,background:BRAND.purple+"1A",color:BRAND.purple,borderRadius:20,padding:"2px 8px",fontWeight:700,letterSpacing:0.5}}>PRÓXIMAMENTE</span>}
              </button>); })()}
          </div>
        )}
        {tabDetalle==="fotos"&&(
          <div>
            <div style={{border:"1.5px dashed "+BRAND.border,borderRadius:10,padding:"0.85rem",textAlign:"center",cursor:"pointer",background:BRAND.bg,marginBottom:12}} onClick={()=>fotoRef.current?.click()}><div style={{fontSize:12,color:BRAND.muted}}>📷 Subir fotos del vehículo</div></div>
            <input ref={fotoRef} type="file" accept={ACCEPT_IMG} multiple style={{display:"none"}} onChange={ev=>agregarFotos(ev.target.files)} />
            {(!o.fotos||o.fotos.length===0)&&<div style={{color:BRAND.muted,fontSize:13,textAlign:"center",padding:"1.5rem 0"}}>Sin fotos aún</div>}
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(100px,1fr))",gap:8}}>{(o.fotos||[]).map(f=><div key={f.id} style={{position:"relative",aspectRatio:"4/3",borderRadius:8,overflow:"hidden",border:"0.5px solid "+BRAND.border}}><ImagenArchivo item={f} token={usuario?.token} alt={f.nombre} style={{width:"100%",height:"100%",objectFit:"cover",cursor:"pointer"}} onClick={()=>setFotoAmpliada(f)} /><button onClick={()=>eliminarFoto(f.id)} style={{position:"absolute",top:4,right:4,background:"#000a",border:"none",color:"#fff",borderRadius:"50%",width:20,height:20,cursor:"pointer",fontSize:11,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button></div>)}</div>
          </div>
        )}
        {tabDetalle==="docs"&&(
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <div style={{background:BRAND.bg,borderRadius:10,padding:"0.85rem"}}>
              <div style={{fontSize:12,fontWeight:600,color:BRAND.accent,marginBottom:10}}>Agregar Documento</div>
              <label style={S.label}>Tipo</label><select style={{...S.select,marginBottom:8,fontSize:12}} value={docTipo} onChange={e=>setDocTipo(e.target.value)}>{TIPOS_DOC.map(t=><option key={t.key} value={t.key}>{t.label}</option>)}</select>
              <label style={S.label}>Nombre (opcional)</label><input style={{...S.input,marginBottom:10,fontSize:12}} placeholder="Ej. Valuación Zurich" value={docNombre} onChange={e=>setDocNombre(e.target.value)} />
              <button style={{...S.btn,width:"100%",fontSize:12}} onClick={()=>docRef.current?.click()}>📎 Seleccionar archivo</button>
              <input ref={docRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp,.heic,.heif" style={{display:"none"}} onChange={ev=>{if(ev.target.files.length)agregarDoc(ev.target.files);ev.target.value="";}} />
            </div>
            <div style={{background:BRAND.bg,borderRadius:10,padding:"0.85rem"}}>
              <div style={{fontSize:12,fontWeight:600,color:BRAND.muted,marginBottom:10}}>Documentos adjuntos {(o.documentos||[]).length>0&&<span style={{background:BRAND.card2,borderRadius:10,padding:"1px 8px",fontSize:11,color:BRAND.accent}}>{o.documentos.length}</span>}</div>
              {(!o.documentos||o.documentos.length===0)?<div style={{textAlign:"center",color:BRAND.muted,fontSize:12,padding:"1.5rem 0"}}>Sin documentos adjuntos</div>:TIPOS_DOC.map(t=>{const docs=(o.documentos||[]).filter(d=>d.tipo===t.key);if(!docs.length)return null;return(<div key={t.key} style={{marginBottom:12}}><div style={{fontSize:11,color:BRAND.muted,marginBottom:6}}>{t.label} ({docs.length})</div>{docs.map(d=><div key={d.id} style={{display:"flex",alignItems:"center",gap:8,background:BRAND.card2,borderRadius:8,padding:"0.55rem 0.75rem",marginBottom:6}}><div style={{width:28,height:28,borderRadius:5,background:BRAND.dimmed,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700,color:BRAND.accent,flexShrink:0}}>{d.ext}</div><div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.nombre}</div><div style={{fontSize:10,color:BRAND.muted}}>{d.fecha} - {d.size}</div></div><div style={{display:"flex",gap:4,flexShrink:0}}><EnlaceArchivo item={d} token={usuario?.token} nombre={d.archivo} style={{...S.btnSm(BRAND.blue),textDecoration:"none",display:"inline-block"}}>⬇</EnlaceArchivo><button style={S.btnSm()} onClick={()=>eliminarDoc(d.id)}>✕</button></div></div>)}</div>);})}
            </div>
          </div>
        )}
        {tabDetalle==="ficha"&&<FichaDetalle o={o} ordenes={ordenes} setOrdenes={setOrdenes} setOrdenSel={setOrdenSel} S={S} usuario={usuario} />}
        {tabDetalle==="novedades"&&<Novedades orden={o} ordenes={ordenes} setOrdenes={setOrdenes} setOrdenSel={setOrdenSel} S={S} />}
        {tabDetalle==="refacciones"&&<ChecklistRefacciones o={o} ordenes={ordenes} setOrdenes={setOrdenes} setOrdenSel={setOrdenSel} puedeEdit={puedeEdit} usuario={usuario} S={S} />}
        {tabDetalle==="bitacora"&&<div><div style={{fontSize:12,color:BRAND.muted,marginBottom:12}}>Historial de cambios</div>{(o.bitacora||[]).slice().reverse().map((b,i)=><div key={i} style={{display:"flex",gap:12,marginBottom:14,alignItems:"flex-start"}}><div style={{width:8,height:8,borderRadius:"50%",background:BRAND.accent,marginTop:5,flexShrink:0}} /><div><div style={{fontSize:13,fontWeight:500}}>{b.accion}</div><div style={{fontSize:11,color:BRAND.muted}}>{b.usuario} - {b.fecha}</div></div></div>)}</div>}
      </div>
    </div>
  );
}

function TarjetaOrden({ o, ordenes, setOrdenes, setOrdenSel, onClick, badge }) {
  const S=mkS(); const e=ESTADOS.find(x=>x.key===o.estado)||ESTADOS[0]; const idx=PASOS.indexOf(o.estado);
  return (
    <div style={{...S.card,cursor:"pointer",padding:"0.85rem",...((diasDesdeAlta(o)||0)>DIAS_ALERTA?{borderLeft:"4px solid hsl(0, 75%, 45%)"}:{})}} onClick={onClick}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
        {o.fotoPrincipal?<img src={o.fotoPrincipal} style={{width:48,height:36,objectFit:"cover",borderRadius:7,flexShrink:0}} alt="v" />:<div style={{width:48,height:36,background:BRAND.bg,borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>🚗</div>}
        <div style={{flex:1,minWidth:0}}><div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2,flexWrap:"wrap"}}><span style={{fontSize:12,fontWeight:700,color:BRAND.accent}}>{o.id}</span><span style={{fontSize:13,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{o.cliente}</span></div><div style={{fontSize:11,color:BRAND.muted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{o.vehiculo}</div></div>
        {badge?<span style={{flexShrink:0,background:BRAND.muted+"22",color:BRAND.muted,borderRadius:20,padding:"2px 8px",fontSize:10,fontWeight:600}}>{badge}</span>:<span style={{flexShrink:0,background:e.color+"18",color:e.color,border:"0.5px solid "+e.color+"44",borderRadius:20,padding:"2px 8px",fontSize:10,fontWeight:500}}>{e.label}</span>}
      </div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",marginBottom:8}}><ContadorDias o={o} />{o.enTransito&&(()=>{ const dT=diasEnTransito(o); return <span style={{fontSize:10,background:BRAND.blue+"12",color:BRAND.blue,border:"0.5px solid "+BRAND.blue+"44",borderRadius:5,padding:"2px 7px",fontWeight:600}}>🚗 Tránsito{dT!==null?` · ${dT} d`:""}</span>; })()}{o.llegada==="grua"&&<span style={{fontSize:10,background:BRAND.bg,color:BRAND.muted,borderRadius:5,padding:"2px 7px"}}>🚛 Grúa</span>}{(o.refacciones||[]).length>0&&(()=>{ const atr=o.refacciones.some(r=>diasAtrasoRef(r)>0); const todas=o.refacciones.every(r=>r.recibida); return <span title={atr?"Hay refacciones atrasadas":undefined} style={{fontSize:10,background:atr?COLOR_ATRASO+"12":BRAND.bg,color:atr?TEXTO_ATRASO:(todas?BRAND.green:BRAND.muted),border:atr?"0.5px solid "+COLOR_ATRASO+"55":"none",borderRadius:5,padding:"2px 7px",fontWeight:600}}>{atr?"⚠ ":""}🔧 {o.refacciones.filter(r=>r.recibida).length}/{o.refacciones.length}</span>; })()}{o.placa&&<span style={{fontSize:10,background:BRAND.bg,color:BRAND.muted,borderRadius:5,padding:"2px 7px"}}>{o.placa}</span>}{o.tecnico&&<span style={{fontSize:10,background:BRAND.bg,color:BRAND.muted,borderRadius:5,padding:"2px 7px"}}>{o.tecnico}</span>}{o.costo>0&&<span style={{fontSize:10,background:BRAND.green+"11",color:BRAND.green,border:"0.5px solid "+BRAND.green+"33",borderRadius:5,padding:"2px 7px"}}>${o.costo.toLocaleString("es-MX")}</span>}{o.siniestro&&<span style={{fontSize:10,background:BRAND.blue+"11",color:BRAND.blue,border:"0.5px solid "+BRAND.blue+"33",borderRadius:5,padding:"2px 7px"}}>{o.siniestro}</span>}</div>
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
  const [recuperacion, setRecuperacion] = useState(null);   // { accessToken } cuando se abre un enlace de recuperación
  const [avisoLogin, setAvisoLogin] = useState(null);       // { tipo: 'info'|'error', texto }
  const [sinConexion, setSinConexion] = useState(false);    // al abrir: la llave venció y no hay internet para renovarla
  const usuarioRef = useRef(null); usuarioRef.current = usuario;
  const iniciandoRef = useRef(true); iniciandoRef.current = iniciando;
  const arrancarRef = useRef(null);
  // ?pizarron en la dirección: esta pestaña muestra solo el pizarrón (para la TV del taller)
  const [modoPizarron, setModoPizarron] = useState(() => { try { return new URLSearchParams(window.location.search).has("pizarron"); } catch (_) { return false; } });

  // Cambia solo las llaves de la sesión; lo demás del usuario sigue igual
  const aplicarLlaves = n => setUsuario(prev => prev && prev.id === n.id
    ? { ...prev, token: n.token, refreshToken: n.refreshToken, expiresAt: n.expiresAt } : prev);

  // Cierra la sesión en este navegador (en todas sus pestañas). revocar: avisar también al servidor.
  const cerrarSesionLocal = (motivo, revocar = true) => {
    const u = usuarioRef.current;
    if (revocar && u && !u.modoDemo && sesionVigente(u, 0)) supaAuth.signOut(u.token, "local");
    avisarCierre(motivo);
    borrarSesion();
    setUsuario(null);
    setAvisoLogin(MENSAJES_CIERRE[motivo] ? { tipo:"info", texto: MENSAJES_CIERRE[motivo] } : null);
  };

  // La sesión ya no está en este navegador: otra pestaña la cerró, o entró otra cuenta
  const sesionAjena = () => {
    if (leerSesion()) { window.location.reload(); return; }
    setUsuario(null);
    setAvisoLogin(avisoDeCierre());
  };

  useEffect(() => {
    let vivo = true, enCurso = false, reintento = null, intentos = 0;
    // Abre la sesión guardada: la renueva (o adopta la que renovó otra pestaña) y trae el perfil al día
    const arrancar = async () => {
      if (!vivo || enCurso) return;
      enCurso = true; clearTimeout(reintento);
      try {
        const u = leerSesion();
        if (!u) { setSinConexion(false); setIniciando(false); return; }
        if (u.modoDemo || !u.refreshToken) { setUsuario(u); setIniciando(false); return; }
        if (u.rol !== "pantalla" && inactivoDemasiado()) {      // las cuentas de pantalla no se cierran por inactividad
          if (sesionVigente(u, 0)) supaAuth.signOut(u.token, "local");
          borrarSesion();
          setAvisoLogin({ tipo:"info", texto: MENSAJES_CIERRE.inactividad });
          setSinConexion(false); setIniciando(false);
          return;
        }
        const r = await renovarSesionCompartida(u);
        if (!vivo) return;
        let act = r.usuario || null;
        if (!act) {
          if (r.ajena && leerSesion()) { reintento = setTimeout(arrancar, 0); return; }   // entró otra cuenta: abrir esa
          if (r.definitivo) {
            setAvisoLogin(r.ajena ? avisoDeCierre() : { tipo:"info", texto: MENSAJES_CIERRE.vencida });
            setSinConexion(false); setIniciando(false);
            return;
          }
          // Sin internet: si la llave aún sirve un rato se entra y se renueva después; si no, se espera la conexión
          if (sesionVigente(u, 30 * 1000)) act = u;
          else { setSinConexion(true); intentos++; reintento = setTimeout(arrancar, Math.min(30, 5 * intentos) * 1000); return; }
        }
        try {
          const perfil = await Promise.race([supaApi.getPerfil(act.token, act.id), new Promise(res => setTimeout(() => res(null), 8000))]);
          if (perfil && act.rol === "pantalla" && ROLES_EQUIPO.includes(perfil.rol)) {
            // La cuenta de la TV pasó a ser del equipo: no se abre la app completa en una pantalla que ve el público
            supaAuth.signOut(act.token, "local"); borrarSesion();
            setAvisoLogin({ tipo:"info", texto: MENSAJES_CIERRE.rol }); setSinConexion(false); setIniciando(false);
            return;
          }
          if (perfil) act = { ...act, rol: perfil.rol || act.rol, taller: perfil.taller || act.taller, tallerNombre: perfil.taller_nombre || act.tallerNombre };
        } catch (_) {}
        if (!vivo) return;
        if (!leerActividad()) marcarActividad();
        setSinConexion(false); setUsuario(act); setIniciando(false);
      } finally { enCurso = false; }
    };
    arrancarRef.current = arrancar;

    // ¿Venimos de un enlace del correo (recuperar contraseña / confirmar cuenta)?
    const h = leerHashAuth();
    if (h) {
      limpiarHash();   // el token no debe quedarse en la URL ni en el historial
      if (h.error) {
        const vencido = /expired|invalid/i.test(h.error + " " + (h.errorCode || ""));
        setAvisoLogin({ tipo:"error", texto: vencido ? "El enlace expiró o ya se usó. Solicita uno nuevo desde «¿Olvidaste tu contraseña?»." : "No se pudo validar el enlace: " + h.error });
      } else if (h.tipo === "recovery" && h.accessToken) {
        setRecuperacion({ accessToken: h.accessToken });
        setIniciando(false);
        return () => { vivo = false; };
      } else if (h.tipo === "signup") {
        setAvisoLogin({ tipo:"info", texto:"Correo confirmado. Ya puedes iniciar sesión." });
      }
    }
    arrancar();
    const alVolverLaRed = () => { if (iniciandoRef.current) arrancar(); };
    window.addEventListener("online", alVolverLaRed);
    return () => { vivo = false; clearTimeout(reintento); window.removeEventListener("online", alVolverLaRed); };
  }, []);

  useEffect(() => { if (usuario) guardarSesion(usuario); }, [usuario]);

  // Lo que hagan las demás pestañas de este navegador con la sesión
  useEffect(() => {
    const alCambiar = e => {
      if (e.key !== null && e.key !== SESION_KEY) return;
      if (iniciandoRef.current) { if (arrancarRef.current) arrancarRef.current(); return; }
      const actual = usuarioRef.current, guardada = leerSesion();
      if (!guardada) {                                            // se cerró la sesión en otra pestaña
        if (actual && !actual.modoDemo) { setUsuario(null); setAvisoLogin(avisoDeCierre()); }
        return;
      }
      if (!actual) { setAvisoLogin(null); setUsuario(guardada); return; }   // iniciaste sesión en otra pestaña
      if (guardada.id !== actual.id || !!guardada.modoDemo !== !!actual.modoDemo) { window.location.reload(); return; }
      if (guardada.refreshToken && guardada.refreshToken !== actual.refreshToken && (guardada.expiresAt || 0) > (actual.expiresAt || 0))
        aplicarLlaves(guardada);                                  // otra pestaña renovó la sesión
      if (guardada.rol !== actual.rol || guardada.taller !== actual.taller)
        setUsuario(prev => prev && prev.id === guardada.id ? { ...prev, rol: guardada.rol, taller: guardada.taller, tallerNombre: guardada.tallerNombre } : prev);
    };
    window.addEventListener("storage", alCambiar);
    return () => window.removeEventListener("storage", alCambiar);
  }, []);

  // Renueva la sesión antes de que venza y la cierra tras 12 horas sin uso. Revisa cada 30 s,
  // al volver a la pestaña o despertar la computadora, y en cuanto regresa el internet.
  const idSesion = usuario && !usuario.modoDemo && usuario.refreshToken ? usuario.id : "";
  const esPantallaSesion = !!usuario && usuario.rol === "pantalla";
  const soloPizarron = !!usuario && (esPantallaSesion || modoPizarron);   // esta pestaña solo muestra el pizarrón
  useEffect(() => {
    if (!idSesion) return;
    let vivo = true, enCurso = false, fallas = 0, reintento = null;
    const revisar = async () => {
      if (!vivo || enCurso) return;
      const u = usuarioRef.current;
      if (!(u && u.rol === "pantalla") && inactivoDemasiado()) { cerrarSesionLocal("inactividad"); return; }
      if (!u || u.modoDemo || sesionVigente(u)) return;
      enCurso = true;
      let r;
      try { r = await renovarSesionCompartida(u); } finally { enCurso = false; }
      if (!vivo) return;
      if (r.usuario) { fallas = 0; aplicarLlaves(r.usuario); return; }
      if (r.ajena) { sesionAjena(); return; }
      if (r.definitivo) { cerrarSesionLocal("vencida", false); return; }
      fallas++;                                     // sin internet: la sesión sigue abierta y se reintenta
      clearTimeout(reintento);
      if (fallas <= 3) reintento = setTimeout(revisar, 5000 * fallas);
    };
    revisar();
    const iv = setInterval(revisar, REVISAR_SESION_MS);
    const alVolver = () => { if (!document.hidden) revisar(); };
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("focus", alVolver);
    window.addEventListener("online", revisar);
    return () => {
      vivo = false; clearInterval(iv); clearTimeout(reintento);
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("focus", alVolver);
      window.removeEventListener("online", revisar);
    };
  }, [idSesion]);

  // Cualquier clic, toque o tecla cuenta como uso, en cualquier pestaña. Si ya pasaron 12 horas
  // sin uso, ese primer toque cierra la sesión en lugar de extenderla.
  useEffect(() => {
    if (!idSesion || esPantallaSesion) return;      // la TV no tiene quién la use: no cuenta actividad
    let ultima = 0;
    const alUsar = () => {
      const ahora = Date.now();
      if (ahora - ultima < 60 * 1000) return;       // a lo más una escritura por minuto
      if (inactivoDemasiado()) { cerrarSesionLocal("inactividad"); return; }
      ultima = ahora; marcarActividad(ahora);
    };
    const eventos = ["pointerdown", "keydown", "touchstart", "wheel"];
    eventos.forEach(ev => window.addEventListener(ev, alUsar, { capture: true, passive: true }));
    return () => eventos.forEach(ev => window.removeEventListener(ev, alUsar, { capture: true }));
  }, [idSesion, esPantallaSesion]);

  const iniciarSesion = u => { if (!u.modoDemo) marcarActividad(); setAvisoLogin(null); setUsuario(u); };
  const cerrarSesion = () => cerrarSesionLocal("salida");
  const cerrarSesionEnTodos = async () => {
    const u = usuarioRef.current;
    if (!u || u.modoDemo) return;
    if (!confirm("¿Cerrar tu sesión en todos tus dispositivos? Tendrás que volver a iniciar sesión en cada uno.")) return;
    let vigente = u;
    if (!sesionVigente(u, 10 * 1000)) { const r = await renovarSesionCompartida(u); if (r.usuario) vigente = r.usuario; }
    if (!(await supaAuth.signOut(vigente.token, "global"))) {
      alert("No se pudo cerrar la sesión en tus otros dispositivos. Revisa tu conexión e inténtalo de nuevo.");
      return;
    }
    cerrarSesionLocal("todos", false);
  };

  // Vuelve a leer el perfil (la TV lo pide si el servidor le niega el pizarrón, y cada 10 minutos).
  // Si una cuenta de pantalla pasó a ser del equipo, se cierra la sesión en lugar de abrir la app completa.
  const revisarPerfil = async () => {
    const u = usuarioRef.current;
    if (!u || u.modoDemo) return;
    try {
      const perfil = await supaApi.getPerfil(u.token, u.id);
      if (!perfil || !perfil.rol || !usuarioRef.current || usuarioRef.current.id !== u.id) return;
      if (u.rol === "pantalla" && ROLES_EQUIPO.includes(perfil.rol)) { cerrarSesionLocal("rol"); return; }
      if (perfil.rol !== u.rol || (perfil.taller && perfil.taller !== u.taller))
        setUsuario(prev => prev && prev.id === u.id ? { ...prev, rol: perfil.rol, taller: perfil.taller || prev.taller, tallerNombre: perfil.taller_nombre || prev.tallerNombre } : prev);
    } catch (_) {}
  };
  const salirDelPizarron = () => {
    try { const url = new URL(window.location.href); url.searchParams.delete("pizarron"); window.history.replaceState(null, "", url.pathname + url.search + url.hash); } catch (_) {}
    setModoPizarron(false);
  };

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
  const [gBusqueda,setGBusqueda]=useState("");
  const [pagina,setPagina]=useState(1);
  const [refFiltro,setRefFiltro]=useState({ estado:"pendientes", n:0 });   // filtro con el que se abre la sección Refacciones
  const [pizFiltro,setPizFiltro]=useState({ estado:"todas", n:0 });        // filtro con el que se abre la sección Pizarrón
  const [ordenLista,setOrdenLista]=useState(()=>{ try { return localStorage.getItem("repairx_orden_lista")==="antiguas"?"antiguas":"recientes"; } catch(_){ return "recientes"; } });
  const [fotoAmpliada,setFotoAmpliada]=useState(null);
  const [docTipo,setDocTipo]=useState("inventario");
  const [docNombre,setDocNombre]=useState("");
  const [camaraActiva,setCamaraActiva]=useState(false);
  const [subiendo,setSubiendo]=useState("");
  const [cargando,setCargando]=useState(false);
  const [errorSync,setErrorSync]=useState("");
  const [avisoSync,setAvisoSync]=useState("");   // avisos de sincronización (no son errores)
  const [usuarios,setUsuarios]=useState([]);
  const [rolAprobar,setRolAprobar]=useState({});   // rol elegido para cada solicitud pendiente
  const [modalCerrar,setModalCerrar]=useState(null);
  const [modalRetroceder,setModalRetroceder]=useState(null);
  const [modalCobro,setModalCobro]=useState(null);
  const [modalPago,setModalPago]=useState(null);
  const [modalTerminar,setModalTerminar]=useState(null);
  // CAMBIO 4: servicio ahora es array para multi-selección
  const [form,setForm]=useState({cliente:"",telefono:"",vehiculo:"",placa:"",serie:"",siniestro:"",color:"",servicio:[],tecnico:"",entrega:"",notas:"",costo:"",fotoPrincipal:null,llegada:"",transito:false});

  const creandoRef=useRef(false);
  const fotoRef=useRef(); const docRef=useRef(); const fotoPrincipalRef=useRef(); const videoRef=useRef(); const canvasRef=useRef();

  useEffect(()=>{ setPagina(1); }, [busqueda, filtroEstado, subVista]);

  useEffect(() => {
    if (!usuario || usuario.modoDemo || !puedePerm(usuario,"todo") || soloPizarron) return;
    if (vista!=="equipo" && vista!=="dashboard") return;
    supaApi.getUsuariosTaller(usuario.token, usuario.taller).then(d => { if(Array.isArray(d)) setUsuarios(d); }).catch(()=>{});
  }, [vista, usuario, soloPizarron]);

  // ─── Sincronización con el servidor (edición simultánea sin pérdidas) ───────
  const syncRef = useRef({});      // id → { base: la orden tal como está en el servidor, version }
  const enviadoRef = useRef({});   // id → último estado ya puesto en cola (evita guardar dos veces lo mismo)
  const colaRef = useRef({});      // id → guardado en curso (uno a la vez por orden)
  const cursorRef = useRef(null);  // actualizado_en más reciente recibido del servidor
  const cargadoRef = useRef(false);
  const ultimoRefrescoRef = useRef(0);
  const estadoRef = useRef({});
  estadoRef.current = { ordenes, ordenesCobro, ordenesCobradas, ordenesTerminadas, historial };
  const ordenSelRef = useRef(null);
  ordenSelRef.current = ordenSel;
  // Cambios del servidor que ya se mandaron a pantalla pero React aún no redibuja.
  // Mientras tanto, cualquier lectura para guardar los aplica encima (si no, un guardado
  // leería la versión vieja y "borraría" lo que agregó otra persona). Se vacía tras cada render.
  const pendienteRef = useRef({});
  useEffect(() => { pendienteRef.current = {}; });

  const LISTA_SETTERS = { activas: setOrdenes, cobro: setOrdenesCobro, cobradas: setOrdenesCobradas, terminadas: setOrdenesTerminadas, historial: setHistorial };
  const NOMBRE_LISTA = { activas:"Activas", cobro:"Para cobro", cobradas:"Cobradas", terminadas:"Terminadas", historial:"Historial" };
  const listaDe = o => o.fechaCierre ? "historial" : o.fechaTerminado ? "terminadas" : o.fechaPago ? "cobradas" : o.fechaEnvioCobro ? "cobro" : "activas";
  const todasLasOrdenes = () => { const e = estadoRef.current; return [...(e.ordenes||[]), ...(e.ordenesCobro||[]), ...(e.ordenesCobradas||[]), ...(e.ordenesTerminadas||[]), ...(e.historial||[])]; };
  const buscarOrden = id => todasLasOrdenes().find(o => o.id === id);
  // La orden tal como la ve el usuario, incluyendo cambios del servidor aún no dibujados
  const filaLocalDe = o => {
    let fila = ordenToDB(o, usuario.taller);
    (pendienteRef.current[o.id] || []).forEach(p => { fila = fusionarOrden(p.antes, fila, p.despues).fila; });
    return fila;
  };
  const registrarPendiente = (id, antes, despues) => { (pendienteRef.current[id] = pendienteRef.current[id] || []).push({ antes, despues }); };
  const avanzarCursor = ts => { if (ts && (!cursorRef.current || Date.parse(ts) > Date.parse(cursorRef.current))) cursorRef.current = ts; };

  // Pone la versión nueva de una orden en la lista que le corresponde según sus fechas
  const reemplazarOrden = (id, nueva) => {
    const destino = listaDe(nueva);
    Object.entries(LISTA_SETTERS).forEach(([clave, set]) => set(lista => {
      const i = lista.findIndex(x => x.id === id);
      if (clave === destino) { if (i >= 0) { const c = lista.slice(); c[i] = nueva; return c; } return [nueva, ...lista]; }
      return i >= 0 ? lista.filter(x => x.id !== id) : lista;
    }));
    const sel = ordenSelRef.current;
    if (sel && sel.id === id) {
      if (destino === "activas") setOrdenSel(nueva);
      else { setOrdenSel(null); setAvisoSync(`La orden ${id} fue movida a «${NOMBRE_LISTA[destino]}» por otra persona.`); }
    }
  };

  // Muestra la versión fusionada sin perder lo que el usuario hizo mientras se guardaba
  const aplicarFusion = (id, filaEnviada, filaFusionada) => {
    const actual = buscarOrden(id);
    let fila = filaFusionada;
    if (actual) {
      const filaActual = filaLocalDe(actual);
      if (!igual(filaActual, filaEnviada)) fila = fusionarOrden(filaEnviada, filaActual, filaFusionada).fila;
      registrarPendiente(id, filaActual, fila);
    }
    enviadoRef.current[id] = estable(filaFusionada);   // si el usuario siguió editando, se guardará en el siguiente ciclo
    reemplazarOrden(id, dbToOrden(fila));
  };

  const guardarOrden = async id => {
    const orden = buscarOrden(id);
    if (!orden) return;                                  // ya no existe localmente (p. ej. renombrada)
    const fila = filaLocalDe(orden);
    const res = await sincronizarFila(usuario.token, fila, syncRef.current[id]);
    syncRef.current[id] = { base: res.base, version: res.version };
    avanzarCursor(res.actualizadoEn);
    if (res.fusionada) {
      aplicarFusion(id, fila, res.fusionada);
      if (res.conflictos.length) {
        const que = res.conflictos.map(c => ETIQUETAS_CAMPO[c] || c).join(", ");
        setAvisoSync(`${id}: otra persona cambió ${que} al mismo tiempo. Se conservó su versión; revisa la orden.`);
      }
    }
  };

  // Un guardado a la vez por orden (si llega otro, espera su turno)
  const encolar = (id, tarea) => {
    const previa = colaRef.current[id] || Promise.resolve();
    const actual = previa.catch(() => {}).then(tarea);
    colaRef.current[id] = actual;
    actual.catch(() => {}).finally(() => { if (colaRef.current[id] === actual) delete colaRef.current[id]; });
    return actual;
  };

  const programarGuardado = o => {
    if (usuarioRef.current && usuarioRef.current.rol === "pantalla") return;   // la pantalla nunca guarda
    const js = estable(filaLocalDe(o));
    if (enviadoRef.current[o.id] === js) return;
    enviadoRef.current[o.id] = js;
    encolar(o.id, () => guardarOrden(o.id)).catch(e => {
      console.error("Error al guardar la orden:", e);
      const entrada = syncRef.current[o.id];
      if (e.codigo === "SIN_PERMISO" && entrada) {
        // La base de datos rechazó el cambio: la orden vuelve a como está guardada (reintentar no serviría)
        const guardada = dbToOrden(entrada.base);
        enviadoRef.current[o.id] = estable(ordenToDB(guardada, usuario.taller));
        reemplazarOrden(o.id, guardada);
        setErrorSync(`No se guardó el cambio en la orden ${o.id}: ${e.detalle || "tu usuario no tiene permiso para hacerlo"}.`);
        return;
      }
      delete enviadoRef.current[o.id];                   // se reintenta en el próximo cambio o en el refresco periódico
      setErrorSync(e.codigo === "NO_EXISTE" ? e.message : `No se pudo guardar la orden ${o.id}. Verifica tu conexión; se reintentará automáticamente.`);
    });
  };

  // Integra una orden que otra persona modificó (si aquí no hay cambios sin guardar)
  const incorporarRemota = row => {
    avanzarCursor(row.actualizado_en);
    const id = row.id, entrada = syncRef.current[id];
    if (entrada && (row.version || 1) <= entrada.version) return;           // ya la tenemos
    if (colaRef.current[id]) return;                                         // se está guardando: la fusión lo resuelve
    const actual = buscarOrden(id);
    if (actual && !entrada) return;
    if (actual && entrada && !igual(filaLocalDe(actual), entrada.base)) return;   // cambios locales pendientes
    const remota = dbToOrden(row);
    const fila = ordenToDB(remota, usuario.taller);
    if (actual) registrarPendiente(id, filaLocalDe(actual), fila);
    syncRef.current[id] = { base: fila, version: row.version || 1 };
    enviadoRef.current[id] = estable(fila);
    reemplazarOrden(id, remota);
  };

  const alRenombrar = (viejo, nuevo, version) => {
    const e = syncRef.current[viejo];
    if (e) {
      const base = { ...e.base, id: nuevo };
      syncRef.current[nuevo] = { base, version: version || e.version };
      enviadoRef.current[nuevo] = estable(base);
    }
    delete syncRef.current[viejo]; delete enviadoRef.current[viejo];
  };

  // Solo recarga todo si cambia la cuenta, el taller o el rol (no en cada renovación del token)
  // En modo pizarrón no se cargan las órdenes completas: la TV pide a la base solo lo que muestra
  const claveSesion = usuario && !usuario.modoDemo && !soloPizarron ? [usuario.id, usuario.taller, usuario.rol].join("|") : "";

  useEffect(() => {
    if (!claveSesion) { cargadoRef.current = false; return; }
    // Si no se pueden traer las órdenes (sin internet al abrir), se reintenta solo con la llave vigente
    let vivo = true, reintento = null, intentos = 0;
    const AVISO_CARGA = "No se pudieron cargar las órdenes. Verifica tu conexión; se reintentará automáticamente.";
    const cargar = () => {
      const u = usuarioRef.current;
      if (!vivo || !u) return;
      supaApi.getOrdenes(u.token).then(rows => {
        if (!vivo) return;
        if (!Array.isArray(rows)) throw new Error("respuesta inesperada al cargar las órdenes");
        const listas = { activas:[], cobro:[], cobradas:[], terminadas:[], historial:[] };
        const snap = {}, env = {}; let cursor = null;
        rows.forEach(r => {
          const o = dbToOrden(r);
          listas[listaDe(o)].push(o);
          const fila = ordenToDB(o, usuario.taller);
          snap[o.id] = { base: fila, version: r.version || 1 };
          env[o.id] = estable(fila);
          if (r.actualizado_en && (!cursor || Date.parse(r.actualizado_en) > Date.parse(cursor))) cursor = r.actualizado_en;
        });
        setOrdenes(listas.activas); setOrdenesCobro(listas.cobro); setOrdenesCobradas(listas.cobradas); setOrdenesTerminadas(listas.terminadas); setHistorial(listas.historial);
        syncRef.current = snap; enviadoRef.current = env;
        cursorRef.current = cursor || new Date(Date.now() - 60000).toISOString();
        cargadoRef.current = true;
        setCargando(false);
        setErrorSync(e => e === AVISO_CARGA ? "" : e);
      }).catch(() => {
        if (!vivo) return;
        setCargando(false);
        setErrorSync(AVISO_CARGA);
        intentos++;
        reintento = setTimeout(cargar, Math.min(60, 10 * intentos) * 1000);
      });
    };
    setCargando(true);
    cargar();
    return () => { vivo = false; clearTimeout(reintento); };
  }, [claveSesion]);

  // Guarda lo que cambió (espera 0.8 s para agrupar teclazos)
  useEffect(() => {
    if (!usuario || usuario.modoDemo || !cargadoRef.current) return;
    const t = setTimeout(() => { todasLasOrdenes().forEach(programarGuardado); }, 800);
    return () => clearTimeout(t);
  }, [ordenes, ordenesCobro, ordenesCobradas, ordenesTerminadas, historial, usuario]);

  // Cada 45 s y al volver a la pestaña: reintenta guardados fallidos y trae lo que cambiaron otros
  useEffect(() => {
    if (!usuario || usuario.modoDemo) return;
    let vivo = true;
    const refrescar = async () => {
      if (!cargadoRef.current || document.hidden) return;
      if (Date.now() - ultimoRefrescoRef.current < 5000) return;
      ultimoRefrescoRef.current = Date.now();
      todasLasOrdenes().forEach(o => {
        if (colaRef.current[o.id]) return;
        const e = syncRef.current[o.id];
        if (e && igual(filaLocalDe(o), e.base)) return;
        programarGuardado(o);
      });
      const desde = new Date(Date.parse(cursorRef.current || new Date().toISOString()) - 10000).toISOString();
      try {
        const filas = await supaApi.ordenesDesde(usuario.token, desde);
        if (vivo && Array.isArray(filas)) filas.forEach(incorporarRemota);
      } catch (_) {}
    };
    const iv = setInterval(refrescar, 45000);
    const alVolver = () => { if (!document.hidden) refrescar(); };
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("focus", alVolver);
    return () => { vivo = false; clearInterval(iv); document.removeEventListener("visibilitychange", alVolver); window.removeEventListener("focus", alVolver); };
  }, [usuario]);

  // Los avisos informativos se ocultan solos
  useEffect(() => { if (!avisoSync) return; const t = setTimeout(() => setAvisoSync(""), 10000); return () => clearTimeout(t); }, [avisoSync]);

  if (iniciando) return <div style={{minHeight:"100vh",background:BRAND.bg,display:"flex",alignItems:"center",justifyContent:"center",padding:"1.5rem"}}><div style={{textAlign:"center",maxWidth:320}}><div style={{fontSize:28,fontWeight:900,letterSpacing:3,marginBottom:8}}><LogoRX alto={24} centrado /></div>
    {sinConexion
      ? <><div style={{fontSize:14,fontWeight:600,color:BRAND.text,margin:"10px 0 4px"}}>Sin conexión con el servidor</div>
          <div style={{fontSize:12,color:BRAND.muted,lineHeight:1.5,marginBottom:14}}>Tu sesión sigue abierta. Volveremos a intentarlo en cuanto regrese el internet.</div>
          <button onClick={()=>arrancarRef.current&&arrancarRef.current()} style={{background:BRAND.accent,color:"#fff",border:"none",borderRadius:10,padding:"0.6rem 1.2rem",fontSize:13,fontWeight:700,cursor:"pointer"}}>Reintentar ahora</button></>
      : <div style={{fontSize:12,color:BRAND.muted}}>Cargando...</div>}
  </div></div>;
  if (recuperacion) return <NuevaPasswordScreen token={recuperacion.accessToken}
    onListo={()=>{ borrarSesion(); setUsuario(null); setRecuperacion(null); setAvisoLogin({ tipo:"info", texto:"Contraseña actualizada. Inicia sesión con tu nueva contraseña." }); }}
    onCancelar={()=>setRecuperacion(null)} />;
  if (!usuario) return <LoginScreen key={avisoLogin ? avisoLogin.texto : "login"} onLogin={iniciarSesion} aviso={avisoLogin} />;
  if (!usuario.modoDemo && (usuario.rol === "pendiente" || usuario.rol === "rechazado"))
    return <PantallaPendiente usuario={usuario} onActualizar={setUsuario} onLogout={cerrarSesion} />;
  // La TV del taller: las cuentas de pantalla solo ven el pizarrón; el equipo lo abre con ?pizarron
  if (soloPizarron)
    return <PizarronPantalla usuario={usuario} esPantalla={esPantallaSesion} ordenesDemo={usuario.modoDemo ? ordenes : null}
      onSalir={salirDelPizarron} onCerrarSesion={cerrarSesion} onRevisarPerfil={revisarPerfil} />;

  const pendientesEquipo = puedePerm(usuario,"todo") ? usuarios.filter(u=>u.rol==="pendiente").length : 0;

  // ─── Pizarrón: fechas de entrega de las órdenes activas ─────────────────────
  const resPiz = resumenPizarron(ordenes, hoyLocal());
  const irAPizarron = filtro => { setPizFiltro({ estado: filtro || "todas", n: Date.now() }); setVista("pizarron"); setOrdenSel(null); setGBusqueda(""); };
  const cambiarFechaEntrega = (id, fecha, motivo) => {
    const fn = o => conFechaEntrega(o, fecha, { motivo, usuario });
    setOrdenes(prev => prev.map(o => o.id === id ? fn(o) : o));
    setOrdenSel(prev => prev && prev.id === id ? fn(prev) : prev);
  };
  const abrirOrdenInfo = o => { setOrdenSel(o); setTabDetalle("info"); setVista("ordenes"); setSubVista("activas"); };
  const renderPizarron = () => (
    <SeccionPizarron key={pizFiltro.n} filtroInicial={pizFiltro.estado} ordenes={ordenes} usuario={usuario} desktop={desktop}
      puedeEditar={puedePerm(usuario, "editar_ordenes") || puedePerm(usuario, "ficha")} onFecha={cambiarFechaEntrega} onAbrirOrden={abrirOrdenInfo} />
  );

  // ─── Refacciones de las órdenes activas ─────────────────────────────────────
  const resRef = resumenRefacciones(ordenes);
  const irARefacciones = estado => { setRefFiltro({ estado: estado || "pendientes", n: Date.now() }); setVista("refacciones"); setOrdenSel(null); setGBusqueda(""); };
  const abrirOrdenRefacciones = o => { setOrdenSel(o); setTabDetalle("refacciones"); setVista("ordenes"); setSubVista("activas"); };
  const cambiarRefaccion = (ordenId, n) => {
    const fn = o => ordenConRefacciones(o, (o.refacciones || []).map(r => r.id === n.id ? n : r), usuario);
    setOrdenes(prev => prev.map(o => o.id === ordenId ? fn(o) : o));
    setOrdenSel(prev => prev && prev.id === ordenId ? fn(prev) : prev);
  };
  const renderRefacciones = () => (
    <SeccionRefacciones key={refFiltro.n} filtroInicial={refFiltro.estado} ordenes={ordenes} desktop={desktop}
      puedeEdit={puedePerm(usuario, "editar_ordenes")} onCambiar={cambiarRefaccion} onAbrirOrden={abrirOrdenRefacciones} />
  );

  const estObj=key=>ESTADOS.find(e=>e.key===key)||ESTADOS[0];
  const totalAct=ordenes.length;
  const totCobro=ordenesCobro.reduce((a,o)=>a+Math.max(0,(o.costo||0)-(o.descuento||0)),0);
  const totCobradas=ordenesCobradas.reduce((a,o)=>a+Math.max(0,(o.costo||0)-(o.descuento||0)),0);
  const totCobradoGlobal=[...ordenes,...ordenesCobro,...ordenesCobradas,...ordenesTerminadas,...historial].filter(o=>o.fechaPago).reduce((a,o)=>a+Math.max(0,(o.costo||0)-(o.descuento||0)),0);
  const proxExp=ordenesTerminadas.filter(o=>{const d=dDias(o.fechaTerminado);return d>=DIAS_TERM-30&&d<=DIAS_TERM;});

  const ordenesActivas=ordenarPorAlta(ordenes.filter(o=>{const mE=filtroEstado==="todos"||o.estado===filtroEstado;const mB=busqueda===""||[o.cliente,o.vehiculo,o.placa].some(v=>v.toLowerCase().includes(busqueda.toLowerCase()));return mE&&mB;}), ordenLista);
  const totalPaginas=Math.max(1,Math.ceil(ordenesActivas.length/PAGE_SIZE));
  const paginaActual=Math.min(pagina,totalPaginas);
  const activasPagina=ordenesActivas.slice((paginaActual-1)*PAGE_SIZE, paginaActual*PAGE_SIZE);
  const cambiarOrdenLista=v=>{ setOrdenLista(v); setPagina(1); try { localStorage.setItem("repairx_orden_lista", v); } catch(_){} };
  const selectorOrden=(
    <div role="group" aria-label="Ordenar por fecha de alta" style={{display:"inline-flex",background:BRAND.bg,border:"1px solid "+BRAND.border,borderRadius:9,padding:2,gap:2,flexShrink:0}}>
      {[{k:"recientes",l:"Más recientes"},{k:"antiguas",l:"Más antiguas"}].map(op=>{ const sel=ordenLista===op.k; return (
        <button key={op.k} type="button" aria-pressed={sel} onClick={()=>cambiarOrdenLista(op.k)}
          style={{border:"none",borderRadius:7,padding:"5px 11px",fontSize:11,fontWeight:600,cursor:"pointer",background:sel?"#fff":"transparent",color:sel?BRAND.text:BRAND.muted,boxShadow:sel?"0 1px 2px rgba(29,39,51,0.12)":"none"}}>{op.l}</button>
      ); })}
    </div>
  );

  const resultadosGlobales=(()=>{
    const q=gBusqueda.trim().toLowerCase(); if(!q)return [];
    const match=o=>[o.id,o.cliente,o.vehiculo,o.placa,o.siniestro,o.serie,o.telefono,...(o.refacciones||[]).flatMap(r=>[r.nombre,r.pedido,r.ordenCompra,r.proveedor,r.numeroParte])].some(v=>String(v||"").toLowerCase().includes(q));
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
  const enviarACobro=(id,desc,notas)=>{const o=ordenes.find(x=>x.id===id);if(!o)return;setOrdenesCobro(p=>[{...o,fechaEnvioCobro:hoy(),descuento:parseFloat(desc)||0,notasCobro:notas,bitacora:[...(o.bitacora||[]),{accion:"Enviada a cobro",usuario:usuario.nombre,fecha:hoy()}]},...p]);setOrdenes(p=>p.filter(x=>x.id!==id));setOrdenSel(null);setModalCobro(null);setSubVista("cobro");};
  const registrarPago=(id,met,ref)=>{const o=ordenesCobro.find(x=>x.id===id);if(!o)return;setOrdenesCobradas(p=>[{...o,fechaPago:hoy(),metodoPago:met,referenciaPago:ref,bitacora:[...(o.bitacora||[]),{accion:"Pago: "+met+(ref?" Ref:"+ref:""),usuario:usuario.nombre,fecha:hoy()}]},...p]);setOrdenesCobro(p=>p.filter(x=>x.id!==id));setModalPago(null);setSubVista("cobradas");};
  const cerrarOrden=(id,motivo)=>{const o=ordenes.find(x=>x.id===id);if(!o)return;setHistorial(p=>[{...o,fechaCierre:hoy(),motivoCierre:motivo,bitacora:[...(o.bitacora||[]),{accion:"Cerrada: "+motivo,usuario:usuario.nombre,fecha:hoy()}]},...p]);setOrdenes(p=>p.filter(x=>x.id!==id));setOrdenSel(null);setModalCerrar(null);};
  const terminarOrden=id=>{const src=ordenesCobradas.find(x=>x.id===id)||ordenesCobro.find(x=>x.id===id)||ordenes.find(x=>x.id===id);if(!src)return;const t={...src,fechaTerminado:hoy(),bitacora:[...(src.bitacora||[]),{accion:"Siniestro terminado",usuario:usuario.nombre,fecha:hoy()}]};setOrdenesTerminadas(p=>[t,...p]);setOrdenesCobradas(p=>p.filter(x=>x.id!==id));setOrdenesCobro(p=>p.filter(x=>x.id!==id));setOrdenes(p=>p.filter(x=>x.id!==id));setOrdenSel(null);setModalTerminar(null);setVista("terminadas");};

  // Acepta cualquier formato de imagen (incluido HEIC) y siempre sube JPEG comprimido
  const agregarFotos = async files => {
    if (!ordenSel || !files.length) return;
    const lista = Array.from(files);
    const fallidas = [];
    const avisosHEIC = [];
    try {
      for (let i = 0; i < lista.length; i++) {
        const f = lista[i];
        const cuenta = lista.length > 1 ? ` (${i + 1}/${lista.length})` : "";

        if (!pareceImagen(f)) { fallidas.push(`${f.name}: no es un archivo de imagen`); continue; }
        if (f.size > MAX_ARCHIVO_MB * 1024 * 1024) { fallidas.push(`${f.name}: supera ${MAX_ARCHIVO_MB} MB`); continue; }

        try {
          setSubiendo(esHEIC(f) ? `Convirtiendo HEIC${cuenta}...` : `Comprimiendo imagen${cuenta}...`);
          const { blob, dataUrl } = await procesarImagen(f, "foto");

          // En el servidor se guarda solo la ruta del archivo; en el modo demostración, la imagen misma
          let archivo = { url: dataUrl };
          if (!usuario.modoDemo) {
            setSubiendo(`Subiendo${cuenta}...`);
            archivo = { ruta: await supaStorage.subirArchivo(usuario.token, usuario.taller, ordenSel.id, blob, nombreJpg(f.name)) };
          }
          const foto = {
            id: Date.now() + Math.random(),
            nombre: nombreJpg(f.name),
            fecha: hoy(),
            ...archivo,
            size: (blob.size / 1024).toFixed(0) + " KB"
          };
          setOrdenes(p => {
            const u = p.map(o => o.id === ordenSel.id ? { ...o, fotos: [...(o.fotos || []), foto] } : o);
            setOrdenSel(u.find(o => o.id === ordenSel.id));
            return u;
          });
        } catch (e) {
          // El aviso de HEIC es instructivo y va aparte, no mezclado con fallos técnicos.
          // Una foto que falla no debe abortar el resto del lote.
          if (e.codigo === "HEIC_NO_SOPORTADO") avisosHEIC.push(e.message);
          else fallidas.push(`${f.name}: ${e.message}`);
        }
      }
    } finally {
      setSubiendo("");
      if (avisosHEIC.length) alert(avisosHEIC[0] + (avisosHEIC.length > 1 ? `\n\n(${avisosHEIC.length} archivos HEIC en total)` : ""));
      if (fallidas.length) alert("No se pudieron procesar estas imágenes:\n\n" + fallidas.join("\n"));
    }
  };

  // Borra el archivo del servidor después de quitarlo de la orden. Si falla, solo queda un archivo
  // suelto en la carpeta del taller (la orden ya no lo muestra); no se interrumpe al usuario.
  const borrarDelServidor = item => {
    const ruta = rutaArchivo(item);
    if (!ruta || usuario.modoDemo || !usuario.token) return;
    supaStorage.borrarArchivos(usuario.token, [ruta]).catch(e => console.warn("No se pudo borrar del servidor:", ruta, e.message));
  };
  const eliminarFoto=fid=>{ if(!confirm("¿Eliminar esta foto? Esta acción no se puede deshacer."))return; const foto=(ordenSel.fotos||[]).find(f=>f.id===fid); const u=ordenes.map(o=>o.id===ordenSel.id?{...o,fotos:o.fotos.filter(f=>f.id!==fid)}:o);setOrdenes(u);setOrdenSel(u.find(o=>o.id===ordenSel.id)); borrarDelServidor(foto); };
  const agregarDoc=async files=>{
    if(!ordenSel||!files.length)return; const f=files[0]; if(f.size>MAX_ARCHIVO_MB*1024*1024){alert(`«${f.name}» supera el límite de ${MAX_ARCHIVO_MB} MB.`);return;} const ext=f.name.split(".").pop().toUpperCase(); setSubiendo("Procesando documento...");
    if(!pareceImagen(f) && !EXT_DOCUMENTO.includes(ext.toLowerCase())){setSubiendo("");alert(`«${f.name}»: solo se pueden adjuntar PDF, Word, Excel o imágenes.`);return;}
    try{
      let archivo, tamKB = (f.size/1024).toFixed(0), extFinal = ext, nombreArchivo = f.name;
      if (pareceImagen(f)) {
        // Documento-imagen: se convierte a JPEG comprimido igual que las fotos
        setSubiendo(esHEIC(f) ? "Convirtiendo HEIC..." : "Comprimiendo documento...");
        const { blob, dataUrl } = await procesarImagen(f, "doc");
        tamKB = (blob.size/1024).toFixed(0);
        extFinal = "JPG";
        nombreArchivo = nombreJpg(f.name);
        if (!usuario.modoDemo) { setSubiendo(`Subiendo ${nombreArchivo}...`); archivo = { ruta: await supaStorage.subirArchivo(usuario.token,usuario.taller,ordenSel.id,blob,nombreArchivo) }; }
        else archivo = { url: dataUrl };
      } else if (!usuario.modoDemo) {
        // PDF, Word y Excel se suben tal cual al bucket privado. Antes se guardaban dentro de la orden,
        // y cada vez que se abría la app se descargaban completos los de todas las órdenes.
        setSubiendo(`Subiendo ${nombreArchivo}...`);
        archivo = { ruta: await supaStorage.subirArchivo(usuario.token,usuario.taller,ordenSel.id,f,nombreArchivo) };
      } else {
        archivo = { url: await new Promise((res,rej)=>{const r=new FileReader();r.onload=ev=>res(ev.target.result);r.onerror=()=>rej(new Error("No se pudo leer el archivo."));r.readAsDataURL(f);}) };
      }
      const doc={id:Date.now()+Math.random(),tipo:docTipo,nombre:docNombre||nombreArchivo,archivo:nombreArchivo,ext:extFinal,fecha:hoy(),size:tamKB+" KB",...archivo};
      setOrdenes(p=>{const u=p.map(o=>o.id===ordenSel.id?{...o,documentos:[...(o.documentos||[]),doc]}:o);setOrdenSel(u.find(o=>o.id===ordenSel.id));return u;});
      setDocNombre("");
    }catch(e){alert(e.codigo==="HEIC_NO_SOPORTADO" ? e.message : `No se pudo adjuntar «${f.name}»: ${e.message}`);}finally{setSubiendo("");}
  };
  const eliminarDoc=did=>{ if(!confirm("¿Eliminar este documento? Esta acción no se puede deshacer."))return; const doc=(ordenSel.documentos||[]).find(d=>d.id===did); const u=ordenes.map(o=>o.id===ordenSel.id?{...o,documentos:o.documentos.filter(d=>d.id!==did)}:o);setOrdenes(u);setOrdenSel(u.find(o=>o.id===ordenSel.id)); borrarDelServidor(doc); };

  const abrirCamara=async()=>{setCamaraActiva(true);setTimeout(async()=>{try{const s=await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"}});if(videoRef.current){videoRef.current.srcObject=s;videoRef.current.play();}}catch{setCamaraActiva(false);alert("No se pudo acceder a la cámara.");}},100);};
  const tomarFoto=()=>{const v=videoRef.current,c=canvasRef.current;if(!v||!c)return;c.width=v.videoWidth;c.height=v.videoHeight;c.getContext("2d").drawImage(v,0,0);setForm(f=>({...f,fotoPrincipal:c.toDataURL("image/jpeg",0.75)}));if(v.srcObject)v.srcObject.getTracks().forEach(t=>t.stop());setCamaraActiva(false);};
  const cerrarCamara=()=>{if(videoRef.current?.srcObject)videoRef.current.srcObject.getTracks().forEach(t=>t.stop());setCamaraActiva(false);};

  // CAMBIO 5: crearOrden con validación de taller y conversión de array a string
  const crearOrden = async () => {
    if (!usuario.taller) {
      alert("Tu cuenta no tiene un taller asignado. Cierra sesión, vuelve a entrar e intenta de nuevo.");
      return;
    }
    if (creandoRef.current) return;          // evita doble clic = dos órdenes
    creandoRef.current = true;
    let folio;
    try {
      if (usuario.modoDemo) {
        folio = generarIdOrden(ordenes, ordenesCobro, ordenesCobradas, ordenesTerminadas, historial);
      } else {
        setSubiendo("Creando orden...");
        folio = await supaApi.siguienteFolio(usuario.token);
      }
    } catch (e) {
      alert("No se pudo generar el número de orden. Verifica tu conexión e inténtalo de nuevo.\n\n" + e.message);
      return;
    } finally {
      setSubiendo("");
      creandoRef.current = false;
    }
    const servicioStr = Array.isArray(form.servicio) ? form.servicio.join(", ") : form.servicio;
    const { transito, ...datosForm } = form;
    const bitacoraInicial = [{ accion: "Orden creada", usuario: usuario.nombre, fecha: hoy() }];
    if (transito) bitacoraInicial.push({ accion: "Unidad enviada a tránsito en espera de piezas", usuario: usuario.nombre, fecha: hoy() });
    if (form.entrega) bitacoraInicial.push({ accion: "Fecha de entrega: " + fechaCorta(form.entrega), usuario: usuario.nombre, fecha: hoy() });
    const n = {
      ...datosForm,
      ...EXTRA(),
      fechaPromesaEntrega: form.entrega || "",   // la misma fecha que verá el pizarrón
      llegada: form.llegada || "",
      enTransito: !!transito,
      fechaTransito: transito ? hoyLocal() : "",
      servicio: servicioStr,
      fechaPrimerIngreso: hoy(),
      id: folio,
      tallerId: usuario.taller,
      fecha: hoy(),
      estado: "presupuesto",
      costo: parseFloat(form.costo) || 0,
      fotos: [], documentos: [], novedades: [], refacciones: [],
      bitacora: bitacoraInicial
    };
    setOrdenes(p => [n, ...p]);
    setForm({ cliente:"", telefono:"", vehiculo:"", placa:"", serie:"", siniestro:"",
      color:"", servicio:[], tecnico:"", entrega:"", notas:"", costo:"", fotoPrincipal:null, llegada:"", transito:false });
    setCamaraActiva(false);
    setVista("ordenes");
    setSubVista("activas");
  };

  const ModalTerminar=()=>{if(!modalTerminar)return null;return(<div style={S.overlay} onClick={()=>setModalTerminar(null)}><div style={S.modalBox} onClick={e=>e.stopPropagation()}><div style={{fontSize:16,fontWeight:800,color:BRAND.green,marginBottom:6}}>Terminar Siniestro</div><div style={{fontSize:12,color:BRAND.muted,marginBottom:16}}>{modalTerminar.id} - {modalTerminar.cliente}</div><div style={{background:BRAND.bg,borderRadius:10,padding:"0.85rem",marginBottom:16}}>{["Se moverá a la sección Terminadas","Se conservará por 1 año (365 días)","Aviso 30 días antes de expirar"].map((t,i)=><div key={i} style={{fontSize:12,color:BRAND.text,marginBottom:6}}>✓ {t}</div>)}</div><div style={{display:"flex",gap:8}}><button style={{...S.btnGreen,flex:1,padding:"0.65rem",fontSize:14}} onClick={()=>terminarOrden(modalTerminar.id)}>Confirmar terminado</button><button style={S.btnSm()} onClick={()=>setModalTerminar(null)}>Cancelar</button></div></div></div>);};
  const ModalCerrar=()=>{const [m,sm]=useState("");if(!modalCerrar)return null;return(<div style={S.overlay} onClick={()=>setModalCerrar(null)}><div style={S.modalBox} onClick={e=>e.stopPropagation()}><div style={{fontSize:15,fontWeight:700,color:BRAND.accent,marginBottom:4}}>Cerrar Orden {modalCerrar.id}</div><div style={{fontSize:12,color:BRAND.muted,marginBottom:14}}>Se moverá al historial por {DIAS_HIST} días.</div><label style={S.label}>Motivo</label><select style={{...S.select,marginBottom:14}} value={m} onChange={e=>sm(e.target.value)}><option value="">Seleccionar...</option><option>Vehículo entregado al cliente</option><option>Cancelado por el cliente</option><option>Trabajo terminado sin entrega</option><option>Orden duplicada</option><option>Otro</option></select><div style={{display:"flex",gap:8}}><button style={S.btnDanger} disabled={!m} onClick={()=>cerrarOrden(modalCerrar.id,m)}>Confirmar cierre</button><button style={S.btnSm()} onClick={()=>setModalCerrar(null)}>Cancelar</button></div></div></div>);};
  // Regresar a la etapa anterior: solo el administrador, con motivo; queda en la bitácora con su nombre.
  // La base de datos aplica la misma regla (migracion_retroceso_solo_admin.sql).
  const ModalRetroceder=()=>{const [mot,sm]=useState("");const [err,se]=useState("");if(!modalRetroceder)return null;const o=modalRetroceder;const i=PASOS.indexOf(o.estado);const ant=i>0?estObj(PASOS[i-1]):null;const esAdmin=puedePerm(usuario,"todo");
    const ok=()=>{ if(!esAdmin){se("Solo un administrador puede regresar una orden a la etapa anterior.");return;} if(!mot.trim()){se("Indica el motivo.");return;}
      const oo=ordenes.find(x=>x.id===o.id); const ii=oo?PASOS.indexOf(oo.estado):-1;
      if(ii>0){ updOrden(o.id,{estado:PASOS[ii-1]},{accion:"Retrocedió a: "+estObj(PASOS[ii-1]).label+" - "+mot.trim(),usuario:usuario.nombre+" (admin)"}); }
      setModalRetroceder(null); };
    return(<div style={S.overlay} onClick={()=>setModalRetroceder(null)}><div style={S.modalBox} onClick={e=>e.stopPropagation()}><div style={{fontSize:15,fontWeight:700,color:BRAND.blue,marginBottom:4}}>Regresar a la etapa anterior</div><div style={{fontSize:12,color:BRAND.muted,marginBottom:14}}>De {estObj(o.estado).label}{ant?" a "+ant.label:""}. Quedará en la bitácora con tu nombre.</div>
      {esAdmin
        ?<><label style={S.label}>Motivo</label><textarea style={{...S.input,minHeight:55,resize:"none",marginBottom:10}} value={mot} onChange={e=>{sm(e.target.value);se("");}} />{err&&<div style={{fontSize:12,color:"#EF4444",marginBottom:10}}>{err}</div>}<div style={{display:"flex",gap:8}}><button style={{...S.btn,background:BRAND.blue}} onClick={ok}>Regresar etapa</button><button style={S.btnSm()} onClick={()=>setModalRetroceder(null)}>Cancelar</button></div></>
        :<><div style={{background:BRAND.bg,borderRadius:8,padding:"0.75rem",marginBottom:12,fontSize:12,color:BRAND.muted}}>Solo un administrador puede regresar una orden a la etapa anterior.</div><button style={S.btnSm()} onClick={()=>setModalRetroceder(null)}>Cerrar</button></>}
    </div></div>);};
  const ModalCobro=()=>{const [desc,sd]=useState("");const [notas,sn]=useState("");if(!modalCobro)return null;const total=Math.max(0,(modalCobro.costo||0)-(parseFloat(desc)||0));return(<div style={S.overlay} onClick={()=>setModalCobro(null)}><div style={S.modalBox} onClick={e=>e.stopPropagation()}><div style={{fontSize:15,fontWeight:700,color:BRAND.green,marginBottom:4}}>Enviar a Cobro</div><div style={{fontSize:12,color:BRAND.muted,marginBottom:14}}>{modalCobro.id} - {modalCobro.cliente}</div><div style={{background:BRAND.bg,borderRadius:8,padding:"0.75rem",marginBottom:14}}><div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:8}}><span style={{color:BRAND.muted}}>Costo</span><span style={{fontWeight:600}}>${(modalCobro.costo||0).toLocaleString("es-MX")}</span></div><label style={S.label}>Descuento ($)</label><input style={{...S.input,marginBottom:10}} type="number" placeholder="0" value={desc} onChange={e=>sd(e.target.value)} /><div style={{display:"flex",justifyContent:"space-between",fontSize:15,fontWeight:700,borderTop:"0.5px solid "+BRAND.border,paddingTop:8}}><span style={{color:BRAND.muted}}>Total</span><span style={{color:BRAND.green}}>${total.toLocaleString("es-MX")}</span></div></div><label style={S.label}>Notas (opcional)</label><textarea style={{...S.input,minHeight:50,resize:"none",marginBottom:14}} value={notas} onChange={e=>sn(e.target.value)} /><div style={{display:"flex",gap:8}}><button style={S.btnGreen} onClick={()=>enviarACobro(modalCobro.id,desc,notas)}>Confirmar</button><button style={S.btnSm()} onClick={()=>setModalCobro(null)}>Cancelar</button></div></div></div>);};
  const ModalPago=()=>{const [met,sm]=useState("Efectivo");const [ref,sr]=useState("");if(!modalPago)return null;const total=Math.max(0,(modalPago.costo||0)-(modalPago.descuento||0));return(<div style={S.overlay} onClick={()=>setModalPago(null)}><div style={S.modalBox} onClick={e=>e.stopPropagation()}><div style={{fontSize:15,fontWeight:700,color:BRAND.purple,marginBottom:4}}>Registrar Pago</div><div style={{fontSize:12,color:BRAND.muted,marginBottom:14}}>{modalPago.id} - {modalPago.cliente}</div><div style={{background:BRAND.bg,borderRadius:8,padding:"0.75rem",marginBottom:14}}><div style={{display:"flex",justifyContent:"space-between",fontSize:15,fontWeight:700}}><span style={{color:BRAND.muted}}>Total</span><span style={{color:BRAND.green}}>${total.toLocaleString("es-MX")}</span></div></div><label style={S.label}>Método de pago</label><select style={{...S.select,marginBottom:10}} value={met} onChange={e=>sm(e.target.value)}>{["Efectivo","Transferencia","Tarjeta débito","Tarjeta crédito","Cheque","Aseguradora"].map(x=><option key={x}>{x}</option>)}</select><label style={S.label}>Referencia (opcional)</label><input style={{...S.input,marginBottom:14}} value={ref} onChange={e=>sr(e.target.value)} /><div style={{display:"flex",gap:8}}><button style={{...S.btn,background:BRAND.purple}} onClick={()=>registrarPago(modalPago.id,met,ref)}>Confirmar pago</button><button style={S.btnSm()} onClick={()=>setModalPago(null)}>Cancelar</button></div></div></div>);};

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

  const renderDashboard=()=>{
    const activas=ordenarPorAlta(ordenes, ordenLista);
    const enPiso=activas.filter(o=>!o.enTransito), enTransito=activas.filter(o=>o.enTransito);
    const abrir=o=>{setOrdenSel(o);setTabDetalle("info");setVista("ordenes");setSubVista("activas");};
    const columna=(titulo,detalle,lista,color,icono,vacio)=>(
      <div style={{background:BRAND.bg,borderRadius:12,padding:"0.85rem",minWidth:0}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:10}}>
          <div style={{minWidth:0}}>
            <div style={{fontSize:14,fontWeight:700,color}}>{icono} {titulo}</div>
            <div style={{fontSize:11,color:BRAND.muted}}>{detalle}</div>
          </div>
          <span style={{fontSize:20,fontWeight:800,color,flexShrink:0}}>{lista.length}</span>
        </div>
        {lista.length===0
          ?<div style={{fontSize:12,color:BRAND.muted,textAlign:"center",padding:"1.25rem 0.5rem"}}>{vacio}</div>
          :<div style={{display:"flex",flexDirection:"column",gap:10}}>{lista.map(o=><TarjetaOrden key={o.id} o={o} ordenes={ordenes} setOrdenes={setOrdenes} setOrdenSel={setOrdenSel} onClick={()=>abrir(o)} />)}</div>}
      </div>
    );
    return(
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <div style={{display:"grid",gridTemplateColumns:desktop?"repeat(4,1fr)":"repeat(2,1fr)",gap:10}}>{[{label:"Órdenes Activas",value:totalAct,color:BRAND.accent},{label:"Para Cobro",value:ordenesCobro.length,color:BRAND.green},{label:"Total Cobrado",value:"$"+totCobradoGlobal.toLocaleString("es-MX"),color:BRAND.purple},{label:"Terminadas",value:ordenesTerminadas.length,color:BRAND.blue}].map((m,i)=><div key={i} style={{...S.metric,border:"0.5px solid "+m.color+"25"}}><div style={{fontSize:10,color:BRAND.muted,marginBottom:4,textTransform:"uppercase",letterSpacing:0.8}}>{m.label}</div><div style={{fontSize:24,fontWeight:800,color:m.color}}>{m.value}</div></div>)}</div>
      {pendientesEquipo>0&&(
        <div onClick={()=>{setVista("equipo");setOrdenSel(null);}} style={{background:BRAND.blue+"12",border:"1px solid "+BRAND.blue+"55",borderRadius:10,padding:"10px 14px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,cursor:"pointer"}}>
          <span style={{fontSize:13,color:BRAND.blue,fontWeight:700}}>🔔 {pendientesEquipo} solicitud{pendientesEquipo!==1?"es":""} para unirse a tu taller</span>
          <span style={{fontSize:12,color:BRAND.blue,fontWeight:600,flexShrink:0}}>Revisar →</span>
        </div>
      )}
      {(()=>{ const vencidas=ordenes.filter(o=>(diasDesdeAlta(o)||0)>DIAS_ALERTA); if(!vencidas.length) return null; const n=vencidas.length; return (
        <div onClick={()=>{setVista("ordenes");setSubVista("activas");setOrdenSel(null);}} style={{background:"hsla(0, 85%, 50%, 0.08)",border:"1px solid hsla(0, 85%, 45%, 0.40)",borderRadius:10,padding:"10px 14px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,cursor:"pointer"}}>
          <span style={{fontSize:13,color:"hsl(0, 75%, 40%)",fontWeight:700}}>⚠ {n} {n===1?"orden lleva":"órdenes llevan"} más de {DIAS_ALERTA} días desde su alta</span>
          <span style={{fontSize:12,color:"hsl(0, 75%, 40%)",fontWeight:600,flexShrink:0}}>Ver →</span>
        </div>); })()}
      {(resPiz.vencida + resPiz.hoy + resPiz.manana) > 0 && (()=>{ const rojo = resPiz.vencida > 0; const c = rojo ? { fondo:"#FEF2F2", borde:"#FCA5A5", texto:"#B91C1C" } : { fondo:"#FFFBEB", borde:"#FCD34D", texto:"#92400E" };
        const ir = () => irAPizarron(resPiz.vencida ? "vencida" : resPiz.hoy ? "hoy" : "manana");
        const partes = [resPiz.vencida ? `${resPiz.vencida} vencida${resPiz.vencida===1?"":"s"}` : "", resPiz.hoy ? `${resPiz.hoy} para hoy` : "", resPiz.manana ? `${resPiz.manana} para mañana` : ""].filter(Boolean);
        return (
        <div role="button" tabIndex={0} onClick={ir} onKeyDown={e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); ir(); } }} style={{background:c.fondo,border:"1px solid "+c.borde,borderRadius:10,padding:"10px 14px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,cursor:"pointer"}}>
          <span style={{fontSize:13,color:c.texto,fontWeight:700}}>📅 Entregas: {partes.join(", ")}</span>
          <span style={{fontSize:12,color:c.texto,fontWeight:600,flexShrink:0}}>Ver pizarrón →</span>
        </div>); })()}
      <ResumenRefaccionesDashboard ordenes={ordenes} desktop={desktop} onIr={irARefacciones} />
      <div style={S.card}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:12}}>
          <div style={{fontSize:13,fontWeight:700,color:BRAND.accent}}>Unidades del taller <span style={{fontSize:11,color:BRAND.muted,fontWeight:400}}>({activas.length} {activas.length===1?"orden activa":"órdenes activas"})</span></div>
          {selectorOrden}
        </div>
        <div style={{display:"grid",gridTemplateColumns:desktop?"1fr 1fr":"1fr",gap:12,alignItems:"start"}}>
          {columna("En piso","Dentro del taller",enPiso,BRAND.accent,"🔧","No hay unidades dentro del taller.")}
          {columna("En tránsito","Esperando piezas fuera del taller",enTransito,BRAND.blue,"🚗","Ninguna unidad en tránsito. Cuando una unidad salga a esperar piezas, aparecerá aquí.")}
        </div>
      </div>
    </div>
  );};

  const renderOrdenes=()=>{const subTabs=[{k:"activas",l:"Activas",count:ordenes.length,color:BRAND.accent},{k:"cobro",l:"Para Cobro",count:ordenesCobro.length,color:BRAND.green},{k:"cobradas",l:"Cobradas",count:ordenesCobradas.length,color:BRAND.purple}];return(
    <div>
      <div style={{display:"flex",gap:0,marginBottom:14,borderBottom:"0.5px solid "+BRAND.border}}>{subTabs.map(t=><button key={t.k} onClick={()=>{setSubVista(t.k);setOrdenSel(null);}} style={{padding:"10px 16px",fontSize:13,cursor:"pointer",background:"none",border:"none",borderBottom:subVista===t.k?"2px solid "+t.color:"2px solid transparent",color:subVista===t.k?t.color:BRAND.muted,fontWeight:subVista===t.k?700:400,display:"flex",alignItems:"center",gap:6}}>{t.l}{t.count>0&&<span style={{background:subVista===t.k?t.color+"22":BRAND.card2,color:subVista===t.k?t.color:BRAND.muted,borderRadius:10,padding:"0px 7px",fontSize:11}}>{t.count}</span>}</button>)}</div>
      {subVista==="activas"&&(
        <div>
          {!ordenSel&&<div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}><input style={{...S.input,width:180}} placeholder="Buscar en activas..." value={busqueda} onChange={e=>setBusqueda(e.target.value)} /><select style={{...S.select,width:155}} value={filtroEstado} onChange={e=>setFiltroEstado(e.target.value)}><option value="todos">Todos los estados</option>{ESTADOS.map(e=><option key={e.key} value={e.key}>{e.label}</option>)}</select>{selectorOrden}{puedePerm(usuario,"crear_ordenes")&&<button style={S.btn} onClick={()=>setVista("nueva")}>+ Nueva Orden</button>}</div>}
          {ordenSel?<OrdenExpandida onRenombrado={alRenombrar} o={ordenSel} ordenes={ordenes} setOrdenes={setOrdenes} setOrdenSel={setOrdenSel} tabDetalle={tabDetalle} setTabDetalle={setTabDetalle} avanzarEstado={avanzarEstado} setModalRetroceder={setModalRetroceder} setModalCerrar={setModalCerrar} setModalCobro={setModalCobro} setModalTerminar={setModalTerminar} fotoRef={fotoRef} docRef={docRef} docTipo={docTipo} setDocTipo={setDocTipo} docNombre={docNombre} setDocNombre={setDocNombre} agregarFotos={agregarFotos} eliminarFoto={eliminarFoto} agregarDoc={agregarDoc} eliminarDoc={eliminarDoc} setFotoAmpliada={setFotoAmpliada} usuario={usuario} />:(
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
          {ordenesCobro.length>0&&<div style={{background:BRAND.green+"11",border:"0.5px solid "+BRAND.green+"33",borderRadius:8,padding:"8px 14px",marginBottom:12,display:"flex",justifyContent:"space-between"}}><span style={{fontSize:12,color:BRAND.green}}>Total pendiente</span><span style={{fontSize:16,fontWeight:800,color:BRAND.green}}>${totCobro.toLocaleString("es-MX")}</span></div>}
          {ordenesCobro.length===0&&<div style={{textAlign:"center",color:BRAND.muted,padding:"3rem",fontSize:13}}>Sin órdenes pendientes de cobro</div>}
          <div style={{display:"flex",flexDirection:"column",gap:8}}>{ordenesCobro.map(o=>{const total=Math.max(0,(o.costo||0)-(o.descuento||0));return(<div key={o.id} style={{...S.card,border:"0.5px solid "+BRAND.green+"33"}}><div style={{display:"flex",alignItems:"center",gap:10}}>{o.fotoPrincipal?<img src={o.fotoPrincipal} style={{width:48,height:36,objectFit:"cover",borderRadius:7,flexShrink:0}} alt="v" />:<div style={{width:48,height:36,background:BRAND.bg,borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>🚗</div>}<div style={{flex:1,minWidth:0}}><div style={{display:"flex",gap:8,alignItems:"center",marginBottom:2}}><span style={{fontSize:12,fontWeight:700,color:BRAND.green}}>{o.id}</span><span style={{fontSize:13,fontWeight:500}}>{o.cliente}</span></div><div style={{fontSize:11,color:BRAND.muted}}>{o.vehiculo} - {o.placa}</div></div><div style={{textAlign:"right",flexShrink:0}}><div style={{fontSize:16,fontWeight:800,color:BRAND.green,marginBottom:6}}>${total.toLocaleString("es-MX")}</div><button style={{...S.btn,background:BRAND.purple,fontSize:12,padding:"5px 12px"}} onClick={()=>setModalPago(o)}>Registrar pago</button></div></div></div>);})}</div>
        </div>
      )}
      {subVista==="cobradas"&&(
        <div>
          {ordenesCobradas.length>0&&<div style={{background:BRAND.purple+"11",border:"0.5px solid "+BRAND.purple+"33",borderRadius:8,padding:"8px 14px",marginBottom:12,display:"flex",justifyContent:"space-between"}}><span style={{fontSize:12,color:BRAND.purple}}>Total cobrado</span><span style={{fontSize:16,fontWeight:800,color:BRAND.purple}}>${totCobradas.toLocaleString("es-MX")}</span></div>}
          {ordenesCobradas.length===0&&<div style={{textAlign:"center",color:BRAND.muted,padding:"3rem",fontSize:13}}>Sin órdenes cobradas aún</div>}
          <div style={{display:"flex",flexDirection:"column",gap:8}}>{ordenesCobradas.map(o=>{const total=Math.max(0,(o.costo||0)-(o.descuento||0));return(<div key={o.id} style={{...S.card,border:"0.5px solid "+BRAND.purple+"33"}}><div style={{display:"flex",alignItems:"center",gap:10}}>{o.fotoPrincipal?<img src={o.fotoPrincipal} style={{width:48,height:36,objectFit:"cover",borderRadius:7,flexShrink:0}} alt="v" />:<div style={{width:48,height:36,background:BRAND.bg,borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>🚗</div>}<div style={{flex:1,minWidth:0}}><div style={{display:"flex",gap:8,alignItems:"center",marginBottom:2,flexWrap:"wrap"}}><span style={{fontSize:12,fontWeight:700,color:BRAND.purple}}>{o.id}</span><span style={{fontSize:13,fontWeight:500}}>{o.cliente}</span><span style={{fontSize:11,background:BRAND.purple+"22",color:BRAND.purple,borderRadius:10,padding:"1px 8px"}}>✓ Pagado</span></div><div style={{fontSize:11,color:BRAND.muted}}>{o.vehiculo} · {o.placa}</div><div style={{fontSize:11,color:BRAND.muted}}>{o.metodoPago}{o.referenciaPago?" · "+o.referenciaPago:""} · {o.fechaPago}</div></div><div style={{textAlign:"right",flexShrink:0}}><div style={{fontSize:16,fontWeight:800,color:BRAND.purple,marginBottom:6}}>${total.toLocaleString("es-MX")}</div><button style={{...S.btnGreen,fontSize:11,padding:"5px 10px"}} onClick={()=>setModalTerminar(o)}>Terminar</button></div></div></div>);})}</div>
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
    // CAMBIO 6: validación de multi-servicio
    if(!form.servicio || form.servicio.length===0) err.servicio="Selecciona al menos un servicio";
    if(form.telefono.trim()&&form.telefono.replace(/\D/g,"").length<10) err.telefono="Al menos 10 dígitos";
    if(form.serie.trim()&&form.serie.trim().length!==17) err.serie="El VIN debe tener 17 caracteres";
    if(form.costo!==""&&(isNaN(parseFloat(form.costo))||parseFloat(form.costo)<0)) err.costo="Debe ser un número mayor o igual a 0";
    if(form.entrega&&form.entrega<hoyLocal()) err.entrega="No puede ser anterior a hoy";
    const hayErrores=Object.keys(err).length>0;
    const be=f=>err[f]?{border:"0.5px solid #EF4444"}:{};
    const Er=({f})=>err[f]?<div style={{fontSize:10,color:"#EF4444",marginTop:3}}>{err[f]}</div>:null;

    // Toggle de servicio en el array
    const toggleServicio = sv => {
      setForm(f => ({
        ...f,
        servicio: f.servicio.includes(sv)
          ? f.servicio.filter(x => x !== sv)
          : [...f.servicio, sv]
      }));
    };

    return (
    <div style={{maxWidth:540}}>
      <div style={S.card}>
        <div style={{fontSize:14,fontWeight:700,color:BRAND.accent,marginBottom:14}}>Nueva Orden de Trabajo</div>
        <div style={{marginBottom:14}}>
          <label style={S.label}>Foto del Vehículo</label>
          <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
            <div style={{width:110,height:80,borderRadius:10,overflow:"hidden",border:"0.5px solid "+BRAND.border,background:BRAND.bg,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>{camaraActiva?<video ref={videoRef} style={{width:"100%",height:"100%",objectFit:"cover"}} autoPlay playsInline muted />:form.fotoPrincipal?<img src={form.fotoPrincipal} alt="preview" style={{width:"100%",height:"100%",objectFit:"cover"}} />:<span style={{fontSize:28}}>🚗</span>}</div>
            <canvas ref={canvasRef} style={{display:"none"}} />
            <div style={{display:"flex",flexDirection:"column",gap:6,flex:1}}>{camaraActiva?(<><button style={{...S.btn,fontSize:12}} onClick={tomarFoto}>📸 Tomar foto</button><button style={{...S.btnSm(),fontSize:12,padding:"5px 10px"}} onClick={cerrarCamara}>Cancelar</button></>):(<><button style={{...S.btn,fontSize:12}} onClick={abrirCamara}>📷 Usar cámara</button><button style={{...S.btnSm(),fontSize:12,padding:"5px 10px"}} onClick={()=>fotoPrincipalRef.current?.click()}>🖼️ Subir foto</button>{form.fotoPrincipal&&<button style={{...S.btnSm(),fontSize:11,color:"#fca5a5"}} onClick={()=>setForm(f=>({...f,fotoPrincipal:null}))}>✕ Quitar</button>}</>)}<input ref={fotoPrincipalRef} type="file" accept={ACCEPT_IMG} style={{display:"none"}} onChange={async ev=>{const f=ev.target.files[0];if(!f)return;if(!pareceImagen(f)){alert("Ese archivo no es una imagen.");ev.target.value="";return;}try{setSubiendo(esHEIC(f)?"Convirtiendo HEIC...":"Procesando imagen...");const {dataUrl}=await procesarImagen(f,"portada");setForm(p=>({...p,fotoPrincipal:dataUrl}));}catch(ex){alert(ex.codigo==="HEIC_NO_SOPORTADO" ? ex.message : "No se pudo procesar la imagen: "+ex.message);}finally{setSubiendo("");}ev.target.value="";}} /></div>
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
          <div><label style={S.label}>Cliente *</label><input style={{...S.input,...be("cliente")}} placeholder="Nombre completo" value={form.cliente} onChange={e=>setForm({...form,cliente:e.target.value})} /><Er f="cliente" /></div>
          <div><label style={S.label}>Teléfono</label><input style={{...S.input,...be("telefono")}} placeholder="55 0000 0000" value={form.telefono} onChange={e=>setForm({...form,telefono:e.target.value})} /><Er f="telefono" /></div>
          <div><label style={S.label}>Vehículo *</label><input style={{...S.input,...be("vehiculo")}} placeholder="Marca, Modelo, Año" value={form.vehiculo} onChange={e=>setForm({...form,vehiculo:e.target.value})} /><Er f="vehiculo" /></div>
          <div><label style={S.label}>Placa *</label><input style={{...S.input,...be("placa")}} placeholder="ABC-000" value={form.placa} onChange={e=>setForm({...form,placa:e.target.value})} /><Er f="placa" /></div>
          <div style={{gridColumn:"1/-1"}}>
            <label style={S.label}>¿Cómo llegó la unidad?</label>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {[{k:"grua",l:"🚛 En grúa"},{k:"circulando",l:"🚗 Circulando"}].map(op=>{ const sel=form.llegada===op.k; return (
                <button key={op.k} type="button" aria-pressed={sel} onClick={()=>setForm(f=>({...f,llegada:f.llegada===op.k?"":op.k}))}
                  style={{padding:"7px 14px",borderRadius:20,border:"1.5px solid "+(sel?BRAND.accent:BRAND.border),background:sel?BRAND.accent:"#fff",color:sel?"#fff":BRAND.muted,fontSize:12,fontWeight:sel?700:400,cursor:"pointer"}}>{op.l}</button>
              ); })}
            </div>
          </div>
          <div style={{gridColumn:"1/-1"}}><label style={S.label}>No. de Serie / VIN</label><input style={{...S.input,fontFamily:"monospace",letterSpacing:2,textTransform:"uppercase",...be("serie")}} placeholder="Ej. 1HGBH41JXMN109186" maxLength={17} value={form.serie} onChange={e=>setForm({...form,serie:e.target.value.toUpperCase()})} /><Er f="serie" /></div>
          <div style={{gridColumn:"1/-1"}}><label style={S.label}>No. de Siniestro (si aplica)</label><input style={S.input} placeholder="Ej. SIN-2026-00123" value={form.siniestro} onChange={e=>setForm({...form,siniestro:e.target.value})} /></div>
          <div><label style={S.label}>Color</label><input style={S.input} placeholder="Ej. Blanco perla" value={form.color} onChange={e=>setForm({...form,color:e.target.value})} /></div>
          {/* CAMBIO 7: "Fecha Promesa de Entrega" en lugar de "Fecha de Entrega" */}
          <div><label style={S.label}>Fecha Promesa de Entrega</label><input type="date" min={hoyLocal()} style={{...S.input,...be("entrega")}} value={form.entrega} onChange={e=>setForm({...form,entrega:e.target.value})} /><Er f="entrega" /></div>
          {/* CAMBIO 8: Multi-selección de servicios con pills */}
          <div style={{gridColumn:"1/-1"}}>
            <label style={S.label}>Servicio * <span style={{color:BRAND.muted,fontWeight:400}}>(puedes elegir varios)</span></label>
            <div style={{display:"flex",flexWrap:"wrap",gap:7,padding:"6px 0",border:err.servicio?"0.5px solid #EF4444":"none",borderRadius:err.servicio?8:0,paddingLeft:err.servicio?8:0}}>
              {SERVICIOS.map(sv => {
                const sel = Array.isArray(form.servicio) && form.servicio.includes(sv);
                return (
                  <button key={sv} type="button" onClick={()=>toggleServicio(sv)}
                    style={{padding:"7px 14px",borderRadius:20,border:"1.5px solid "+(sel?BRAND.accent:BRAND.border),background:sel?BRAND.accent:"#fff",color:sel?"#fff":BRAND.muted,fontSize:12,fontWeight:sel?700:400,cursor:"pointer",transition:"all 0.15s"}}>
                    {sv}
                  </button>
                );
              })}
            </div>
            {form.servicio.length>0&&<div style={{fontSize:10,color:BRAND.accent,marginTop:4}}>Seleccionado: {form.servicio.join(", ")}</div>}
            <Er f="servicio" />
          </div>
          {/* Técnico: texto libre */}
          <div style={{gridColumn:"1/-1"}}><label style={S.label}>Técnico</label><input style={S.input} placeholder="Nombre del técnico" value={form.tecnico} onChange={e=>setForm({...form,tecnico:e.target.value})} /></div>
        </div>
        <div style={{marginBottom:10}}><label style={S.label}>Costo Estimado ($)</label><input style={{...S.input,...be("costo")}} type="number" min="0" step="0.01" placeholder="0.00" value={form.costo} onChange={e=>setForm({...form,costo:e.target.value})} /><Er f="costo" /></div>
        <div style={{marginBottom:14}}><label style={S.label}>Notas</label><textarea style={{...S.input,minHeight:60,resize:"vertical"}} placeholder="Describe el problema..." value={form.notas} onChange={e=>setForm({...form,notas:e.target.value})} /></div>
        <div style={{marginBottom:14,background:form.transito?BRAND.blue+"0D":BRAND.bg,border:"1px solid "+(form.transito?BRAND.blue+"44":BRAND.border),borderRadius:10,padding:"0.8rem 0.9rem"}}>
          <div style={{fontSize:13,fontWeight:600,marginBottom:8}}>¿La unidad se va a tránsito mientras llegan las piezas?</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {[{v:false,l:"No, se queda en piso"},{v:true,l:"Sí, mandar a tránsito"}].map(op=>{ const sel=!!form.transito===op.v; return (
              <button key={String(op.v)} type="button" aria-pressed={sel} onClick={()=>setForm(f=>({...f,transito:op.v}))}
                style={{padding:"7px 14px",borderRadius:20,border:"1.5px solid "+(sel?(op.v?BRAND.blue:BRAND.text):BRAND.border),background:sel?(op.v?BRAND.blue:BRAND.text):"#fff",color:sel?"#fff":BRAND.muted,fontSize:12,fontWeight:sel?700:400,cursor:"pointer"}}>{op.l}</button>
            ); })}
          </div>
          {form.transito&&form.llegada==="grua"&&<div style={{fontSize:12,color:"#B45309",marginTop:8}}>⚠ La unidad llegó en grúa: confirma que puede circular antes de mandarla a tránsito.</div>}
          {form.transito&&<div style={{fontSize:11,color:BRAND.muted,marginTop:8}}>La orden aparecerá en la columna «En tránsito» del Dashboard. Cuando la unidad regrese, registra su reingreso desde la orden.</div>}
        </div>
        {hayErrores&&<div style={{background:"#EF444415",border:"0.5px solid #EF444433",borderRadius:8,padding:"7px 10px",fontSize:11,color:"#EF4444",marginBottom:12}}>Corrige los campos marcados antes de crear la orden.</div>}
        <div style={{display:"flex",gap:8}}><button style={{...S.btn,opacity:hayErrores?0.5:1,cursor:hayErrores?"not-allowed":"pointer"}} onClick={crearOrden} disabled={hayErrores}>Crear Orden</button><button style={S.btnSm()} onClick={()=>setVista("ordenes")}>Cancelar</button></div>
      </div>
    </div>
    );
  };

  const cambiarRol = async (uid, rol) => {
    if (usuario.modoDemo) { alert("La gestión de roles requiere Supabase configurado."); return false; }
    const previo = usuarios;
    setUsuarios(us => us.map(u => u.id===uid ? {...u, rol} : u));
    try { await supaApi.actualizarRol(usuario.token, uid, rol); return true; }
    catch (e) { setUsuarios(previo); alert("No se pudo actualizar el rol. " + e.message); return false; }
  };

  const renderEquipo = () => {
    const lista = usuario.modoDemo ? DEMOS.map(d=>({id:d.id,nombre:d.nombre,email:d.email,rol:d.rol})) : usuarios;
    const pendientes = lista.filter(u=>u.rol==="pendiente");
    const rechazados = lista.filter(u=>u.rol==="rechazado");
    const miembros   = lista.filter(u=>u.rol!=="pendiente"&&u.rol!=="rechazado");
    const avatar = (u, color) => <div style={{width:34,height:34,borderRadius:"50%",background:color+"22",border:"1.5px solid "+color+"44",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,color,flexShrink:0}}>{(u.nombre||u.email||"?")[0].toUpperCase()}</div>;
    const datos = u => <div style={{flex:1,minWidth:140}}><div style={{fontSize:13,fontWeight:600}}>{u.nombre||"(sin nombre)"}{u.id===usuario.id&&<span style={{fontSize:10,color:BRAND.muted,fontWeight:400}}> · tú</span>}</div><div style={{fontSize:11,color:BRAND.muted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.email}</div>{u.rol==="pantalla"&&<div style={{fontSize:10,color:"#0F766E",marginTop:2}}>📺 Solo ve el pizarrón: sin teléfonos, costos ni fotos</div>}</div>;
    const aprobar  = u => cambiarRol(u.id, rolAprobar[u.id] || "asesor");
    const rechazar = u => { if (!confirm(`¿Rechazar la solicitud de ${u.nombre || u.email}? No podrá ver nada del taller.`)) return; cambiarRol(u.id, "rechazado"); };
    return (
      <div style={{maxWidth:680,display:"flex",flexDirection:"column",gap:14}}>
        {!usuario.modoDemo&&PLANES_CON_LIGA.length>0&&(
          <div style={S.card}>
            <div style={{fontSize:13,fontWeight:700,color:BRAND.accent,marginBottom:4}}>Suscripción de RepairX</div>
            <div style={{fontSize:12,color:BRAND.muted,marginBottom:12}}>El pago se cobra solo cada mes con Mercado Pago, y puedes cancelarlo cuando quieras desde tu cuenta de Mercado Pago. Para identificar tu pago, usa el mismo correo con el que entras a RepairX: <b style={{color:BRAND.text}}>{usuario.email}</b>.</div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {PLANES_CON_LIGA.map(p=>(
                <div key={p.liga} style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",background:BRAND.bg,borderRadius:10,padding:"0.65rem 0.85rem"}}>
                  <div style={{flex:1,minWidth:150}}><div style={{fontSize:13,fontWeight:700}}>{p.nombre}</div>{p.precio&&<div style={{fontSize:12,color:BRAND.muted}}>{p.precio}</div>}</div>
                  <a href={p.liga.trim()} target="_blank" rel="noopener noreferrer" style={{...S.btn,textDecoration:"none",display:"inline-block"}}>Pagar con Mercado Pago</a>
                </div>
              ))}
            </div>
          </div>
        )}
        <div style={S.card}>
          <div style={{fontSize:13,fontWeight:700,color:BRAND.accent,marginBottom:8}}>Código del taller</div>
          <div style={{fontSize:12,color:BRAND.muted,marginBottom:10}}>Compártelo con tus colaboradores para que se registren en {usuario.tallerNombre||"tu taller"}. Quedarán como <b>solicitud pendiente</b> hasta que los apruebes aquí. Trátalo como una contraseña: no lo publiques.</div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <div style={{flex:1,background:BRAND.bg,border:"0.5px solid "+BRAND.border,borderRadius:9,padding:"0.6rem 0.9rem",fontSize:18,fontWeight:800,letterSpacing:3,color:BRAND.accent,fontFamily:"monospace",overflow:"hidden",textOverflow:"ellipsis"}}>{usuario.taller||"—"}</div>
            <button style={S.btn} onClick={()=>{ try{navigator.clipboard?.writeText(usuario.taller);}catch(_){} }}>Copiar</button>
          </div>
          {usuario.modoDemo&&<div style={{fontSize:11,color:"#F59E0B",marginTop:8}}>En modo demo el código es de ejemplo y la gestión de roles está deshabilitada.</div>}
        </div>

        {pendientes.length>0&&(
          <div style={{...S.card,border:"1.5px solid "+BRAND.blue+"55"}}>
            <div style={{fontSize:13,fontWeight:700,color:BRAND.blue,marginBottom:4}}>🔔 Solicitudes pendientes ({pendientes.length})</div>
            <div style={{fontSize:12,color:BRAND.muted,marginBottom:12}}>Se registraron con el código de tu taller y no ven nada hasta que las apruebes. Si no reconoces a alguien, recházalo.</div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {pendientes.map(u=>(
                <div key={u.id} style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",background:BRAND.bg,borderRadius:10,padding:"0.6rem 0.85rem"}}>
                  {avatar(u, BRAND.blue)}{datos(u)}
                  <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                    <select value={rolAprobar[u.id]||"asesor"} onChange={e=>setRolAprobar(p=>({...p,[u.id]:e.target.value}))} title="Rol con el que entrará" style={{...S.select,width:150}}>
                      {Object.keys(ROLES).map(k=><option key={k} value={k}>{ROLES[k].label}</option>)}
                    </select>
                    <button style={{...S.btnGreen,padding:"0.45rem 0.9rem"}} onClick={()=>aprobar(u)}>Aprobar</button>
                    <button style={{...S.btnDanger,padding:"0.45rem 0.9rem"}} onClick={()=>rechazar(u)}>Rechazar</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={S.card}>
          <div style={{fontSize:13,fontWeight:700,color:BRAND.accent,marginBottom:12}}>Usuarios del taller ({miembros.length})</div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {miembros.map(u=>{ const r=ROLES[u.rol]||{label:u.rol,color:BRAND.muted}; const yo=u.id===usuario.id; return (
              <div key={u.id} style={{display:"flex",alignItems:"center",gap:10,background:BRAND.bg,borderRadius:10,padding:"0.6rem 0.85rem"}}>
                {avatar(u, r.color)}{datos(u)}
                <select value={u.rol} disabled={yo} onChange={e=>{ const v=e.target.value; if(v==="rechazado"&&!confirm(`¿Quitarle el acceso a ${u.nombre||u.email}? Dejará de ver las órdenes del taller de inmediato.`)) return; cambiarRol(u.id,v); }} style={{...S.select,width:150,opacity:yo?0.5:1,cursor:yo?"not-allowed":"pointer"}}>
                  {Object.keys(ROLES).map(k=><option key={k} value={k}>{ROLES[k].label}</option>)}
                  {!yo&&<option value="rechazado">⛔ Quitar acceso</option>}
                </select>
              </div>
            );})}
            {miembros.length===0&&<div style={{textAlign:"center",color:BRAND.muted,fontSize:13,padding:"1.5rem 0"}}>Aún no hay otros usuarios. Comparte el código para que se unan.</div>}
          </div>
          <div style={{fontSize:10,color:BRAND.muted,marginTop:10}}>No puedes cambiar tu propio rol para evitar quedarte sin acceso de administrador.</div>
        </div>

        {rechazados.length>0&&(
          <div style={S.card}>
            <div style={{fontSize:12,fontWeight:700,color:BRAND.muted,marginBottom:8}}>Sin acceso: rechazados o dados de baja ({rechazados.length})</div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {rechazados.map(u=>(
                <div key={u.id} style={{display:"flex",alignItems:"center",gap:10,opacity:0.75}}>
                  {avatar(u, BRAND.muted)}{datos(u)}
                  <button style={S.btnSm()} onClick={()=>cambiarRol(u.id,"pendiente")}>Reconsiderar</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const titulos={dashboard:"",ordenes:"Órdenes de Trabajo",pizarron:"Pizarrón del taller",refacciones:"Refacciones",historial:"Historial",nueva:"Nueva Orden",terminadas:"Siniestros Terminados",exportar:"Exportar a Excel",equipo:"Equipo"};

  return (
    <div style={{fontFamily:FUENTE_APP,minHeight:"100vh",width:"100%",background:BRAND.bg,color:BRAND.text}}>
      <ModalTerminar /><ModalCerrar /><ModalRetroceder /><ModalCobro /><ModalPago />
      {avisoSync&&<div style={{position:"fixed",bottom:errorSync?76:16,left:"50%",transform:"translateX(-50%)",zIndex:961,background:"#1E3A8A",border:"0.5px solid #1E40AF",borderRadius:10,padding:"10px 14px",display:"flex",alignItems:"center",gap:12,maxWidth:"90vw",boxShadow:"0 8px 24px #00000055"}}><span style={{fontSize:12,color:"#DBEAFE"}}>ℹ️ {avisoSync}</span><button onClick={()=>setAvisoSync("")} style={{background:"none",border:"none",color:"#DBEAFE",cursor:"pointer",fontSize:14,flexShrink:0}}>✕</button></div>}
      {errorSync&&<div style={{position:"fixed",bottom:16,left:"50%",transform:"translateX(-50%)",zIndex:960,background:"#7F1D1D",border:"0.5px solid #991b1b",borderRadius:10,padding:"10px 14px",display:"flex",alignItems:"center",gap:12,maxWidth:"90vw",boxShadow:"0 8px 24px #00000088"}}><span style={{fontSize:12,color:"#fca5a5"}}>⚠️ {errorSync}</span><button onClick={()=>setErrorSync("")} style={{background:"none",border:"none",color:"#fca5a5",cursor:"pointer",fontSize:14,flexShrink:0}}>✕</button></div>}
      {cargando&&<div style={{position:"fixed",inset:0,background:"#000000cc",zIndex:980,display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{background:BRAND.card2,border:"0.5px solid "+BRAND.border,borderRadius:14,padding:"1.5rem 2rem",textAlign:"center"}}><div style={{fontSize:24,marginBottom:8}}>⏳</div><div style={{fontSize:14,fontWeight:600,color:BRAND.text}}>Cargando órdenes...</div></div></div>}
      {subiendo&&<div style={{position:"fixed",inset:0,background:"#000000aa",zIndex:950,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(3px)"}}><div style={{background:BRAND.card2,border:"0.5px solid "+BRAND.border,borderRadius:14,padding:"1.25rem 1.75rem",textAlign:"center"}}><div style={{fontSize:22,marginBottom:8}}>⏳</div><div style={{fontSize:13,fontWeight:600,color:BRAND.text}}>{subiendo}</div></div></div>}
      {fotoAmpliada&&<div style={S.overlay} onClick={()=>setFotoAmpliada(null)}><ImagenArchivo item={fotoAmpliada} token={usuario?.token} alt={fotoAmpliada.nombre} style={{maxWidth:"90vw",maxHeight:"85vh",borderRadius:12,objectFit:"contain"}} /><button style={{position:"absolute",top:16,right:16,background:"#1D2733",border:"none",color:"#fff",borderRadius:"50%",width:32,height:32,cursor:"pointer",fontSize:16}} onClick={()=>setFotoAmpliada(null)}>✕</button></div>}
      <Sidebar vista={vista} setVista={(v)=>{setVista(v);setGBusqueda("");}} setOrdenSel={setOrdenSel} hLen={historial.length} tLen={ordenesTerminadas.length} desktop={desktop} esAdmin={puedePerm(usuario,"todo")} logo={usuario.logo} tallerNombre={usuario.tallerNombre||usuario.taller} pendientes={pendientesEquipo} refPend={resRef.pendientes} refAtrasadas={resRef.atrasadas} pizAlertas={resPiz.vencida + resPiz.hoy} />
      <div style={{marginLeft:desktop?240:0,display:"flex",flexDirection:"column",minHeight:"100vh",minWidth:0}}>
        <div style={{position:"sticky",top:0,zIndex:100,flexShrink:0,boxShadow:"0 1px 8px rgba(29,39,51,0.08)"}}>
          <div style={{padding:desktop?"0 1rem":"0 1rem 0 58px",minHeight:48,borderBottom:"0.5px solid "+BRAND.border,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,background:BRAND.card}}>
            <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
              {!desktop&&<span style={{fontSize:15,fontWeight:900,letterSpacing:2}}><LogoRX alto={14} /></span>}
              {titulos[vista]&&desktop&&<span style={{fontSize:13,fontWeight:600,color:BRAND.text}}>{titulos[vista]}</span>}
              {MODO_DEMO&&<span style={{fontSize:10,background:"#F59E0B22",color:"#F59E0B",borderRadius:10,padding:"2px 8px",border:"0.5px solid #F59E0B44"}}>DEMO</span>}
            </div>
            <UsuarioBadge usuario={usuario} onLogout={cerrarSesion} onLogoutTodos={cerrarSesionEnTodos} />
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
                {vista==="refacciones" && renderRefacciones()}
                {vista==="pizarron"   && renderPizarron()}
                {vista==="exportar"   && <ExportarExcel ordenes={[...ordenes,...ordenesCobro,...ordenesCobradas,...ordenesTerminadas,...historial]} S={S} />}
              </>}
        </div>
      </div>
    </div>
  );
}
