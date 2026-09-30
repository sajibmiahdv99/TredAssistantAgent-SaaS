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
  const [info, setInfo] = useState<string | null>(null);
  const [isRecovery, setIsRecovery] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [providers, setProviders] = useState({ google: false, apple: false });

  // MFA challenge state
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");

  // "Login with Telegram" — bot-less phone + code (MTProto, no bot)
  const [tgPhone, setTgPhone] = useState("");
  const [tgRef, setTgRef] = useState<string | null>(null);
  const [tgCode, setTgCode] = useState("");
  const [tgPw, setTgPw] = useState("");
  const [tgNeedsPw, setTgNeedsPw] = useState(false);
  const [tgBusy, setTgBusy] = useState(false);
  const [tgErr, setTgErr] = useState<string | null>(null);
  const [tgOpen, setTgOpen] = useState(false);
  const [remember, setRemember] = useState(true);
  const [forgot, setForgot] = useState(false);

  const destination = safeNext(next);

  function goAfterAuth() {
    if (destination) {
      window.location.replace(destination);
      return;
    }
    router.navigate({ to: "/app", replace: true });
  }

  async function tgSendCode() {
    setTgBusy(true);
    setTgErr(null);
    try {
      const res = await fetch("/api/public/telegram-phone-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: tgPhone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to send a Telegram code.");
      setTgRef(data.ref as string);
    } catch (e) {
      setTgErr(e instanceof Error ? e.message : "Failed to send a Telegram code.");
    } finally {
      setTgBusy(false);
    }
  }

  async function tgVerify() {
    setTgBusy(true);
    setTgErr(null);
    try {
      const res = await fetch("/api/public/telegram-phone-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ref: tgRef,
          code: tgCode,
          password: tgNeedsPw ? tgPw : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Telegram login failed.");
      if (data.needsPassword) {
        setTgNeedsPw(true);
        return;
      }
      const { error } = await supabase.auth.signInWithPassword({
        email: data.email as string,
        password: data.password as string,
      });
      if (error) throw error;
      goAfterAuth();
    } catch (e) {
      setTgErr(e instanceof Error ? e.message : "Telegram login failed.");
    } finally {
      setTgBusy(false);
    }
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
    const controller = new AbortController();
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
      signal: controller.signal,
    }).then((response) => response.ok ? response.json() : null).then((settings) => {
      if (settings) setProviders({ google: settings.external?.google === true, apple: settings.external?.apple === true });
    }).catch(() => {});
    if (new URLSearchParams(window.location.hash.slice(1)).get("type") === "recovery") {
      setIsRecovery(true);
    }
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setIsRecovery(true);
        setPassword("");
        setErr(null);
      }
    });
    // If arriving here via router-guard redirect with an active aal1 session,
    // immediately show the TOTP challenge without requiring password re-entry.
    checkAalAndMaybePromptMfa().catch(() => {});
    return () => { controller.abort(); subscription.unsubscribe(); };
  }, []);

  async function updatePassword(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (password !== confirmPassword) {
      setErr("Passwords must match.");
      return;
    }
    setBusy(true);
    try {
      if (await checkAalAndMaybePromptMfa()) return;
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      await supabase.auth.signOut();
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      setIsRecovery(false);
      setIsSignup(false);
      setPassword("");
      setConfirmPassword("");
      setInfo("Password updated. Sign in with your new password.");
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Password update failed.");
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setInfo(null);
    setBusy(true);
    try {
      if (isSignup) {
        const emailRedirectTo = destination
          ? `${window.location.origin}${destination}`
          : window.location.origin;
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo, data: { full_name: name } },
        });
        if (error) throw error;
        if (data.session) goAfterAuth();
        else setInfo("Check your inbox and confirm your email before signing in.");
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
      if (isRecovery) setMfaFactorId(null);
      else goAfterAuth();
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

  async function socialLogin(provider: "google" | "apple" | "telegram") {
    if (provider === "telegram") {
      setTgOpen(true);
      return;
    }
    setErr(null);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${window.location.origin}/auth` },
      });
      if (error) setErr(error.message);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Social login failed.");
    }
  }

  async function forgotPassword() {
    if (!email) {
      setErr("Enter your email address first.");
      setForgot(true);
      return;
    }
    setErr(null);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth`,
      });
      if (error) setErr(error.message);
      else setInfo("Check your inbox to reset your password.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Password reset failed.");
    }
  }

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

  if (isRecovery) return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <form onSubmit={updatePassword} className="w-full max-w-md space-y-5 rounded-2xl border border-border bg-card p-8">
        <h1 className="text-2xl font-semibold">Choose a new password</h1>
        <label className="block">New password
          <input type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="mt-2 w-full rounded-md border border-border bg-background px-4 py-3" />
        </label>
        <label className="block">Confirm new password
          <input type="password" autoComplete="new-password" required minLength={8} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="mt-2 w-full rounded-md border border-border bg-background px-4 py-3" />
        </label>
        {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
        <button disabled={busy} className="w-full rounded-md bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-50">{busy ? "Updating…" : "Update password"}</button>
      </form>
    </div>
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        {/* Brand logo — top-left, like Cornix */}
        <Link to="/" className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
            {BRAND.logoInitial}
          </span>
          <span className="text-lg font-semibold">{BRAND.name}</span>
        </Link>

        {/* Centered heading — Cornix style */}
        <div className="mt-10 text-center">
          <h1 className="text-3xl font-bold tracking-tight">Welcome to {BRAND.name}!</h1>
          <p className="mt-2 text-lg text-muted-foreground">
            {isSignup ? "Create your Account" : "Login to your Account"}
          </p>
        </div>

        <form onSubmit={onSubmit} className="mt-8 space-y-5">
          {isSignup && (
            <div>
              <label className="mb-1 block text-sm font-medium text-muted-foreground">Full name</label>
              <input
                type="text"
                required
                placeholder="Full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-md border border-border bg-transparent px-4 py-3 text-center text-base outline-none focus:border-primary"
              />
            </div>
          )}
          <div>
            <label className="mb-1 block text-sm font-medium text-muted-foreground">Email</label>
            <input
              type="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-border bg-transparent px-4 py-3 text-center text-base outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-muted-foreground">Password</label>
            <input
              type="password"
              required
              minLength={6}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-border bg-transparent px-4 py-3 text-center text-base outline-none focus:border-primary"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            Remember me for 30 days
          </label>

          {err && <p className="text-center text-sm text-destructive">{err}</p>}
          {info && <p role="status" className="text-center text-sm text-primary">{info}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-primary px-4 py-3 text-base font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "…" : isSignup ? "Create account" : "Login"}
          </button>
        </form>

        <div className="mt-5 text-center">
          <button onClick={forgotPassword} className="text-sm text-muted-foreground hover:text-foreground">
            Forgot Password?
          </button>
        </div>
        <p className="mt-2 text-center text-sm">
          {isSignup ? "Already have an Account? " : "Don't have an Account? "}
          <button onClick={() => setIsSignup((v) => !v)} className="font-medium text-primary hover:underline">
            {isSignup ? "Login" : "Register"}
          </button>
        </p>

        {/* Social login — Cornix icon row */}
        <div className="mt-8 flex items-center gap-4">
          <div className="h-px flex-1 bg-border" />
          <span className="text-sm text-muted-foreground">Or login with</span>
          <div className="h-px flex-1 bg-border" />
        </div>
        <div className="mt-6 flex items-center justify-center gap-6">
          {providers.google && <button
            type="button"
            onClick={() => socialLogin("google")}
            title="Continue with Google"
            className="grid h-11 w-11 place-items-center rounded-full border border-border bg-card transition hover:border-primary"
          >
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.57-5.17 3.57-8.81z" />
              <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3c-1.08.72-2.45 1.16-4.06 1.16-3.13 0-5.78-2.11-6.73-4.96H1.28v3.09A12 12 0 0 0 12 24z" />
              <path fill="#FBBC05" d="M5.27 14.29a7.2 7.2 0 0 1 0-4.58V6.62H1.28a12 12 0 0 0 0 10.76l3.99-3.09z" />
              <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42A11.97 11.97 0 0 0 12 0 12 12 0 0 0 1.28 6.62l3.99 3.09C6.22 6.86 8.87 4.75 12 4.75z" />
            </svg>
          </button>}
          {providers.apple && <button
            type="button"
            onClick={() => socialLogin("apple")}
            title="Continue with Apple"
            className="grid h-11 w-11 place-items-center rounded-full border border-border bg-card text-current transition hover:border-primary"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M17.05 12.54c-.02-2.51 2.05-3.72 2.14-3.78-1.17-1.71-2.99-1.94-3.63-1.97-1.54-.16-3.01.91-3.79.91-.78 0-1.99-.89-3.27-.86-1.68.02-3.23.98-4.09 2.48-1.75 3.03-.45 7.51 1.25 9.97.83 1.2 1.82 2.55 3.12 2.5 1.25-.05 1.73-.81 3.24-.81s1.94.81 3.27.78c1.35-.02 2.2-1.22 3.03-2.43.95-1.4 1.34-2.75 1.36-2.82-.03-.01-2.61-1.01-2.63-3.97zM14.5 4.8c.69-.84 1.16-2 1.03-3.16-1 .04-2.2.66-2.91 1.5-.64.74-1.2 1.93-1.05 3.07 1.11.09 2.24-.56 2.93-1.41z" />
            </svg>
          </button>}
          <button
            type="button"
            onClick={() => socialLogin("telegram")}
            title="Continue with Telegram"
            className="grid h-11 w-11 place-items-center rounded-full border border-border bg-card transition hover:border-primary"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="#229ED9">
              <path d="M11.94 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm4.09 8.2-1.55 7.3c-.11.5-.4.63-.82.39l-2.26-1.67-1.09 1.05c-.12.12-.22.22-.45.22l.16-2.29 4.16-3.76c.18-.16-.04-.25-.28-.09l-5.14 3.24-2.21-.69c-.48-.15-.49-.48.1-.71l8.64-3.33c.4-.14.75.09.62.55z" />
            </svg>
          </button>
        </div>
        <p className="mt-8 text-center text-xs text-muted-foreground">Always verify</p>
      </div>

      {/* Bot-less Telegram login — modern branded 2-step modal (no bot) */}
      {tgOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
          onClick={() => setTgOpen(false)}
        >
          <div
            className="w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Telegram-blue header */}
            <div className="flex items-center justify-between bg-[#229ED9] px-5 py-4 text-white">
              <div className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-white/15">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="#fff">
                    <path d="M11.94 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm4.09 8.2-1.55 7.3c-.11.5-.4.63-.82.39l-2.26-1.67-1.09 1.05c-.12.12-.22.22-.45.22l.16-2.29 4.16-3.76c.18-.16-.04-.25-.28-.09l-5.14 3.24-2.21-.69c-.48-.15-.49-.48.1-.71l8.64-3.33c.4-.14.75.09.62.55z" />
                  </svg>
                </span>
                <span className="text-base font-semibold">Sign in with Telegram</span>
              </div>
              <button onClick={() => setTgOpen(false)} className="text-2xl leading-none text-white/70 hover:text-white">
                &times;
              </button>
            </div>

            <div className="px-6 py-6">
              {/* step wave */}
              <div className="mb-5 flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${tgRef ? "bg-[#229ED9]" : "bg-muted"}`} />
                <span className={`h-0.5 w-8 rounded ${tgRef ? "bg-[#229ED9]" : "bg-muted"}`} />
                <span className={`h-2.5 w-2.5 rounded-full ${tgRef ? "bg-[#229ED9]" : "bg-muted"}`} />
                <span className="ml-2 text-xs font-medium text-muted-foreground">Step {tgRef ? 2 : 1} of 2</span>
              </div>
              <p className="mb-4 text-sm text-muted-foreground">
                No bot needed — we&apos;ll send a login code straight to your Telegram.
              </p>

              {!tgRef ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    tgSendCode();
                  }}
                  className="space-y-3"
                >
                  <div className="flex items-center rounded-lg border border-border bg-background focus-within:border-[#229ED9]">
                    <span className="flex items-center border-r border-border px-3 text-sm text-muted-foreground">+880</span>
                    <input
                      value={tgPhone}
                      onChange={(e) => setTgPhone(e.target.value)}
                      placeholder="1 555 555 5555"
                      autoComplete="tel"
                      className="w-full bg-transparent px-3 py-3 text-sm outline-none"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={tgBusy}
                    className="w-full rounded-lg bg-[#229ED9] px-4 py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {tgBusy ? "Sending code…" : "Send code"}
                  </button>
                </form>
              ) : !tgNeedsPw ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    tgVerify();
                  }}
                  className="space-y-3"
                >
                  <input
                    value={tgCode}
                    onChange={(e) => setTgCode(e.target.value)}
                    placeholder="Login code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    className="w-full rounded-lg border border-border bg-background px-3 py-3 text-center text-lg tracking-[0.4em] outline-none focus:border-[#229ED9]"
                  />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <button type="button" onClick={tgSendCode} disabled={tgBusy} className="hover:text-[#229ED9]">
                      Resend code
                    </button>
                    <span>Sent to +880{tgPhone}</span>
                  </div>
                  <button
                    type="submit"
                    disabled={tgBusy}
                    className="w-full rounded-lg bg-[#229ED9] px-4 py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {tgBusy ? "Signing in…" : "Verify & Sign in"}
                  </button>
                </form>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    tgVerify();
                  }}
                  className="space-y-3"
                >
                  <p className="text-xs text-muted-foreground">This account uses a Telegram password — enter it below.</p>
                  <input
                    type="password"
                    value={tgPw}
                    onChange={(e) => setTgPw(e.target.value)}
                    placeholder="Telegram password"
                    autoComplete="current-password"
                    className="w-full rounded-lg border border-border bg-background px-3 py-3 text-sm outline-none focus:border-[#229ED9]"
                  />
                  <button
                    type="submit"
                    disabled={tgBusy}
                    className="w-full rounded-lg bg-[#229ED9] px-4 py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {tgBusy ? "Signing in…" : "Verify & Sign in"}
                  </button>
                </form>
              )}
              {tgErr && <p className="mt-3 text-center text-sm text-destructive">{tgErr}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
