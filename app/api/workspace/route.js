import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const fail = (message, status = 400) => NextResponse.json({ error: message }, { status });

export async function GET(request) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return fail("Sign in to open your workspace.", 401);
    let { data: memberships, error } = await supabase.from("project_members").select("project_id,role,projects(id,name,description,automation_base_url,automation_schedule_enabled,created_at)").eq("user_id", user.id);
    if (error) throw error;
    let projects = (memberships || []).map(row => ({ ...row.projects, role: row.role })).filter(Boolean);
    if (!projects.length) {
      const { data: projectId, error: bootstrapError } = await supabase.rpc("bootstrap_project", { project_name: "My workspace" });
      if (bootstrapError) throw bootstrapError;
      const { data: membership, error: refreshError } = await supabase.from("project_members").select("project_id,role,projects(id,name,description,automation_base_url,automation_schedule_enabled,created_at)").eq("project_id", projectId).eq("user_id", user.id).single();
      if (refreshError) throw refreshError;
      projects = [{ ...membership.projects, role: membership.role }];
    }
    const requestedId = new URL(request.url).searchParams.get("projectId");
    const project = projects.find(item => item.id === requestedId) || projects[0];
    const pid = project.id;
    const queries = await Promise.all([
      supabase.from("test_cases").select("*").eq("project_id", pid).order("created_at", { ascending: false }),
      supabase.from("test_cycles").select("*").eq("project_id", pid).order("created_at", { ascending: false }),
      supabase.from("tasks").select("*").eq("project_id", pid).order("created_at", { ascending: false }),
      supabase.from("requirements").select("*").eq("project_id", pid).order("created_at", { ascending: false }),
      supabase.from("defects").select("*").eq("project_id", pid).order("created_at", { ascending: false }),
      supabase.from("test_runs").select("*,test_results(*,test_cases(key,title))").eq("project_id", pid).order("created_at", { ascending: false }).limit(50),
      supabase.from("test_results").select("*,test_runs!inner(project_id)").eq("test_runs.project_id", pid).order("executed_at", { ascending: false }).limit(250),
      supabase.from("requirement_test_cases").select("requirement_id,test_case_id,requirements!inner(project_id)").eq("requirements.project_id", pid),
      supabase.from("cycle_test_cases").select("cycle_id,test_case_id,test_cycles!inner(project_id)").eq("test_cycles.project_id", pid),
      supabase.from("project_members").select("user_id,role,profiles(display_name,email,avatar_url)").eq("project_id", pid),
      supabase.from("audit_log").select("*").eq("project_id", pid).order("created_at", { ascending: false }).limit(100),
      supabase.from("test_case_attachments").select("*,test_cases!inner(project_id)").eq("test_cases.project_id",pid).order("created_at",{ascending:false}),
      supabase.from("notifications").select("*").eq("project_id",pid).order("created_at",{ascending:false}).limit(30),
    ]);
    const keys = ["testCases", "cycles", "tasks", "requirements", "defects", "runs", "results", "requirementLinks", "cycleLinks", "members", "auditLog", "attachments", "notifications"];
    const payload = {};
    for (let i = 0; i < queries.length; i += 1) {
      if (queries[i].error) throw queries[i].error;
      payload[keys[i]] = queries[i].data || [];
    }
    const { data: profile } = await supabase.from("profiles").select("display_name,email,avatar_url").eq("id", user.id).maybeSingle();
    return NextResponse.json({ user: { id: user.id, email: user.email, ...profile }, projects, project, ...payload });
  } catch (error) {
    const status = error.message?.includes("not configured") ? 503 : 500;
    return fail(error.message || "Unable to load workspace.", status);
  }
}

export async function POST(request) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return fail("Sign in to create a workspace.", 401);
    const { name } = await request.json();
    if (!name?.trim()) return fail("Enter a workspace name.");
    const { data, error } = await supabase.rpc("bootstrap_project", { project_name: name.trim() });
    if (error) throw error;
    return NextResponse.json({ projectId: data }, { status: 201 });
  } catch (error) {
    return fail(error.message || "Unable to create workspace.", 400);
  }
}

export async function PATCH(request) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return fail("Sign in to update workspace settings.", 401);
    const body = await request.json();
    if (!body.projectId) return fail("Choose a workspace.");
    if (body.automation_base_url) {
      let parsed;
      try { parsed = new URL(body.automation_base_url); } catch { return fail("Enter a valid automation target URL."); }
      if (!["http:","https:"].includes(parsed.protocol)) return fail("Automation target URL must use HTTP or HTTPS.");
      if (parsed.protocol === "http:" && !["localhost","127.0.0.1"].includes(parsed.hostname)) return fail("Use HTTPS for a public automation target.");
    }
    const updates = {};
    if (typeof body.name === "string") updates.name = body.name.trim().slice(0,80);
    if (typeof body.description === "string") updates.description = body.description.trim().slice(0,500);
    if (body.automation_base_url !== undefined) updates.automation_base_url = body.automation_base_url || null;
    if (typeof body.automation_schedule_enabled === "boolean") updates.automation_schedule_enabled = body.automation_schedule_enabled;
    if (!Object.keys(updates).length || !updates.name) return fail("Enter a workspace name.");
    const { data, error } = await supabase.from("projects").update(updates).eq("id",body.projectId).select("id,name,description,automation_base_url").single();
    if (error) throw error;
    return NextResponse.json({ project: data });
  } catch (error) { return fail(error.message || "Unable to update workspace settings.", 400); }
}
