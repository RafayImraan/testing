import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const resources = {
  "test-cases": { table: "test_cases", prefix: "TC", fields: ["title","objective","preconditions","steps","expected_result","module","priority","status","automation_type","automation_file","assigned_to"] },
  cycles: { table: "test_cycles", fields: ["name","version","status","starts_at","ends_at"] },
  tasks: { table: "tasks", fields: ["title","description","status","priority","assigned_to","due_at","linked_test_case_id"] },
  requirements: { table: "requirements", prefix: "REQ", fields: ["title","description","priority","status"] },
  defects: { table: "defects", prefix: "BUG", fields: ["title","description","severity","status","linked_test_case_id"] },
};
const jsonError = (error, status = 400) => NextResponse.json({ error }, { status });
const pick = (source, fields) => Object.fromEntries(fields.filter(key => source[key] !== undefined).map(key => [key, source[key]]));
const newKey = prefix => `${prefix}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

async function authorize(request, projectId) {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { error: jsonError("Sign in to use this workspace.", 401) };
  if (!projectId) return { error: jsonError("Choose a workspace.") };
  return { supabase, user };
}

export async function GET(request, { params }) {
  const { resource } = await params;
  const config = resources[resource];
  if (!config) return jsonError("This resource is not available.", 404);
  try {
    const projectId = new URL(request.url).searchParams.get("projectId");
    const { supabase, error } = await authorize(request, projectId);
    if (error) return error;
    let query = supabase.from(config.table).select("*").eq("project_id", projectId);
    query = resource === "test-cases" || resource === "tasks" || resource === "requirements" || resource === "defects" ? query.order("created_at", { ascending: false }) : query.order("created_at", { ascending: false });
    const { data, error: dbError } = await query;
    if (dbError) throw dbError;
    return NextResponse.json({ items: data || [] });
  } catch (error) {
    return jsonError(error.message || "Unable to load records.", 500);
  }
}

export async function POST(request, { params }) {
  const { resource } = await params;
  const config = resources[resource];
  if (!config) return jsonError("This resource is not available.", 404);
  try {
    const body = await request.json();
    const { supabase, user, error } = await authorize(request, body.project_id);
    if (error) return error;
    const row = { ...pick(body, config.fields), project_id: body.project_id, created_by: user.id };
    if (config.prefix) row.key = newKey(config.prefix);
    if (resource === "test-cases") row.steps = Array.isArray(row.steps) ? row.steps : [];
    if (resource === "cycles") row.status = row.status || "planned";
    const { data, error: dbError } = await supabase.from(config.table).insert(row).select("*").single();
    if (dbError) throw dbError;
    if (resource === "cycles" && Array.isArray(body.test_case_ids) && body.test_case_ids.length) {
      const links = body.test_case_ids.map(test_case_id => ({ cycle_id: data.id, test_case_id }));
      const { error: linkError } = await supabase.from("cycle_test_cases").insert(links);
      if (linkError) throw linkError;
    }
    if (resource === "requirements" && Array.isArray(body.test_case_ids) && body.test_case_ids.length) {
      const links = body.test_case_ids.map(test_case_id => ({ requirement_id: data.id, test_case_id }));
      const { error: linkError } = await supabase.from("requirement_test_cases").insert(links);
      if (linkError) throw linkError;
    }
    return NextResponse.json({ item: data }, { status: 201 });
  } catch (error) {
    return jsonError(error.message || "Unable to create record.", 400);
  }
}
