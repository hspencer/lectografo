// Acceso con Google + bootstrap de Persona/Biblioteca (specs/multiusuario.allium).
// Modulo aparte de app.js: solo gatilla la app principal una vez autenticado.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, collection, getDoc, getDocs, setDoc, updateDoc, addDoc,
  arrayUnion, serverTimestamp, getCountFromServer,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  projectId: "lectografo",
  appId: "1:89307511697:web:0820610c8e3dfb9833f830",
  storageBucket: "lectografo.firebasestorage.app",
  apiKey: "AIzaSyBW4gRh2OiFDtkivywICf_qpg1WYZ0DvUg",
  authDomain: "lectografo.firebaseapp.com",
  messagingSenderId: "89307511697",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Estado minimo que app.js puede leer una vez "lectografo:auth-listo" dispara.
window.lectografoAuth = { uid: null, nombre: null, email: null, bibliotecaId: null, esAdmin: false };

const gate = document.getElementById("auth-gate");
const btnGoogle = document.getElementById("auth-btn-google");
const userBadge = document.getElementById("auth-user-nombre");
const btnSignOut = document.getElementById("auth-btn-signout");
const btnImportar = document.getElementById("btn-importar");
const importFileInput = document.getElementById("import-file-input");
const btnAdmin = document.getElementById("btn-admin");
const adminPanel = document.getElementById("admin-panel");
const adminPanelBody = document.getElementById("admin-panel-body");
const adminPanelCerrar = document.getElementById("admin-panel-cerrar");

btnGoogle?.addEventListener("click", () => {
  signInWithPopup(auth, new GoogleAuthProvider()).catch((err) => {
    console.error("Error de acceso con Google:", err);
    alert("No se pudo iniciar sesión: " + err.message);
  });
});

btnSignOut?.addEventListener("click", () => signOut(auth));

// RegistrarPersona (multiusuario.allium): crea Persona y, si todavia no es
// propietaria de ninguna Biblioteca, crea la suya con una Membresia propietaria.
//
// Que bibliotecas tiene cada persona se guarda en personas/{uid}.bibliotecaIds
// (documento que la propia persona siempre puede leer y escribir), no se
// descubre con un collectionGroup query sobre membresias: ese query exige
// leer membresias de OTRA biblioteca antes de saber a cual perteneces, y las
// reglas de Firestore niegan un `list` entre colecciones que no puede
// demostrarse valido de antemano (huevo y gallina) -- ver notas en
// firestore.rules.
async function asegurarPersonaYBiblioteca(user) {
  const personaRef = doc(db, "personas", user.uid);
  const personaSnap = await getDoc(personaRef);

  if (!personaSnap.exists()) {
    const bibId = await crearBibliotecaPropia(user);
    await setDoc(personaRef, {
      nombre: user.displayName || user.email,
      email: user.email,
      registradaEn: serverTimestamp(),
      bibliotecaIds: [bibId],
    });
    return bibId;
  }

  const existentes = personaSnap.data().bibliotecaIds || [];
  if (existentes.length > 0) return existentes[0];

  const bibId = await crearBibliotecaPropia(user);
  await updateDoc(personaRef, { bibliotecaIds: arrayUnion(bibId) });
  return bibId;
}

async function crearBibliotecaPropia(user) {
  const bibRef = doc(collection(db, "bibliotecas"));
  await setDoc(bibRef, {
    nombre: user.displayName || user.email,
    creadaEn: serverTimestamp(),
    creadoPor: user.uid,
  });
  await setDoc(doc(db, "bibliotecas", bibRef.id, "membresias", user.uid), {
    personaUid: user.uid,
    rol: "propietaria",
    otorgadaPor: null,
    otorgadaEn: serverTimestamp(),
  });
  return bibRef.id;
}

