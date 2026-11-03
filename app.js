const pages = ["home","radar","forecast","alerts","myday","vehicle","locations","prevention","more","settings"];
function showPage(name){
  if(!pages.includes(name)) name="home";
  document.querySelectorAll(".page").forEach(p=>p.classList.toggle("active",p.id===`page-${name}`));
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.page===name || (["vehicle","locations","prevention","settings"].includes(name)&&b.dataset.page==="more")));
  window.scrollTo({top:0,behavior:"smooth"});
  if(name==="radar") setTimeout(()=>{initWeatherMap();setTimeout(initRainViewerRadar,500);},120);
}
document.addEventListener("click",e=>{
  const nav=e.target.closest("[data-page]");
  if(nav){e.preventDefault();showPage(nav.dataset.page);}
});
document.getElementById("location-shortcut").addEventListener("click",()=>showPage("radar"));

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
document.getElementById("save-location").addEventListener("click",async()=>{
  const name=val("location-search");
  if(!name){alert("Escribí el nombre de una localidad o lugar.");return;}
  const button=document.getElementById("save-location");button.disabled=true;button.textContent="Buscando…";
  let lat=null,lon=null,displayName=name;
  try{const geo=await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=es&format=json`);const result=await geo.json();if(result.results?.length){lat=result.results[0].latitude;lon=result.results[0].longitude;displayName=[result.results[0].name,result.results[0].admin1,result.results[0].country].filter(Boolean).join(", ");}}catch{}
  const list=readLocations(),id=`place-${Date.now()}`;
  list.push({id,name:displayName,tag:selectedTag,lat,lon});saveLocations(list);
  if(!localStorage.getItem(PRIMARY_KEY))localStorage.setItem(PRIMARY_KEY,id);
  document.getElementById("location-search").value="";button.disabled=false;button.textContent="＋ Agregar";renderLocations();
  if(primaryId(list)===id&&Number.isFinite(lat))loadWeather(lat,lon,displayName);
  if(!Number.isFinite(lat))alert("Guardamos el nombre, pero no encontramos sus coordenadas. Probá con localidad y provincia para consultar el clima de ese lugar.");
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
    const primary=readLocations().find(l=>l.id===primaryId(readLocations()));
    if(primary?.id===id)loadWeather(lat,lon,"Mi ubicación actual");
    if(weatherMap){weatherMap.setView([lat,lon],10);setMapMarker(lat,lon,"Mi ubicación actual");}
    alert(`Ubicación guardada. Coordenadas: ${lat.toFixed(5)}, ${lon.toFixed(5)}.`);
  },err=>{
    button.disabled=false;button.textContent="⌖ Guardar mi ubicación actual";
    const message=err.code===1?"Permiso denegado. Podés habilitar la ubicación en los ajustes del teléfono.":err.code===3?"La ubicación tardó demasiado. Intentá nuevamente.":"No se pudo obtener la ubicación. Revisá los permisos del teléfono.";
    alert(message);
  },{enableHighAccuracy:true,timeout:15000,maximumAge:60000});
});
if("serviceWorker" in navigator && location.protocol.startsWith("http")){window.addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js").catch(()=>{}));}


// Datos meteorológicos reales: Open-Meteo. Si no hay conexión, la app conserva una indicación clara.
const DEFAULT_COORDS={lat:-31.4167,lon:-64.1833,name:"Córdoba, Argentina"};
let activeCoords={...DEFAULT_COORDS},weatherMap=null,mapMarker=null;
const weatherText={0:"Despejado",1:"Mayormente despejado",2:"Parcialmente nublado",3:"Nublado",45:"Niebla",48:"Niebla con escarcha",51:"Llovizna ligera",53:"Llovizna",55:"Llovizna intensa",61:"Lluvia ligera",63:"Lluvia",65:"Lluvia intensa",71:"Nieve ligera",73:"Nieve",75:"Nieve intensa",80:"Chaparrones",81:"Chaparrones",82:"Chaparrones intensos",95:"Tormenta",96:"Tormenta con granizo",99:"Tormenta fuerte con granizo"};
function weatherEmoji(code){if([0,1].includes(code))return "☀️";if([2].includes(code))return "🌤️";if([3,45,48].includes(code))return "☁️";if([51,53,55,61,63,65,80,81,82].includes(code))return "🌧️";if([71,73,75].includes(code))return "❄️";if([95,96,99].includes(code))return "⛈️";return "🌤️";}
function recommendationFor(code,uv,wind){
  if([95,96,99].includes(code))return {title:"Tomá precauciones ante tormentas",description:"Resguardate en un lugar seguro y asegurá objetos que puedan volarse. Consultá los avisos oficiales.",icon:"🏠"};
  if([61,63,65,80,81,82].includes(code))return {title:"Preparate para la lluvia",description:"Organizá tus traslados y llevá protección para la lluvia. Revisá las condiciones de circulación.",icon:"🚗"};
  if(wind>=40)return {title:"Asegurá los objetos expuestos",description:"Guardá o sujetá macetas, toldos y elementos que puedan desplazarse por el viento.",icon:"🪴"};
  if(uv>=6)return {title:"Índice UV elevado",description:"Considerá protección solar, buscá sombra en las horas de mayor radiación y mantené una buena hidratación.",icon:"🧴"};
  if(code<=1 && uv>=3)return {title:"Cuidate del sol",description:"Usá protección solar si vas a estar al aire libre y mantenete hidratado.",icon:"🧴"};
  if(code===71||code===73||code===75)return {title:"Protegé las plantas del frío",description:"Si tenés plantas sensibles, considerá resguardarlas de las bajas temperaturas.",icon:"🌱"};
  return {title:"Organizá tus actividades",description:"Consultá el pronóstico antes de salir y elegí el momento más conveniente para tus planes.",icon:"📅"};
}
function getSelectedCoordinates(){
  try{const list=readLocations(),id=primaryId(list),place=list.find(x=>x.id===id);if(place&&Number.isFinite(place.lat)&&Number.isFinite(place.lon))return {lat:place.lat,lon:place.lon,name:place.name};}catch{}
  return {...DEFAULT_COORDS};
}

function setWeatherVisual(code,temperature,wind){
  const hero=document.querySelector('.weather-hero');
  const img=document.getElementById('weather-mascot');
  if(!hero||!img)return;
  let type='sun',label='soleado';
  if([95,96,99].includes(code)){type='storm';label='tormenta';}
  else if([71,73,75].includes(code)){type='cold';label='nieve';}
  else if([51,53,55,61,63,65,80,81,82].includes(code)){type='rain';label='lluvia';}
  else if([3,45,48].includes(code)){type='cloud';label='nublado';}
  else if(wind>=40){type='wind';label='viento';}
  else if(temperature>=35 && [0,1,2].includes(code)){type='heat';label='calor';}
  else if(temperature<=2){type='cold';label='frío';}
  hero.dataset.weather=type;
  img.src=`assets/mascot-${type}.png`;
  img.alt=`Mascota ClimaGo: ${label}`;
}

let weatherRequestId=0;
let weatherRefreshTimer=null;
let lastWeatherRefresh=0;
async function loadWeather(lat,lon,name){
  const requestId=++weatherRequestId;
  activeCoords={lat,lon,name:name||"Ubicación seleccionada"};
  if(typeof smnLoadAlerts==="function") smnLoadAlerts();
  const label=document.getElementById("current-location-label");if(label&&name)label.textContent=`${name} ▾`;
  const source=document.getElementById("weather-updated");if(source)source.textContent="Actualizando datos meteorológicos…";
  const url=`https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&hourly=temperature_2m,weather_code,uv_index&daily=weather_code,temperature_2m_max,temperature_2m_min,uv_index_max&forecast_days=7&timezone=auto`;
  try{
    const response=await fetch(url,{cache:"no-store"});if(!response.ok)throw new Error("No se pudo consultar el servicio meteorológico");const data=await response.json();
    if(requestId!==weatherRequestId)return;
    const c=data.current,h=data.hourly,d=data.daily,code=Number(c.weather_code),uvIndex=h.uv_index?.[Math.max(0,h.time.findIndex(t=>t>=c.time))]??d.uv_index_max?.[0]??0;
    lastWeatherRefresh=Date.now();
    setText("home-temperature",`${Math.round(c.temperature_2m)}°`);setText("home-condition",weatherText[code]||"Condiciones variables");setText("home-feels",`Sensación térmica: ${Math.round(c.apparent_temperature)}°`);setText("home-uv",`UV ${Math.round(uvIndex)}`);setText("home-wind",`${Math.round(c.wind_speed_10m)} km/h`);setText("home-humidity",`${Math.round(c.relative_humidity_2m)}%`);setWeatherVisual(code,Number(c.temperature_2m),Number(c.wind_speed_10m));
    if(source)source.textContent=`Datos meteorológicos · Open-Meteo · ${new Date().toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"})}`;
    const tip=recommendationFor(code,Number(uvIndex),Number(c.wind_speed_10m));setText("tip-heading",tip.title);setText("tip-description",tip.description);setText("tip-illustration",tip.icon);setText("prevention-tip-title",tip.title);setText("prevention-tip-text",tip.description);setText("prevention-tip-icon",tip.icon);
    renderHourly(h,c.time);renderDaily(d);
    setText("map-location-label",activeCoords.name);setText("map-weather-status",`${weatherText[code]||"Tiempo variable"} · ${Math.round(c.temperature_2m)}°`);setText("map-weather-detail",`Viento ${Math.round(c.wind_speed_10m)} km/h · Humedad ${Math.round(c.relative_humidity_2m)}%. Datos de Open-Meteo.`);
    if(weatherMap){setMapMarker(lat,lon,`${activeCoords.name}: ${Math.round(c.temperature_2m)}° · ${weatherText[code]||"Tiempo variable"}`);}
  }catch(error){
    if(requestId!==weatherRequestId)return;
    if(source)source.textContent="No se pudieron actualizar los datos. Revisá tu conexión.";
    setText("home-condition","Datos meteorológicos no disponibles");
    setText("map-weather-status","No se pudieron cargar los datos del tiempo");
  }
}
function refreshWeatherForActiveLocation(){
  const coords=activeCoords||getSelectedCoordinates();
  if(coords&&Number.isFinite(coords.lat)&&Number.isFinite(coords.lon))loadWeather(coords.lat,coords.lon,coords.name);
}
function startWeatherRefresh(){
  if(weatherRefreshTimer)clearInterval(weatherRefreshTimer);
  weatherRefreshTimer=setInterval(()=>{
    if(document.visibilityState==="visible")refreshWeatherForActiveLocation();
  },10*60*1000);
}
window.addEventListener("pageshow",()=>{
  if(Date.now()-lastWeatherRefresh>60*1000)refreshWeatherForActiveLocation();
  startWeatherRefresh();
});
document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState==="visible"&&Date.now()-lastWeatherRefresh>60*1000)refreshWeatherForActiveLocation();
});
function setText(id,value){const el=document.getElementById(id);if(el)el.textContent=value;}
function renderHourly(hourly,currentTime){const host=document.getElementById("home-hourly");if(!host||!hourly)return;let index=hourly.time.findIndex(t=>t>=currentTime);if(index<0)index=0;const items=[];for(let i=index;i<Math.min(index+4,hourly.time.length);i++){const date=new Date(hourly.time[i]);items.push(`<div class="hour"><small>${i===index?"Ahora":date.toLocaleTimeString("es-AR",{hour:"2-digit",hour12:false})+" h"}</small><span>${weatherEmoji(Number(hourly.weather_code[i]))}</span><b>${Math.round(hourly.temperature_2m[i])}°</b></div>`);}host.innerHTML=items.join("");}
function renderDaily(daily){const host=document.querySelector(".forecast-list");if(!host||!daily)return;host.innerHTML=daily.time.slice(1,7).map((date,i)=>`<div><b>${new Date(`${date}T12:00:00`).toLocaleDateString("es-AR",{weekday:"long"})}</b><span>${weatherEmoji(Number(daily.weather_code[i+1]))}</span><span>${Math.round(daily.temperature_2m_max[i+1])}° / ${Math.round(daily.temperature_2m_min[i+1])}°</span></div>`).join("");const today=document.querySelector(".forecast-today");if(today){const temp=daily.temperature_2m_max[0],min=daily.temperature_2m_min[0];today.querySelector("strong").textContent=`${Math.round(temp)}°`;today.querySelector(".big-weather").textContent=weatherEmoji(Number(daily.weather_code[0]));today.querySelector("p").textContent=`Máxima y mínima previstas · ${Math.round(temp)}° / ${Math.round(min)}° · Open-Meteo`;}}
function initWeatherMap(){
  if(!window.L){setText("map-weather-status","No se pudo cargar el componente del mapa. Revisá tu conexión.");return;}
  const coords=getSelectedCoordinates();activeCoords=coords;
  if(!weatherMap){weatherMap=L.map("weather-map",{zoomControl:true}).setView([coords.lat,coords.lon],9);L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(weatherMap);}
  setTimeout(()=>weatherMap.invalidateSize(),80);weatherMap.setView([coords.lat,coords.lon],9);setMapMarker(coords.lat,coords.lon,coords.name);loadWeather(coords.lat,coords.lon,coords.name);
}
function setMapMarker(lat,lon,label){if(!weatherMap)return;if(mapMarker)mapMarker.remove();mapMarker=L.marker([lat,lon]).addTo(weatherMap).bindPopup(escapeHtml(label));}
document.getElementById("radar-locate")?.addEventListener("click",()=>{
  const button=document.getElementById("radar-locate");if(!navigator.geolocation){setText("map-weather-status","Este dispositivo no permite acceder al GPS.");return;}
  button.disabled=true;button.textContent="Buscando…";
  navigator.geolocation.getCurrentPosition(pos=>{const {latitude:lat,longitude:lon}=pos.coords;button.disabled=false;button.textContent="⌖ Mi ubicación";activeCoords={lat,lon,name:"Mi ubicación actual"};weatherMap?.setView([lat,lon],11);setMapMarker(lat,lon,"Mi ubicación actual");loadWeather(lat,lon,"Mi ubicación actual");},err=>{button.disabled=false;button.textContent="⌖ Mi ubicación";setText("map-weather-status",err.code===1?"Permiso de ubicación denegado. Habilitalo en los ajustes del teléfono.":"No se pudo obtener la ubicación. Intentá nuevamente.");},{enableHighAccuracy:true,timeout:15000,maximumAge:60000});
});
async function initializeWeatherLocation(){
  const saved=readLocations().find(place=>place.id===primaryId(readLocations())&&Number.isFinite(place.lat)&&Number.isFinite(place.lon));
  if(saved){loadWeather(saved.lat,saved.lon,saved.name);return;}
  if(navigator.geolocation){
    navigator.geolocation.getCurrentPosition(position=>{
      const {latitude,longitude}=position.coords;
      loadWeather(latitude,longitude,"Mi ubicación actual");
    },()=>{
      const fallback=getSelectedCoordinates();loadWeather(fallback.lat,fallback.lon,fallback.name);
    },{enableHighAccuracy:false,timeout:10000,maximumAge:10*60*1000});
  }else{
    const fallback=getSelectedCoordinates();loadWeather(fallback.lat,fallback.lon,fallback.name);
  }
}
initializeWeatherLocation();
startWeatherRefresh();


