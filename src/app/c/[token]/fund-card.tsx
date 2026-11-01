"use client";

import { PayPalButtons, PayPalScriptProvider, usePayPalScriptReducer } from "@paypal/react-paypal-js";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { finishFunding, startFunding } from "@/app/actions/funding";
import { Callout, Card } from "@/components/ui";
import { formatCents } from "@/lib/money";

interface Props {
  token: string;
  clientId: string;
  totalCents: number;
  fundBy: string | null;
  /** One line on what was agreed, shown above the amount. */
  agreedText?: string;
  demoBuyer: { email: string; password: string } | null;
}

function Buttons({ token, onError, onDone }: { token: string; onError: (m: string) => void; onDone: (m: string) => void }) {
  const [{ isPending, isRejected }] = usePayPalScriptReducer();
  if (isRejected) return <p className="text-sm text-danger">PayPal couldn&apos;t load. Check your connection and reload the page.</p>;
  return (
    <>
      {isPending && <div className="h-12 animate-pulse rounded-full bg-surface-2" aria-label="Loading PayPal" />}
      <PayPalButtons
        style={{ layout: "vertical", shape: "pill", label: "paypal", height: 45 }}
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

export function FundCard({ token, clientId, totalCents, fundBy, agreedText, demoBuyer }: Props) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  return (
    <Card className="border-brand/30 p-5 shadow-raised sm:p-6">
      <p className="flex items-center gap-2 text-xs font-medium text-brand">
        <span className="size-2 rounded-full bg-brand" aria-hidden="true" />
        Fund the job
      </p>
      <p className="amount mt-2 text-4xl font-semibold">{formatCents(totalCents)}</p>
      {agreedText && <p className="mt-2 text-sm text-pretty text-muted">{agreedText}</p>}
      <ol className="mt-5 space-y-3 border-t border-line pt-5 text-sm">
        {[
          <>
            PayPal <strong className="font-semibold">holds</strong> the money. It isn&apos;t sent to anyone yet.
          </>,
          <>Each milestone is paid only when its delivery passes the agreed checks, or when you approve it.</>,
          <>Money that isn&apos;t earned is released back to you.</>,
        ].map((t, i) => (
          <li key={i} className="flex gap-3">
            <span className="tabular flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[11px] font-semibold text-muted">{i + 1}</span>
            <span className="text-pretty text-muted">{t}</span>
          </li>
        ))}
      </ol>

      <div className="mt-6" aria-live="polite">
        {status ? (
          <Callout tone="ok">{status}</Callout>
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
          <Callout tone="danger" role="alert" className="mt-3">
            {error}
          </Callout>
        )}
      </div>

      {fundBy && <p className="mt-3 text-center text-xs text-muted">Fund by {fundBy}, or the agreement expires and nothing is charged.</p>}

      {demoBuyer && (
        <div className="mt-5 rounded-xl border border-dashed border-line-strong p-4 text-xs">
          <p className="font-medium">Demo: pay with this PayPal sandbox buyer</p>
          <p className="mt-1.5 font-mono text-muted select-all">{demoBuyer.email}</p>
          <p className="font-mono text-muted select-all">{demoBuyer.password}</p>
          <p className="mt-1.5 text-faint">Test money only. No real account is charged.</p>
        </div>
      )}
    </Card>
  );
}
