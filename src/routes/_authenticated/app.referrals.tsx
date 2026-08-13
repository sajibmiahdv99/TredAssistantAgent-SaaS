import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { PageHeader, Card } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import { getReferrals } from "@/lib/user.functions";

const opts = queryOptions({ queryKey: ["referrals"], queryFn: () => getReferrals() });

export const Route = createFileRoute("/_authenticated/app/referrals")({
  loader: ({ context }) => context.queryClient.ensureQueryData(opts),
  component: Page,
  errorComponent: ({ error }) => <p className="text-sm text-destructive">{error.message}</p>,
  notFoundComponent: () => <p>Not found.</p>,
});

function Page() {
  const { data } = useSuspenseQuery(opts);
  const aff = data.affiliate;
  const code = data.referralCode ?? "";
  const link = typeof window !== "undefined" && code ? `${window.location.origin}/auth?ref=${code}` : "";

  return (
    <>
      <PageHeader title="Referrals" subtitle="Share your link to earn recurring commission." />
      <Card className="mb-6">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Your referral link</p>
        <div className="mt-2 flex gap-2">
          <Input readOnly value={link} />
          <Button variant="outline" onClick={() => { navigator.clipboard.writeText(link); toast.success("Copied"); }}>
            <Copy className="h-4 w-4" />
          </Button>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-4">
        <Card><p className="text-xs uppercase text-muted-foreground">Direct referrals</p><p className="mt-2 text-2xl font-semibold">{aff?.direct_referrals ?? 0}</p></Card>
        <Card><p className="text-xs uppercase text-muted-foreground">Total earned</p><p className="mt-2 text-2xl font-semibold">{Number(aff?.total_earned ?? 0).toFixed(2)}</p></Card>
        <Card><p className="text-xs uppercase text-muted-foreground">Pending</p><p className="mt-2 text-2xl font-semibold">{Number(aff?.total_pending ?? 0).toFixed(2)}</p></Card>
        <Card><p className="text-xs uppercase text-muted-foreground">Paid out</p><p className="mt-2 text-2xl font-semibold">{Number(aff?.total_paid ?? 0).toFixed(2)}</p></Card>
      </div>

      <h2 className="mt-8 mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Recent commissions</h2>
      {data.commissions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No commissions yet.</p>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Level</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.commissions.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="text-xs text-muted-foreground">{new Date(c.created_at).toLocaleDateString()}</TableCell>
                  <TableCell>L{c.level}</TableCell>
                  <TableCell>{Number(c.amount).toFixed(2)}</TableCell>
                  <TableCell className="text-xs uppercase">{c.status}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
