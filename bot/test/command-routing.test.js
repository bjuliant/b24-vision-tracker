import test from "node:test";
import assert from "node:assert/strict";
import { resolveCommandMatches } from "../command-routing.js";

const commands = ["approve", "approvechat", "attack", "attacks", "scout", "status"];
const aliases = {
  approvechat: ["approvechat"],
  attacks: ["attacks"],
  scout: ["sc", "scout"],
  status: ["st", "status"]
};

test("exact approve does not resolve as approvechat", () => {
  assert.deepEqual(resolveCommandMatches("approve", commands, aliases), ["approve"]);
  assert.deepEqual(resolveCommandMatches("approvechat", commands, aliases), ["approvechat"]);
});

test("exact attack and attacks remain separate commands", () => {
  assert.deepEqual(resolveCommandMatches("attack", commands, aliases), ["attack"]);
  assert.deepEqual(resolveCommandMatches("attacks", commands, aliases), ["attacks"]);
});

test("unique abbreviations resolve while ambiguous ones remain ambiguous", () => {
  assert.deepEqual(resolveCommandMatches("sc", commands, aliases), ["scout"]);
  assert.deepEqual(resolveCommandMatches("st", commands, aliases), ["status"]);
  assert.deepEqual(resolveCommandMatches("a", commands, aliases).sort(), ["approve", "approvechat", "attack", "attacks"].sort());
});
