import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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
  Search,
  type LucideIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getMyProfile } from "@/lib/profile.functions";
import { getMyRoles } from "@/lib/auth/role.functions";
import { BRAND } from "@/lib/brand";
import {
  CommandPalette,
  CmdHotkey,
  isMacPlatform,
  type CommandGroup,
} from "@/components/ops/command-palette";
import { SyncStatus } from "@/components/ops/sync-status";

type NavItem = { label: string; to: string; icon: LucideIcon; exact?: boolean; kbd?: string };

const sections: { label: string; items: NavItem[] }[] = [
  {
    label: "General",
    items: [{ label: "Overview", to: "/app", icon: LayoutDashboard, exact: true, kbd: "G O" }],
  },
  {
    label: "Trading",
    items: [
      { label: "Active Trades", to: "/app/active-trades", icon: TrendingUp, kbd: "G T" },
      { label: "Trade History", to: "/app/trade-history", icon: History },
      { label: "Analytics", to: "/app/analytics", icon: BarChart3 },
      { label: "Heat Map", to: "/app/heatmap", icon: Flame },
      { label: "Backtest", to: "/app/backtest", icon: FlaskConical },
    ],
  },
  {
    label: "Connections",
    items: [
      { label: "Exchanges", to: "/app/exchanges", icon: Network, kbd: "G E" },
      { label: "Sources", to: "/app/sources", icon: Send, kbd: "G S" },
    ],
  },
  {
    label: "Risk",
    items: [
      { label: "Risk", to: "/app/risk", icon: ShieldCheck },
      { label: "Risk Optimizer", to: "/app/risk-optimizer", icon: SlidersHorizontal },
    ],
  },
  {
    label: "Account",
    items: [
      { label: "Marketplace", to: "/app/marketplace", icon: Store },
      { label: "Billing", to: "/app/billing", icon: CreditCard },
      { label: "Referrals", to: "/app/referrals", icon: Users },
      { label: "Support", to: "/app/support", icon: LifeBuoy },
      { label: "Preferences", to: "/app/preferences", icon: Settings },
      { label: "Profile", to: "/app/profile", icon: User },
    ],
  },
];


export function AppShell({ children }: { children?: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const profile = useQuery({ queryKey: ["my-profile"], queryFn: () => getMyProfile() });
  const roles = useQuery({ queryKey: ["my-roles"], queryFn: () => getMyRoles() });
  const isAdmin = roles.data?.isAdmin;

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    router.navigate({ to: "/auth", replace: true });
  }, [router]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = isMacPlatform() ? e.metaKey : e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = useCallback(
    (to: string) => {
      router.navigate({ to: to as never });
      setPaletteOpen(false);
      setMenuOpen(false);
    },
    [router],
  );

  const paletteGroups = useMemo<CommandGroup[]>(() => {
    const navGroups: CommandGroup[] = sections.map((section) => ({
      label: section.label,
      items: section.items.map((item) => ({
        id: item.to,
        label: item.label,
        icon: item.icon,
        kbd: item.kbd,
        onSelect: () => go(item.to),
      })),
    }));
    const actions: CommandGroup = {
      label: "Actions",
      items: [
        ...(isAdmin
          ? [
              {
                id: "admin",
                label: "Open Admin Panel",
                icon: Shield,
                onSelect: () => go("/admin"),
              },
            ]
          : []),
        {
          id: "signout",
          label: "Sign out",
          icon: LogOut,
          onSelect: () => {
            setPaletteOpen(false);
            void signOut();
          },
        },
      ],
    };
    return [...navGroups, actions];
  }, [go, isAdmin, signOut]);

  const activeLink = (item: NavItem) =>
    item.exact ? pathname === item.to : pathname.startsWith(item.to);

  const NavList = ({ onNavigate }: { onNavigate?: () => void }) => (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-3">
      {sections.map((section) => (
        <div key={section.label} className="space-y-0.5">
          <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {section.label}
          </div>
          {section.items.map((item) => {
            const active = activeLink(item);
            return (
              <Link
                key={item.to}
                to={item.to as never}
                onClick={onNavigate}
                className={`group flex items-center gap-2.5 rounded-md border-l-2 py-1.5 pl-2.5 pr-2 text-[13px] transition-colors ${
                  active
                    ? "border-l-primary bg-primary/10 text-foreground"
                    : "border-l-transparent text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                <item.icon
                  className={`h-4 w-4 shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`}
                />
                <span className="flex-1 truncate">{item.label}</span>
                {item.kbd && (
                  <span className="hidden font-mono text-[10px] text-muted-foreground/60 group-hover:text-muted-foreground xl:inline">
                    {item.kbd}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ))}
      {isAdmin && (
        <Link
          to="/admin"
          onClick={onNavigate}
          className="flex items-center gap-2.5 rounded-md border-l-2 border-l-transparent py-1.5 pl-2.5 pr-2 text-[13px] text-amber-400/90 hover:bg-secondary"
        >
          <Shield className="h-4 w-4" />
          <span className="flex-1">Admin Panel</span>
        </Link>
      )}
    </nav>
  );

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-sidebar lg:flex">
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-4">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
              {BRAND.logoInitial}
            </span>
            <span className="flex flex-col leading-none">
              <span className="text-[13px] font-semibold tracking-tight">{BRAND.name}</span>
              <span className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {BRAND.tagline}
              </span>
            </span>
          </Link>
        </div>
        <NavList />
        <div className="border-t border-border p-3">
          <div className="mb-2 flex items-center gap-2.5">
            <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
              {profile.data?.full_name?.[0]?.toUpperCase() ?? "U"}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-foreground">
                {profile.data?.full_name || "User"}
              </div>
              <div className="truncate text-[11px] text-muted-foreground">{profile.data?.email}</div>
            </div>
          </div>
          <button
            onClick={signOut}
            className="flex items-center gap-2 text-[12px] text-muted-foreground hover:text-foreground"
          >
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background/80 px-3 backdrop-blur-sm sm:px-4">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="p-2 text-muted-foreground lg:hidden"
            aria-label="Toggle navigation"
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <span className="grid h-6 w-6 place-items-center rounded bg-primary text-[10px] font-bold text-primary-foreground lg:hidden">
            {BRAND.logoInitial}
          </span>

          <button
            onClick={() => setPaletteOpen(true)}
            className="hidden h-8 items-center gap-2 rounded-md border border-border bg-secondary px-2.5 text-muted-foreground hover:bg-secondary/70 md:flex md:w-64 md:justify-between"
          >
            <span className="flex items-center gap-2 text-[13px]">
              <Search className="h-3.5 w-3.5" /> Search…
            </span>
            <CmdHotkey />
          </button>

          <div className="flex-1" />

          <SyncStatus state="live" />
        </header>

        {menuOpen && (
          <div className="border-b border-border bg-sidebar p-2 lg:hidden">
            <NavList onNavigate={() => setMenuOpen(false)} />
          </div>
        )}

        <div className="flex-1 overflow-auto p-4 sm:p-6 lg:p-8">{children ?? <Outlet />}</div>
      </main>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} groups={paletteGroups} />
    </div>
  );
}
