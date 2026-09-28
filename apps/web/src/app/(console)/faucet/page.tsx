import { Faucet } from "@/components/console/faucet";
import { WalletGate } from "@/components/console/wallet-gate";

export default function FaucetPage() {
  return (
    <WalletGate>
      <Faucet />
    </WalletGate>
  );
}
