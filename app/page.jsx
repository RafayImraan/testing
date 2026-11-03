import { redirect } from "next/navigation";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import DashboardClient from "./workspace-client";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (!isSupabaseConfigured()) redirect("/login?setup=1");
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/login");
    return <DashboardClient initialUser={{ id: user.id, email: user.email, displayName: user.user_metadata?.display_name || "" }} />;
  } catch (error) {
    if (error?.digest?.startsWith("NEXT_REDIRECT")) throw error;
    redirect("/login?setup=1");
  }
}
