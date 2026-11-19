const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("app.js", "utf8");
const start = source.indexOf("function pushSubscriptionLocationState(");
const end = source.indexOf("\nasync function restorePushSubscriptionStatus", start);
assert.notEqual(start, -1, "Missing Push location compatibility helper");
assert.notEqual(end, -1, "Missing Push restore boundary");
const sandbox = {};
vm.runInNewContext(source.slice(start, end) + "\nglobalThis.check=pushSubscriptionLocationState;", sandbox);
const check = sandbox.check;

test("legacy Android subscription without saved location remains usable", () => {
  assert.equal(check(null, {lat:-31.4,lon:-64.2}), "legacy");
});

test("subscription with matching saved location is accepted", () => {
  assert.equal(check({lat:-31.4,lon:-64.2}, {lat:-31.4,lon:-64.2}), "matched");
});

test("subscription saved for a different location requires reactivation", () => {
  assert.equal(check({lat:-31.4,lon:-64.2}, {lat:-32.9,lon:-60.7}), "mismatch");
});

test("malformed saved location is not treated as a valid match", () => {
  assert.equal(check({lat:"bad",lon:-64.2}, {lat:-31.4,lon:-64.2}), "mismatch");
});