// Importar texto (transcripcion.allium: ingesta txt/md) directo a Firestore,
// sin extraccion todavia -- "procesar con Gemini" es un paso aparte.
const FORMATOS = { ".md": "markdown", ".markdown": "markdown", ".txt": "texto" };
async function importarArchivo(file) {
  const { uid, bibliotecaId } = window.lectografoAuth;
  if (!uid || !bibliotecaId) return;
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  const formato = FORMATOS[ext] || "texto";
  const texto = await file.text();
  const titulo = file.name.replace(/\.[^.]+$/, "");
  await addDoc(collection(db, "bibliotecas", bibliotecaId, "transcripciones"), {
    titulo, texto, formato,
    creadaPor: uid,
    creadaEn: serverTimestamp(),
  });
}

btnImportar?.addEventListener("click", () => importFileInput?.click());
importFileInput?.addEventListener("change", async () => {
  const file = importFileInput.files?.[0];
  importFileInput.value = "";
  if (!file) return;
  try {
    await importarArchivo(file);
    alert(`"${file.name}" importado a tu biblioteca.`);
  } catch (err) {
    console.error("Error al importar:", err);
    alert("No se pudo importar el archivo: " + err.message);
  }
});

// Consola de administración (solo persona.esAdmin): personas registradas y
// cuantos elementos tiene cada una en su(s) biblioteca(s).
async function cargarConsolaAdmin() {
  adminPanelBody.innerHTML = '<p class="muted" style="font-size:var(--sn-fs-xs)">Cargando…</p>';
  const personasSnap = await getDocs(collection(db, "personas"));
  const filas = await Promise.all(personasSnap.docs.map(async (p) => {
    const persona = p.data();
    const bibliotecaIds = persona.bibliotecaIds || [];
    const conteos = await Promise.all(bibliotecaIds.map(async (bibId) => {
      try {
        const agg = await getCountFromServer(collection(db, "bibliotecas", bibId, "transcripciones"));
        return agg.data().count;
      } catch {
        return 0;
      }
    }));
    const total = conteos.reduce((a, b) => a + b, 0);
    return { nombre: persona.nombre || "(sin nombre)", email: persona.email || "", total };
  }));

  adminPanelBody.innerHTML = filas.map((f) => `
    <div class="admin-persona-row">
      <span>
        <span class="admin-persona-nombre">${f.nombre}</span>
        <span class="admin-persona-email">${f.email}</span>
      </span>
      <span class="admin-persona-count">${f.total} elemento${f.total === 1 ? "" : "s"}</span>
    </div>
  `).join("") || '<p class="muted" style="font-size:var(--sn-fs-xs)">Sin personas registradas.</p>';
}

btnAdmin?.addEventListener("click", () => {
  adminPanel.hidden = !adminPanel.hidden;
  if (!adminPanel.hidden) cargarConsolaAdmin().catch((err) => {
    adminPanelBody.innerHTML = `<p class="muted" style="font-size:var(--sn-fs-xs)">Error: ${err.message}</p>`;
  });
});
adminPanelCerrar?.addEventListener("click", () => { adminPanel.hidden = true; });

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.lectografoAuth = { uid: null, nombre: null, email: null, bibliotecaId: null, esAdmin: false };
    if (gate) gate.hidden = false;
    if (userBadge) userBadge.textContent = "";
    if (btnImportar) btnImportar.hidden = true;
    if (btnAdmin) btnAdmin.hidden = true;
    if (adminPanel) adminPanel.hidden = true;
    return;
  }

  let bibliotecaId = null;
  let esAdmin = false;
  try {
    bibliotecaId = await asegurarPersonaYBiblioteca(user);
    esAdmin = (await getDoc(doc(db, "personas", user.uid))).data()?.esAdmin === true;
  } catch (err) {
    console.error("No se pudo preparar Persona/Biblioteca:", err);
    alert("Accediste, pero no se pudo crear tu biblioteca: " + err.message);
    return;
  }

  window.lectografoAuth = {
    uid: user.uid,
    nombre: user.displayName || user.email,
    email: user.email,
    bibliotecaId,
    esAdmin,
  };
  if (gate) gate.hidden = true;
  if (userBadge) userBadge.textContent = user.displayName || user.email;
  if (btnImportar) btnImportar.hidden = false;
  if (btnAdmin) btnAdmin.hidden = !esAdmin;
  window.dispatchEvent(new CustomEvent("lectografo:auth-listo", { detail: window.lectografoAuth }));
});
