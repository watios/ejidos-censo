// =========================================================================
// 1. INICIALIZACIÓN DE BASE DE DATOS LOCAL CON DEXIE.JS
// =========================================================================
const db = new Dexie('ControlEjidosDB');
db.version(1).stores({
  localidades: '++id, nombre',
  sectores: '++id, localidadId, nombre',
  hogares: '++id, cedula, nombre, localidadId, sectorId, costera, hijos'
});

let activeSearchQuery = '';
let selectedImportData = null;
let importType = ''; 
let deferredPrompt = null; // Captura el evento de instalación nativo (Windows/Móvil)

const localidadesPredefinidas = ["San Pedro", "Bichar", "Guinima", "Amparo", "Guamache", "La Uva", "Zulica"];

document.addEventListener('DOMContentLoaded', async () => {
  await verificarYPrecargarLocalidades();
  actualizarDesplegablesLocalidades();
  loadHogares();
  loadLocalidadesUI();
  loadSectoresUI();
  inicializarManejadorGPS();
  inicializarInstalacionPWA(); // Inicializa el detector de instalación para Windows/Móviles
});

async function verificarYPrecargarLocalidades() {
  const count = await db.localidades.count();
  if (count === 0) {
    for (let loc of localidadesPredefinidas) {
      await db.localidades.add({ nombre: loc.trim() });
    }
  }
}

// =========================================================================
// GPS DECIMAL A GRADOS, MINUTOS Y SEGUNDOS (GMS)
// =========================================================================
function convertirDecimalAGMS(lat, lng) {
  function formatComponent(val, isLat) {
    const absVal = Math.abs(val);
    const grados = Math.floor(absVal);
    const minutosFloat = (absVal - grados) * 60;
    const minutos = Math.floor(minutosFloat);
    const segundos = ((minutosFloat - minutos) * 60).toFixed(2);
    
    let direccion = '';
    if (isLat) {
      direccion = val >= 0 ? 'N' : 'S';
    } else {
      direccion = val >= 0 ? 'E' : 'O';
    }
    return `${grados}°${minutos}'${segundos}"${direccion}`;
  }
  return `${formatComponent(lat, true)} ${formatComponent(lng, false)}`;
}

