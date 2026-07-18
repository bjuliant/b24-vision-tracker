import test from "node:test";
import assert from "node:assert/strict";
import { buildGalaxyMapUrl, naturalGalaxySort, rowBelongsToMiniAppGalaxy, selectMiniAppGalaxy } from "../miniapp-galaxy.js";

test("imported galaxy choices are unique and naturally sorted", () => {
  assert.deepEqual(naturalGalaxySort(["b39-main", "B24", "b23-main", "B24"]), ["B23", "B24", "B39"]);
});

test("a signed B24 session may temporarily select imported B23", () => {
  assert.equal(selectMiniAppGalaxy({
    requestedGalaxy: "B23",
    tokenGalaxy: "B24",
    availableGalaxies: ["B23", "B24"]
  }), "B23");
  assert.equal(selectMiniAppGalaxy({
    requestedGalaxy: "B99",
    tokenGalaxy: "B24",
    availableGalaxies: ["B23", "B24"]
  }), "");
});

test("a bare /map keeps the saved/token galaxy while /map B23 retains B23 in the link", () => {
  assert.equal(selectMiniAppGalaxy({ tokenGalaxy: "B24", availableGalaxies: ["B23", "B24"] }), "B24");
  const url = new URL(buildGalaxyMapUrl("https://example.test/map?theme=dark", {
    galaxy: "B23",
    access: "signed-access",
    version: "test"
  }));
  assert.equal(url.searchParams.get("gal"), "B23");
  assert.equal(url.searchParams.get("access"), "signed-access");
  assert.equal(url.searchParams.get("theme"), "dark");
});

test("read and write request context selects one galaxy without changing token preference", () => {
  const tokenPreference = "B24";
  const selected = selectMiniAppGalaxy({
    requestedGalaxy: "B23",
    tokenGalaxy: tokenPreference,
    availableGalaxies: ["B23", "B24"]
  });
  assert.equal(selected, "B23");
  assert.equal(`${selected.toLowerCase()}-main`, "b23-main");
  assert.notEqual(`${selected.toLowerCase()}-main`, "b24-main");
  assert.equal(tokenPreference, "B24");
});

test("a B23 watch row cannot appear in a B24 Mini App snapshot", () => {
  const watch = { map_id: "b23-main", type: "scout", target_coord: "B23:17" };
  assert.equal(rowBelongsToMiniAppGalaxy(watch, "B23"), true);
  assert.equal(rowBelongsToMiniAppGalaxy(watch, "B24"), false);
});
