"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import { useConnect, useConnection, useConnectors, useDisconnect } from "wagmi";
import { toFailure } from "@/lib/failure";
import { short } from "@/lib/format";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { useVenue } from "@/lib/venue";
import { EASE, FailureNotice, Hash, Label, Status } from "./ui";

/*
 * The wallet cell of the console bar. Disconnected, it lists every injected
 * wallet the browser announces (EIP-6963). Connected, it opens a panel with
 * the owner, the derived smart account, and the session, plus sign-out and
 * disconnect. It never asks for or displays a key.
 */

export function ConnectList({ onDone }: { onDone?: () => void }) {
  const connectors = useConnectors();
  const connect = useConnect();
  const failure = connect.error ? toFailure(connect.error) : null;
  // The generic `injected` entry duplicates announced wallets once any exist.
  const announced = connectors.filter(
    (connector) => connector.id !== "injected",
  );
  const list = announced.length > 0 ? announced : connectors;

  return (
    <div>
      {list.length === 0 ? (
        <p className="text-fog">
          No browser wallet was found. Install a wallet such as MetaMask or
          Rabby, then reload this page.
        </p>
      ) : (
        <ul className="border-t border-rule">
          {list.map((connector) => {
            const pending =
              connect.isPending && connect.variables?.connector === connector;
            return (
              <li key={connector.uid} className="border-b border-rule">
                <button
                  type="button"
                  disabled={connect.isPending}
                  onClick={() =>
                    connect.mutate(
                      { connector },
                      { onSuccess: () => onDone?.() },
                    )
                  }
                  className="group pressable flex w-full items-center gap-4 px-1 py-3.5 text-left hover:bg-ink/[0.03] disabled:cursor-wait"
                >
                  {connector.icon ? (
                    // biome-ignore lint/performance/noImgElement: wallet-announced data URI icon
                    <img
                      src={connector.icon}
                      alt=""
                      width={24}
                      height={24}
                      className="size-6"
                    />
                  ) : (
                    <span aria-hidden className="size-6 bg-rule" />
                  )}
                  <span className="flex-1 font-medium">{connector.name}</span>
                  {pending ? (
                    <Status tone="pending">In your wallet</Status>
                  ) : (
                    <span
                      aria-hidden
                      className="arrow font-mono text-fog group-hover:translate-x-1 group-hover:text-ink"
                    >
                      &#8594;
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {failure ? (
        <div className="mt-4">
          <FailureNotice failure={failure} />
        </div>
      ) : null}
    </div>
  );
}

export function WalletCell() {
  const { status, address } = useConnection();
  const { account, session, signOut } = useSession();
  const disconnect = useDisconnect();
  const venue = useVenue();
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const connected = status === "connected" && address;
  const tone =
    venue.status === "ok"
      ? "ok"
      : venue.status === "checking" || venue.status === "disconnected"
        ? "pending"
        : "fail";

  return (
    <div ref={root} className="relative flex items-stretch">
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={connected ? "Wallet" : "Connect wallet"}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "group pressable flex items-center gap-2 whitespace-nowrap border-l border-ruleinvert px-3 sm:px-5 md:gap-3 md:px-6",
          connected
            ? "bg-paper text-ink hover:bg-ink/[0.04]"
            : "bg-ink text-paper hover:bg-signal hover:text-ink",
        )}
      >
        {connected ? (
          <>
            <span
              aria-hidden
              className={cn(
                "size-1.5",
                tone === "ok" && "bg-ok-ink",
                tone === "pending" &&
                  "bg-statuspending motion-safe:animate-blink",
                tone === "fail" && "bg-fail-ink",
              )}
            />
            <span className="hidden font-mono text-[12px] sm:inline">
              {short(address, 6, 4)}
            </span>
            <span className="text-[12px] font-medium sm:hidden">Wallet</span>
            <span className="sr-only">
              {venue.status === "ok"
                ? "connected to chain 97"
                : "wallet needs attention"}
            </span>
          </>
        ) : (
          <span className="text-[12px] font-medium sm:text-[15px]">
            <span className="sm:hidden">Wallet</span>
            <span className="hidden sm:inline">
              {status === "connecting" || status === "reconnecting"
                ? "Connecting"
                : "Connect wallet"}
            </span>
          </span>
        )}
        <span
          aria-hidden
          className={cn(
            "font-mono text-[11px] transition-transform duration-200 ease-out-vivid",
            open && "rotate-180",
          )}
        >
          &#9662;
        </span>
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            id={panelId}
            role="dialog"
            aria-label={connected ? "Wallet" : "Connect a wallet"}
            initial={reduced ? false : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: EASE }}
            className="absolute right-0 top-full z-50 w-[min(24rem,calc(100vw-1rem))] border border-ink bg-paper p-5 text-ink"
          >
            {connected ? (
              <div className="space-y-4">
                <div>
                  <Label>Owner wallet</Label>
                  <div className="mt-1 text-[13px]">
                    <Hash value={address.toLowerCase()} full />
                  </div>
                </div>
                {account ? (
                  <div>
                    <Label>Smart account</Label>
                    <div className="mt-1 text-[13px]">
                      <Hash value={account} full />
                    </div>
                    <p className="mt-1 text-[13px] text-fog">
                      Modular Account V2, derived from this owner. Only this
                      owner can change it.
                    </p>
                  </div>
                ) : null}
                <div>
                  <Label>Session</Label>
                  <p className="mt-1 text-[13px]">
                    {session
                      ? `Signed in until ${new Date(session.expiresAt).toLocaleTimeString()}`
                      : "Not signed in"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-3 border-t border-rule pt-4">
                  {session ? (
                    <button
                      type="button"
                      onClick={() => {
                        signOut();
                        setOpen(false);
                      }}
                      className="pressable font-mono text-[11px] uppercase tracking-[0.16em] text-fog underline underline-offset-4 hover:text-ink"
                    >
                      Sign out
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      signOut();
                      disconnect.mutate();
                      setOpen(false);
                    }}
                    className="pressable font-mono text-[11px] uppercase tracking-[0.16em] text-fail-ink underline underline-offset-4"
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <Label>Choose a wallet</Label>
                <p className="mb-4 mt-2 text-[13px] leading-snug text-fog">
                  Your wallet stays the root owner. Perago asks for signatures,
                  never for a seed phrase or key.
                </p>
                <ConnectList onDone={() => setOpen(false)} />
              </div>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
