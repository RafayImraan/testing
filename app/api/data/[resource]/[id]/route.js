import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const resources = {
  "test-cases": { table: "test_cases", fields: ["title","objective","preconditions","steps","expected_result","module","priority","status","automation_type","automation_file","assigned_to"] },
  cycles: { table: "test_cycles", fields: ["name","version","status","starts_at","ends_at"] },
  tasks: { table: "tasks", fields: ["title","description","status","priority","assigned_to","due_at","linked_test_case_id"] },
  requirements: { table: "requirements", fields: ["title","description","priority","status"] },
  defects: { table: "defects", fields: ["title","description","severity","status","linked_test_case_id"] },
};
const pick = (source, fields) => Object.fromEntries(fields.filter(key => source[key] !== undefined).map(key => [key, source[key]]));
const jsonError = (error, status = 400) => NextResponse.json({ error }, { status });

async function authorize(projectId) {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { error: jsonError("Sign in to use this workspace.", 401) };
  if (!projectId) return { error: jsonError("Choose a workspace.") };
  return { supabase, user };
}

export async function PATCH(request, { params }) {
  const { resource, id } = await params;
  const config = resources[resource];
  if (!config) return jsonError("This resource is not available.", 404);
  try {
    const body = await request.json();
    const { supabase, error } = await authorize(body.project_id);
    if (error) return error;
    const { data, error: dbError } = await supabase.from(config.table).update(pick(body, config.fields)).eq("id", id).eq("project_id", body.project_id).select("*").single();
    if (dbError) throw dbError;
    if (resource === "cycles" && Array.isArray(body.test_case_ids)) {
      const { error: deleteError } = await supabase.from("cycle_test_cases").delete().eq("cycle_id", id);
      if (deleteError) throw deleteError;
      if (body.test_case_ids.length) {
        const { error: linkError } = await supabase.from("cycle_test_cases").insert(body.test_case_ids.map(test_case_id => ({ cycle_id: id, test_case_id })));
        if (linkError) throw linkError;
      }
    }
    if (resource === "requirements" && Array.isArray(body.test_case_ids)) {
      const { error: deleteError } = await supabase.from("requirement_test_cases").delete().eq("requirement_id", id);
      if (deleteError) throw deleteError;
      if (body.test_case_ids.length) {
        const { error: linkError } = await supabase.from("requirement_test_cases").insert(body.test_case_ids.map(test_case_id => ({ requirement_id: id, test_case_id })));
        if (linkError) throw linkError;
      }
    }
    return NextResponse.json({ item: data });
  } catch (error) {
    return jsonError(error.message || "Unable to update record.", 400);
  }
}

export async function DELETE(request, { params }) {
  const { resource, id } = await params;
  const config = resources[resource];
  if (!config) return jsonError("This resource is not available.", 404);
  try {
    const projectId = new URL(request.url).searchParams.get("projectId");
    const { supabase, error } = await authorize(projectId);
    if (error) return error;
    const { error: dbError } = await supabase.from(config.table).delete().eq("id", id).eq("project_id", projectId);
    if (dbError) throw dbError;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error.message || "Unable to delete record.", 400);
  }
}