function inicializarManejadorGPS() {
  const btnGps = document.getElementById('btnCapturarGPS');
  const inputCoords = document.getElementById('hogarCoordenadas');

  btnGps.addEventListener('click', () => {
    if (!navigator.geolocation) {
      showStatus('❌ Su dispositivo no soporta geolocalización nativa.');
      return;
    }
    btnGps.innerText = '📡 Buscando...';
    btnGps.disabled = true;

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        inputCoords.value = convertirDecimalAGMS(lat, lng);
        btnGps.innerText = '📍 Capturar GPS';
        btnGps.disabled = false;
        showStatus('✅ Ubicación capturada con éxito.');
      },
      (error) => {
        btnGps.innerText = '📍 Capturar GPS';
        btnGps.disabled = false;
        showStatus('❌ Active el GPS y conceda los permisos del equipo.');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

// =========================================================================
// ENRUTAMIENTO Y MENÚ
// =========================================================================
document.querySelectorAll('.menu-item').forEach(item => {
  item.addEventListener('click', () => {
    const targetId = item.dataset.target;
    if (!targetId) return;

    const label = item.querySelector('.menu-label').innerText;
    document.getElementById('main-menu').classList.remove('active');
    document.getElementById(targetId).classList.add('active');
    document.getElementById('btnBackToMenu').style.visibility = 'visible';
    document.getElementById('appTitle').innerText = label;

    if (targetId === 'sec-hogares') { loadHogares(); resetFormHogar(); }
    if (targetId === 'sec-localidades') { loadLocalidadesUI(); resetFormLoc(); }
    if (targetId === 'sec-sectores') { loadSectoresUI(); resetFormSec(); }
    if (targetId === 'sec-reportes') { document.getElementById('cardResultadosReporte').style.display = 'none'; }
    actualizarDesplegablesLocalidades();
  });
});

document.getElementById('btnBackToMenu').addEventListener('click', () => {
  document.querySelectorAll('.section-content').forEach(sec => sec.classList.remove('active'));
  document.getElementById('main-menu').classList.add('active');
  document.getElementById('btnBackToMenu').style.visibility = 'hidden';
  document.getElementById('appTitle').innerText = '🏠 Control de Ejidos';
});

function showStatus(message, duration = 3000) {
  const toast = document.getElementById('toastStatus');
  toast.innerText = message;
  toast.style.display = 'block';
  setTimeout(() => { toast.style.display = 'none'; }, duration);
}

// =========================================================================
// DESPLEGABLES DINÁMICOS
// =========================================================================
async function actualizarDesplegablesLocalidades() {
  const locs = await db.localidades.orderBy('nombre').toArray();
  const optionsHtml = '<option value="">Seleccione...</option>' + 
    locs.map(l => `<option value="${l.id}">${escapeHtml(l.nombre)}</option>`).join('');
  
  document.getElementById('hogarLocalidad').innerHTML = optionsHtml;
  document.getElementById('secLocalidadBelongs').innerHTML = optionsHtml;
  document.getElementById('repLocalidad').innerHTML = '<option value="">-- Todas --</option>' + locs.map(l => `<option value="${l.id}">${escapeHtml(l.nombre)}</option>`).join('');
}

document.getElementById('hogarLocalidad').addEventListener('change', async (e) => {
  await actualizarDesplegableSectores(parseInt(e.target.value), 'hogarSector', 'Seleccione un Sector...');
});

document.getElementById('repLocalidad').addEventListener('change', async (e) => {
  const locId = parseInt(e.target.value);
  if (!locId) {
    document.getElementById('repSector').innerHTML = '<option value="">Seleccione una Localidad primero...</option>';
    return;
  }
  await actualizarDesplegableSectores(locId, 'repSector', '-- Todos los Sectores --');
});

async function actualizarDesplegableSectores(localidadId, targetSelectId, defaultText) {
  const selectNode = document.getElementById(targetSelectId);
  if (!localidadId) {
    selectNode.innerHTML = `<option value="">${defaultText}</option>`;
    return;
  }
  const secs = await db.sectores.where('localidadId').equals(localidadId).toArray();
  if (secs.length === 0) {
    selectNode.innerHTML = '<option value="">No existen sectores aquí...</option>';
  } else {
    selectNode.innerHTML = `<option value="">${defaultText}</option>` + 
      secs.map(s => `<option value="${s.id}">${escapeHtml(s.nombre)}</option>`).join('');
  }
}

// =========================================================================
// GESTIÓN DEL PADRÓN DE HOGARES
// =========================================================================
async function loadHogares() {
  let list = await db.hogares.toArray();
  const container = document.getElementById('hogaresList');
  if (list.length === 0) {
    container.innerHTML = '<p style="text-align:center;color:#666;">No hay hogares registrados en este dispositivo.</p>';
    return;
  }
  if (activeSearchQuery.trim() !== '') {
    const q = activeSearchQuery.toLowerCase().trim();
    list = list.filter(h => h.nombre.toLowerCase().includes(q) || h.cedula.toLowerCase().includes(q));
  }
  const mapLoc = new Map((await db.localidades.toArray()).map(l => [l.id, l.nombre]));
  const mapSec = new Map((await db.sectores.toArray()).map(s => [s.id, s.nombre]));

  container.innerHTML = list.map(h => `
    <div class="person-item">
      <div class="person-info" style="flex: 1; min-width: 200px;">
        <div class="nombre">${escapeHtml(h.nombre)}</div>
        <div class="cedula">C.I: <strong>${escapeHtml(h.cedula)}</strong> | Casa: ${escapeHtml(h.casaNo) || 'N/A'}</div>
        <div class="cedula" style="color:#1976D2; font-weight:500;">📍 ${escapeHtml(mapLoc.get(h.localidadId) || 'Indefinida')} - 🧭 ${escapeHtml(mapSec.get(h.sectorId) || 'Sin Sector')}</div>
        ${h.coordenadas ? `<div class="cedula" style="color:#2E7D32;">🌐 Coords: <code>${escapeHtml(h.coordenadas)}</code></div>` : ''}
      </div>
      <div class="action-buttons">
        <button class="btn-action" onclick="editarHogar(${h.id})">Editar</button>
        <button class="btn-action delete" onclick="eliminarHogar(${h.id})">Eliminar</button>
      </div>
    </div>
  `).join('');
}

document.getElementById('searchHogarInput').addEventListener('input', (e) => { activeSearchQuery = e.target.value; loadHogares(); });

document.getElementById('btnGuardarHogar').addEventListener('click', async () => {
  const idVal = document.getElementById('hogarId').value;
  const locId = parseInt(document.getElementById('hogarLocalidad').value);
  const secId = parseInt(document.getElementById('hogarSector').value);
  const nombre = document.getElementById('hogarNombre').value.trim();
  const cedula = document.getElementById('hogarCedula').value.trim();
  const telf = document.getElementById('hogarTelefono').value.trim();

  if (!locId || !secId || !nombre || !cedula || !telf) { showStatus('⚠️ Por favor completa todos los campos requeridos (*)'); return; }

  const idAct = idVal ? parseInt(idVal) : null;
  const existeCedula = await db.hogares.where('cedula').equalsIgnoreCase(cedula).first();
  if (existeCedula && (!idAct || existeCedula.id !== idAct)) { showStatus('🚨 Error: Esta Cédula ya está registrada.'); return; }

  const datosHogar = {
    localidadId: locId, sectorId: secId, nombre, cedula, nacionalidad: document.getElementById('hogarNacionalidad').value,
    rif: document.getElementById('hogarRif').value.trim(), correo: document.getElementById('hogarCorreo').value.trim(), telefono: telf, 
    casaNo: document.getElementById('hogarCasaNo').value.trim(), organizacion: document.getElementById('hogarOrganizacion').value, 
    costera: document.getElementById('hogarCostera').value, hijos: parseInt(document.getElementById('hogarHijos').value) || 0, 
    pareja: document.getElementById('hogarPareja').value, anosConst: parseInt(document.getElementById('hogarAnosConst').value) || 0,
    coordenadas: document.getElementById('hogarCoordenadas').value.trim()
  };

  if (idAct) { await db.hogares.update(idAct, datosHogar); showStatus('🔄 Registro actualizado'); } 
  else { await db.hogares.add(datosHogar); showStatus('✅ Registro guardado'); }
  resetFormHogar(); loadHogares();
});

async function editarHogar(id) {
  const h = await db.hogares.get(id); if (!h) return;
  document.getElementById('hogarId').value = h.id;
  document.getElementById('hogarLocalidad').value = h.localidadId;
  await actualizar遊esplegableSectores(h.localidadId, 'hogarSector', 'Seleccione un Sector...');
  document.getElementById('hogarSector').value = h.sectorId;
  document.getElementById('hogarNombre').value = h.nombre;
  document.getElementById('hogarCedula').value = h.cedula;
  document.getElementById('hogarTelefono').value = h.telefono;
  document.getElementById('hogarCoordenadas').value = h.coordenadas || '';
  document.getElementById('btnCancelarHogarEdicion').style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
document.getElementById('btnCancelarHogarEdicion').addEventListener('click', resetFormHogar);

function resetFormHogar() {
  document.getElementById('hogarId').value = ''; document.getElementById('hogarNombre').value = '';
  document.getElementById('hogarCedula').value = ''; document.getElementById('hogarTelefono').value = '';
  document.getElementById('hogarCoordenadas').value = '';
  document.getElementById('hogarSector').innerHTML = '<option value="">Seleccione una Localidad primero...</option>';
  document.getElementById('btnCancelarHogarEdicion').style.display = 'none';
}

async function eliminarHogar(id) { if (confirm('¿Eliminar este registro?')) { await db.hogares.delete(id); loadHogares(); } }

// =========================================================================
// LOCALIDADES Y SECTORES (MANTENIMIENTO)
// =========================================================================
async function loadLocalidadesUI() {
  const locs = await db.localidades.orderBy('nombre').toArray();
  document.getElementById('localidadesList').innerHTML = locs.map(l => `
    <div class="person-item"><div class="person-info"><div class="nombre">${escapeHtml(l.nombre)}</div></div>
    <div class="action-buttons"><button class="btn-action delete" onclick="eliminarLoc(${l.id})">Eliminar</button></div></div>
  `).join('');
}
document.getElementById('btnGuardarLoc').addEventListener('click', async () => {
  const name = document.getElementById('locNombre').value.trim(); if (!name) return;
  await db.localidades.add({ nombre: name }); document.getElementById('locNombre').value = ''; loadLocalidadesUI();
});
async function eliminarLoc(id) { if (confirm('¿Eliminar localidad?')) { await db.sectores.where('localidadId').equals(id).delete(); await db.localidades.delete(id); loadLocalidadesUI(); } }

async function loadSectoresUI() {
  const secs = await db.sectores.toArray();
  const mapLoc = new Map((await db.localidades.toArray()).map(l => [l.id, l.nombre]));
  document.getElementById('sectoresList').innerHTML = secs.map(s => `
    <div class="person-item"><div class="person-info"><div class="nombre">${escapeHtml(s.nombre)}</div><div class="cedula">Localidad: ${escapeHtml(mapLoc.get(s.localidadId))}</div></div>
    <div class="action-buttons"><button class="btn-action delete" onclick="eliminarSec(${s.id})">Eliminar</button></div></div>
  `).join('');
}
document.getElementById('btnGuardarSec').addEventListener('click', async () => {
  const locId = parseInt(document.getElementById('secLocalidadBelongs').value);
  const name = document.getElementById('secNombre').value.trim();
  if (locId && name) { await db.sectores.add({ localidadId: locId, nombre: name }); document.getElementById('secNombre').value = ''; loadSectoresUI(); }
});
async function eliminarSec(id) { if (confirm('¿Eliminar sector?')) { await db.sectores.delete(id); loadSectoresUI(); } }

// =========================================================================
// REPORTES E IMPORTACIONES JSON
// =========================================================================
document.getElementById('repTipo').addEventListener('change', (e) => {
  const tipo = e.target.value;
  document.getElementById('divRepFiltroLocalidad').style.display = (tipo === 'localidad' || tipo === 'sector') ? 'block' : 'none';
  document.getElementById('divRepFiltroSector').style.display = (tipo === 'sector') ? 'block' : 'none';
});

document.getElementById('btnGenerarReporte').addEventListener('click', async () => {
  const tipo = document.getElementById('repTipo').value;
  const locFiltro = parseInt(document.getElementById('repLocalidad').value);
  const secFiltro = parseInt(document.getElementById('repSector').value);
  let data = await db.hogares.toArray();
  const mapLoc = new Map((await db.localidades.toArray()).map(l => [l.id, l.nombre]));
  const mapSec = new Map((await db.sectores.toArray()).map(s => [s.id, s.nombre]));

  if (tipo === 'localidad' && locFiltro) data = data.filter(h => h.localidadId === locFiltro);
  if (tipo === 'sector' && secFiltro) data = data.filter(h => h.sectorId === secFiltro);
  if (tipo === 'costera') data = data.filter(h => h.costera === 'Si');
  if (tipo === 'hijos') data = data.filter(h => h.hijos > 0);

  document.getElementById('reporteContenidoTabla').innerHTML = `
    <table class="report-table">
      <thead><tr><th>Cédula</th><th>Nombre</th><th>Ubicación</th><th>Coordenadas GMS</th></tr></thead>
      <tbody>${data.map(h => `<tr><td>${escapeHtml(h.cedula)}</td><td>${escapeHtml(h.nombre)}</td><td>${escapeHtml(mapLoc.get(h.localidadId))}<br>${escapeHtml(mapSec.get(h.sectorId))}</td><td><code>${escapeHtml(h.coordenadas) || 'N/A'}</code></td></tr>`).join('')}</tbody>
    </table>`;
  document.getElementById('cardResultadosReporte').style.display = 'block';
  document.getElementById('btnImprimirReporte').style.display = data.length > 0 ? 'inline-block' : 'none';
});
document.getElementById('btnImprimirReporte').addEventListener('click', () => window.print());

function descargarArchivoJson(o, n) {
  const blob = new Blob([JSON.stringify(o, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = n; a.click();
}
document.getElementById('btnExpSoloHogares').addEventListener('click', async () => {
  descargarArchivoJson({ formato: "solo_hogares", hogares: await db.hogares.toArray() }, `Hogares-${new Date().toISOString().slice(0,10)}.json`);
});
document.getElementById('btnExpLocSectores').addEventListener('click', async () => {
  descargarArchivoJson({ formato: "estructura_geografica", localidades: await db.localidades.toArray(), sectores: await db.sectores.toArray() }, `Estructura-${new Date().toISOString().slice(0,10)}.json`);
});

document.getElementById('btnClickFile').addEventListener('click', () => document.getElementById('fileInputImport').click());
document.getElementById('fileInputImport').addEventListener('change', (e) => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      selectedImportData = JSON.parse(evt.target.result);
      importType = selectedImportData.formato;
      document.getElementById('btnProcesarImportacion').style.display = 'block';
      document.getElementById('fileInfoLabel').innerText = file.name;
    } catch { showStatus('JSON inválido'); }
  };
  reader.readAsText(file);
});
document.getElementById('btnProcesarImportacion').addEventListener('click', async () => {
  if (importType === "solo_hogares" && selectedImportData.hogares) {
    for (let h of selectedImportData.hogares) {
      let ex = await db.hogares.where('cedula').equalsIgnoreCase(h.cedula).first();
      if (!ex) await db.hogares.add(h);
    }
  }
  showStatus('Datos consolidados.'); loadHogares();
});

document.getElementById('btnResetearTodo').addEventListener('click', async () => {
  if (confirm('¿Borrar absolutamente todo?')) { await db.hogares.clear(); await db.sectores.clear(); location.reload(); }
});

function escapeHtml(str) { return str ? String(str).replace(/[&<>'\"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[m])) : ''; }

// =========================================================================
// MANEJADOR DE INSTALACIÓN UNIVERSAL (WINDOWS NATIVO / MÓVILES)
// =========================================================================
function inicializarInstalacionPWA() {
  const banner = document.getElementById('bannerInstalacion');
  const btnInstalar = document.getElementById('btnInstalarApp');
  const btnCerrar = document.getElementById('btnCerrarBanner');

  // Captura el disparador en Windows y Android
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); 
    deferredPrompt = e; 
    banner.style.display = 'block'; // Muestra el cintillo superior de forma limpia
  });

  btnInstalar.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    banner.style.display = 'none'; 
    deferredPrompt.prompt(); // Despliega la ventana de confirmación oficial de Windows/Chrome
    
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      showStatus('🚀 ¡Instalación completada! Revisa tu Escritorio.');
    }
    deferredPrompt = null;
  });

  btnCerrar.addEventListener('click', () => { banner.style.display = 'none'; });

  window.addEventListener('appinstalled', () => {
    banner.style.display = 'none';
    deferredPrompt = null;
    showStatus('🎉 Aplicación instalada con éxito en el sistema.');
  });
}

// Registro automático del Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(() => console.log('Service Worker Operativo para modo Offline'))
      .catch(err => console.error('Error Service Worker', err));
  });
}