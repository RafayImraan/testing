import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const allowed = new Set(["image/png","image/jpeg","image/webp","application/pdf","text/plain"]);

export async function POST(request) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Sign in to upload evidence." }, { status: 401 });
    const form = await request.formData();
    const file = form.get("file"); const caseId=form.get("caseId"); const projectId=form.get("projectId");
    if (!file || !caseId || !projectId || typeof file.arrayBuffer !== "function") return NextResponse.json({ error: "Choose a file and its test case." }, { status: 400 });
    if (file.size > 10*1024*1024) return NextResponse.json({ error: "Each evidence file must be 10 MB or smaller." }, { status: 400 });
    if (!allowed.has(file.type)) return NextResponse.json({ error: "Use a PNG, JPG, WebP, PDF, or plain text attachment." }, { status: 400 });
    const { data: testCase, error: caseError } = await supabase.from("test_cases").select("id").eq("id",caseId).eq("project_id",projectId).single();
    if (caseError || !testCase) return NextResponse.json({ error: "This test case is unavailable in the selected workspace." }, { status: 404 });
    const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,"_").slice(-100)||"evidence";
    const path=`${user.id}/${projectId}/${caseId}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await supabase.storage.from("test-evidence").upload(path,file,{contentType:file.type,upsert:false});
    if(uploadError)throw uploadError;
    const { data, error } = await supabase.from("test_case_attachments").insert({test_case_id:caseId,storage_path:path,file_name:file.name.slice(0,180),mime_type:file.type,file_size:file.size,uploaded_by:user.id}).select("id,file_name,mime_type,file_size,created_at").single();
    if(error){await supabase.storage.from("test-evidence").remove([path]);throw error}
    return NextResponse.json({ attachment:data },{status:201});
  } catch(error){return NextResponse.json({error:error.message||"Unable to upload this file."},{status:400})}
}

export async function GET(request){
  try{
    const supabase=await createSupabaseServerClient();
    const {data:{user},error:authError}=await supabase.auth.getUser();
    if(authError||!user)return NextResponse.json({error:"Sign in to view evidence."},{status:401});
    const id=new URL(request.url).searchParams.get("caseId");
    if(!id)return NextResponse.json({error:"Choose a test case."},{status:400});
    const {data,error}=await supabase.from("test_case_attachments").select("id,storage_path,file_name,mime_type,file_size,created_at").eq("test_case_id",id).order("created_at",{ascending:false});
    if(error)throw error;
    const files=await Promise.all((data||[]).map(async item=>{const {data:signed,error:signError}=await supabase.storage.from("test-evidence").createSignedUrl(item.storage_path,300);return {...item,url:signError?null:signed.signedUrl}}));
    return NextResponse.json({attachments:files});
  }catch(error){return NextResponse.json({error:error.message||"Unable to load evidence."},{status:400})}
}
