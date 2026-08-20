import { useState, type ReactNode } from "react";
import { Link, Outlet, useRouter, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Network,
  Send,
  ShieldCheck,
  TrendingUp,
  History,
  BarChart3,
  CreditCard,
  Users,
  LifeBuoy,
  Settings,
  LogOut,
  Menu,
  X,
  Shield,
  Flame,
  FlaskConical,
  User,
  Store,
  SlidersHorizontal,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getMyProfile } from "@/lib/profile.functions";
import { getMyRoles } from "@/lib/auth/role.functions";
import { BRAND } from "@/lib/brand";

type Nav = { label: string; to: string; icon: typeof LayoutDashboard; exact?: boolean };
const nav: Nav[] = [
  { label: "Overview", to: "/app", icon: LayoutDashboard, exact: true },
  { label: "Active Trades", to: "/app/active-trades", icon: TrendingUp },
  { label: "Trade History", to: "/app/trade-history", icon: History },
  { label: "Analytics", to: "/app/analytics", icon: BarChart3 },
  { label: "Exchanges", to: "/app/exchanges", icon: Network },
  { label: "Sources", to: "/app/sources", icon: Send },
  { label: "Risk", to: "/app/risk", icon: ShieldCheck },
  { label: "Risk Optimizer", to: "/app/risk-optimizer", icon: SlidersHorizontal },
  { label: "Heat Map", to: "/app/heatmap", icon: Flame },
  { label: "Backtest", to: "/app/backtest", icon: FlaskConical },
  { label: "Marketplace", to: "/app/marketplace", icon: Store },
  { label: "Billing", to: "/app/billing", icon: CreditCard },
  { label: "Referrals", to: "/app/referrals", icon: Users },
  { label: "Support", to: "/app/support", icon: LifeBuoy },
  { label: "Preferences", to: "/app/preferences", icon: Settings },
  { label: "Profile", to: "/app/profile", icon: User },
];

export function AppShell({ children }: { children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const profile = useQuery({ queryKey: ["my-profile"], queryFn: () => getMyProfile() });
  const roles = useQuery({ queryKey: ["my-roles"], queryFn: () => getMyRoles() });

  async function signOut() {
    await supabase.auth.signOut();
    router.navigate({ to: "/auth", replace: true });
  }

  const NavList = ({ onClick }: { onClick?: () => void }) => (
    <nav className="flex-1 space-y-1 px-3 overflow-y-auto">
      {nav.map((item) => {
        const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
        return (
          <Link
            key={item.to}
            to={item.to as never}
            onClick={onClick}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
      {roles.data?.isAdmin && (
        <Link
          to="/admin"
          onClick={onClick}
          className="mt-4 flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-amber-400 hover:bg-accent"
        >
          <Shield className="h-4 w-4" /> Admin Panel
        </Link>
      )}
    </nav>
  );

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-sidebar lg:flex">
        <div className="p-5">
          <Link to="/" className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
              {BRAND.logoInitial}
            </span>
            <div>
              <div className="text-base font-semibold leading-none">{BRAND.name}</div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-1">
                {BRAND.tagline}
              </div>
            </div>
          </Link>
        </div>
        <NavList />
        <div className="border-t border-border p-4">
          <div className="mb-3 flex items-center gap-3">
            <div className="grid h-8 w-8 place-items-center rounded-full bg-primary/20 text-sm font-semibold text-primary">
              {profile.data?.full_name?.[0]?.toUpperCase() ?? "U"}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                {profile.data?.full_name || "User"}
              </div>
              <div className="truncate text-xs text-muted-foreground">{profile.data?.email}</div>
            </div>
          </div>
          <button
            onClick={signOut}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-border p-4 lg:hidden">
          <button
            onClick={() => setOpen((v) => !v)}
            className="p-2"
            aria-label={open ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={open}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
              {BRAND.logoInitial}
            </span>
            <span className="font-semibold">{BRAND.name}</span>
          </div>
          <button onClick={signOut} className="p-2 text-muted-foreground" aria-label="Sign out">
            <LogOut className="h-5 w-5" />
          </button>
        </div>
        {open && (
          <div className="border-b border-border bg-sidebar p-3 lg:hidden">
            <NavList onClick={() => setOpen(false)} />
          </div>
        )}
        <div className="flex-1 p-4 sm:p-6 lg:p-8">{children ?? <Outlet />}</div>
      </main>
    </div>
  );
}
