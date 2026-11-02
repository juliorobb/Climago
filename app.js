const pages = ["home","radar","forecast","alerts","myday","vehicle","locations","prevention","more","settings"];
function showPage(name){
  if(!pages.includes(name)) name="home";
  document.querySelectorAll(".page").forEach(p=>p.classList.toggle("active",p.id===`page-${name}`));
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.page===name || (["vehicle","locations","prevention","settings"].includes(name)&&b.dataset.page==="more")));
  window.scrollTo({top:0,behavior:"smooth"});
}
document.addEventListener("click",e=>{
  const nav=e.target.closest("[data-page]");
  if(nav){e.preventDefault();showPage(nav.dataset.page);}
});
document.getElementById("location-shortcut").addEventListener("click",()=>showPage("locations"));

const dialog=document.getElementById("simple-dialog"), dialogTitle=document.getElementById("dialog-title"), dialogContent=document.getElementById("dialog-content"), dialogSave=document.getElementById("dialog-save");
let dialogAction=null;
function openDialog(title,fields,action){
  dialogTitle.textContent=title;dialogContent.innerHTML=fields;dialogAction=action;dialog.showModal();
}
document.getElementById("add-vehicle-record").addEventListener("click",()=>{
  openDialog("Nuevo registro",`<label>Tipo de trabajo<select id="record-type"><option>Service / cambio de aceite</option><option>Filtros</option><option>Correa de distribución</option><option>Batería</option><option>Reparación</option><option>Lavado</option><option>Otro</option></select></label><label>Descripción<input id="record-description" placeholder="Ej.: cambio de aceite y filtros"></label><label>Fecha<input id="record-date" type="date"></label><label>Kilometraje (opcional)<input id="record-km" type="number" placeholder="Ej.: 85000"></label><label>Costo (opcional)<input id="record-cost" type="number" placeholder="Ej.: 45000"></label>`,()=>{
    const item={type:val("record-type"),description:val("record-description"),date:val("record-date"),km:val("record-km"),cost:val("record-cost")};
    const arr=JSON.parse(localStorage.getItem("climagoVehicleRecords")||"[]");arr.unshift(item);localStorage.setItem("climagoVehicleRecords",JSON.stringify(arr));renderRecords();
  });
});
function val(id){return document.getElementById(id)?.value?.trim()||""}
dialogSave.addEventListener("click",e=>{e.preventDefault();if(dialogAction)dialogAction();dialog.close();});
function renderRecords(){
  const host=document.getElementById("vehicle-records"),arr=JSON.parse(localStorage.getItem("climagoVehicleRecords")||"[]");
  if(!arr.length){host.innerHTML='<div class="empty-state">Todavía no hay registros. Podés guardar cambios de aceite, filtros, correa, batería, reparaciones, lavados y sus costos.</div>';return;}
  host.innerHTML=arr.map(r=>`<div class="record"><div><b>${escapeHtml(r.type)}</b><small>${escapeHtml(r.description)} · ${escapeHtml(r.date||"Fecha no indicada")}${r.km?` · ${escapeHtml(r.km)} km`:""}</small></div><strong>${r.cost?`$${escapeHtml(r.cost)}`:"—"}</strong></div>`).join("");
}
function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
renderRecords();

document.getElementById("add-task").addEventListener("click",()=>{
  openDialog("Nueva actividad",`<label>Actividad<input id="task-name" placeholder="Ej.: llevar el auto al service"></label><label>Fecha<input id="task-date" type="date"></label><label>Hora<input id="task-time" type="time"></label>`,()=>{
    const name=val("task-name");if(!name)return;
    const row=document.createElement("div");row.className="task";row.innerHTML=`<span class="check">•</span><div><b>${escapeHtml(name)}</b><small>${escapeHtml(val("task-date"))} ${escapeHtml(val("task-time"))}</small></div>`;
    document.getElementById("task-list").appendChild(row);
  });
});

