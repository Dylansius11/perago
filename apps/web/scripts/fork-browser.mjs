#!/usr/bin/env node
/**
 * Fork-only browser proof. A disposable key is created in this Node process;
 * the page sees an EIP-1193 provider but NEVER receives the private key.
 * Start `pnpm --filter @perago/api dev:fork` with the existing perago_dev
 * database (never the perago_test integration DB) and
 * `NEXT_PUBLIC_PERAGO_RPC_URL=http://127.0.0.1:8545 pnpm --filter @perago/web dev`.
 * Then run `pnpm --filter @perago/web browser:fork`.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  deriveSemiModularAccountAddress,
  mandateExecutorAbi,
} from "@perago/sdk";
import { chromium } from "playwright";
import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";

const RPC = "http://127.0.0.1:8545";
const WEB = "http://localhost:3000";
const account = privateKeyToAccount(generatePrivateKey());
const wallet = createWalletClient({
  account,
  chain: bscTestnet,
  transport: http(RPC),
});
const mobile = process.argv.includes("--mobile");
const revoke = process.argv.includes("--revoke");
const expire = process.argv.includes("--expire");
const failVerify = process.argv.includes("--fail-verify");
const output = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".screenshots",
  failVerify
    ? "fork-browser-failed"
    : expire
      ? "fork-browser-expire"
      : revoke
        ? "fork-browser-revoke"
        : mobile
          ? "fork-browser-mobile"
          : "fork-browser",
);

const client = createPublicClient({ chain: bscTestnet, transport: http(RPC) });
async function rpc(method, params = []) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const result = await res.json();
  if (result.error) throw new Error(`${method}: ${result.error.message}`);
  return result.result;
}

async function inject(page) {
  let currentChain = "0x1";
  let rejectNext = false;
  await page.exposeBinding(
    "__peragoTestWallet",
    async (_source, method, params = []) => {
      if (method === "__rejectNext") {
        rejectNext = true;
        return null;
      }
      if (method === "eth_chainId") return currentChain;
      if (method === "wallet_switchEthereumChain") {
        if (params[0]?.chainId !== "0x61")
          throw Object.assign(new Error("Unsupported chain"), { code: 4902 });
        currentChain = "0x61";
        return null;
      }
      if (method === "eth_accounts" || method === "eth_requestAccounts")
        return [account.address];
      if (
        method === "personal_sign" ||
        method === "eth_sign" ||
        method === "eth_signTypedData_v4" ||
        method === "eth_sendTransaction"
      ) {
        if (rejectNext) {
          rejectNext = false;
          throw Object.assign(new Error("User rejected the request."), {
            code: 4001,
          });
        }
      }
      if (method === "personal_sign" || method === "eth_sign") {
        const message =
          params.find(
            (value) =>
              typeof value === "string" &&
              value.startsWith("0x") &&
              value.length > 42,
          ) ?? params[0];
        return account.signMessage({
          message:
            typeof message === "string" && message.startsWith("0x")
              ? { raw: message }
              : message,
        });
      }
      if (method === "eth_signTypedData_v4") {
        const typed = JSON.parse(params[1]);
        return account.signTypedData(typed);
      }
      if (method === "eth_sendTransaction") {
        const [tx] = params;
        if (tx.from.toLowerCase() !== account.address.toLowerCase())
          throw new Error("wrong wallet sender");
        return wallet.sendTransaction({
          account,
          chain: bscTestnet,
          to: tx.to,
          data: tx.data ?? tx.input,
          value: tx.value ? BigInt(tx.value) : 0n,
        });
      }
      if (method === "wallet_addEthereumChain") return null;
      return rpc(method, params);
    },
  );
  await page.addInitScript(() => {
    const listeners = new Map();
    const provider = {
      isMetaMask: true,
      on(event, listener) {
        const list = listeners.get(event) ?? [];
        list.push(listener);
        listeners.set(event, list);
        return provider;
      },
      removeListener(event, listener) {
        listeners.set(
          event,
          (listeners.get(event) ?? []).filter(
            (candidate) => candidate !== listener,
          ),
        );
        return provider;
      },
      emit(event, payload) {
        for (const listener of listeners.get(event) ?? []) listener(payload);
      },
      async request({ method, params = [] }) {
        try {
          const result = await window.__peragoTestWallet(method, params);
          if (method === "wallet_switchEthereumChain")
            provider.emit("chainChanged", params[0].chainId);
          return result;
        } catch (error) {
          if (error.message.includes("User rejected the request"))
            throw Object.assign(new Error("User rejected the request."), {
              code: 4001,
            });
          throw error;
        }
      },
    };
    Object.defineProperty(window, "ethereum", {
      configurable: true,
      value: provider,
    });
    const announce = () =>
      window.dispatchEvent(
        new CustomEvent("eip6963:announceProvider", {
          detail: {
            info: {
              uuid: "4bd97a51-813e-49e3-9212-167d2926b1ce",
              name: "Fork Test Wallet",
              icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E",
              rdns: "perago.local.fork",
            },
            provider,
          },
        }),
      );
    window.addEventListener("eip6963:requestProvider", announce);
    setTimeout(announce, 0);
    window.__rejectWalletPrompt = () =>
      window.__peragoTestWallet("__rejectNext");
  });
}

async function main() {
  await rpc("anvil_setBalance", [
    account.address,
    `0x${parseEther("1").toString(16)}`,
  ]);
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1440, height: 900 },
      isMobile: mobile,
      hasTouch: mobile,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const policyResponses = [];
    const policyConfirmations = [];
    const taskResponses = [];
    page.on("response", (response) => {
      if (response.url().includes("/policies")) {
        policyResponses.push({
          path: new URL(response.url()).pathname,
          status: response.status(),
        });
        if (new URL(response.url()).pathname.endsWith("/activation")) {
          void response
            .json()
            .then((body) => policyConfirmations.push(body.status));
        }
      }
      if (
        response.url().includes("/tasks/") &&
        response.request().method() === "GET"
      ) {
        void response
          .json()
          .then((body) =>
            taskResponses.push({
              status: response.status(),
              task: body.status,
              mandate: body.mandate?.status,
              receipt: body.receipt?.status,
            }),
          )
          .catch(() => {});
      }
    });
    await inject(page);
    await page.goto(`${WEB}/app`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Switch to chain 97" }).waitFor();
    await page.screenshot({
      path: path.join(output, "01-wrong-chain.png"),
      fullPage: true,
    });
    console.log(JSON.stringify({ check: "wrong-chain-gate", visible: true }));
    await page.getByRole("button", { name: "Switch to chain 97" }).click();
    await page.getByRole("button", { name: "Sign in" }).waitFor();
    await page.evaluate(() => window.__rejectWalletPrompt());
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByText("WALLET_REJECTED").waitFor();
    await page.screenshot({
      path: path.join(output, "02-wallet-rejected.png"),
      fullPage: true,
    });
    console.log(JSON.stringify({ check: "wallet-rejection", visible: true }));
    await page.getByRole("button", { name: "Sign in" }).click();
    await page
      .getByText("Your intent, carried through.")
      .waitFor({ timeout: 30_000 });
    await page
      .getByRole("button", { name: "Create smart account" })
      .waitFor({ timeout: 30_000 });
    await page.screenshot({
      path: path.join(output, "03-account-setup.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Create smart account" }).click();
    await page
      .getByText("code present on chain 97")
      .waitFor({ timeout: 60_000 });
    await page.screenshot({
      path: path.join(output, "04-account-created.png"),
      fullPage: true,
    });
    console.log(JSON.stringify({ check: "account-created", code: true }));
    await page.goto(`${WEB}/faucet`, { waitUntil: "networkidle" });
    await page.getByText("Faucet eligibility").waitFor();
    const claim = page.getByRole("button", { name: "Request test tBNB" });
    await claim.waitFor();
    if (await claim.isEnabled()) {
      const claimResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith("/faucet/claims") &&
          response.request().method() === "POST",
      );
      await claim.click();
      const claimed = await (await claimResponse).json();
      await page.getByText("Funds confirmed").waitFor({ timeout: 60_000 });
      await page.screenshot({
        path: path.join(output, "05-faucet-confirmed.png"),
        fullPage: true,
      });
      const faucetReceipt = await client.getTransactionReceipt({
        hash: claimed.transactionHash,
      });
      const faucetTransfer = await client.getTransaction({
        hash: claimed.transactionHash,
      });
      if (
        faucetReceipt.status !== "success" ||
        faucetTransfer.to?.toLowerCase() !== claimed.recipient.toLowerCase() ||
        claimed.recipient.toLowerCase() !==
          deriveSemiModularAccountAddress({
            owner: account.address,
          }).toLowerCase() ||
        faucetTransfer.value !== BigInt(claimed.amountWei)
      ) {
        throw new Error("Faucet claim UI did not match the fork transfer.");
      }
      console.log(
        JSON.stringify({
          check: "faucet-fork-transfer",
          chainId: 97,
          transactionHash: claimed.transactionHash,
          recipient: claimed.recipient,
          amountWei: claimed.amountWei,
          blockNumber: faucetReceipt.blockNumber.toString(),
          blockHash: faucetReceipt.blockHash,
        }),
      );
      console.log(JSON.stringify({ check: "faucet-confirmed", visible: true }));
      await page.reload({ waitUntil: "networkidle" });
      await page
        .getByText("FAUCET_ALREADY_CLAIMED", { exact: true })
        .waitFor({ timeout: 30_000 });
      if (
        await page
          .getByRole("button", { name: "Request test tBNB" })
          .isEnabled()
      ) {
        throw new Error(
          "A second faucet claim was offered inside the rolling window.",
        );
      }
      console.log(
        JSON.stringify({
          check: "faucet-repeat-refused",
          reason: "FAUCET_ALREADY_CLAIMED",
        }),
      );
    } else {
      await page
        .getByText(
          /FAUCET_(ALREADY_CLAIMED|ACCOUNT_FUNDED|BUDGET_EXHAUSTED|RATE_LIMITED|UNAVAILABLE)/u,
        )
        .first()
        .waitFor();
      await page.screenshot({
        path: path.join(output, "05-faucet-refused.png"),
        fullPage: true,
      });
      console.log(JSON.stringify({ check: "faucet-refusal", visible: true }));
      const hash = await wallet.sendTransaction({
        account,
        chain: bscTestnet,
        to: deriveSemiModularAccountAddress({ owner: account.address }),
        value: parseEther("0.02"),
      });
      await client.waitForTransactionReceipt({ hash });
    }
    await page.goto(`${WEB}/app`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Wrap", exact: true }).waitFor();
    await page.getByRole("button", { name: "Wrap", exact: true }).click();
    await page
      .getByRole("button", { name: "Wrap", exact: true })
      .waitFor({ state: "detached", timeout: 60_000 });
    await page
      .getByRole("button", { name: "Review exact limits" })
      .waitFor({ timeout: 60_000 });
    await page.screenshot({
      path: path.join(output, "06-wrapped.png"),
      fullPage: true,
    });
    console.log(JSON.stringify({ check: "wrapped-wbnb", visible: true }));
    await page.getByRole("button", { name: "Review exact limits" }).click();
    await page
      .getByRole("button", { name: "Sign and activate" })
      .waitFor({ timeout: 30_000 });
    await page.screenshot({
      path: path.join(output, "07-policy-review.png"),
      fullPage: true,
    });
    console.log(JSON.stringify({ check: "policy-review", visible: true }));
    await page.getByRole("button", { name: "Sign and activate" }).click();
    try {
      await page.getByText(/Policy v\d+ active/u).waitFor({ timeout: 60_000 });
    } catch (error) {
      console.log("policy responses:", policyResponses);
      console.log(
        "policy failure:",
        (await page.getByRole("alert").allInnerTexts()).map((text) =>
          text.slice(0, 500),
        ),
      );
      console.log(
        "policy end:",
        (await page.locator("main").innerText()).slice(-900),
      );
      console.log("page errors:", errors);
      throw error;
    }
    await page.screenshot({
      path: path.join(output, "08-policy-active.png"),
      fullPage: true,
    });
    console.log(
      JSON.stringify({
        check: "policy-active",
        visible: true,
        confirmations: policyConfirmations,
      }),
    );
    await page
      .getByRole("textbox", { name: "Your goal" })
      .fill("Swap 0.01 WBNB for CAKE");
    await page.getByRole("button", { name: "Compile goal" }).click();
    await page.waitForURL(/\/app\/tasks\/[0-9a-f-]+$/u, { timeout: 60_000 });
    await page
      .getByRole("button", { name: "Simulate exact plan" })
      .waitFor({ timeout: 45_000 });
    console.log(
      JSON.stringify({
        check: "swap-compiled",
        url: new URL(page.url()).pathname,
      }),
    );
    const policyChecks = page.getByText("Inspect all 13 policy checks");
    await policyChecks.waitFor({ timeout: 10_000 });
    if (await page.getByText("CHAIN", { exact: true }).isVisible()) {
      throw new Error(
        "Passing policy checks must be available on demand, not dominate the plan.",
      );
    }
    await page.screenshot({
      path: path.join(output, "09-swap-plan.png"),
      fullPage: true,
    });
    await policyChecks.click();
    await page.getByText("CHAIN", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Simulate exact plan" }).click();
    await page
      .getByRole("button", { name: "Prepare fresh mandate" })
      .waitFor({ state: "visible", timeout: 60_000 });
    await page.getByRole("button", { name: "Prepare fresh mandate" }).click();
    await page
      .getByRole("button", { name: "Sign exact mandate" })
      .waitFor({ timeout: 60_000 });
    console.log(JSON.stringify({ check: "swap-prepared", visible: true }));
    await page.screenshot({
      path: path.join(output, "10-mandate-review.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Approve exact input" }).click();
    const acceptance = failVerify
      ? page.waitForResponse(
          (response) =>
            /\/tasks\/[^/]+\/mandate$/u.test(
              new URL(response.url()).pathname,
            ) && response.request().method() === "POST",
        )
      : null;
    await page
      .getByRole("button", { name: "Sign exact mandate" })
      .click({ timeout: 60_000 });
    const signedResponse = acceptance ? await acceptance : null;
    const signedHash = signedResponse
      ? (await signedResponse.json()).mandateHash
      : null;
    await page
      .getByRole("region", { name: "Signed mandate" })
      .waitFor({ timeout: 60_000 });
    await page.screenshot({
      path: path.join(output, "11-mandate-queued.png"),
      fullPage: true,
    });
    console.log(JSON.stringify({ check: "swap-queued", visible: true }));
    if (expire) {
      await page
        .getByRole("button", { name: "Revoke before execution" })
        .waitFor({ timeout: 150_000 });
      await rpc("evm_increaseTime", [7200]);
      await rpc("evm_mine");
      await page
        .getByRole("region", { name: "Public receipt" })
        .waitFor({ timeout: 180_000 });
      const expired = await page
        .getByRole("region", { name: "Public receipt" })
        .innerText();
      if (
        !expired.includes("EXPIRED") ||
        !expired.includes("authority consumed")
      ) {
        throw new Error(
          `Expiry did not end authority: ${expired.slice(0, 500)}`,
        );
      }
      console.log(
        JSON.stringify({ check: "owner-mandate-expired", visible: true }),
      );
      if (errors.length) throw new Error(errors.join("\n"));
      return;
    }
    if (failVerify) {
      if (!signedHash) throw new Error("Signed mandate hash was not returned.");
      const config = await (await fetch("http://127.0.0.1:8787/config")).json();
      const outputToken = config.tokens.find(
        (token) => token.symbol === "Cake",
      )?.address;
      const originalCode = outputToken
        ? await client.getCode({ address: outputToken })
        : null;
      if (!originalCode)
        throw new Error("Pinned fork output token has no runtime.");
      const readRecord = () =>
        client.readContract({
          abi: mandateExecutorAbi,
          address: config.mandateExecutor,
          functionName: "mandateRecord",
          args: [signedHash],
        });
      const beginDeadline = Date.now() + 180_000;
      while ((await readRecord()).status !== 2 && Date.now() < beginDeadline)
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      if ((await readRecord()).status !== 2)
        throw new Error("Mandate never entered EXECUTING on the fork.");
      let failed = false;
      try {
        await rpc("anvil_setCode", [outputToken, "0x60006000fd"]);
        const failureDeadline = Date.now() + 180_000;
        while (Date.now() < failureDeadline) {
          const status = (await readRecord()).status;
          if (status === 4) {
            failed = true;
            break;
          }
          if (status !== 2)
            throw new Error(`Unexpected onchain status ${status}`);
          await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
      } finally {
        await rpc("anvil_setCode", [outputToken, originalCode]);
      }
      if (!failed) throw new Error("Verifier fault did not end in FAILED.");
      await page
        .getByRole("region", { name: "Public receipt" })
        .waitFor({ timeout: 180_000 });
      const failedReceipt = await page
        .getByRole("region", { name: "Public receipt" })
        .innerText();
      if (
        !failedReceipt.includes("FAILED") ||
        !failedReceipt.includes("NOT_VERIFIED")
      )
        throw new Error(
          `Failure receipt missing: ${failedReceipt.slice(0, 500)}`,
        );
      if (
        await page.getByRole("button", { name: "Sign exact mandate" }).count()
      )
        throw new Error("Terminal mandate still offers a replay signature.");
      const originalRequest = signedResponse?.request();
      const authorization = originalRequest?.headers().authorization;
      const signedBody = originalRequest?.postData();
      if (!authorization || !signedBody)
        throw new Error("Browser submission proof is unavailable for replay.");
      const replay = await fetch(signedResponse.url(), {
        method: "POST",
        headers: { authorization, "content-type": "application/json" },
        body: signedBody,
      });
      const replayed = await replay.json();
      if (replay.status !== 201 || replayed.mandateHash !== signedHash)
        throw new Error("Exact signature replay was not idempotent.");
      const taskAfterReplay = await fetch(
        signedResponse.url().replace(/\/mandate$/u, ""),
        { headers: { authorization } },
      );
      const unchanged = await taskAfterReplay.json();
      if (
        unchanged.execution?.status !== "TERMINAL" ||
        unchanged.receipt?.status !== "FAILED"
      )
        throw new Error("Signature replay queued another execution.");
      console.log(
        JSON.stringify({
          check: "terminal-signature-replay",
          oneExecution: true,
        }),
      );
      console.log(
        JSON.stringify({
          check: "verifier-failed",
          mandateHash: signedHash,
          visible: true,
        }),
      );
      if (errors.length) throw new Error(errors.join("\n"));
      return;
    }
    if (revoke) {
      const control = page.getByRole("button", {
        name: "Revoke before execution",
      });
      await control.waitFor({ timeout: 150_000 });
      await control.click();
      try {
        await page
          .getByRole("region", { name: "Public receipt" })
          .waitFor({ timeout: 180_000 });
      } catch (error) {
        console.log(
          JSON.stringify({
            check: "owner-revoke-ui-diagnostic",
            alerts: await page.getByRole("alert").allInnerTexts(),
            text: (await page.locator("main").innerText()).slice(-2500),
            visibility: await page.evaluate(() => document.visibilityState),
            taskResponses: taskResponses.slice(-15),
            errors,
          }),
        );
        await page.screenshot({
          path: path.join(output, "12-revoke-waiting.png"),
          fullPage: true,
        });
        throw error;
      }
      const revoked = await page
        .getByRole("region", { name: "Public receipt" })
        .innerText();
      if (!revoked.includes("REVOKED") || revoked.includes("SUCCEEDED")) {
        await page.screenshot({
          path: path.join(output, "12-revoke-failed.png"),
          fullPage: true,
        });
        console.log(
          JSON.stringify({
            check: "owner-revoke-failure",
            alerts: await page.getByRole("alert").allInnerTexts(),
            action: (await page.locator("main").innerText()).slice(-1700),
          }),
        );
        throw new Error(
          `Revocation did not consume authority: ${revoked.slice(0, 500)}`,
        );
      }
      await page.screenshot({
        path: path.join(output, "12-revoked.png"),
        fullPage: true,
      });
      console.log(JSON.stringify({ check: "owner-revoked", visible: true }));
      if (errors.length) throw new Error(errors.join("\n"));
      return;
    }
    await page
      .getByRole("region", { name: "Public receipt" })
      .waitFor({ timeout: 120_000 });
    const receiptText = await page
      .getByRole("region", { name: "Public receipt" })
      .innerText();
    if (!receiptText.includes("SUCCEEDED") || !receiptText.includes("PASSED")) {
      throw new Error(
        `Swap receipt did not prove success: ${receiptText.slice(0, 350)}`,
      );
    }
    await page.screenshot({
      path: path.join(output, "12-swap-receipt.png"),
      fullPage: true,
    });
    console.log(JSON.stringify({ check: "swap-receipt", visible: true }));
    await page.goto(`${WEB}/app`, { waitUntil: "networkidle" });
    await page.getByText(/Policy v1 active/u).waitFor({ timeout: 30_000 });
    const cake = page.locator("fieldset").filter({ hasText: "Cake" });
    await cake.getByRole("radio", { name: "active" }).check();
    await cake
      .getByRole("textbox", { name: "Cake maximum input per task" })
      .fill("2");
    await cake
      .getByRole("textbox", { name: "Cake rolling 24-hour cap" })
      .fill("5");
    await page.getByRole("button", { name: "Review exact limits" }).click();
    await page.getByRole("button", { name: "Sign and activate" }).waitFor();
    await page.getByRole("button", { name: "Sign and activate" }).click();
    await page.getByText(/Policy v2 active/u).waitFor({ timeout: 60_000 });
    console.log(
      JSON.stringify({
        check: "stake-policy-active",
        visible: true,
        confirmations: policyConfirmations,
      }),
    );
    await page
      .getByRole("textbox", { name: "Your goal" })
      .fill("Stake 0.5 CAKE");
    await page.getByRole("button", { name: "Compile goal" }).click();
    await page.waitForURL(/\/app\/tasks\/[0-9a-f-]+$/u, { timeout: 60_000 });
    await page
      .getByRole("button", { name: "Simulate exact plan" })
      .waitFor({ timeout: 45_000 });
    await page.screenshot({
      path: path.join(output, "13-stake-plan.png"),
      fullPage: true,
    });
    console.log(
      JSON.stringify({
        check: "stake-compiled",
        url: new URL(page.url()).pathname,
      }),
    );
    await page.getByRole("button", { name: "Simulate exact plan" }).click();
    await page
      .getByRole("button", { name: "Prepare fresh mandate" })
      .waitFor({ timeout: 60_000 });
    try {
      await page
        .getByRole("button", { name: "Prepare fresh mandate" })
        .click({ timeout: 10_000 });
    } catch (error) {
      console.log(
        "stake simulation screen:",
        (await page.locator("main").innerText()).slice(-2400),
      );
      console.log("stake page errors:", errors);
      throw error;
    }
    await page
      .getByRole("button", { name: "Sign exact mandate" })
      .waitFor({ timeout: 60_000 });
    await page.screenshot({
      path: path.join(output, "14-stake-review.png"),
      fullPage: true,
    });
    if (mobile) {
      const overflow = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      console.log(
        JSON.stringify({ check: "mobile-task-overflow", ...overflow }),
      );
      if (overflow.scroll > overflow.viewport)
        throw new Error("Signed mobile task overflows the viewport.");
    }
    const stakeMinimum = await page
      .getByRole("region", { name: "Prepare and sign mandate" })
      .locator("dt", { hasText: "minimum output" })
      .locator("..")
      .locator("dd")
      .innerText();
    if (
      !stakeMinimum.includes("POOL_SHARES") ||
      stakeMinimum.includes("Cake")
    ) {
      throw new Error(
        `Stake signature minimum has the wrong unit: ${stakeMinimum}`,
      );
    }
    await page.getByRole("button", { name: "Approve exact input" }).click();
    await page
      .getByRole("button", { name: "Sign exact mandate" })
      .click({ timeout: 60_000 });
    await page
      .getByRole("region", { name: "Public receipt" })
      .waitFor({ timeout: 120_000 });
    const stakeReceipt = await page
      .getByRole("region", { name: "Public receipt" })
      .innerText();
    if (
      !stakeReceipt.includes("SUCCEEDED") ||
      !stakeReceipt.includes("PASSED")
    ) {
      throw new Error(
        `Stake receipt did not prove success: ${stakeReceipt.slice(0, 350)}`,
      );
    }
    if (
      await page
        .getByRole("region", { name: "Simulation progress" })
        .isVisible()
    ) {
      throw new Error(
        "Completed simulation steps must not bury the final receipt.",
      );
    }
    await page.screenshot({
      path: path.join(output, "15-stake-receipt.png"),
      fullPage: true,
    });
    console.log(JSON.stringify({ check: "stake-receipt", visible: true }));
    await page.goto(`${WEB}/app`, { waitUntil: "networkidle" });
    await page.getByText(/Policy v2 active/u).waitFor({ timeout: 30_000 });
    await page
      .getByRole("textbox", { name: "Your goal" })
      .fill("Stake 0.1 CAKE");
    await page.getByRole("button", { name: "Compile goal" }).click();
    await page.waitForURL(/\/app\/tasks\/[0-9a-f-]+$/u, { timeout: 60_000 });
    await page.getByRole("button", { name: "Simulate exact plan" }).click();
    await page
      .getByRole("button", { name: "Prepare fresh mandate" })
      .waitFor({ timeout: 60_000 });
    await rpc("evm_increaseTime", [600]);
    await rpc("evm_mine", []);
    await page.getByRole("button", { name: "Prepare fresh mandate" }).click();
    await page
      .getByText("STALE_QUOTE", { exact: true })
      .first()
      .waitFor({ timeout: 30_000 });
    await page.screenshot({
      path: path.join(output, "16-stale-quote.png"),
      fullPage: true,
    });
    console.log(
      JSON.stringify({ check: "stale-quote-refused", visible: true }),
    );

    await page.route("http://127.0.0.1:8787/**", (route) => route.abort());
    await page.goto(`${WEB}/app`, { waitUntil: "networkidle" });
    await page
      .getByText("The Perago API is not answering.")
      .waitFor({ timeout: 30_000 });
    await page.getByText("API_UNREACHABLE").waitFor();
    await page.screenshot({
      path: path.join(output, "17-provider-outage.png"),
      fullPage: true,
    });
    await page.unroute("http://127.0.0.1:8787/**");
    await page.getByRole("button", { name: "Try again" }).click();
    await page
      .getByText("Your intent, carried through.")
      .waitFor({ timeout: 30_000 });
    console.log(
      JSON.stringify({ check: "provider-outage-recovered", visible: true }),
    );
    if (errors.length) throw new Error(errors.join("\n"));
  } finally {
    await browser.close();
  }
}

await main();
