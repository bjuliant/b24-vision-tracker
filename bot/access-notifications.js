export function officerNotificationRecipientIds(rows = [], configuredOfficerIds = []) {
  const activeOfficers = rows
    .filter((row) => row?.status === "active" && ["officer", "owner"].includes(String(row.role || "").toLowerCase()))
    .map((row) => String(row.user_id || ""));
  return [...new Set([...activeOfficers, ...configuredOfficerIds.map(String)].filter(Boolean))];
}

function memberLines(member = {}) {
  return [
    `Member: ${member.displayName || member.username || member.userId || "Unknown"}`,
    member.username ? `Username: @${String(member.username).replace(/^@/, "")}` : "",
    member.userId ? `User ID: ${member.userId}` : ""
  ].filter(Boolean);
}

export function enlistmentOfficerMessage({ guild = "APP", scopeLabel = "", member = {}, status = "pending" } = {}) {
  const pending = status !== "active";
  return [
    pending ? `New ${guild} enlistment request` : `${guild} member refreshed enlistment`,
    "",
    ...memberLines(member),
    scopeLabel ? `Operation scope: ${scopeLabel}` : "",
    `Status: ${status}`,
    pending && member.userId ? `Approve: $approve ${member.userId}` : ""
  ].filter(Boolean).join("\n");
}

export function approvalOfficerMessage({ guild = "APP", scopeLabel = "", member = {}, approvedBy = {}, accessMode = "group" } = {}) {
  return [
    `${guild} membership approved`,
    "",
    ...memberLines(member),
    `Approved by: ${approvedBy.displayName || approvedBy.username || approvedBy.userId || "Unknown officer"}`,
    approvedBy.userId ? `Approver ID: ${approvedBy.userId}` : "",
    `Access mode: ${accessMode}`,
    scopeLabel ? `Operation scope: ${scopeLabel}` : ""
  ].filter(Boolean).join("\n");
}
