import test from "node:test";
import assert from "node:assert/strict";
import { coverageFriendlyTags, identityOwnerSearchTerms, uncoveredRegionPage, uncoveredWatchableRegions, withoutCoveredRegionTargets } from "../galaxy-context.js";

test("the configured APP tag counts as friendly coverage without a manual stance row", () => {
  const tags = coverageFriendlyTags([
    ["ALLY", "friend"],
    ["ENEMY", "enemy"]
  ], "APP");
  assert.deepEqual([...tags], ["APP", "ALLY"]);
  assert.equal(tags.has("APP"), true);
});

test("uncovered sector coordinates paginate deterministically", () => {
  const regions = Array.from({ length: 45 }, (_, index) => `B24:${index + 1}`);
  assert.deepEqual(uncoveredRegionPage(regions, 2, 20), {
    page: 2,
    pages: 3,
    total: 45,
    from: 20,
    to: 40,
    rows: regions.slice(20, 40)
  });
  assert.equal(uncoveredRegionPage(regions, 99, 20).page, 3);
});

test("regions without any imported systems are not scouting targets", () => {
  const watchable = new Set(["B24:1", "B24:4", "B24:12"]);
  const covered = new Set(["B24:4"]);
  assert.deepEqual(uncoveredWatchableRegions("B24", covered, watchable), ["B24:1", "B24:12"]);
  assert.equal(uncoveredWatchableRegions("B24", covered, watchable).includes("B24:2"), false);
});

test("a Telegram handle expands base searches through its verified game owner", () => {
  const links = [{ telegram_username: "henrybob123", game_username: "Pug Commander", game_username_key: "pug commander" }];
  assert.deepEqual(identityOwnerSearchTerms("@henrybob", links), ["henrybob", "pug commander"]);
  assert.deepEqual(identityOwnerSearchTerms("fear", links), ["fear"]);
});

test("scout agenda presentation omits regions covered by APP bases", () => {
  const agenda = {
    key: "G-TEST1",
    operations: [
      { operation_id: "1", target_coord: "B24:12" },
      { operation_id: "2", target_coord: "B24:13" }
    ]
  };
  assert.deepEqual(withoutCoveredRegionTargets(agenda, new Set(["B24:12"])).operations, [
    { operation_id: "2", target_coord: "B24:13" }
  ]);
});
