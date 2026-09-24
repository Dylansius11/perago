import { encodeSwapAction, type Hash } from "@perago/sdk";
import { encodeFunctionData, erc20Abi, parseAbi, parseEther } from "viem";
import { describe, expect, it } from "vitest";

import { submitted } from "./executor-process.js";
import {
  bump,
  createJourney,
  type JourneyVenue,
  lower,
  MANDATE_STATUS,
  OTHER,
  type PreparedTask,
} from "./journey.js";

/**
 * P4-003 swap journey. One natural-language swap goes through the shared
 * journey harness (`journey.ts`): owner, account, policy, simulation, digest,
 * authorization, begin, the perform UserOperation and transaction, the output
 * delta, the receipt, and replay rejection. Excess spend, a lowered minimum,
 * and a changed recipient, adapter, selector, target, or action are refused
 * at the policy, signature, authorization, perform, and session layers.
 */

const SWAP_GOAL = "Swap 0.01 WBNB for CAKE";
const SWAP_INPUT = parseEther("0.01");
const wbnbAbi = parseAbi(["function deposit() payable"]);

export function defineSwapJourney(venue: JourneyVenue): void {
  const j = createJourney({
    venue,
    kind: "SWAP",
    title: "Phase 4 swap journey",
    evidence: {
      fork: "bsc-testnet.fork.phase4-swap-journey.json",
      testnet: "bsc-testnet.phase4-swap-journey.json",
    },
    async fund(tools) {
      const WBNB = tools.token("WBNB");
      const deposit = encodeFunctionData({
        abi: wbnbAbi,
        functionName: "deposit",
      });
      if (!tools.live) {
        await tools.sendAs(tools.account, {
          data: deposit,
          to: WBNB,
          value: parseEther("0.05"),
        });
        return {};
      }
      const held = await tools.balanceOf(WBNB, tools.account);
      if (held >= SWAP_INPUT) return {};
      const need = SWAP_INPUT - held;
      const wrap = await tools.send({ data: deposit, to: WBNB, value: need });
      const transfer = await tools.send({
        data: encodeFunctionData({
          abi: erc20Abi,
          args: [tools.account, need],
          functionName: "transfer",
        }),
        to: WBNB,
      });
      return {
        accountWbnb: {
          amount: need.toString(),
          wrap: { transactionHash: wrap, explorer: tools.explorer(wrap) },
          transfer: {
            transactionHash: transfer,
            explorer: tools.explorer(transfer),
          },
        },
      };
    },
  });
  const WBNB = j.token("WBNB");
  const CAKE = j.token("Cake");
  const EXECUTOR = j.deployment.mandateExecutor.address;
  const stakeAdapter = {
    name: "the pinned stake adapter",
    address: j.deployment.adapters.STAKE.adapter.address,
  };

  describe(`Phase 4 swap journey on ${j.live ? "chain 97 (testnet-demo)" : "a chain-97 fork"}`, {
    timeout: 1_800_000,
  }, () => {
    let task: PreparedTask;
    let rootSignature: `0x${string}`;
    let swapFields: Record<string, string>;
    let wbnbBefore = 0n;
    let cakeBefore = 0n;
    let executorNonceBefore = 0;
    let authorizeTx: Hash;
    let beginTx: Hash;
    let transactions: { authorize: Hash; begin: Hash; perform: Hash };

    it("activates a Wallet Policy and installs a perform-only session with one root UserOperation", async () => {
      await j.activatePolicy();
    });

    it("refuses excess spend and a foreign recipient in policy, before anything is signed", async () => {
      await j.refuseInPolicy({
        excessGoal: "Swap 1 WBNB for CAKE",
        policyLimit: "WBNB 0.05 per task",
        goal: SWAP_GOAL,
      });
    });

    it("compiles, simulates, and prepares one swap digest the chain agrees with", async () => {
      task = await j.prepareJourneyTask("p4-journey-swap", SWAP_GOAL);
      expect(BigInt(task.mandate.maxInput)).toBe(SWAP_INPUT);
      const { action } = task.simulation.result;
      if (action.kind !== "SWAP") throw new Error("not a swap action");
      const { kind: _kind, ...fields } = action;
      swapFields = fields;
    });

    it("rejects a root signature over any tampered field, then queues the exact one", async () => {
      rootSignature = await j.signAndQueue(task, stakeAdapter);
    });

    it("refuses tampered mandates at MandateExecutor.authorize under the owner's real signature", async () => {
      await j.refuseTamperedAuthorize(
        task,
        rootSignature,
        // The stake pair accepts a two-token mandate; only the signature refuses it.
        { ...stakeAdapter, refusal: /^InvalidRootSignature$/u },
        {
          name: "the PancakeSwap router",
          address: j.deployment.adapters.SWAP.protocolTarget.address,
        },
      );
    });

    it("authorizes and begins through the worker, then refuses every tampered perform and session call", async () => {
      const { mandate, mandateHash } = task;
      await j.approveExactInput(mandate);
      wbnbBefore = await j.balanceOf(WBNB, j.account);
      cakeBefore = await j.balanceOf(CAKE, j.account);
      executorNonceBefore = await j.client.getTransactionCount({
        address: j.executorAccount.address,
      });

      authorizeTx = await j.stage("journey-authorize", "AUTHORIZE");
      beginTx = await j.stage("journey-begin", "BEGIN");
      await j.awaitFinality(beginTx);
      const record = await j.onchainRecord(mandateHash);
      expect(MANDATE_STATUS[record.status]).toBe("EXECUTING");
      const allowance = await j.client.readContract({
        abi: erc20Abi,
        address: WBNB,
        args: [j.account, EXECUTOR],
        functionName: "allowance",
      });
      expect(allowance).toBe(BigInt(mandate.maxInput));

      const swapAction = (changes: Record<string, string>) =>
        encodeSwapAction({ ...swapFields, ...changes });
      await j.refuseTamperedPerform(task, stakeAdapter, [
        [
          "action amountIn raised (excess spend)",
          swapAction({ amountIn: bump(swapFields.amountIn ?? "0") }),
        ],
        [
          "action minAmountOut lowered",
          swapAction({ minAmountOut: lower(swapFields.minAmountOut ?? "1") }),
        ],
        ["action recipient changed", swapAction({ recipient: OTHER })],
        ["action pool fee changed", swapAction({ poolFee: "2500" })],
      ]);
      await j.refuseSessionCalls(task, {
        name: "recipient changed",
        bytes: swapAction({ recipient: OTHER }),
      });

      j.evidence.execution = {
        authorize: {
          transactionHash: authorizeTx,
          explorer: j.explorer(authorizeTx),
        },
        begin: {
          transactionHash: beginTx,
          explorer: j.explorer(beginTx),
        },
        executionStartedAt: record.executionStartedAt.toString(),
        exactAllowanceBeforePerform: allowance.toString(),
      };
    });

    it("performs through the worker and records a verified receipt with the measured output delta", async () => {
      transactions = {
        authorize: authorizeTx,
        begin: beginTx,
        perform: await j.stage("journey-perform", "PERFORM"),
      };
      const finish = await j.processes().step("journey-finish");
      expect(submitted(finish)).toEqual([]);
      await j.verifyLifecycle(task.mandateHash, transactions);

      const { mandate } = task;
      const wbnbAfter = await j.balanceOf(WBNB, j.account);
      const cakeAfter = await j.balanceOf(CAKE, j.account);
      const allowanceAfter = await j.client.readContract({
        abi: erc20Abi,
        address: WBNB,
        args: [j.account, EXECUTOR],
        functionName: "allowance",
      });
      expect(wbnbBefore - wbnbAfter).toBe(BigInt(mandate.maxInput));
      expect(cakeAfter - cakeBefore).toBeGreaterThanOrEqual(
        BigInt(mandate.minOutput),
      );
      expect(allowanceAfter).toBe(0n);
      expect(await j.balanceOf(WBNB, EXECUTOR)).toBe(0n);
      expect(await j.balanceOf(CAKE, EXECUTOR)).toBe(0n);
      const executorTransactions =
        (await j.client.getTransactionCount({
          address: j.executorAccount.address,
        })) - executorNonceBefore;
      expect(executorTransactions).toBe(3);

      j.evidence.outcome = {
        wbnbSpent: (wbnbBefore - wbnbAfter).toString(),
        maxInput: mandate.maxInput,
        cakeReceived: (cakeAfter - cakeBefore).toString(),
        minOutput: mandate.minOutput,
        allowanceAfter: allowanceAfter.toString(),
        mandateExecutorResidualWbnb: "0",
        mandateExecutorResidualCake: "0",
        executorTransactions,
      };
    });

    it("rejects every replay of the consumed mandate and never acts on a redelivery", async () => {
      await j.refuseReplays(task, rootSignature, transactions);
    });

    it("keeps the executor key and worker token out of every log line", async () => {
      await j.checkLogsAndWriteEvidence();
    });
  });
}
