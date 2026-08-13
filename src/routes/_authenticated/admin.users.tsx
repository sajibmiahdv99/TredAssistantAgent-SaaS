import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useMutation, useQueryClient, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader } from "@/components/PageHeader";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { adminListUsers, adminSetUserActive, adminGrantRole } from "@/lib/admin.functions";

const opts = queryOptions({ queryKey: ["admin", "users"], queryFn: () => adminListUsers() });

export const Route = createFileRoute("/_authenticated/admin/users")({
  loader: ({ context }) => context.queryClient.ensureQueryData(opts),
  component: Page,
  errorComponent: ({ error }) => <p className="text-sm text-destructive">{error.message}</p>,
  notFoundComponent: () => <p>Not found.</p>,
});

function Page() {
  const { data } = useSuspenseQuery(opts);
  const qc = useQueryClient();
  const toggleActive = useServerFn(adminSetUserActive);
  const grantRole = useServerFn(adminGrantRole);

  const setActive = useMutation({
    mutationFn: (v: { user_id: string; is_active: boolean }) => toggleActive({ data: v }),
    onSuccess: () => { toast.success("Updated"); qc.invalidateQueries({ queryKey: ["admin", "users"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const toggleAdmin = useMutation({
    mutationFn: (v: { user_id: string; grant: boolean }) => grantRole({ data: { user_id: v.user_id, role: "admin", grant: v.grant } }),
    onSuccess: () => { toast.success("Updated"); qc.invalidateQueries({ queryKey: ["admin", "users"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <PageHeader title="Users" subtitle={`${data.length} accounts`} />
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <div className="font-medium">{u.full_name || "—"}</div>
                  <div className="text-xs text-muted-foreground">{u.email}</div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {u.roles.length === 0 ? <Badge variant="outline">user</Badge> : u.roles.map((r) => <Badge key={r} variant={r === "admin" ? "default" : "secondary"}>{r}</Badge>)}
                  </div>
                </TableCell>
                <TableCell>{u.is_active ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Disabled</Badge>}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{new Date(u.created_at).toLocaleDateString()}</TableCell>
                <TableCell className="text-right space-x-2">
                  <Button size="sm" variant="outline" onClick={() => toggleAdmin.mutate({ user_id: u.id, grant: !u.roles.includes("admin") })} disabled={toggleAdmin.isPending}>
                    {u.roles.includes("admin") ? "Revoke admin" : "Make admin"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setActive.mutate({ user_id: u.id, is_active: !u.is_active })} disabled={setActive.isPending}>
                    {u.is_active ? "Disable" : "Enable"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
