import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) return NextResponse.json({ user: null });
    return NextResponse.json({ user: user ? { id: user.id, email: user.email, displayName: user.user_metadata?.display_name || user.email?.split("@")[0] } : null });
  } catch (error) {
    return NextResponse.json({ error: error.message, code: "SUPABASE_NOT_CONFIGURED" }, { status: 503 });
  }
}

export async function POST(request) {
  try {
    const { action, email, password, displayName } = await request.json();
    const supabase = await createSupabaseServerClient();
    if (action === "logout") {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (action === "signup") {
      const requestUrl = new URL(request.url);
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { display_name: displayName || "" }, emailRedirectTo: `${requestUrl.origin}/auth/callback` } });
      if (error) throw error;
      if (data.session) {
        const { error: bootstrapError } = await supabase.rpc("bootstrap_project", { project_name: "My workspace" });
        if (bootstrapError) throw bootstrapError;
      }
      return NextResponse.json({ ok: true, needsEmailConfirmation: !data.session, message: data.session ? "Your workspace is ready." : "Check your email to confirm your account." });
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return NextResponse.json({ ok: true, user: { id: data.user.id, email: data.user.email, displayName: data.user.user_metadata?.display_name || "" } });
  } catch (error) {
    const status = error.message?.includes("not configured") ? 503 : 400;
    return NextResponse.json({ error: error.message || "Unable to complete sign in." }, { status });
  }
}
