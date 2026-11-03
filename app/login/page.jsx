"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Eye, EyeOff, FlaskConical, ShieldCheck } from "lucide-react";

export default function LoginPage() {
  const [mode, setMode] = useState("signin");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [configured, setConfigured] = useState(true);

  useEffect(() => {
    fetch("/api/auth").then(async response => {
      if (response.status === 503) setConfigured(false);
      if (response.ok) {
        const data = await response.json();
        if (data.user) window.location.replace("/");
      }
    }).catch(() => setConfigured(false));
    if (new URLSearchParams(window.location.search).get("error") === "confirmation") setError("Your sign-in link could not be verified. Please try again.");
  }, []);

  async function submit(event) {
    event.preventDefault(); setBusy(true); setNotice(""); setError("");
    try {
      const response = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: mode === "signup" ? "signup" : "signin", email, password, displayName }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to continue.");
      if (data.needsEmailConfirmation) setNotice(data.message);
      else window.location.replace("/");
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return <main className="auth-page"><section className="auth-card"><div className="auth-brand"><div className="brand-mark"><ShieldCheck size={19}/></div><span>testtrace<span className="brand-dot">.</span></span></div><div className="auth-emblem"><FlaskConical size={22}/></div><div className="auth-heading"><h1>{mode === "signup" ? "Create your workspace" : "Welcome back"}</h1><p>{mode === "signup" ? "Start bringing your quality work together." : "Sign in to continue to your quality workspace."}</p></div>
    {!configured && <div className="auth-alert"><b>Connect your database to continue</b><span>Add your Supabase URL and anon key in <code>.env.local</code>, then apply <code>supabase/schema.sql</code> to your project.</span></div>}
    {error && <div className="form-alert error-alert">{error}</div>}{notice && <div className="form-alert success-alert">{notice}</div>}
    <form onSubmit={submit} className="auth-form">{mode === "signup" && <label>Your name<input name="displayName" value={displayName} onChange={e=>setDisplayName(e.target.value)} autoComplete="name" placeholder="Your name" required/></label>}<label>Email address<input name="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" type="email" placeholder="you@company.com" required/></label><label>Password<div className="password-wrap"><input name="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} type={showPassword ? "text" : "password"} minLength={8} placeholder="At least 8 characters" required/><button type="button" onClick={()=>setShowPassword(v=>!v)} aria-label={showPassword?"Hide password":"Show password"}>{showPassword?<EyeOff size={16}/>:<Eye size={16}/>}</button></div></label><button className="button button-primary auth-submit" type="submit" disabled={busy || !configured}>{busy ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}<ArrowRight size={16}/></button></form>
    <div className="auth-switch">{mode === "signup" ? "Already have an account?" : "New to TestTrace?"} <button onClick={()=>{setMode(mode === "signup" ? "signin" : "signup");setError("");setNotice("")}}>{mode === "signup" ? "Sign in" : "Create an account"}</button></div><div className="auth-trust"><ShieldCheck size={14}/> Your project data is private to your workspace</div></section></main>;
}
