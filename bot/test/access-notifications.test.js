import test from "node:test";
import assert from "node:assert/strict";
import {
  approvalOfficerMessage,
  enlistmentOfficerMessage,
  officerNotificationRecipientIds
} from "../access-notifications.js";

test("every active officer and owner receives access notifications exactly once", () => {
  const rows = [
    { user_id: "1", role: "officer", status: "active" },
    { user_id: "2", role: "owner", status: "active" },
    { user_id: "3", role: "member", status: "active" },
    { user_id: "4", role: "officer", status: "banned" }
  ];
  assert.deepEqual(officerNotificationRecipientIds(rows, ["2", "5"]), ["1", "2", "5"]);
});

test("enlistment alert identifies the requester and gives officers an approval command", () => {
  const message = enlistmentOfficerMessage({
    guild: "APP",
    scopeLabel: "APP Operations",
    status: "pending",
    member: { userId: "42", username: "bob", displayName: "Bob" }
  });
  assert.match(message, /New APP enlistment request/);
  assert.match(message, /Bob/);
  assert.match(message, /\$approve 42/);
  assert.match(message, /APP Operations/);
});

test("approval alert tells every officer who approved whom", () => {
  const message = approvalOfficerMessage({
    guild: "APP",
    scopeLabel: "APP Operations",
    accessMode: "group",
    member: { userId: "42", displayName: "Bob" },
    approvedBy: { userId: "7", displayName: "Alice" }
  });
  assert.match(message, /APP membership approved/);
  assert.match(message, /Member: Bob/);
  assert.match(message, /Approved by: Alice/);
  assert.match(message, /Access mode: group/);
});