/* ClimaGo MVP: alertas generales CAP + avisos ACP del SMN */
const SMN_DIAGNOSTIC_URL = "https://climago-smn-diagnostico.juliorobbles01.workers.dev/";
let smnRefreshHandle = null;
let smnRequestId = 0;
let smnLastPayload = null;
function smnZoneLabel(zones) {
  if (Array.isArray(zones)) return zones.map(z => typeof z === "string" ? z : (z && (z.areaDesc || z.name)) || "").filter(Boolean).join(" · ");
  return String(zones || "Zona indicada por el SMN");
}
function smnFormatTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("es-AR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"});
}
function smnRender(payload) {
  const cap = payload.cap || {};
  const capRows = Array.isArray(cap.alerts) ? cap.alerts : [];
  const allRows = capRows.map(a => ({
    ...a,
    feedType:"CAP",
    title:a.headline || a.event || "Alerta meteorológica",
    zones:(a.areas||[]).map(x=>x.description).filter(Boolean),
    affectsLocation:!!a.affectsLocation,
    date:a.onset||a.effective||a.sent,
    endDate:a.expires,
    sourceLabel:"SMN · Alertas oficiales CAP"
  }));
  const relevant = allRows.filter(a => a.affectsLocation);
  smnLastPayload = payload;
  window.climagoLastSmnAlerts = allRows;
  const host = document.getElementById("official-alert-list");
  if (!host) return;
  const capComplete = cap.coverageComplete === true && cap.dataStatus === "ok";
  const capAvailable = ["ok","partial","rate_limited"].includes(cap.dataStatus);
  const summary = document.getElementById("alerts-summary");
  if (summary) summary.classList.toggle("has-alert", relevant.length > 0);
  const coverageText = capComplete ? "Feed oficial CAP consultado completamente" :
    cap.dataStatus === "rate_limited" ? "Consulta parcial: el SMN aplicó un límite temporal" :
    capAvailable ? "Feed oficial CAP consultado parcialmente" : "Feed oficial CAP no disponible";
  setText("alerts-summary-title", relevant.length ? relevant.length + " aviso(s) para tu ubicación" : capComplete ? "Sin alertas generales vigentes para el punto" : "No se pudo confirmar el estado completo de alertas");
  setText("alerts-summary-detail", coverageText + ". Se comparan las coordenadas con las áreas publicadas por el SMN.");
  setText("home-alert-text", relevant.length ? relevant.length + " aviso(s) para tu zona" : capComplete ? "Sin alertas generales vigentes" : "Consulta incompleta: revisá los avisos oficiales");
  setText("home-alert-detail", capComplete ? "Consulta completa del feed CAP del SMN. Mantenete atento a las actualizaciones." : "La consulta fue parcial o no estuvo disponible. No se debe interpretar como ausencia de riesgo.");
  const risk = document.getElementById("home-alert-status");
  if (risk) {
    risk.classList.toggle("risk-neutral", relevant.length === 0 && capComplete);
    risk.classList.toggle("risk-danger", relevant.length > 0);
  }
  if (!allRows.length) {
    const message = capComplete ? "El feed CAP del SMN se consultó completo y no informa alertas vigentes para este punto." : "No hay avisos disponibles para mostrar. La consulta del feed CAP no fue completa; esto no significa que no exista riesgo meteorológico.";
    host.innerHTML = '<div class="panel empty-state">'+escapeHtml(message)+'</div>';
  } else {
    host.innerHTML = allRows.slice().sort((a,b) => Number(b.affectsLocation)-Number(a.affectsLocation)).map(a => {
      const title = escapeHtml(a.title || "Aviso meteorológico");
      const zones = escapeHtml(smnZoneLabel(a.zones));
      const state = a.affectsLocation ? "AFECTA TU UBICACIÓN" : "OTRA ZONA";
      const severity = String(a.severity || "").toLowerCase();
      const cls = ["extreme","severe"].includes(severity) ? "danger" : ["moderate"].includes(severity) ? "warning" : "watch";
      const start = smnFormatTime(a.date), end = smnFormatTime(a.endDate);
      const description = a.description ? '<p>'+escapeHtml(a.description)+'</p>' : '';
      return '<article class="official-alert-card '+cls+(a.affectsLocation?' for-location':'')+'"><div class="official-alert-top"><span>⚠</span><small>'+state+'</small></div><b>'+title+'</b>'+description+'<p>'+zones+'</p><div class="official-alert-time">Vigencia: '+start+' a '+end+'</div><small class="official-alert-source">'+escapeHtml(a.sourceLabel||"SMN")+'</small></article>';
    }).join("");
  }
  const stamp = payload.testedAt || cap.generatedAt || Date.now();
  setText("alerts-updated", "Actualizado " + new Date(stamp).toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"}));
}
async function smnLoadAlerts() {
  const requestId = ++smnRequestId;
  const coords = activeCoords && Number.isFinite(activeCoords.lat) && Number.isFinite(activeCoords.lon) ? {...activeCoords} : getSelectedCoordinates();
  const host = document.getElementById("official-alert-list");
  setText("alerts-summary-detail","Consultando el feed oficial CAP del SMN para "+(coords.name||"la ubicación seleccionada")+"…");
  try {
    const url = new URL(SMN_DIAGNOSTIC_URL);
    url.searchParams.set("resource","alerts");
    url.searchParams.set("lat",coords.lat);
    url.searchParams.set("lon",coords.lon);
    const response = await fetch(url.toString(),{cache:"no-store"});
    const cap = await response.json().catch(()=>({dataStatus:"unavailable",coverageComplete:false,alerts:[]}));
    if(requestId!==smnRequestId)return;
    if(!response.ok && !["partial","rate_limited"].includes(cap.dataStatus)) throw new Error("SMN HTTP "+response.status);
    smnRender({cap,testedAt:new Date().toISOString(),location:coords});
  } catch(error) {
    if(requestId!==smnRequestId)return;
    setText("alerts-summary-title","Avisos temporalmente no disponibles");
    setText("alerts-summary-detail","No se pudo consultar el feed CAP del SMN. No se interpreta como ausencia de riesgo.");
    setText("home-alert-text","Avisos oficiales temporalmente no disponibles");
    setText("home-alert-detail","No se debe interpretar como ausencia de riesgo.");
    const risk=document.getElementById("home-alert-status");
    if(risk){risk.classList.remove("risk-neutral");risk.classList.remove("risk-danger");}
    if(host)host.innerHTML='<div class="panel empty-state">No se pudieron cargar los avisos oficiales del SMN. Intentá actualizar más tarde.</div>';
    setText("alerts-updated","Sin actualización");
  }
}
document.getElementById("refresh-alerts")?.addEventListener("click",smnLoadAlerts);
document.querySelectorAll('[data-page="alerts"]').forEach(el=>el.addEventListener("click",()=>smnLoadAlerts()));
smnLoadAlerts();
smnRefreshHandle=setInterval(()=>{if(document.visibilityState==="visible")smnLoadAlerts();},5*60*1000);

/* Prototipo de radar RainViewer: solo histórico reciente, sin nowcast */
let rainRadarFrames=[],rainRadarLayer=null,rainRadarIndex=0,rainRadarMapRef=null,rainRadarTimer=null,smnRadarLayer=null,rainRadarHost="https://tilecache.rainviewer.com";
async function initRainViewerRadar(){
  if(!weatherMap||!window.L)return;
  rainRadarMapRef=weatherMap;
  const status=document.getElementById("map-weather-status");
  try{
    if(status)status.textContent="Consultando imágenes de radar…";
    const response=await fetch("https://api.rainviewer.com/public/weather-maps.json",{cache:"no-store"});
    if(!response.ok)throw new Error("RainViewer HTTP "+response.status);
    const data=await response.json();
    const frames=data.radar?.past||[];
    if(!frames.length)throw new Error("No hay imágenes históricas disponibles.");
    rainRadarFrames=frames;rainRadarHost=data.host||rainRadarHost;
    const slider=document.getElementById("radar-frame-slider");
    slider.max=String(frames.length-1);slider.value=String(frames.length-1);slider.disabled=false;
    rainRadarIndex=frames.length-1;
    showRainViewerFrame(rainRadarIndex,rainRadarHost);
    if(status)status.textContent="Radar de precipitación · RainViewer (prototipo)";
    const play=document.getElementById("radar-play");if(play)play.disabled=false;
    setText("map-weather-detail","Imágenes de radar de los últimos 120 minutos. Actualización aproximada cada 10 minutos. Fuente: RainViewer.");
    setText("radar-frame-label","Imágenes recientes · "+frames.length+" pasos");
  }catch(error){
    const play=document.getElementById("radar-play");if(play)play.disabled=true;
    if(status)status.textContent="Radar no disponible en este momento";
    setText("map-weather-detail","No se pudo obtener la secuencia de RainViewer. El mapa base sigue disponible.");
    setText("radar-frame-time","Sin datos");
  }
}
function showRainViewerFrame(index,host){
  if(!rainRadarFrames.length||!rainRadarMapRef)return;
  rainRadarIndex=Math.max(0,Math.min(index,rainRadarFrames.length-1));
  const frame=rainRadarFrames[rainRadarIndex];
  const base=host||rainRadarHost;
  const url=base+frame.path+"/256/{z}/{x}/{y}/2/1_1.png";
  if(rainRadarLayer)rainRadarLayer.remove();
  rainRadarLayer=L.tileLayer(url,{tileSize:256,opacity:.68,transparent:true,maxNativeZoom:7,maxZoom:19,attribution:'Weather data © <a href="https://www.rainviewer.com/">RainViewer</a>'});
  rainRadarLayer.addTo(rainRadarMapRef);
  const date=new Date(frame.time*1000);
  setText("radar-frame-time",date.toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"})+" · "+date.toLocaleDateString("es-AR",{day:"2-digit",month:"2-digit"}));
  const slider=document.getElementById("radar-frame-slider");if(slider)slider.value=String(rainRadarIndex);
}
document.getElementById("radar-frame-slider")?.addEventListener("input",e=>showRainViewerFrame(Number(e.target.value)));
document.getElementById("radar-play")?.addEventListener("click",()=>{
  const button=document.getElementById("radar-play");
  if(rainRadarTimer){clearInterval(rainRadarTimer);rainRadarTimer=null;button.textContent="▶ Reproducir";return;}
  if(!rainRadarFrames.length)return;
  button.textContent="Ⅱ Pausar";
  rainRadarTimer=setInterval(()=>{const next=(rainRadarIndex+1)%rainRadarFrames.length;showRainViewerFrame(next);},700);
});
document.getElementById("radar-toggle-rain")?.addEventListener("click",()=>{
  const on=!!rainRadarLayer;
  if(on){rainRadarLayer.remove();rainRadarLayer=null;document.getElementById("radar-toggle-rain").classList.remove("active");}
  else{document.getElementById("radar-toggle-rain").classList.add("active");initRainViewerRadar();}
});
document.getElementById("radar-toggle-alerts")?.addEventListener("click",()=>{
  const button=document.getElementById("radar-toggle-alerts");
  if(smnRadarLayer){smnRadarLayer.remove();smnRadarLayer=null;button.classList.remove("active");return;}
  const capAlerts=Array.isArray(smnLastPayload?.cap?.alerts)?smnLastPayload.cap.alerts:[];
  // Dibujar únicamente las áreas de avisos que incluyen el punto consultado.
  const relevantAlerts=capAlerts.filter(alert=>alert.affectsLocation);
  const features=relevantAlerts.flatMap(alert=>(alert.areas||[])
    .filter(area=>area.affected&&area.geometry)
    .map(area=>({type:"Feature",properties:{title:alert.headline||alert.event||"Alerta SMN",zone:area.description||""},geometry:area.geometry})));
  if(!features.length){setText("map-weather-detail","Los avisos CAP recibidos todavía no incluyen geometrías para dibujar en el mapa.");return;}
  smnRadarLayer=L.geoJSON({type:"FeatureCollection",features},{style:()=>({color:"#ffb45c",weight:2,fillColor:"#ff784f",fillOpacity:.16})}).addTo(weatherMap);
  button.classList.add("active");
});
