import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export async function POST(request) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Sign in to manage team members." }, { status: 401 });
    const { projectId, email, role } = await request.json();
    if (!projectId || !email) return NextResponse.json({ error: "Workspace and email are required." }, { status: 400 });
    const { data, error } = await supabase.rpc("add_project_member", { target_project: projectId, member_email: email.trim(), member_role: role || "member" });
    if (error) throw error;
    return NextResponse.json({ userId: data }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error.message || "Unable to add this member." }, { status: 400 }); }
}
