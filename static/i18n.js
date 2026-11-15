// i18n del "chrome" estático de la app (topbar, menú de cuenta, configuración,
// biblioteca). Los textos generados dinámicamente dentro de app.js (tarjetas,
// modales de detalle, mensajes de error del servidor) quedan en español por
// ahora -- primera instancia: cubre lo que ve cualquier persona sin iniciar
// sesión y el chrome permanente, no cada cadena del editor.
const DICCIONARIO = {
  es: {
    "topbar.volver":        "Volver a la biblioteca",
    "topbar.importar":      "Importar",
    "topbar.buscar":        "Buscar concepto…",
    "tab.mapa":              "Mapa",
    "tab.conceptos":         "Conceptos",
    "tab.relaciones":        "Relaciones",
    "tab.texto":             "Texto",
    "auth.cuenta":           "Cuenta",
    "auth.google":           "Continuar con Google",
    "auth.lectores":         "Lectores",
    "auth.lectores.titulo":  "Personas registradas",
    "auth.config":           "Configuración",
    "auth.salir":            "Salir",
    "auth.idioma":           "Idioma",
    "biblioteca.vacia":      "No hay textos disponibles.",
    "biblioteca.vacia.ayuda": "Añade archivos .txt a la carpeta transcripts/.",
    "biblioteca.publica.vacia": "Todavía no hay textos públicos.",
    "biblioteca.publica.ayuda": "Inicia sesión para ver y crear tu propia biblioteca.",
    "config.cerrar":         "Cerrar",
  },
  en: {
    "topbar.volver":        "Back to library",
    "topbar.importar":      "Import",
    "topbar.buscar":        "Search concept…",
    "tab.mapa":              "Map",
    "tab.conceptos":         "Concepts",
    "tab.relaciones":        "Relations",
    "tab.texto":             "Text",
    "auth.cuenta":           "Account",
    "auth.google":           "Continue with Google",
    "auth.lectores":         "Readers",
    "auth.lectores.titulo":  "Registered readers",
    "auth.config":           "Settings",
    "auth.salir":            "Sign out",
    "auth.idioma":           "Language",
    "biblioteca.vacia":      "No texts available.",
    "biblioteca.vacia.ayuda": "Add .txt files to the transcripts/ folder.",
    "biblioteca.publica.vacia": "No public texts yet.",
    "biblioteca.publica.ayuda": "Sign in to see and build your own library.",
    "config.cerrar":         "Close",
  },
};

const IDIOMAS = Object.keys(DICCIONARIO);
let idiomaActual = localStorage.getItem("lectografo:idioma") || "";
if (!IDIOMAS.includes(idiomaActual)) {
  idiomaActual = navigator.language?.toLowerCase().startsWith("en") ? "en" : "es";
}

export function t(clave) {
  return DICCIONARIO[idiomaActual]?.[clave] ?? DICCIONARIO.es[clave] ?? clave;
}

export function idioma() { return idiomaActual; }

export function aplicarIdioma(lang) {
  if (lang && IDIOMAS.includes(lang) && lang !== idiomaActual) {
    idiomaActual = lang;
    localStorage.setItem("lectografo:idioma", lang);
  }
  document.documentElement.lang = idiomaActual;
  document.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-title]").forEach(el => {
    const texto = t(el.dataset.i18nTitle);
    el.title = texto;
    el.setAttribute("aria-label", texto);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll(".idioma-btn").forEach(b => b.classList.toggle("active", b.dataset.lang === idiomaActual));
  window.dispatchEvent(new CustomEvent("lectografo:idioma-cambiado", { detail: idiomaActual }));
}

// Listener directo (no delegado en document): el menú de cuenta detiene la
// propagación de sus propios clics para no cerrarse solo, así que un
// listener en document nunca vería este clic.
document.querySelectorAll(".idioma-btn").forEach(btn => {
  btn.addEventListener("click", () => aplicarIdioma(btn.dataset.lang));
});

window.lectografoT = t;
window.lectografoIdioma = idioma;
aplicarIdioma();
