"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { api } from "@/lib/api";
import { Logo } from "@/components/Icon";
import { ErrorBox, Spinner } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    try { const saved = localStorage.getItem("plumb-invite"); if (saved) setCode(saved); } catch {}
    supabase().auth.getSession().then(({ data }) => { if (data.session) router.replace("/"); });
  }, [router]);

  async function finish() {
    if (code.trim()) {
      try { await api("/join", { method: "POST", json: { code: code.trim() } }); try { localStorage.removeItem("plumb-invite"); } catch {} }
      catch (e) { setError((e as Error).message); setBusy(false); return; }
    }
    router.replace("/");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setInfo(null);
    const auth = supabase().auth;
    if (mode === "signin") {
      const { error } = await auth.signInWithPassword({ email, password });
      if (error) { setError(error.message); setBusy(false); return; }
      return finish();
    }
    const { data, error } = await auth.signUp({
      email, password, options: { data: { full_name: name }, emailRedirectTo: window.location.origin + "/login" },
    });
    if (error) { setError(error.message); setBusy(false); return; }
    if (!data.session) {
      try { if (code.trim()) localStorage.setItem("plumb-invite", code.trim()); } catch {}
      setInfo("Check your inbox to confirm your email, then sign in.");
      setMode("signin"); setBusy(false); return;
    }
    return finish();
  }

  return (
    <main className="auth">
      <div className="auth-card">
        <div className="brand" style={{ padding: 0 }}><Logo /><div><b>Plumb</b><small>AI fleet console</small></div></div>
        <h1>{mode === "signin" ? "Sign in" : "Create your account"}</h1>
        <p>{mode === "signin" ? "Onboard, evaluate, release, and monitor your AI agents." : "You’ll get your own workspace, or join a team with an invite code."}</p>
        <form onSubmit={submit}>
          {mode === "signup" && (
            <div><label className="lab" htmlFor="name">Full name</label><div className="inp"><input id="name" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" /></div></div>
          )}
          <div><label className="lab" htmlFor="email">Work email</label><div className="inp"><input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></div></div>
          <div><label className="lab" htmlFor="password">Password</label><div className="inp"><input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete={mode === "signin" ? "current-password" : "new-password"} /></div></div>
          <div><label className="lab" htmlFor="code">Invite code<small>Optional</small></label><div className="inp"><input id="code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Join a teammate’s workspace" /></div></div>
          {error && <ErrorBox>{error}</ErrorBox>}
          {info && <div className="note-box">{info}</div>}
          <button className="btn pri lg" type="submit" disabled={busy}>{busy && <Spinner />}{mode === "signin" ? "Sign in" : "Create account"}</button>
        </form>
        <p className="switch-mode">
          {mode === "signin" ? "New to Plumb? " : "Already have an account? "}
          <button className="link-btn" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(null); }}>
            {mode === "signin" ? "Create an account" : "Sign in"}
          </button>
        </p>
      </div>
    </main>
  );
}
