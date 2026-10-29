// @vitest-environment jsdom

import { hydrate } from "@wagmi/core";
import { bscTestnet } from "viem/chains";
import { describe, expect, it } from "vitest";
import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors/injected";

describe("console wallet discovery", () => {
  it("keeps each announced wallet once across three provider mounts", async () => {
    const config = createConfig({
      chains: [bscTestnet],
      connectors: [injected()],
      multiInjectedProviderDiscovery: true,
      ssr: true,
      transports: { [bscTestnet.id]: http() },
    });

    try {
      for (const info of [
        {
          uuid: "00000000-0000-4000-8000-000000000001",
          rdns: "io.metamask",
          name: "MetaMask",
        },
        {
          uuid: "00000000-0000-4000-8000-000000000002",
          rdns: "app.phantom",
          name: "Phantom",
        },
      ]) {
        window.dispatchEvent(
          new CustomEvent("eip6963:announceProvider", {
            detail: {
              info: {
                ...info,
                icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>",
              },
              provider: { request: async () => [] },
            },
          }),
        );
      }

      for (let mount = 0; mount < 3; mount++) {
        await hydrate(config, { reconnectOnMount: false }).onMount();
      }

      const walletIds = config.connectors
        .filter((connector) => connector.id !== "injected")
        .map((connector) => connector.id);
      expect(walletIds).toEqual(["io.metamask", "app.phantom"]);
    } finally {
      config._internal.mipd?.destroy();
      window.localStorage.clear();
    }
  });
});
