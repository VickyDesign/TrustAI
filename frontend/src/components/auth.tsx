"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { api } from "@/lib/api";
import type { Me } from "@/lib/types";
import { Logo } from "./Icon";
import { ErrorBox, Spinner } from "./ui";

interface AuthValue { me: Me; reloadMe: () => Promise<void>; signOut: () => Promise<void> }
const AuthCtx = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const v = useContext(AuthCtx);
  if (!v) throw new Error("useAuth outside AuthGate");
  return v;
}

/** Requires a Supabase session, loads the workspace from the API, and shares it with the page. */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reloadMe = useCallback(async () => {
    try {
      setMe(await api<Me>("/me"));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    supabase().auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (!data.session) router.replace("/login");
      else reloadMe();
    });
    const { data: sub } = supabase().auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") router.replace("/login");
    });
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, [router, reloadMe]);

  const signOut = useCallback(async () => {
    await supabase().auth.signOut();
    router.replace("/login");
  }, [router]);

  if (error) {
    return (
      <div className="auth">
        <div className="auth-card">
          <Logo />
          <h1>Can’t load your workspace</h1>
          <div style={{ marginTop: 16 }}><ErrorBox>{error}</ErrorBox></div>
          <div className="row" style={{ marginTop: 18 }}>
            <button className="btn pri" onClick={reloadMe}>Try again</button>
            <button className="btn ghost" onClick={signOut}>Sign out</button>
          </div>
        </div>
      </div>
    );
  }
  if (!me) {
    return <div className="auth"><Spinner size={22} /></div>;
  }
  return <AuthCtx.Provider value={{ me, reloadMe, signOut }}>{children}</AuthCtx.Provider>;
}
