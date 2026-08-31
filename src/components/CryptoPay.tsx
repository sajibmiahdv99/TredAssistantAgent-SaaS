import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getCryptoPayInfo,
  startCryptoPayment,
  verifyCryptoPayment,
} from "@/lib/crypto-pay.functions";
import { getBilling } from "@/lib/user.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface PlanRow {
  code: string;
  name: string;
  monthly_price: number | null;
  yearly_price: number | null;
  max_open_positions: number | null;
  max_daily_trades: number | null;
}

const cryptoInfoOpts = {
  queryKey: ["cryptoPayInfo"],
  queryFn: () => getCryptoPayInfo(),
};

export function CryptoPay() {
  const qc = useQueryClient();
  const { data: info } = useQuery(cryptoInfoOpts);
  const { data: billing } = useQuery({
    queryKey: ["billing"],
    queryFn: () => getBilling(),
  });

  const startFn = useServerFn(startCryptoPayment);
  const verifyFn = useServerFn(verifyCryptoPayment);

  const [planCode, setPlanCode] = useState<string>("");
  const [interval, setInterval] = useState<"monthly" | "yearly">("monthly");
  const [txHash, setTxHash] = useState<string>("");

  const [invoice, setInvoice] = useState<{
    invoiceNumber: string;
    amount: number;
    address: string;
    network: string;
    contract: string;
  } | null>(null);

  const [phase, setPhase] = useState<"idle" | "awaiting_payment" | "submitted">("idle");
  const [error, setError] = useState<string | null>(null);

  const start = useMutation({
    mutationFn: () => startFn({ data: { planCode, billingInterval: interval } }),
    onSuccess: (r) => {
      if (r.alreadyActive) {
        setError("You already have an active subscription.");
        return;
      }
      setInvoice({
        invoiceNumber: r.invoiceNumber ?? "",
        amount: r.amount,
        address: r.address,
        network: r.network,
        contract: r.contract,
      });
      setPhase("awaiting_payment");
      setError(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  const verify = useMutation({
    mutationFn: () =>
      invoice ? verifyFn({ data: { invoiceNumber: invoice.invoiceNumber, txHash } }) : Promise.reject(),
    onSuccess: (r) => {
      if (r.paid) {
        setPhase("submitted");
        setError(null);
        qc.invalidateQueries({ queryKey: ["billing"] });
        qc.invalidateQueries({ queryKey: ["cryptoPayInfo"] });
      } else {
        setError(r.reason ?? "Payment not confirmed yet.");
      }
    },
    onError: (e: Error) => setError(e.message),
  });

  const copyAddress = () => {
    if (invoice?.address) {
      void navigator.clipboard?.writeText(invoice.address);
    }
  };

  if (!info) return null;
  if (!info.enabled) {
    return (
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Pay with Crypto</CardTitle>
          <CardDescription>USDT (TRC-20) payments are not configured yet.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const plans: PlanRow[] = (billing?.plans ?? []) as PlanRow[];
  const plan = plans.find((p) => p.code === planCode);
  const amount =
    plan ? (interval === "yearly" ? plan.yearly_price : plan.monthly_price) ?? 0 : 0;

  return (
    <Card className="mt-8">
      <CardHeader>
        <CardTitle>Pay with Trust Wallet (USDT)</CardTitle>
        <CardDescription>
          No card needed — pay <span className="font-semibold">USDT</span> on the{" "}
          <Badge variant="secondary" className="align-middle">TRC-20</Badge> network from your Trust
          Wallet. Payment activates automatically once verified on-chain.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {phase === "idle" && (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[160px] space-y-1">
                <label className="text-xs text-muted-foreground">Plan</label>
                <Select value={planCode} onValueChange={setPlanCode}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a plan" />
                  </SelectTrigger>
                  <SelectContent>
                    {plans.map((p) => (
                      <SelectItem key={p.code} value={p.code}>
                        {p.name} — ${p.monthly_price}/mo
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Billing</label>
                <Select
                  value={interval}
                  onValueChange={(v) => setInterval(v as "monthly" | "yearly")}
                >
                  <SelectTrigger className="w-[130px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="yearly">Yearly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={() => start.mutate()}
                disabled={!planCode || start.isPending}
              >
                {start.isPending ? "Creating…" : "Pay with Trust Wallet"}
              </Button>
            </div>
            {amount > 0 && (
              <p className="text-sm text-muted-foreground">
                You will pay{" "}
                <span className="font-semibold text-foreground">${amount} USDT</span>
                {interval === "yearly" ? " / year" : ""}.
              </p>
            )}
          </>
        )}

        {phase === "awaiting_payment" && invoice && (
          <div className="space-y-4 rounded-lg border p-4">
            <div className="text-sm">
              <span className="text-muted-foreground">Invoice:</span>{" "}
              <span className="font-mono">{invoice.invoiceNumber}</span>
            </div>
            <div className="text-2xl font-bold">
              {invoice.amount} <span className="text-base font-normal">USDT</span>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                Send USDT (TRC-20) to this address in Trust Wallet:
              </label>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded bg-muted px-3 py-2 text-sm break-all">
                  {invoice.address}
                </code>
                <Button variant="outline" onClick={copyAddress}>
                  Copy
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Network: <span className="font-medium">{invoice.network}</span> · Contract:{" "}
                <span className="font-mono">{invoice.contract}</span>
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                After sending, paste the transaction hash (TXID) and verify:
              </label>
              <div className="flex items-center gap-2">
                <Input
                  className="font-mono"
                  placeholder="TRX transaction hash (e.g. a1b2…)"
                  value={txHash}
                  onChange={(e) => setTxHash(e.target.value)}
                />
                <Button
                  onClick={() => verify.mutate()}
                  disabled={txHash.trim().length < 10 || verify.isPending}
                >
                  {verify.isPending ? "Verifying…" : "Verify & Activate"}
                </Button>
              </div>
            </div>
            {txHash && (
              <p className="text-xs text-muted-foreground">
                We check on-chain that this is a confirmed USDT (TRC-20) transfer to the address
                above for at least{" "}
                <span className="font-medium">${invoice.amount}</span>.
              </p>
            )}
          </div>
        )}

        {phase === "submitted" && (
          <div className="rounded-lg border border-green-600/40 bg-green-600/10 p-4 text-green-100">
            ✅ Payment verified! Your subscription is active.
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
