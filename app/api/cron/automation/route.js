import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic="force-dynamic";
export const maxDuration=60;

async function dispatchWorkflow({owner,repository,token,workflow,run,projectId,caseIds,source}){
  const response=await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,{
    method:"POST",headers:{Authorization:`Bearer ${token}`,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","Content-Type":"application/json"},
    body:JSON.stringify({ref:process.env.GITHUB_AUTOMATION_BRANCH||"main",inputs:{run_id:run.id,project_id:projectId,test_case_ids:caseIds.join(","),source}}),
  });
  if(!response.ok)throw new Error(`Workflow dispatch returned HTTP ${response.status}.`);
}

export async function GET(request){
  const secret=process.env.CRON_SECRET;
  if(!secret)return NextResponse.json({error:"Cron authorization is not configured."},{status:503});
  if(request.headers.get("authorization")!==`Bearer ${secret}`)return NextResponse.json({error:"Unauthorized."},{status:401});
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;const service=process.env.SUPABASE_SERVICE_ROLE_KEY;
  const owner=process.env.GITHUB_AUTOMATION_OWNER;const repository=process.env.GITHUB_AUTOMATION_REPOSITORY;const token=process.env.GITHUB_AUTOMATION_TOKEN;
  if(!url||!service||!owner||!repository||!token)return NextResponse.json({error:"Scheduled automation connections are incomplete."},{status:503});
  const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:projects,error:projectError}=await admin.from("projects").select("id,automation_base_url").eq("automation_schedule_enabled",true).not("automation_base_url","is",null).limit(20);
  if(projectError)return NextResponse.json({error:projectError.message},{status:500});
  const workflow=process.env.GITHUB_AUTOMATION_WORKFLOW||"automation.yml";const outcomes=[];
  for(const project of projects||[]){
    const {data:cycles,error:cycleError}=await admin.from("test_cycles").select("id,name").eq("project_id",project.id).eq("status","active");
    if(cycleError){outcomes.push({projectId:project.id,error:cycleError.message});continue}
    for(const cycle of cycles||[]){
      const {data:links,error:linksError}=await admin.from("cycle_test_cases").select("test_case_id").eq("cycle_id",cycle.id);
      if(linksError){outcomes.push({projectId:project.id,cycleId:cycle.id,error:linksError.message});continue}
      const ids=(links||[]).map(x=>x.test_case_id);
      if(!ids.length)continue;
      const {data:cases,error:casesError}=await admin.from("test_cases").select("id,automation_type").eq("project_id",project.id).in("id",ids).in("automation_type",["playwright","selenium","newman"]);
      if(casesError){outcomes.push({projectId:project.id,cycleId:cycle.id,error:casesError.message});continue}
      for(const source of ["playwright","selenium","newman"]){
        const matching=(cases||[]).filter(item=>item.automation_type===source).map(item=>item.id);
        for(let offset=0;offset<matching.length;offset+=25){
          const caseIds=matching.slice(offset,offset+25);
          const {data:run,error:runError}=await admin.from("test_runs").insert({project_id:project.id,cycle_id:cycle.id,source,status:"queued",branch:process.env.GITHUB_AUTOMATION_BRANCH||"main"}).select("id").single();
          if(runError){outcomes.push({projectId:project.id,cycleId:cycle.id,error:runError.message});continue}
          try{await dispatchWorkflow({owner,repository,token,workflow,run,projectId:project.id,caseIds,source});outcomes.push({runId:run.id,source,status:"queued",count:caseIds.length})}
          catch(error){await admin.from("test_runs").update({status:"failed",finished_at:new Date().toISOString(),summary:{error:error.message}}).eq("id",run.id);outcomes.push({runId:run.id,source,error:error.message})}
        }
      }
    }
  }
  return NextResponse.json({scheduledProjects:projects?.length||0,queuedRuns:outcomes.filter(x=>x.status==="queued").length,outcomes});
}
