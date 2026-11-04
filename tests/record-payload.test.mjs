import test from "node:test";
import assert from "node:assert/strict";
import { buildRecordPayload } from "../lib/record-payload.mjs";

test("cycle form title maps to the database name field", () => {
  const payload = buildRecordPayload("cycles", {
    title: "Release 2.0",
    version: "2.0",
    status: "planned",
    test_case_ids: ["case-1"],
  }, "project-1");

  assert.equal(payload.name, "Release 2.0");
  assert.equal(payload.title, undefined);
  assert.deepEqual(payload.test_case_ids, ["case-1"]);
  assert.equal(payload.project_id, "project-1");
});

test("test case steps are parsed before saving", () => {
  const payload = buildRecordPayload("test-cases", {
    title: "Health check",
    steps: '[{"action":"goto","value":"/api/health"}]',
  }, "project-1");

  assert.deepEqual(payload.steps, [{ action: "goto", value: "/api/health" }]);
});

test("invalid test case step JSON is rejected", () => {
  assert.throws(() => buildRecordPayload("test-cases", { steps: "not-json" }, "project-1"));
});

test("empty task due date is stored as null", () => {
  const payload = buildRecordPayload("tasks", { title: "Review release", due_at: "" }, "project-1");
  assert.equal(payload.due_at, null);
});
