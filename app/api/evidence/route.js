import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Sign in to view evidence." }, { status: 401 });
    const params = new URL(request.url).searchParams;
    const runId=params.get("runId"); const caseId=params.get("caseId");
    if(!runId||!caseId)return NextResponse.json({error:"A run and test case are required."},{status:400});
    const {data,error}=await supabase.from("test_results").select("evidence,test_runs!inner(project_id)").eq("run_id",runId).eq("test_case_id",caseId).single();
    if(error)throw error;
    const {data:membership,error:memberError}=await supabase.from("project_members").select("project_id").eq("project_id",data.test_runs.project_id).eq("user_id",user.id).maybeSingle();
    if(memberError||!membership)return NextResponse.json({error:"You do not have access to this evidence."},{status:403});
    const file=(data.evidence||[]).find(item=>item.path);
    if(!file)return NextResponse.json({error:"No screenshot was saved for this result."},{status:404});
    const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
    if(!serviceKey)return NextResponse.json({error:"Evidence signing is not configured."},{status:503});
    const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:signed,error:signError}=await admin.storage.from("test-evidence").createSignedUrl(file.path,300);
    if(signError)throw signError;
    return NextResponse.json({url:signed.signedUrl,fileName:file.file_name});
  }catch(error){return NextResponse.json({error:error.message||"Unable to open evidence."},{status:400})}
}
