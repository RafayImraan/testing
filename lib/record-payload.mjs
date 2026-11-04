export function buildRecordPayload(kind, form, projectId) {
  const payload = { ...form, project_id: projectId };

  if (kind === "test-cases") {
    payload.steps = JSON.parse(form.steps);
  }
  if (kind === "cycles") {
    payload.name = form.title;
    payload.test_case_ids = form.test_case_ids;
    delete payload.title;
  }
  if (kind === "requirements") payload.test_case_ids = form.test_case_ids;
  if (kind === "defects") payload.severity = form.severity;
  if (kind === "tasks") payload.due_at = form.due_at || null;

  return payload;
}
