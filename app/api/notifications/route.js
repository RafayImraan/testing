import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic="force-dynamic";
export async function PATCH(request){
  try{
    const supabase=await createSupabaseServerClient();
    const {data:{user},error:authError}=await supabase.auth.getUser();
    if(authError||!user)return NextResponse.json({error:"Sign in to update notifications."},{status:401});
    const {id,projectId,all}=await request.json();
    let query=supabase.from("notifications").update({read_at:new Date().toISOString()}).eq("user_id",user.id).eq("project_id",projectId).is("read_at",null);
    if(!all){if(!id)return NextResponse.json({error:"Notification id is required."},{status:400});query=query.eq("id",id)}
    const {error}=await query;
    if(error)throw error;
    return NextResponse.json({ok:true});
  }catch(error){return NextResponse.json({error:error.message||"Unable to update notifications."},{status:400})}
}