const LOCATIONS_KEY="climagoLocations";
const PRIMARY_KEY="climagoPrimaryLocation";
let selectedTag="Casa";
function readLocations(){
  try {
    const data=JSON.parse(localStorage.getItem(LOCATIONS_KEY)||"[]");
    return Array.isArray(data)?data.map((l,i)=>({
      id:l.id||`legacy-${i}-${String(l.name||"lugar").slice(0,12)}`,
      name:String(l.name||"Lugar guardado"),tag:String(l.tag||"Otro"),
      lat:l.lat===null||l.lat===undefined?null:Number(l.lat),
      lon:l.lon===null||l.lon===undefined?null:Number(l.lon)
    })):[];
  } catch { return []; }
}
function saveLocations(list){localStorage.setItem(LOCATIONS_KEY,JSON.stringify(list));}
function primaryId(list){const stored=localStorage.getItem(PRIMARY_KEY);return list.some(l=>l.id===stored)?stored:(list[0]?.id||"");}
function setPrimary(id){localStorage.setItem(PRIMARY_KEY,id);renderLocations();}
function updateCurrentLocationLabel(list){
  const primary=list.find(l=>l.id===primaryId(list));
  document.getElementById("current-location-label").textContent=primary?`${primary.name} ▾`:"Agregar ubicación ▾";
}
document.querySelectorAll("[data-tag]").forEach(b=>b.addEventListener("click",()=>{
  selectedTag=b.dataset.tag;
  document.querySelectorAll("[data-tag]").forEach(x=>x.classList.toggle("selected",x===b));
}));
document.getElementById("save-location").addEventListener("click",()=>{
  const name=val("location-search");
  if(!name){alert("Escribí el nombre de una localidad o lugar.");return;}
  const list=readLocations(),id=`place-${Date.now()}`;
  list.push({id,name,tag:selectedTag,lat:null,lon:null});saveLocations(list);
  if(!localStorage.getItem(PRIMARY_KEY))localStorage.setItem(PRIMARY_KEY,id);
  document.getElementById("location-search").value="";renderLocations();
});
function renderLocations(){
  const host=document.getElementById("saved-locations"),list=readLocations(),primary=primaryId(list);
  if(primary&&!localStorage.getItem(PRIMARY_KEY))localStorage.setItem(PRIMARY_KEY,primary);
  host.innerHTML=list.length?list.map(l=>`<div class="saved-location">
    <span>${l.tag==="Casa"?"🏠":l.tag==="Trabajo"?"💼":l.tag==="Auto"?"🚗":"📍"}</span>
    <div><b>${escapeHtml(l.name)}</b><small>${escapeHtml(l.tag)}${Number.isFinite(l.lat)&&Number.isFinite(l.lon)?` · ${l.lat.toFixed(5)}, ${l.lon.toFixed(5)}`:""}${l.id===primary?" · Principal":""}</small></div>
    <div class="location-actions">${l.id!==primary?`<button class="text-button make-primary" data-id="${escapeHtml(l.id)}">Hacer principal</button>`:""}<button class="text-button remove-location" data-id="${escapeHtml(l.id)}" aria-label="Eliminar ${escapeHtml(l.name)}">×</button></div>
  </div>`).join(""):'<div class="empty-state">Todavía no guardaste lugares. Agregá uno por nombre o guardá tu ubicación actual.</div>';
  host.querySelectorAll(".remove-location").forEach(b=>b.addEventListener("click",()=>{
    const next=readLocations().filter(l=>l.id!==b.dataset.id);saveLocations(next);
    if(localStorage.getItem(PRIMARY_KEY)===b.dataset.id)localStorage.setItem(PRIMARY_KEY,next[0]?.id||"");
    renderLocations();
  }));
  host.querySelectorAll(".make-primary").forEach(b=>b.addEventListener("click",()=>setPrimary(b.dataset.id)));
  updateCurrentLocationLabel(list);
}
renderLocations();
document.getElementById("use-location").addEventListener("click",()=>{
  if(!navigator.geolocation){alert("Este navegador no permite obtener la ubicación.");return;}
  const button=document.getElementById("use-location");
  button.disabled=true;button.textContent="Obteniendo ubicación…";
  navigator.geolocation.getCurrentPosition(pos=>{
    const lat=pos.coords.latitude,lon=pos.coords.longitude,list=readLocations(),id=`gps-${Date.now()}`;
    list.push({id,name:"Mi ubicación actual",tag:selectedTag,lat,lon});saveLocations(list);
    if(!localStorage.getItem(PRIMARY_KEY)||!list.some(l=>l.id===localStorage.getItem(PRIMARY_KEY)))localStorage.setItem(PRIMARY_KEY,id);
    button.disabled=false;button.textContent="⌖ Guardar mi ubicación actual";renderLocations();
    alert(`Ubicación guardada. Coordenadas: ${lat.toFixed(5)}, ${lon.toFixed(5)}.`);
  },err=>{
    button.disabled=false;button.textContent="⌖ Guardar mi ubicación actual";
    const message=err.code===1?"Permiso denegado. Podés habilitar la ubicación en los ajustes del teléfono.":err.code===3?"La ubicación tardó demasiado. Intentá nuevamente.":"No se pudo obtener la ubicación. Revisá los permisos del teléfono.";
    alert(message);
  },{enableHighAccuracy:true,timeout:15000,maximumAge:60000});
});
if("serviceWorker" in navigator && location.protocol.startsWith("http")){window.addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js").catch(()=>{}));}
