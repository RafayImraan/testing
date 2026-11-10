import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const fail = (message, status = 400) => NextResponse.json({ error: message }, { status });

export async function GET(request) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return fail("Sign in to view test runs.", 401);
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) return fail("Choose a workspace.");
    const { data, error } = await supabase.from("test_runs").select("*,test_results(*,test_cases(key,title))").eq("project_id", projectId).order("created_at", { ascending: false }).limit(50);
    if (error) throw error;
    return NextResponse.json({ runs: data || [] });
  } catch (error) { return fail(error.message || "Unable to load test runs.", 500); }
}

export async function POST(request) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return fail("Sign in to run tests.", 401);
    const body = await request.json();
    if (!body.projectId) return fail("Choose a workspace.");
    const source = body.source === "website" ? "website" : (["playwright","selenium","newman"].includes(body.source) ? body.source : "manual");
    const caseIds = [...new Set(body.caseIds || [])].slice(0, 25);
    if (source !== "website" && !caseIds.length) return fail("Select at least one test case.");
    let cases = [];
    if (source !== "website") {
      const { data, error } = await supabase.from("test_cases").select("id,automation_type").eq("project_id", body.projectId).in("id", caseIds);
      if (error) throw error;
      cases = data || [];
      if (!cases.length || cases.length !== caseIds.length) return fail("One or more selected test cases are unavailable in this workspace.", 403);
      if (source !== "manual" && cases.some(testCase => testCase.automation_type !== source)) return fail("Every selected case must use the selected automation type.");
    }

    if (source === "manual") {
      const results = Array.isArray(body.results) ? body.results : [];
      const allowed = new Set(["passed","failed","blocked","skipped"]);
      if (!results.length || results.length!==caseIds.length || new Set(results.map(item=>item.test_case_id)).size!==results.length || results.some(item => !caseIds.includes(item.test_case_id) || !allowed.has(item.status))) return fail("Provide exactly one result for every selected test case.");
      const { data: run, error: runError } = await supabase.from("test_runs").insert({ project_id: body.projectId, cycle_id: body.cycleId || null, triggered_by: user.id, source: "manual", status: "running", started_at: new Date().toISOString() }).select("*").single();
      if (runError) throw runError;
      const rows = results.map(item => ({ run_id: run.id, test_case_id: item.test_case_id, status: item.status, duration_ms: 0, error_message: item.note || null }));
      const { error: resultError } = await supabase.from("test_results").insert(rows);
      if (resultError) throw resultError;
      for (const item of results) if (item.status !== "skipped") {
        const { error: updateError } = await supabase.from("test_cases").update({ status: item.status === "passed" ? "passed" : item.status === "failed" ? "failed" : "blocked" }).eq("id", item.test_case_id).eq("project_id", body.projectId);
        if (updateError) throw updateError;
      }
      const finalStatus = results.length>0 && results.every(item => item.status === "passed") ? "passed" : "failed";
      const { data: finished, error: finishError } = await supabase.from("test_runs").update({ status: finalStatus, finished_at: new Date().toISOString(), summary: { total: results.length, passed: results.filter(x=>x.status==="passed").length, failed: results.filter(x=>x.status==="failed").length, blocked: results.filter(x=>x.status==="blocked").length, skipped: results.filter(x=>x.status==="skipped").length } }).eq("id", run.id).select("*").single();
      if (finishError) throw finishError;
      return NextResponse.json({ run: finished }, { status: 201 });
    }

    const owner = process.env.GITHUB_AUTOMATION_OWNER;
    const repository = process.env.GITHUB_AUTOMATION_REPOSITORY;
    const token = process.env.GITHUB_AUTOMATION_TOKEN;
    if (!owner || !repository || !token) return fail("The automation runner has not been connected in deployment settings.", 503);
    const { data: project, error: projectError } = await supabase.from("projects").select("automation_base_url").eq("id",body.projectId).single();
    if(projectError)throw projectError;
    if (body.websiteUrl) {
      let target;
      try { target = new URL(body.websiteUrl); } catch { return fail("Enter a valid website URL."); }
      if (!["http:","https:"].includes(target.protocol) || target.username || target.password) return fail("Enter a valid HTTP or HTTPS website URL.");
      if (target.protocol === "http:" && !["localhost","127.0.0.1"].includes(target.hostname)) return fail("Use HTTPS for a public website.");
      const { error: saveError } = await supabase.from("projects").update({automation_base_url:target.href}).eq("id",body.projectId);
      if (saveError) throw saveError;
    }
    if(!project.automation_base_url && !body.websiteUrl)return fail("Enter a website URL to scan.");
    const workflow = process.env.GITHUB_AUTOMATION_WORKFLOW || "automation.yml";
    const branch=body.branch||process.env.GITHUB_AUTOMATION_BRANCH||"main";
    const { data: run, error: insertError } = await supabase.from("test_runs").insert({ project_id: body.projectId, cycle_id: body.cycleId || null, triggered_by: user.id, source, status: "queued", branch }).select("*").single();
    if (insertError) throw insertError;
    const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
      body: JSON.stringify({ ref: branch, inputs: { run_id: run.id, project_id: body.projectId, test_case_ids: caseIds.join(","), source } }),
    });
    if (!response.ok) {
      const detail = await response.text();
      await supabase.from("test_runs").update({ status: "failed", finished_at: new Date().toISOString(), summary: { error: `Runner dispatch failed (${response.status})` } }).eq("id", run.id);
      return fail(`Could not start the automation runner (${response.status}). Check the GitHub token and workflow settings. ${detail.slice(0,180)}`, 502);
    }
    return NextResponse.json({ run }, { status: 202 });
  } catch (error) { return fail(error.message || "Unable to start this run.", 500); }
}
