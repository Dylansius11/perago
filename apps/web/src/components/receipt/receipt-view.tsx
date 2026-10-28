"use client";

import { type ExecutionReceipt, hashSchema } from "@perago/sdk";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { ApiError, ApiUnreachableError, api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  Button,
  ButtonLink,
  Disclosure,
  Glyph,
  Hash,
  Label,
  Panel,
  Status,
  StatusBadge,
} from "../console/ui";
import {
  addressUrl,
  CHAIN_NAME,
  deriveReceiptVerdict,
  mandateRecordUrl,
  type ProofRow,
  proofRows,
  type ReceiptVerdict,
  STATUS_CODE,
  settlementCopy,
  txUrl,
  verificationCopy,
} from "./model";

/*
 * The public, wallet-free receipt. It mounts no wagmi, session, or wallet code:
 * it reads one unauthenticated API route, parses it with the SDK schema, and
 * renders what the chain recorded. A failure to read the index is a calm,
 * retryable notice and never an alarm, because the chain is unchanged.
 */

export function ReceiptView({ mandateHash }: { mandateHash: string }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, refetchOnWindowFocus: false },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <Receipt raw={mandateHash} />
    </QueryClientProvider>
  );
}

function Receipt({ raw }: { raw: string }) {
  const parsed = hashSchema.safeParse(raw);
  const hash = parsed.success ? parsed.data : null;
  const query = useQuery({
    queryKey: ["public-receipt", hash],
    enabled: hash !== null,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: () => {
      if (hash === null) throw new Error("Mandate hash is not valid.");
      return api.receipt(hash);
    },
  });

  if (hash === null) return <InvalidHash raw={raw} />;
  if (query.data) return <Proof receipt={query.data} />;
  if (query.error instanceof ApiError && query.error.status === 404) {
    return <Missing />;
  }
  if (query.isError) {
    return (
      <Unavailable
        code={describeError(query.error)}
        busy={query.isFetching}
        onRetry={() => void query.refetch()}
      />
    );
  }
  return <Loading />;
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) return `${error.status} ${error.code}`;
  if (error instanceof ApiUnreachableError) return "API unreachable";
  return "Unreadable response";
}

/* ------------------------------------------------------------------ */
/* Notices                                                             */
/* ------------------------------------------------------------------ */

function Notice({
  label,
  title,
  children,
  actions,
}: {
  label: string;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section aria-label={title} className="border border-rule bg-paper">
      <div className="relative px-5 py-8 md:px-8 md:py-10">
        <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-rule" />
        <div role="status" aria-live="polite">
          <Label>{label}</Label>
          <h1 className="mt-4 max-w-[22ch] text-3xl font-semibold leading-[1.05] tracking-[-0.03em] md:text-5xl">
            {title}
          </h1>
        </div>
        <div className="mt-4 max-w-[56ch] space-y-3 text-lg leading-snug text-fog">
          {children}
        </div>
        {actions ? (
          <div className="mt-8 flex flex-wrap gap-3">{actions}</div>
        ) : null}
      </div>
    </section>
  );
}

function InvalidHash({ raw }: { raw: string }) {
  return (
    <Notice
      label="Not a receipt link"
      title="That is not a mandate hash."
      actions={
        <ButtonLink href="/" variant="ghost">
          Go to Perago
        </ButtonLink>
      }
    >
      <p>
        A mandate hash is 0x followed by 64 hexadecimal characters. Check the
        link, or scan the QR code again.
      </p>
      <p className="break-all font-mono text-[12px] text-fog">
        {raw.length > 96 ? `${raw.slice(0, 96)}...` : raw}
      </p>
    </Notice>
  );
}

function Missing() {
  return (
    <Notice
      label="404"
      title="No receipt for this mandate"
      actions={
        <ButtonLink href="/" variant="ghost">
          Go to Perago
        </ButtonLink>
      }
    >
      <p>
        Perago has no finalized receipt for this hash. A mandate that is still
        running has none until it ends, and a hash Perago never issued never
        will.
      </p>
    </Notice>
  );
}

