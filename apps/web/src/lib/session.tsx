"use client";

import { type Address, deriveSemiModularAccountAddress } from "@perago/sdk";
import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useConnection } from "wagmi";
import { signMessage } from "wagmi/actions";
import { api } from "./api";
import { wagmiConfig } from "./wagmi";

/*
 * Wallet session. The owner signs one plain-text challenge that names the API
 * domain, chain 97, the owner, and the derived smart account; the API answers
 * with a bearer token. The token lives in `sessionStorage` for this tab only,
 * keyed by owner, and is never logged. Switching the wallet account switches
 * the session with it.
 */

type StoredSession = {
  token: string;
  expiresAt: string;
  account: Address;
  rootOwner: Address;
};

type SessionState = {
  /** Connected owner, lowercase, or null. */
  owner: Address | null;
  /** Smart account derived from the owner (CREATE2 over the pinned factory). */
  account: Address | null;
  session: StoredSession | null;
  signIn: () => Promise<void>;
  signOut: () => void;
  /** Drops a token the API no longer accepts. */
  expire: () => void;
};

const SessionContext = createContext<SessionState | null>(null);

const keyOf = (owner: string) => `perago:session:${owner}`;

function load(owner: string): StoredSession | null {
  const raw = window.sessionStorage.getItem(keyOf(owner));
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw) as StoredSession;
    if (new Date(stored.expiresAt).getTime() <= Date.now() + 30_000) {
      window.sessionStorage.removeItem(keyOf(owner));
      return null;
    }
    return stored;
  } catch {
    window.sessionStorage.removeItem(keyOf(owner));
    return null;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const { address } = useConnection();
  const queryClient = useQueryClient();
  const owner = address ? (address.toLowerCase() as Address) : null;
  const account = useMemo(
    () =>
      owner
        ? (deriveSemiModularAccountAddress({ owner }).toLowerCase() as Address)
        : null,
    [owner],
  );
  const [session, setSession] = useState<StoredSession | null>(null);

  useEffect(() => {
    setSession(owner ? load(owner) : null);
  }, [owner]);

  const signIn = useCallback(async () => {
    if (!owner || !account) throw new Error("Connect a wallet first.");
    const challenge = await api.challenge({ account, rootOwner: owner });
    const signature = await signMessage(wagmiConfig, {
      account: owner,
      message: challenge.message,
    });
    const created = await api.session({
      challengeId: challenge.challengeId,
      signature,
    });
    const stored: StoredSession = {
      token: created.token,
      expiresAt: created.expiresAt,
      account,
      rootOwner: owner,
    };
    window.sessionStorage.setItem(keyOf(owner), JSON.stringify(stored));
    setSession(stored);
    await queryClient.invalidateQueries();
  }, [account, owner, queryClient]);

  const signOut = useCallback(() => {
    if (owner) window.sessionStorage.removeItem(keyOf(owner));
    setSession(null);
    queryClient.removeQueries({ queryKey: ["session"] });
  }, [owner, queryClient]);

  const value = useMemo<SessionState>(
    () => ({
      owner,
      account,
      session: session && session.rootOwner === owner ? session : null,
      signIn,
      signOut,
      expire: signOut,
    }),
    [account, owner, session, signIn, signOut],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
