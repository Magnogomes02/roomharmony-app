import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "gestor" | "profissional" | "visualizador";

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  role: AppRole | null;
  isOwner: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  revalidateAccess: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        // defer to avoid deadlock inside the auth callback
        setTimeout(() => { void resolveAccess(); }, 0);
      } else {
        setRole(null);
        setIsOwner(false);
      }
    });

    supabase.auth.getSession().then(async ({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) await resolveAccess();
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function resolveAccess() {
    // 1) Owner self-heal: guarantees profile + gestor role for owner emails.
    try {
      const { data: ensured } = await supabase.rpc("ensure_owner_access");
      const payload = ensured as { ok?: boolean; is_owner?: boolean } | null;
      if (payload?.ok && payload.is_owner) {
        setIsOwner(true);
        setRole("gestor");
        return;
      }
    } catch {
      // RPC may not exist in legacy envs — fall through to user_roles lookup
    }

    // 2) Fallback: read user_roles. Never downgrade an owner.
    setIsOwner(false);
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .order("role", { ascending: true })
      .limit(1)
      .maybeSingle();
    setRole((data?.role as AppRole) ?? "visualizador");
  }

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }

  async function signUp(email: string, password: string, fullName: string) {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        data: { full_name: fullName },
      },
    });
    return { error: error?.message ?? null };
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  async function revalidateAccess() {
    await resolveAccess();
  }

  return (
    <AuthContext.Provider
      value={{ user, session, role, isOwner, loading, signIn, signUp, signOut, revalidateAccess }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
