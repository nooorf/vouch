"use client";

import { PayPalButtons, PayPalScriptProvider, usePayPalScriptReducer } from "@paypal/react-paypal-js";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { finishFunding, startFunding } from "@/app/actions/funding";
import { Badge, Card } from "@/components/ui";
import { formatCents } from "@/lib/money";

interface Props {
  token: string;
  clientId: string;
  totalCents: number;
  fundBy: string | null;
  demoBuyer: { email: string; password: string } | null;
}

function Buttons({ token, onError, onDone }: { token: string; onError: (m: string) => void; onDone: (m: string) => void }) {
  const [{ isPending, isRejected }] = usePayPalScriptReducer();
  if (isRejected) return <p className="text-sm text-danger">PayPal couldn&apos;t load. Check your connection and reload the page.</p>;
  return (
    <>
      {isPending && <div className="h-12 animate-pulse rounded-lg bg-surface-2" aria-label="Loading PayPal" />}
      <PayPalButtons
        style={{ layout: "vertical", shape: "rect", label: "paypal", height: 45 }}
        createOrder={async () => {
          onError("");
          const res = await startFunding(token);
          if (!res.ok) {
            onError(res.error);
            throw new Error(res.error);
          }
          return res.orderId;
        }}
        onApprove={async (data) => {
          onDone("Confirming with PayPal…");
          const res = await finishFunding(token, data.orderID);
          if (!res.ok) {
            onDone("");
            onError(res.error);
            return;
          }
          onDone(res.result === "pending" ? "PayPal is reviewing the payment. This page updates when it's confirmed." : "Funded. Updating…");
        }}
        onCancel={() => onError("You closed PayPal. Nothing was charged.")}
        onError={() => onError("PayPal ran into a problem. Nothing was charged. Please try again.")}
      />
    </>
  );
}

export function FundCard({ token, clientId, totalCents, fundBy, demoBuyer }: Props) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  return (
    <Card className="p-5">
      <Badge tone="brand">Agreed</Badge>
      <p className="mt-3 text-sm text-muted">Fund the job to start the work.</p>
      <p className="tabular mt-1 font-mono text-3xl font-semibold">{formatCents(totalCents)}</p>
      <ul className="mt-4 space-y-1.5 text-sm text-muted">
        <li>• PayPal <strong className="text-ink">holds</strong> the money. It isn&apos;t sent to anyone yet.</li>
        <li>• Each milestone is paid only when its delivery passes the agreed checks, or when you approve it.</li>
        <li>• Money that isn&apos;t earned is released back to you.</li>
      </ul>

      <div className="mt-5" aria-live="polite">
        {status ? (
          <p className="rounded-lg bg-brand-soft px-3 py-2 text-sm text-brand">{status}</p>
        ) : (
          <PayPalScriptProvider
            options={{ clientId, intent: "authorize", currency: "USD", components: "buttons", disableFunding: "card,credit,paylater,venmo" }}
          >
            <Buttons
              token={token}
              onError={setError}
              onDone={(m) => {
                setStatus(m);
                if (m.startsWith("Funded")) router.refresh();
              }}
            />
          </PayPalScriptProvider>
        )}
        {error && (
          <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
      </div>

      {fundBy && <p className="mt-3 text-xs text-muted">Fund by {fundBy}, or the agreement expires and nothing is charged.</p>}

      {demoBuyer && (
        <div className="mt-4 rounded-lg border border-dashed border-line p-3 text-xs">
          <p className="font-medium">Demo: pay with this PayPal sandbox buyer</p>
          <p className="mt-1 font-mono text-muted">{demoBuyer.email}</p>
          <p className="font-mono text-muted">{demoBuyer.password}</p>
          <p className="mt-1 text-muted">Test money only. No real account is charged.</p>
        </div>
      )}
    </Card>
  );
}
