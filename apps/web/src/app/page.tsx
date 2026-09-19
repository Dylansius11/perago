import { TopBar } from "@/components/chrome/top-bar";
import { SiteFooter } from "@/components/chrome/footer";
import { Hero } from "@/components/sections/hero";
import { LedgerStrip } from "@/components/sections/ledger-strip";
import { Lifecycle } from "@/components/sections/lifecycle";
import { Anatomy } from "@/components/sections/anatomy";
import { FailureStates } from "@/components/sections/failure-states";
import { Receipt } from "@/components/sections/receipt";
import { Closing } from "@/components/sections/closing";

/*
 * Page order tells the product story once, top to bottom:
 * promise (hero) -> constraints (ledger) -> lifecycle (how) ->
 * mandate anatomy (what you sign) -> failure honesty (what if) ->
 * receipt (proof) -> access (act). Each section owns a different layout
 * family; none repeats another.
 */
export default function Page() {
  return (
    <>
      <TopBar />
      <main>
        <Hero />
        <LedgerStrip />
        <Lifecycle />
        <Anatomy />
        <FailureStates />
        <Receipt />
        <Closing />
      </main>
      <SiteFooter />
    </>
  );
}
