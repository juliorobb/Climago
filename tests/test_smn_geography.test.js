const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("app.js", "utf8");
function extract(startName, endName) {
  const start = source.indexOf("function " + startName + "(");
  const end = source.indexOf("function " + endName + "(", start + 1);
  assert.notEqual(start, -1, "Missing function " + startName);
  assert.notEqual(end, -1, "Missing function boundary " + endName);
  return source.slice(start, end);
}
const sandbox = {};
const selected = [
  extract("getSmnAlertState", "isValidCapPolygon"),
  extract("isValidCapPolygon", "getSmnAlertLocation"),
  extract("getSmnGeographicStatus", "getSmnAlertLevel"),
  extract("getSmnAlertLevel", "createSmnAlertCard"),
  "globalThis.alertFns = {getSmnAlertState, isValidCapPolygon, pointInCapPolygon, pointInCapCircle, getSmnGeographicStatus, getSmnAlertLevel};"
].join("\n");
vm.runInNewContext(selected, sandbox);
const {getSmnAlertState, isValidCapPolygon, pointInCapPolygon, pointInCapCircle, getSmnGeographicStatus} = sandbox.alertFns;
const cordoba = {lat:-31.4167, lon:-64.1833};
const polygon = [[-64.20,-31.40],[-64.10,-31.40],[-64.10,-31.50],[-64.20,-31.50],[-64.20,-31.40]];

test("polygon includes points inside and on its boundary", () => {
  assert.equal(isValidCapPolygon(polygon), true);
  assert.equal(isValidCapPolygon([[0,0],[1,1],[2,2],[0,0]]), false);
  assert.equal(pointInCapPolygon(cordoba.lon, cordoba.lat, polygon), true);
  assert.equal(pointInCapPolygon(-64.20, -31.45, polygon), true);
});
test("polygon excludes points outside", () => {
  assert.equal(pointInCapPolygon(-63.9, -31.45, polygon), false);
});
test("circle uses its real radius", () => {
  const circle = {lat:cordoba.lat, lon:cordoba.lon, radiusKm:5};
  assert.equal(pointInCapCircle(cordoba.lon, cordoba.lat, circle), true);
  assert.equal(pointInCapCircle(-64.0, -31.4, circle), false);
  assert.equal(pointInCapCircle(cordoba.lon, cordoba.lat, {...circle, radiusKm:0}), false);
});
test("geography distinguishes local, other and unverifiable", () => {
  assert.equal(getSmnGeographicStatus({areas:[{polygons:[polygon]}]}, cordoba), "local");
  assert.equal(getSmnGeographicStatus({areas:[{polygons:[polygon]}]}, {lat:-30,lon:-60}), "other");
  assert.equal(getSmnGeographicStatus({areas:[]}, cordoba), "unverifiable");
  assert.equal(getSmnGeographicStatus({areas:[{polygons:[polygon]},{description:"Área sin geometría"}]}, {lat:-30,lon:-60}), "unverifiable");
});
test("malformed geometry and missing coordinates never become non-local certainty", () => {
  assert.equal(isValidCapPolygon([[null,null],[1,1],[2,2],[null,null]]), false);
  assert.equal(getSmnGeographicStatus({areas:[{polygons:[[[null,null],[1,1],[2,2],[null,null]]]}]}, cordoba), "unverifiable");
  assert.equal(getSmnGeographicStatus({areas:[{polygons:[polygon]}]}, {lat:null,lon:null}), "unverifiable");
  assert.equal(pointInCapCircle(0,0,{lat:null,lon:0,radiusKm:10}), false);
});
test("old or missing per-alert checks downgrade active alerts to unconfirmed", () => {
  const expires = new Date(Date.now()+60*60*1000).toISOString();
  const publicAlert = {status:"Actual",scope:"Public"};
  assert.equal(getSmnAlertState({state:"active",expires,lastSeen:new Date(Date.now()-60*60*1000).toISOString(),...publicAlert}), "active");
  assert.equal(getSmnAlertState({state:"active",expires,lastSeen:new Date(Date.now()-25*60*60*1000).toISOString(),...publicAlert}), "unconfirmed");
  assert.equal(getSmnAlertState({state:"active",expires,...publicAlert}), "unconfirmed");
  assert.equal(getSmnAlertState({state:"active",expires,lastSeen:new Date().toISOString(),dataStale:true,...publicAlert}), "unconfirmed");
  assert.equal(getSmnAlertState({state:"active",expires,lastSeen:new Date().toISOString(),status:"Test",scope:"Public"}), "unconfirmed");
  assert.equal(getSmnAlertState({state:"active",expires,lastSeen:new Date().toISOString(),status:"Actual",scope:"Restricted"}), "unconfirmed");
  assert.equal(getSmnAlertState({state:"cancelled",expires}), "cancelled");
  assert.equal(getSmnAlertState({state:"scheduled",effective:new Date(Date.now()-60*60*1000).toISOString(),onset:new Date(Date.now()+60*60*1000).toISOString(),expires,lastSeen:new Date().toISOString(),...publicAlert}), "scheduled");
  assert.equal(getSmnAlertState({state:"scheduled",effective:new Date(Date.now()+60*60*1000).toISOString(),onset:new Date(Date.now()-60*60*1000).toISOString(),expires,lastSeen:new Date().toISOString(),...publicAlert}), "scheduled");
  assert.equal(getSmnAlertState({state:"scheduled",effective:new Date(Date.now()-60*60*1000).toISOString(),onset:new Date(Date.now()-30*60*1000).toISOString(),expires,lastSeen:new Date().toISOString(),...publicAlert}), "active");
  assert.equal(getSmnAlertState({state:"scheduled",onset:new Date(Date.now()+60*60*1000).toISOString(),lastSeen:new Date().toISOString(),...publicAlert}), "unconfirmed");
});
test("SAT color is shown only when explicitly present in official CAP data", () => {
  const {getSmnAlertLevel} = sandbox.alertFns;
  assert.equal(getSmnAlertLevel({parameters:[{name:"SAT_COLOR",value:"Naranja"}]}), "naranja");
  assert.equal(getSmnAlertLevel({headline:"Alerta roja por tormentas"}), "rojo");
  assert.equal(getSmnAlertLevel({severity:"Severe",headline:"Tormentas fuertes"}), "desconocido");
});
