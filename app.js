const pages = ["home","radar","forecast","alerts","myday","vehicle","locations","prevention","more","settings"];
function showPage(name){
  if(!pages.includes(name)) name="home";
  document.querySelectorAll(".page").forEach(p=>p.classList.toggle("active",p.id===`page-${name}`));
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.page===name || (["vehicle","locations","prevention","settings"].includes(name)&&b.dataset.page==="more")));
  window.scrollTo({top:0,behavior:"smooth"});
  if(name==="radar") setTimeout(initWeatherMap,120);
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

// Alertas oficiales SMN / CAP.
// El listado distingue avisos vigentes, programados, vencidos y cancelados.
// Los datos incompletos nunca se presentan como ausencia de riesgo.
function formatSmnDate(value){
  if(!value)return "No informada";
  const date=new Date(value);
  return Number.isNaN(date.getTime())?String(value):date.toLocaleString("es-AR",{dateStyle:"short",timeStyle:"short"});
}
function localizeSmnValue(value,kind){
  const key=String(value||"").toLowerCase();
  const translations={
    severity:{extreme:"Extrema",severe:"Severa",moderate:"Moderada",minor:"Leve",unknown:"Sin clasificar"},
    urgency:{immediate:"Inmediata",expected:"Prevista",future:"Futura",past:"Pasada",unknown:"No informada"},
    certainty:{observed:"Observada",likely:"Probable",possible:"Posible",unlikely:"Poco probable",unknown:"No informada"}
  };
  return translations[kind]?.[key]||String(value||"");
}
function smnElement(tag,className,text){
  const node=document.createElement(tag);
  if(className)node.className=className;
  if(text!==undefined)node.textContent=String(text);
  return node;
}
function getSmnAlertState(alert){
  const current=String(alert.state||"unconfirmed").toLowerCase();
  if(current==="cancelled"||String(alert.status||"").toLowerCase()==="cancel"||String(alert.messageType||"").toLowerCase()==="cancel")return "cancelled";
  const expiry=alert.expires?new Date(alert.expires):null;
  if(expiry&&!Number.isNaN(expiry.getTime())&&expiry.getTime()<=Date.now())return "expired";
  const effective=alert.effective||alert.onset;
  const start=effective?new Date(effective):null;
  if(start&&!Number.isNaN(start.getTime())&&start.getTime()>Date.now())return "scheduled";
  return current;
}
function createSmnAlertCard(alert){
  const card=smnElement("article","smn-alert-card");
  const top=smnElement("div","smn-alert-top");
  const title=smnElement("b","",alert.headline||alert.event||alert.title||"Aviso meteorológico");
  const state=getSmnAlertState(alert);
  const labels={active:"VIGENTE",scheduled:"PRÓXIMO",expired:"VENCIDO",cancelled:"CANCELADO",unconfirmed:"VIGENCIA A CONFIRMAR",not_currently_listed:"YA NO FIGURA EN EL FEED"};
  const badge=smnElement("span","smn-alert-badge",labels[state]||"ESTADO NO VERIFICADO");
  badge.dataset.state=state;
  top.append(title,badge);
  card.append(top);
  const severity=[
    localizeSmnValue(alert.severity,"severity"),
    localizeSmnValue(alert.urgency,"urgency"),
    localizeSmnValue(alert.certainty,"certainty")
  ].filter(Boolean).join(" · ");
  if(severity)card.append(smnElement("p","smn-alert-severity",severity));
  if(alert.description||alert.instruction){
    if(alert.description)card.append(smnElement("p","",alert.description));
    if(alert.instruction)card.append(smnElement("p","smn-alert-instruction","Recomendación: "+alert.instruction));
  }else if(alert.description===undefined){
    card.append(smnElement("p","","Consultá las áreas y vigencia en el detalle del aviso."));
  }
  const areas=Array.isArray(alert.areas)?alert.areas.map(a=>typeof a==="string"?a:(a.description||"")).filter(Boolean):[];
  const areaText=areas.length?areas.join(" · "):(alert.areaDesc||"Zona no especificada en los datos recibidos");
  card.append(smnElement("small","smn-alert-area","Zonas: "+areaText));
  const validity=[];
  if(alert.effective)validity.push("Desde "+formatSmnDate(alert.effective));
  else if(alert.onset)validity.push("Desde "+formatSmnDate(alert.onset));
  if(alert.expires)validity.push("Hasta "+formatSmnDate(alert.expires));
  else validity.push("Vencimiento no informado");
  card.append(smnElement("small","smn-alert-validity","Vigencia: "+validity.join(" · ")));
  card.append(smnElement("small","smn-alert-source","Fuente: Servicio Meteorológico Nacional · CAP"));
  if(alert.lastSeen)card.append(smnElement("small","smn-alert-checked","Último chequeo: "+formatSmnDate(alert.lastSeen)));
  const url=alert.url||alert.documentUrl;
  if(url){
    try{
      const parsed=new URL(url);
      if(parsed.protocol==="https:"&&parsed.hostname==="ssl.smn.gob.ar"){
        const link=smnElement("a","","Documento CAP del SMN ↗");
        link.href=parsed.href;link.target="_blank";link.rel="noopener noreferrer";
        card.append(link);
      }
    }catch{}
  }
  return card;
}
function renderSmnAlerts(host,alerts,emptyText){
  host.replaceChildren();
  if(!alerts.length){host.append(smnElement("div","empty-state",emptyText));return;}
  for(const alert of alerts)host.append(createSmnAlertCard(alert));
}
let smnAlertsRequest=0;
async function loadOfficialAlerts(){
  const activeHost=document.getElementById("smn-alerts-active");
  const historyHost=document.getElementById("smn-alerts-history");
  const statusTitle=document.getElementById("smn-alerts-status-title");
  const statusDetail=document.getElementById("smn-alerts-status-detail");
  const statusPanel=document.getElementById("smn-alerts-status");
  const updated=document.getElementById("alerts-updated");
  if(!activeHost||!historyHost)return;
  const requestId=++smnAlertsRequest;
  if(statusTitle)statusTitle.textContent="Consultando los últimos avisos oficiales del SMN…";
  if(statusDetail)statusDetail.textContent="Solicitando el archivo CAP actualizado.";
  const button=document.getElementById("alerts-refresh");
  if(button){button.disabled=true;button.textContent="Consultando…";}
  try{
    const response=await fetch("./data/smn-alerts.json?refresh="+Date.now(),{
      method:"GET",cache:"no-store",headers:{"Accept":"application/json"}
    });
    if(!response.ok)throw new Error("El archivo de alertas respondió HTTP "+response.status);
    const contentType=response.headers.get("content-type")||"";
    const staleCache=response.headers.get("X-ClimaGo-Data-Status")==="stale-cache";
    if(contentType&&!contentType.toLowerCase().includes("json"))throw new Error("El servidor no devolvió JSON (Content-Type: "+contentType+").");
    const data=await response.json();
    if(requestId!==smnAlertsRequest)return;
    if(!Array.isArray(data.alerts))throw new Error("El archivo recibido no contiene una lista de avisos válida.");
    const alerts=data.alerts;
    const active=alerts.filter(a=>["active","scheduled","unconfirmed"].includes(getSmnAlertState(a)));
    const history=alerts.filter(a=>["expired","cancelled","not_currently_listed"].includes(getSmnAlertState(a)));
    renderSmnAlerts(activeHost,active,"No se identificaron avisos vigentes entre los documentos consultados.");
    renderSmnAlerts(historyHost,history,"No hay avisos vencidos o cancelados conservados en el historial.");
    const coverage=data.coverage||{};
    const complete=coverage.complete===true||data.status==="ok";
    const currentAlerts=alerts.filter(a=>getSmnAlertState(a)==="active").length;
    const scheduledAlerts=alerts.filter(a=>getSmnAlertState(a)==="scheduled").length;
    const unconfirmedAlerts=alerts.filter(a=>getSmnAlertState(a)==="unconfirmed").length;
    const discovered=Number(coverage.discovered??data.discoveredDocuments??0);
    const downloaded=Number(coverage.downloaded??data.downloadedDocuments??0);
    const generated=data.generatedAt?formatSmnDate(data.generatedAt):"fecha no informada";
    const generatedAtMs=data.generatedAt?Date.parse(data.generatedAt):NaN;
    // Una fecha ausente o inválida nunca debe presentarse como información reciente.
    const stale=!Number.isFinite(generatedAtMs)||(Date.now()-generatedAtMs>90*60*1000);
    if(complete){
      if(statusTitle)statusTitle.textContent=currentAlerts?"Se encontraron avisos oficiales vigentes":scheduledAlerts?"Se encontraron avisos oficiales programados":unconfirmedAlerts?"Hay avisos cuya vigencia debe confirmarse":"Sin avisos vigentes en la cobertura consultada";
      if(statusDetail)statusDetail.textContent="Catálogo revisado dentro de la ventana reciente de "+(coverage.freshWindowHours||14)+" horas. En esta pasada se procesaron "+downloaded+" de "+(discovered||downloaded)+" documentos detectados.";
      if(statusPanel)statusPanel.dataset.state="complete";
    }else{
      if(statusTitle)statusTitle.textContent=active.length?"Avisos encontrados · cobertura parcial":"No se pudo confirmar la ausencia de avisos";
      if(statusDetail)statusDetail.textContent="Consulta parcial: "+downloaded+" documentos procesados de "+(discovered||"cantidad no informada")+" detectados. No interpretes una lista vacía como ausencia de riesgo.";
      if(statusPanel)statusPanel.dataset.state="partial";
    }
    if(stale){
      if(statusTitle)statusTitle.textContent="Datos oficiales desactualizados o sin fecha verificable";
      if(statusDetail)statusDetail.textContent+=" La última actualización supera los 90 minutos o no tiene una fecha válida. No uses esta información para confirmar que no hay riesgo.";
      if(statusPanel)statusPanel.dataset.state="stale";
    }
    if(staleCache){
      if(statusDetail)statusDetail.textContent+=" Se está mostrando la última copia guardada en el teléfono porque no fue posible consultar el servidor.";
    }
    if(updated)updated.textContent="Fuente: Servicio Meteorológico Nacional · CAP. Última actualización del archivo: "+generated+".";
    const activeCount=document.getElementById("smn-active-count");
    const historyCount=document.getElementById("smn-history-count");
    if(activeCount)activeCount.textContent=String(active.length);
    if(historyCount)historyCount.textContent=String(history.length);
  }catch(error){
    if(requestId!==smnAlertsRequest)return;
    if(statusTitle)statusTitle.textContent="No se pudieron verificar los avisos del SMN";
    if(statusDetail)statusDetail.textContent=String(error?.message||error)+" Revisá la conexión; esta falla no significa que no haya alertas.";
    if(statusPanel)statusPanel.dataset.state="error";
    renderSmnAlerts(activeHost,[],"No hay datos vigentes verificables disponibles.");
    renderSmnAlerts(historyHost,[],"No se pudo cargar el historial de avisos.");
    if(updated)updated.textContent="No se pudo verificar la última actualización. Fuente prevista: Servicio Meteorológico Nacional · CAP.";
  }finally{
    if(button){button.disabled=false;button.textContent="↻ Actualizar";}
  }
}
document.getElementById("alerts-refresh")?.addEventListener("click",loadOfficialAlerts);
loadOfficialAlerts();

function sceneryChoice(){return localStorage.getItem("climagoScenery")||"sierras";}
function setScenery(value){
  if(!["sierras","ciudad","mar"].includes(value))return;
  localStorage.setItem("climagoScenery",value);
  const hero=document.querySelector(".weather-hero"),image=document.getElementById("weather-scenery");
  if(hero)hero.dataset.scenery=value;
  if(image)image.src="assets/scenery-"+value+".svg";
  document.querySelectorAll("[data-scenery-choice]").forEach(button=>button.classList.toggle("selected",button.dataset.sceneryChoice===value));
}
document.querySelectorAll("[data-scenery-choice]").forEach(button=>button.addEventListener("click",()=>setScenery(button.dataset.sceneryChoice)));
setScenery(sceneryChoice());
function updateSceneTime(){
  const hero=document.querySelector(".weather-hero");if(!hero)return;
  const hour=Number(new Intl.DateTimeFormat("en-US",{hour:"2-digit",hourCycle:"h23"}).format(new Date()));
  hero.dataset.night=String(hour<6||hour>=19);
}
updateSceneTime();setInterval(updateSceneTime,60000);
