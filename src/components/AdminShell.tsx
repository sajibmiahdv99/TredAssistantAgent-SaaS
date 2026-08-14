import { useState, type ReactNode } from "react";
import { Link, Outlet, useRouter, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users,
  CreditCard,
  DollarSign,
  Radio,
  FileCheck,
  TrendingUp,
  ShieldCheck,
  UserCheck,
  Landmark,
  LifeBuoy,
  FileText,
  Settings,
  ArrowLeft,
  Menu,
  X,
  LogOut,
  Activity,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { BRAND } from "@/lib/brand";

type Nav = { label: string; to: string; icon: typeof LayoutDashboard; exact?: boolean };
const adminNav: Nav[] = [
  { label: "Overview", to: "/admin", icon: LayoutDashboard, exact: true },
  { label: "Monitoring", to: "/admin/monitoring", icon: Activity },
  { label: "Users", to: "/admin/users", icon: Users },
  { label: "Subscriptions", to: "/admin/subscriptions", icon: CreditCard },
  { label: "Payments", to: "/admin/payments", icon: DollarSign },
  { label: "Sources", to: "/admin/sources", icon: Radio },
  { label: "Parsed Signals", to: "/admin/parsed-signals", icon: FileCheck },
  { label: "Trades", to: "/admin/trades", icon: TrendingUp },
  { label: "Risk Templates", to: "/admin/risk-templates", icon: ShieldCheck },
  { label: "Affiliates", to: "/admin/affiliates", icon: UserCheck },
  { label: "Payouts", to: "/admin/payouts", icon: Landmark },
  { label: "Support", to: "/admin/support", icon: LifeBuoy },
  { label: "Audit Logs", to: "/admin/audit-logs", icon: FileText },
  { label: "Settings", to: "/admin/settings", icon: Settings },
];

export function AdminShell({ children }: { children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  async function signOut() {
    await supabase.auth.signOut();
    router.navigate({ to: "/auth", replace: true });
  }

  const NavList = ({ onClick }: { onClick?: () => void }) => (
    <nav className="flex-1 space-y-1 px-3 overflow-y-auto">
      {adminNav.map((item) => {
        const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
        return (
          <Link
            key={item.to}
            to={item.to as never}
            onClick={onClick}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
              active
                ? "bg-amber-500/10 text-amber-400"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-sidebar lg:flex">
        <div className="p-5">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-amber-500 text-sm font-bold text-background">
              {BRAND.adminInitial}
            </span>
            <div>
              <div className="text-base font-semibold leading-none">Admin Panel</div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-1">
                {BRAND.name}
              </div>
            </div>
          </div>
        </div>
        <NavList />
        <div className="space-y-2 border-t border-border p-4">
          <Link
            to="/app"
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Back to app
          </Link>
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
          <button onClick={() => setOpen((v) => !v)} className="p-2">
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <span className="font-semibold text-amber-400">Admin</span>
          <Link to="/app" className="p-2 text-muted-foreground">
            <ArrowLeft className="h-5 w-5" />
          </Link>
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
