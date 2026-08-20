import { createFileRoute, Link, useRouter, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { BRAND } from "@/lib/brand";

const search = z.object({
  mode: z.enum(["signin", "signup"]).optional(),
  next: z.string().optional(),
});

export const Route = createFileRoute("/auth")({
  validateSearch: search,
  head: () => ({ meta: [{ title: `Sign in — ${BRAND.name}` }] }),
  component: AuthPage,
});

function safeNext(next: string | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith("/") || next.startsWith("//")) return null;
  return next;
}

function AuthPage() {
  const { mode, next } = useSearch({ from: "/auth" });
  const router = useRouter();
  const [isSignup, setIsSignup] = useState(mode === "signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // MFA challenge state
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");

  // "Login with Telegram" (Cornix-style bot login)
  const [tg, setTg] = useState<{
    token: string;
    url: string;
    status: "idle" | "waiting" | "error";
    msg: string;
  }>({ token: "", url: "", status: "idle", msg: "" });

  const destination = safeNext(next);

  function goAfterAuth() {
    if (destination) {
      window.location.replace(destination);
      return;
    }
    router.navigate({ to: "/app", replace: true });
  }

  async function checkAalAndMaybePromptMfa(): Promise<boolean> {
    // Returns true if MFA challenge is required (caller should NOT navigate)
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) return false;
    if (data.nextLevel === "aal2" && data.nextLevel !== data.currentLevel) {
      const { data: fData, error: fErr } = await supabase.auth.mfa.listFactors();
      if (fErr) {
        setErr(fErr.message);
        return true;
      }
      const totp = (fData.totp ?? []).find((f) => f.status === "verified");
      if (!totp) return false;
      setMfaFactorId(totp.id);
      return true;
    }
    return false;
  }

  useEffect(() => {
    // If arriving here via router-guard redirect with an active aal1 session,
    // immediately show the TOTP challenge without requiring password re-entry.
    checkAalAndMaybePromptMfa().catch(() => {});
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      if (isSignup) {
        const emailRedirectTo = destination
          ? `${window.location.origin}${destination}`
          : window.location.origin;
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo, data: { full_name: name } },
        });
        if (error) throw error;
        goAfterAuth();
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        const needsMfa = await checkAalAndMaybePromptMfa();
        if (!needsMfa) goAfterAuth();
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  async function verifyMfa(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaFactorId) return;
    setErr(null);
    setBusy(true);
    try {
      const ch = await supabase.auth.mfa.challenge({ factorId: mfaFactorId });
      if (ch.error) throw ch.error;
      const v = await supabase.auth.mfa.verify({
        factorId: mfaFactorId,
        challengeId: ch.data.id,
        code: mfaCode.trim(),
      });
      if (v.error) throw v.error;
      goAfterAuth();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Invalid code. Please try again.");
      setMfaCode("");
    } finally {
      setBusy(false);
    }
  }

  async function cancelMfa() {
    await supabase.auth.signOut();
    setMfaFactorId(null);
    setMfaCode("");
    setErr(null);
  }

  async function startTelegramLogin() {
    setTg({ token: "", url: "", status: "waiting", msg: "Contacting Telegram…" });
    try {
      const res = await fetch("/api/public/telegram-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      const data = await res.json();
      if (!res.ok || !data.token) throw new Error(data.error ?? "Could not start Telegram login");
      setTg({ token: data.token, url: data.url, status: "waiting", msg: "Open the link and press Start" });
    } catch (e) {
      setTg({ token: "", url: "", status: "error", msg: e instanceof Error ? e.message : "Failed" });
    }
  }

  // Poll the Telegram login status until approved.
  useEffect(() => {
    if (tg.status !== "waiting" || !tg.token) return;
    const poll = async () => {
      try {
        const res = await fetch("/api/public/telegram-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "status", token: tg.token }),
        });
        const data = await res.json();
        if (data.status === "ready" && data.email && data.password) {
          clearInterval(i);
          const { error } = await supabase.auth.signInWithPassword({
            email: data.email,
            password: data.password,
          });
          if (error) {
            setTg({ token: "", url: "", status: "error", msg: error.message });
            return;
          }
          goAfterAuth();
        } else if (data.status === "expired") {
          clearInterval(i);
          setTg({ token: "", url: "", status: "error", msg: "Login link expired. Try again." });
        }
      } catch {
        // transient — keep polling
      }
    };
    const i = setInterval(poll, 2000);
    poll();
    return () => clearInterval(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tg.token, tg.status]);

  if (mfaFactorId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8">
          <Link to="/" className="mb-6 flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
              {BRAND.logoInitial}
            </span>
            <span className="text-lg font-semibold">{BRAND.name}</span>
          </Link>
          <h1 className="text-2xl font-semibold">Two-factor authentication</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Enter the 6-digit code from your authenticator app.
          </p>
          <form onSubmit={verifyMfa} className="mt-6 space-y-3">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              placeholder="123456"
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ""))}
              className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-center text-lg tracking-[0.5em] outline-none focus:ring-2 focus:ring-primary"
              autoFocus
            />
            {err && <p className="text-sm text-destructive">{err}</p>}
            <button
              type="submit"
              disabled={busy || mfaCode.length !== 6}
              className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "…" : "Verify"}
            </button>
            <button
              type="button"
              onClick={cancelMfa}
              className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
            >
              Cancel and sign out
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8">
        <Link to="/" className="mb-6 flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
            {BRAND.logoInitial}
          </span>
          <span className="text-lg font-semibold">{BRAND.name}</span>
        </Link>
        <h1 className="text-2xl font-semibold">
          {isSignup ? "Create your account" : "Welcome back"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isSignup ? "Start your 7-day free trial." : "Sign in to your workstation."}
        </p>

        <form onSubmit={onSubmit} className="mt-6 space-y-3">
          {isSignup && (
            <input
              type="text"
              required
              placeholder="Full name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary"
            />
          )}
          <input
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary"
          />
          <input
            type="password"
            required
            minLength={6}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary"
          />
          {err && <p className="text-sm text-destructive">{err}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "…" : isSignup ? "Create account" : "Sign in"}
          </button>
        </form>

        <div className="mt-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">or continue with</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        {tg.status === "waiting" ? (
          <div className="mt-4 rounded-md border border-border bg-muted p-4 text-sm">
            <p className="font-medium">Login with Telegram</p>
            <p className="mt-1 text-muted-foreground">
              {tg.url ? (
                <>
                  Open the link and press{" "}
                  <span className="font-medium text-foreground">Start</span> on the bot, then come
                  back here.
                </>
              ) : (
                tg.msg
              )}
            </p>
            {tg.url && (
              <a
                href={tg.url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block max-w-full truncate rounded-md border bg-background px-3 py-1.5 font-mono text-xs text-primary hover:underline"
              >
                {tg.url}
              </a>
            )}
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              Waiting for approval…
            </div>
            <button
              type="button"
              onClick={() => setTg({ token: "", url: "", status: "idle", msg: "" })}
              className="mt-2 text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={startTelegramLogin}
            disabled={busy}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-md border border-border bg-background px-4 py-2.5 text-sm font-semibold hover:bg-muted disabled:opacity-50"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
              <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
            </svg>
            Login with Telegram
          </button>
        )}
        {tg.status === "error" && <p className="mt-2 text-sm text-destructive">{tg.msg}</p>}

        <p className="mt-5 text-center text-sm text-muted-foreground">
          {isSignup ? "Already have an account? " : `New to ${BRAND.name}? `}
          <button onClick={() => setIsSignup((v) => !v)} className="text-primary hover:underline">
            {isSignup ? "Sign in" : "Create one"}
          </button>
        </p>
      </div>
    </div>
  );
}
