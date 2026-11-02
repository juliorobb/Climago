const pages = ["home","radar","forecast","alerts","myday","vehicle","locations","prevention","more","settings"];
function showPage(name){
  if(!pages.includes(name)) name="home";
  document.querySelectorAll(".page").forEach(p=>p.classList.toggle("active",p.id===`page-${name}`));
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.page===name || (name==="alerts"&&b.dataset.page==="alerts") || (["vehicle","locations","prevention","settings"].includes(name)&&b.dataset.page==="more")));
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
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
renderRecords();

document.getElementById("add-task").addEventListener("click",()=>{
  openDialog("Nueva actividad",`<label>Actividad<input id="task-name" placeholder="Ej.: llevar el auto al service"></label><label>Fecha<input id="task-date" type="date"></label><label>Hora<input id="task-time" type="time"></label>`,()=>{
    const name=val("task-name");if(!name)return;
    const row=document.createElement("div");row.className="task";row.innerHTML=`<span class="check">•</span><div><b>${escapeHtml(name)}</b><small>${escapeHtml(val("task-date"))} ${escapeHtml(val("task-time"))}</small></div>`;
    document.getElementById("task-list").appendChild(row);
  });
});

let selectedTag="Casa";
document.querySelectorAll("[data-tag]").forEach(b=>b.addEventListener("click",()=>{selectedTag=b.dataset.tag;document.querySelectorAll("[data-tag]").forEach(x=>x.classList.toggle("selected",x===b));}));
document.getElementById("save-location").addEventListener("click",()=>{
  const name=val("location-search");if(!name){alert("Escribí una localidad o dirección.");return;}
  const arr=JSON.parse(localStorage.getItem("climagoLocations")||"[]");arr.push({name,tag:selectedTag});localStorage.setItem("climagoLocations",JSON.stringify(arr));renderLocations();document.getElementById("location-search").value="";
});
function renderLocations(){
  const host=document.getElementById("saved-locations"),arr=JSON.parse(localStorage.getItem("climagoLocations")||"[]");
  host.innerHTML='<div class="saved-location"><span>🏠</span><div><b>Córdoba, Argentina</b><small>Principal · Datos de demostración</small></div><span class="check">✓</span></div>'+arr.map((l,i)=>`<div class="saved-location"><span>📍</span><div><b>${escapeHtml(l.name)}</b><small>${escapeHtml(l.tag)}</small></div><button class="text-button remove-location" data-index="${i}" aria-label="Eliminar">×</button></div>`).join("");
  host.querySelectorAll(".remove-location").forEach(b=>b.addEventListener("click",()=>{const a=JSON.parse(localStorage.getItem("climagoLocations")||"[]");a.splice(Number(b.dataset.index),1);localStorage.setItem("climagoLocations",JSON.stringify(a));renderLocations();}));
}
renderLocations();
document.getElementById("use-location").addEventListener("click",()=>{
  if(!navigator.geolocation){alert("Este navegador no permite obtener la ubicación.");return;}
  navigator.geolocation.getCurrentPosition(pos=>alert(`Ubicación obtenida: ${pos.coords.latitude.toFixed(3)}, ${pos.coords.longitude.toFixed(3)}. La conexión con el servicio de mapas se incorporará más adelante.`),()=>alert("No se pudo obtener la ubicación. Revisá los permisos o elegí una localidad manualmente."),{enableHighAccuracy:true,timeout:10000});
});
if("serviceWorker" in navigator && location.protocol.startsWith("http")){window.addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js").catch(()=>{}));}
