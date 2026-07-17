import test from "node:test";
import assert from "node:assert/strict";
import { selectGalaxyPreference } from "../galaxy-context.js";

test("approved rooms use their own galaxy before personal or shared defaults", () => {
  assert.equal(selectGalaxyPreference({
    roomGalaxy: "B23",
    userGalaxy: "B24",
    sharedGalaxy: "B25",
    defaultGalaxy: "B26"
  }), "B23");
});

test("private chats use the personal galaxy before the shared fallback", () => {
  assert.equal(selectGalaxyPreference({
    isPrivate: true,
    roomGalaxy: "B23",
    userGalaxy: "B24",
    sharedGalaxy: "B25",
    defaultGalaxy: "B26"
  }), "B24");
});

test("legacy shared and configured defaults remain valid fallbacks", () => {
  assert.equal(selectGalaxyPreference({ sharedGalaxy: "B25", defaultGalaxy: "B24" }), "B25");
  assert.equal(selectGalaxyPreference({ defaultGalaxy: "B24" }), "B24");
});