function Unavailable({
  code,
  busy,
  onRetry,
}: {
  code: string;
  busy: boolean;
  onRetry: () => void;
}) {
  return (
    <Notice
      label="Receipt index"
      title="The receipt service is busy."
      actions={
        <Button variant="primary" busy={busy} onClick={onRetry}>
          Retry
        </Button>
      }
    >
      <p>
        It could not answer right now, and it may be rate limited. Nothing about
        this mandate has changed. Wait a few seconds and try again.
      </p>
      <p className="font-mono text-[12px]">Index response: {code}</p>
    </Notice>
  );
}

function Bar({ className }: { className: string }) {
  return (
    <span
      aria-hidden
      className={cn("block bg-ink/[0.06] motion-safe:animate-blink", className)}
    />
  );
}

function Loading() {
  return (
    <div role="status" aria-label="Loading receipt" className="space-y-4">
      <div className="border border-rule px-5 py-8 md:px-8 md:py-10">
        <Bar className="h-6 w-28" />
        <Bar className="mt-6 h-9 w-4/5 max-w-md md:h-14" />
        <Bar className="mt-3 h-9 w-3/5 max-w-sm md:h-14" />
        <Bar className="mt-8 h-4 w-full max-w-lg" />
        <Bar className="mt-2 h-4 w-2/3 max-w-sm" />
      </div>
      {[0, 1].map((key) => (
        <div key={key} className="border border-rule px-5 py-6 md:px-6">
          <Bar className="h-3 w-24" />
          <Bar className="mt-6 h-4 w-full" />
          <Bar className="mt-4 h-4 w-5/6" />
          <Bar className="mt-4 h-4 w-2/3" />
        </div>
      ))}
      <span className="sr-only">Loading the public receipt.</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Proof                                                               */
/* ------------------------------------------------------------------ */

/** One labelled value; the label sits above it on a phone and beside it from `sm`. */
function Line({
  label,
  children,
  note,
}: {
  label: string;
  children: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div className="min-w-0 border-b border-rule py-3.5 last:border-b-0 sm:grid sm:grid-cols-[9.5rem_minmax(0,1fr)] sm:gap-x-5">
      <dt className="font-mono text-[12px] text-fog">{label}</dt>
      <dd className="mt-1 min-w-0 sm:mt-0">
        <div className="min-w-0 font-mono text-[13px] break-words">
          {children}
        </div>
        {note ? (
          <div className="mt-1 text-[14px] leading-snug text-fog [overflow-wrap:anywhere]">
            {note}
          </div>
        ) : null}
      </dd>
    </div>
  );
}

function ReasonBlock({ verdict }: { verdict: ReceiptVerdict }) {
  if (!verdict.reason) return null;
  const failing = verdict.tone === "fail";
  return (
    <div
      className={cn(
        "mt-6 max-w-[64ch] border-l-2 py-4 pr-4 pl-4",
        failing
          ? "border-fail-ink bg-fail-ink/[0.045]"
          : "border-rule bg-ink/[0.025]",
      )}
    >
      <p
        className={cn(
          "font-mono text-[11px] uppercase tracking-[0.12em]",
          failing ? "text-fail-ink" : "text-fog",
        )}
      >
        {verdict.reason.code}
      </p>
      <p className="mt-2 text-lg leading-snug">{verdict.reason.message}</p>
    </div>
  );
}

function Hero({
  receipt,
  verdict,
}: {
  receipt: ExecutionReceipt;
  verdict: ReceiptVerdict;
}) {
  const dark = verdict.kind === "verified";
  return (
    <section
      aria-label="Receipt verdict"
      className={cn(
        "relative border",
        dark
          ? "on-dark rain border-ruleinvert bg-ink text-paper"
          : "border-rule bg-paper text-ink",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute inset-x-0 top-0 h-0.5",
          dark
            ? "bg-statusok"
            : verdict.tone === "fail"
              ? "bg-fail-ink"
              : verdict.tone === "pending"
                ? "bg-statuspending"
                : "bg-rule",
        )}
      />
      <div className="px-5 py-7 md:px-8 md:py-10">
        <div role="status" aria-live="polite" aria-atomic="true">
          <StatusBadge tone={verdict.tone} glyph={verdict.glyph} dark={dark}>
            {verdict.label}
          </StatusBadge>
          <h1 className="mt-5 max-w-[20ch] text-balance text-[2rem] font-semibold leading-[1.04] tracking-[-0.035em] sm:text-4xl md:max-w-[24ch] md:text-6xl">
            {verdict.headline}
          </h1>
        </div>
        <p
          className={cn(
            "mt-4 flex max-w-[56ch] items-start gap-2.5 text-lg leading-snug",
            dark ? "text-paper/85" : "text-fog",
          )}
        >
          {dark ? (
            <Glyph name="check" className="mt-[7px] text-statusok" />
          ) : null}
          {verdict.detail}
        </p>
        <ReasonBlock verdict={verdict} />
      </div>
      <dl
        className={cn(
          "grid gap-x-8 gap-y-3 border-t px-5 py-4 md:grid-cols-[auto_auto_1fr] md:px-8",
          dark ? "border-ruleinvert" : "border-rule",
        )}
      >
        <div>
          <dt>
            <Label dark={dark}>Chain</Label>
          </dt>
          <dd className="mt-1 font-mono text-[13px]">
            {CHAIN_NAME} <span className="opacity-60">({receipt.chainId})</span>
          </dd>
        </div>
        <div>
          <dt>
            <Label dark={dark}>Mandate</Label>
          </dt>
          <dd className="mt-1 text-[13px]">
            <Hash dark={dark} value={receipt.mandateHash} />
          </dd>
        </div>
      </dl>
    </section>
  );
}

function TransactionRow({ row }: { row: ProofRow }) {
  return (
    <li className="min-w-0 border-b border-rule py-3.5 last:border-b-0 sm:grid sm:grid-cols-[9.5rem_minmax(0,1fr)] sm:gap-x-5">
      <span className="font-mono text-[12px] text-fog">{row.label}</span>
      <div className="mt-1 min-w-0 sm:mt-0">
        {row.hash ? (
          <>
            <div className="font-mono text-[13px]">
              <Hash value={row.hash} href={row.href} />
            </div>
            <p className="mt-1 text-[14px] leading-snug text-fog">
              {row.block ? `Block ${row.block}` : "Block not recorded"}
              {row.note ? `. ${row.note}.` : "."}
            </p>
          </>
        ) : (
          <p className="text-[14px] text-fog">{row.absent}</p>
        )}
      </div>
    </li>
  );
}

function Settlement({ receipt }: { receipt: ExecutionReceipt }) {
  const { settlement } = receipt;
  return (
    <Panel
      label="Settlement"
      aside={
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-fog">
          {settlement.status.replace(/_/gu, " ")}
        </span>
      }
    >
      <p className="max-w-[56ch] text-lg leading-snug">
        {settlementCopy(settlement)}
      </p>
      {settlement.status === "CONFIRMED" ? (
        <dl className="mt-4">
          <Line label="Payout tx">
            <Hash
              value={settlement.transactionHash}
              href={txUrl(settlement.transactionHash)}
            />
          </Line>
          <Line
            label="Amount"
            note="Raw token units. Divide by the token's decimals for the display amount."
          >
            {settlement.amount}
          </Line>
          <Line label="Token">
            <Hash
              value={settlement.paymentToken}
              href={addressUrl(settlement.paymentToken)}
            />
          </Line>
          <Line label="Provider">
            <Hash
              value={settlement.provider}
              href={addressUrl(settlement.provider)}
            />
          </Line>
        </dl>
      ) : null}
    </Panel>
  );
}

function CheckYourself({ receipt }: { receipt: ExecutionReceipt }) {
  const code = STATUS_CODE[receipt.status];
  return (
    <Panel label="How to check this yourself">
      <p className="max-w-[56ch] text-[15px] leading-snug text-fog">
        You do not have to trust this page. Ask the contract directly.
      </p>
      <ol className="mt-5 space-y-5">
        <li className="flex gap-4">
          <span className="font-mono text-[12px] text-fog">1</span>
          <div className="min-w-0">
            <p className="leading-snug">
              Open the MandateExecutor contract on BscScan, then Contract, then
              Read Contract.
            </p>
            <div className="mt-3">
              <ButtonLink
                href={mandateRecordUrl(receipt.mandateExecutor)}
                variant="ghost"
                external
                arrow
              >
                Open MandateExecutor
              </ButtonLink>
            </div>
          </div>
        </li>
        <li className="flex gap-4">
          <span className="font-mono text-[12px] text-fog">2</span>
          <div className="min-w-0">
            <p className="leading-snug">
              Call <span className="font-mono text-[14px]">mandateRecord</span>{" "}
              with this mandate hash.
            </p>
            <div className="mt-2 text-[13px]">
              <Hash value={receipt.mandateHash} full wrap />
            </div>
          </div>
        </li>
        <li className="flex gap-4">
          <span className="font-mono text-[12px] text-fog">3</span>
          <div className="min-w-0">
            <p className="leading-snug">
              Compare what it returns with this page.
            </p>
            <ul className="mt-2 space-y-1.5 text-[14px] leading-snug text-fog">
              <li>
                <span className="font-mono">status</span> should be{" "}
                <span className="font-mono text-ink">
                  {code} ({receipt.status})
                </span>
                .
              </li>
              <li>
                <span className="font-mono">account</span> should be{" "}
                <span className="font-mono break-all text-ink">
                  {receipt.account}
                </span>
                .
              </li>
              {receipt.verification.hash ? (
                <li>
                  <span className="font-mono">verificationHash</span> should be{" "}
                  <span className="font-mono break-all text-ink">
                    {receipt.verification.hash}
                  </span>
                  .
                </li>
              ) : null}
            </ul>
          </div>
        </li>
      </ol>
    </Panel>
  );
}

function Commitments({ receipt }: { receipt: ExecutionReceipt }) {
  const entries: [string, string][] = [
    ["Policy", receipt.policyHash],
    ["Intent", receipt.intentHash],
    ["Plan", receipt.planHash],
    ["Simulation", receipt.simulationHash],
    ["Action", receipt.actionHash],
    ["Postcondition", receipt.postconditionHash],
    ["Terminal block", receipt.terminal.blockHash],
  ];
  return (
    <Disclosure label="Full commitments" hint="every hash">
      <dl>
        <Line label="Nonce">{receipt.nonce}</Line>
        <Line label="Executor">
          <Hash
            value={receipt.mandateExecutor}
            href={addressUrl(receipt.mandateExecutor)}
            full
            wrap
          />
        </Line>
        {entries.map(([label, value]) => (
          <Line key={label} label={label}>
            <Hash value={value} full wrap />
          </Line>
        ))}
      </dl>
    </Disclosure>
  );
}

function Proof({ receipt }: { receipt: ExecutionReceipt }) {
  const verdict = deriveReceiptVerdict(receipt);
  const verification = receipt.verification;
  return (
    <div className="space-y-4 md:space-y-6">
      <Hero receipt={receipt} verdict={verdict} />
      <div className="flex flex-col gap-4 md:gap-6 lg:grid lg:grid-cols-2 lg:items-start">
        <div className="contents lg:block lg:min-w-0 lg:space-y-6">
          <Panel label="Proof" className="order-1">
            <dl>
              <Line label="Account">
                <Hash
                  value={receipt.account}
                  href={addressUrl(receipt.account)}
                />
              </Line>
              <Line
                label="Verification"
                note={verificationCopy(verification.status)}
              >
                <Status tone={verification.status === "PASSED" ? "ok" : "idle"}>
                  {verification.status.replace(/_/gu, " ")}
                </Status>
              </Line>
              {verification.hash ? (
                <Line label="Verification hash">
                  <Hash value={verification.hash} />
                </Line>
              ) : null}
              {verification.failureReasonHash ? (
                <Line label="Failure reason hash">
                  <Hash value={verification.failureReasonHash} />
                </Line>
              ) : null}
              <Line label="Authority">
                {receipt.authorityConsumed ? "Ended" : "Not confirmed as ended"}
              </Line>
            </dl>
          </Panel>
          <div className="order-3 lg:order-none">
            <Settlement receipt={receipt} />
          </div>
        </div>
        <div className="contents lg:block lg:min-w-0 lg:space-y-6">
          <Panel label="Transactions" className="order-2">
            <ol>
              {proofRows(receipt).map((row) => (
                <TransactionRow key={row.key} row={row} />
              ))}
            </ol>
          </Panel>
          <div className="order-4 lg:order-none">
            <CheckYourself receipt={receipt} />
          </div>
        </div>
      </div>
      <Commitments receipt={receipt} />
      <p className="max-w-[64ch] pt-2 text-[13px] leading-snug text-fog">
        This page reads Perago&apos;s public receipt index for {CHAIN_NAME}. The
        chain is the source of truth, and the steps above let you confirm it
        without Perago.
      </p>
    </div>
  );
}
