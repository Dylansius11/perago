import { setTimeout as delay } from "node:timers/promises";
import {
  cakeStakeAdapterAbi,
  cakeStakePositionAbi,
  encodeAccountExecute,
  encodeStakeAction,
  type Hash,
  mandateExecutorAbi,
} from "@perago/sdk";
import {
  type Abi,
  encodeFunctionData,
  erc20Abi,
  keccak256,
  parseAbi,
  parseEther,
  toHex,
} from "viem";
import { entryPoint07Abi } from "viem/account-abstraction";
import { describe, expect, it } from "vitest";

import { events, submitted } from "./executor-process.js";
import { manifestDeployer } from "./fork.js";
import {
  asHex,
  bump,
  createJourney,
  errorBody,
  type JourneyVenue,
  lower,
  MANDATE_STATUS,
  OTHER,
  type PreparedTask,
  preparedBody,
  refused,
} from "./journey.js";

/**
 * P5-002 stake journey on the shared journey harness (`journey.ts`). One
 * natural-language stake goes through the real API, planner, and executor
 * process against the `testnet-demo` MandateExecutor (`SC-D-006`) and the
 * production `CakeStakeAdapter`/`StakeVerifier` it pins. It records the signed
 * smart account, the exact input, the explicit position terms, the holder's
 * share delta, the terminal receipt, and replay rejection; refuses every
 * critical mutation at the policy, signature, authorization, perform, and
 * session layers; refuses to sign on a stale or unreadable position; survives
 * a SIGKILL of the worker right after the perform UserOperation is persisted;
 * and proves only the recipient can withdraw, then withdraws.
 */

const STAKE_GOAL = "Stake 1 CAKE";
const STAKE_INPUT = parseEther("1");
/** A second stake simulated before the journey's stake lands, so its position read goes stale. */
const PROBE_GOAL = "Stake 0.5 CAKE";
const cakePoolAbi = parseAbi([
  "function userInfo(address) view returns (uint256 shares, uint256 lastDepositedTime, uint256 cakeAtLastUserAction, uint256 lastUserActionTime, uint256 lockStartTime, uint256 lockEndTime, uint256 userBoostedShare, bool locked, uint256 lockedAmount)",
  "function withdrawFee() view returns (uint256)",
  "function withdrawFeePeriod() view returns (uint256)",
  "function performanceFee() view returns (uint256)",
]);
const STAKE_ERRORS = [
  ...cakeStakePositionAbi,
  ...mandateExecutorAbi,
  ...entryPoint07Abi,
] as Abi;

export function defineStakeJourney(venue: JourneyVenue): void {
  const j = createJourney({
    venue,
    kind: "STAKE",
    title: "Phase 5 stake journey",
    evidence: {
      fork: "bsc-testnet.fork.phase5-stake-journey.json",
      testnet: "bsc-testnet.phase5-stake-journey.json",
    },
    async fund(tools) {
      const CAKE = tools.token("Cake");
      const needed = STAKE_INPUT * 2n;
      const transfer = encodeFunctionData({
        abi: erc20Abi,
        args: [tools.account, needed],
        functionName: "transfer",
      });
      if (!tools.live) {
        await tools.sendAs(await manifestDeployer(), {
          data: transfer,
          to: CAKE,
        });
        return {};
      }
      // The disposable owner's account already holds testnet CAKE; top up only if short.
      if ((await tools.balanceOf(CAKE, tools.account)) >= needed) return {};
      const hash = await tools.send({ data: transfer, to: CAKE });
      return {
        accountCake: {
          amount: needed.toString(),
          transactionHash: hash,
          explorer: tools.explorer(hash),
        },
      };
    },
  });
  const CAKE = j.token("Cake");
  const EXECUTOR = j.deployment.mandateExecutor.address;
  const STAKE = j.deployment.adapters.STAKE;
  const POOL = STAKE.protocolTarget.address;
  const swapAdapter = {
    name: "the pinned swap adapter",
    address: j.deployment.adapters.SWAP.adapter.address,
  };

  const sharesOf = async (holder: `0x${string}`) =>
    (
      await j.client.readContract({
        abi: cakePoolAbi,
        address: POOL,
        args: [holder],
        functionName: "userInfo",
      })
    )[0];

  describe(`Phase 5 stake journey on ${j.live ? "chain 97 (testnet-demo)" : "a chain-97 fork"}`, {
    timeout: 1_800_000,
  }, () => {
    let task: PreparedTask;
    let probe: PreparedTask;
    let rootSignature: `0x${string}`;
    let stakeFields: Record<string, string>;
    let holder: `0x${string}`;
    let authorizeTx: Hash;
    let beginTx: Hash;
    let performTx: Hash;
    const freshness: Record<string, unknown> = {};
    let cakeBefore = 0n;
    let sharesBefore = 0n;
    let executorNonceBefore = 0;

    it("activates a Wallet Policy and installs a perform-only session with one root UserOperation", async () => {
      await j.activatePolicy();
    });

    it("refuses excess stake and a foreign recipient in policy, before anything is signed", async () => {
      await j.refuseInPolicy({
        excessGoal: "Stake 10 CAKE",
        policyLimit: "CAKE 5 per task",
        goal: STAKE_GOAL,
      });
    });

    it("compiles, simulates, and prepares one stake whose position terms the chain confirms", async () => {
      task = await j.prepareJourneyTask("p5-journey-stake", STAKE_GOAL);
      const { result } = task.simulation;
      expect(BigInt(task.mandate.maxInput)).toBe(STAKE_INPUT);
      expect(task.mandate.inputToken).toBe(CAKE);
      expect(task.mandate.outputToken).toBe(CAKE);
      expect(result.outcomeUnit).toBe("POOL_SHARES");
      if (result.action.kind !== "STAKE" || result.position === null) {
        throw new Error("not a stake simulation with position terms");
      }
      const { kind: _kind, ...fields } = result.action;
      stakeFields = fields;
      expect(BigInt(result.minOutput)).toBeLessThan(
        BigInt(result.quotedOutput),
      );

      // Every committed position fact, re-read here straight from chain.
      const block = BigInt(result.block.number);
      const position = result.position;
      holder = (
        await j.client.readContract({
          abi: cakeStakeAdapterAbi,
          address: STAKE.adapter.address,
          args: [j.account],
          blockNumber: block,
          functionName: "positionOf",
        })
      ).toLowerCase() as `0x${string}`;
      const pool = (
        functionName: "withdrawFee" | "withdrawFeePeriod" | "performanceFee",
      ) =>
        j.client
          .readContract({
            abi: cakePoolAbi,
            address: POOL,
            blockNumber: block,
            functionName,
          })
          .then(String);
      const code = await j.client.getCode({
        address: holder,
        blockNumber: block,
      });
      expect(position).toEqual({
        holder,
        holderDeployed: code !== undefined && code !== "0x",
        sharesBefore: (
          await j.client.readContract({
            abi: cakePoolAbi,
            address: POOL,
            args: [holder],
            blockNumber: block,
            functionName: "userInfo",
          })
        )[0].toString(),
        withdrawFeeBps: await pool("withdrawFee"),
        withdrawFeePeriodSeconds: await pool("withdrawFeePeriod"),
        performanceFeeBps: await pool("performanceFee"),
      });
      j.evidence.position = {
        committed: position,
        minPositionOut: result.minOutput,
        estimatedShares: result.quotedOutput,
        maxSlippageBps: result.maxSlippageBps,
        policyHash: result.policyHash,
        risks: result.risks,
        check: `holder, deployment, shares, and the three pool fees re-read at block ${result.block.number} equal the committed position`,
      };
    });

    it("rejects a root signature over any tampered field, then queues the exact one", async () => {
      rootSignature = await j.signAndQueue(task, swapAdapter);
    });

    it("refuses tampered mandates at MandateExecutor.authorize under the owner's real signature", async () => {
      await j.refuseTamperedAuthorize(
        task,
        rootSignature,
        // A one-asset mandate is never a swap: the pair check refuses it before the signature.
        { ...swapAdapter, refusal: /^InvalidTokenPair$/u },
        {
          name: "the CAKE Pool",
          address: POOL,
        },
      );
    });

    it("authorizes and begins through the worker, then refuses every tampered perform and session call", async () => {
      const { mandate, mandateHash } = task;
      await j.approveExactInput(mandate);
      cakeBefore = await j.balanceOf(CAKE, j.account);
      sharesBefore = await sharesOf(holder);
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
        address: CAKE,
        args: [j.account, EXECUTOR],
        functionName: "allowance",
      });
      expect(allowance).toBe(BigInt(mandate.maxInput));

      const stakeAction = (changes: Record<string, string>) =>
        encodeStakeAction({ ...stakeFields, ...changes });
      await j.refuseTamperedPerform(task, swapAdapter, [
        [
          "action amount raised (excess spend)",
          stakeAction({ amount: bump(stakeFields.amount ?? "0") }),
        ],
        [
          "action minPositionOut lowered",
          stakeAction({
            minPositionOut: lower(stakeFields.minPositionOut ?? "1"),
          }),
        ],
        ["action recipient changed", stakeAction({ recipient: OTHER })],
        [
          "action poolId changed to another staking target",
          stakeAction({
            poolId: keccak256(
              toHex("perago.stake.pancakeswap.cake-pool.locked.v1"),
            ),
          }),
        ],
        [
          "action asset changed to WBNB",
          stakeAction({ asset: j.token("WBNB") }),
        ],
      ]);
      await j.refuseSessionCalls(task, {
        name: "recipient changed",
        bytes: stakeAction({ recipient: OTHER }),
      });

      j.evidence.execution = {
        authorize: {
          transactionHash: authorizeTx,
          explorer: j.explorer(authorizeTx),
        },
        begin: { transactionHash: beginTx, explorer: j.explorer(beginTx) },
        executionStartedAt: record.executionStartedAt.toString(),
        exactAllowanceBeforePerform: allowance.toString(),
      };
    });

    it("prepares a second stake against the current position and refuses it while the position is unreadable", async () => {
      probe = await j.prepareTask("p5-journey-probe", PROBE_GOAL);
      const committed = probe.simulation.result.position;
      expect(committed?.sharesBefore).toBe(sharesBefore.toString());
      j.evidence.positionFreshness = freshness;
      Object.assign(freshness, {
        goal: PROBE_GOAL,
        taskId: probe.taskId,
        simulatedAtBlock: probe.simulation.result.block.number,
        committedPosition: committed,
        preparedBeforeTheStake: true,
      });
      if (j.live) {
        freshness.unavailable =
          "not exercised on chain 97, whose pool cannot be made unreadable; proven on the fork journey and by src/simulation/stake.test.ts";
      } else {
        // Fork only: the pool's code is swapped for one that reverts, then restored.
        const poolCode = await j.client.getCode({ address: POOL });
        if (!poolCode) throw new Error("the CAKE Pool has no code");
        await j.testClient.setCode({ address: POOL, bytecode: "0xfe" });
        const unavailable = await j.api(
          errorBody,
          `/tasks/${probe.taskId}/mandate/prepare`,
          {},
        );
        await j.testClient.setCode({ address: POOL, bytecode: poolCode });
        expect(unavailable.status).toBe(409);
        expect(unavailable.body.error.code).toBe("POSITION_UNAVAILABLE");
        const restored = await j.api(
          preparedBody,
          `/tasks/${probe.taskId}/mandate/prepare`,
          {},
        );
        expect(restored.status, JSON.stringify(restored.body)).toBe(200);
        freshness.unavailable = {
          fault:
            "anvil_setCode replaced the CAKE Pool runtime with 0xfe (INVALID) for one prepare call",
          prepare: {
            status: unavailable.status,
            error: unavailable.body.error,
          },
          afterRestore: `prepare answered ${restored.status}: an unreadable position refuses without invalidating the simulation`,
        };
      }
    });

    it("performs through the worker, recovers from a SIGKILL after the UserOperation is persisted, and measures the position delta", async () => {
      const { mandate, mandateHash } = task;
      const crash = j.processes().start("journey-perform-crash", "loop");
      const deadline = Date.now() + 180_000;
      let perform = submitted({ code: null, lines: crash.lines }).find(
        (line) => line.kind === "PERFORM",
      );
      while (!perform && Date.now() < deadline) {
        await delay(100); // Watches the worker's stdout for the persisted PERFORM hash.
        perform = submitted({ code: null, lines: crash.lines }).find(
          (line) => line.kind === "PERFORM",
        );
      }
      crash.child.kill("SIGKILL");
      await crash.exited;
      if (!perform?.transactionHash || !perform.userOperationHash) {
        throw new Error(
          `the worker never submitted PERFORM:\n${crash.lines.join("\n")}`,
        );
      }
      performTx = perform.transactionHash;
      const performOperation = perform.userOperationHash;

      // Each restart is a fresh process that must wait out the dead worker's lease.
      const restarts: string[][] = [];
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const run = await j.processes().step(`journey-restart-${attempt}`);
        expect(submitted(run), `restart ${attempt}`).toEqual([]);
        restarts.push(
          events(run)
            .map((line) => line.event)
            .filter((event) => event !== "job.decision"),
        );
        if ((await j.execution(mandateHash)).status === "TERMINAL") break;
      }
      const row = await j.execution(mandateHash);
      expect(row.status).toBe("TERMINAL");
      expect(asHex(row.execute_user_operation_hash)).toBe(performOperation);

      const transactions = {
        authorize: authorizeTx,
        begin: beginTx,
        perform: performTx,
      };
      await j.verifyLifecycle(mandateHash, transactions);

      const cakeAfter = await j.balanceOf(CAKE, j.account);
      const sharesAfter = await sharesOf(holder);
      const allowanceAfter = await j.client.readContract({
        abi: erc20Abi,
        address: CAKE,
        args: [j.account, EXECUTOR],
        functionName: "allowance",
      });
      const holderCode = await j.client.getCode({ address: holder });
      expect(cakeBefore - cakeAfter).toBe(BigInt(mandate.maxInput));
      expect(sharesAfter - sharesBefore).toBeGreaterThanOrEqual(
        BigInt(mandate.minOutput),
      );
      expect(allowanceAfter).toBe(0n);
      expect(holderCode).toMatch(/^0x[0-9a-f]{10,}/u);
      for (const holderOfFunds of [EXECUTOR, STAKE.adapter.address, holder]) {
        expect(await j.balanceOf(CAKE, holderOfFunds), holderOfFunds).toBe(0n);
      }
      const executorTransactions =
        (await j.client.getTransactionCount({
          address: j.executorAccount.address,
        })) - executorNonceBefore;
      expect(executorTransactions).toBe(3);

      j.evidence.restart = {
        killed:
          "a loop worker received SIGKILL as soon as it logged the persisted PERFORM transaction and UserOperation hashes",
        persistedBeforeKill: {
          transactionHash: performTx,
          userOperationHash: performOperation,
        },
        restartEvents: restarts,
        result:
          "the restarted processes submitted nothing; the one persisted UserOperation is the one the chain executed",
      };
      j.evidence.outcome = {
        cakeSpent: (cakeBefore - cakeAfter).toString(),
        maxInput: mandate.maxInput,
        holder,
        holderDeployedAfter: true,
        sharesBefore: sharesBefore.toString(),
        sharesAfter: sharesAfter.toString(),
        sharesMinted: (sharesAfter - sharesBefore).toString(),
        minPositionOut: mandate.minOutput,
        allowanceAfter: allowanceAfter.toString(),
        residualCake: {
          mandateExecutor: "0",
          stakeAdapter: "0",
          holder: "0",
        },
        executorTransactions,
      };
    });

    it("refuses to sign the second stake once this stake moved the position", async () => {
      const stale = await j.api(
        errorBody,
        `/tasks/${probe.taskId}/mandate/prepare`,
        {},
      );
      expect(stale.status).toBe(409);
      const reasons = (stale.body.error.detail ?? "").split(", ");
      expect(reasons).toContain("STALE_POSITION");
      freshness.stale = {
        prepare: { status: stale.status, error: stale.body.error },
        currentShares: (await sharesOf(holder)).toString(),
        note: "every stale fact is reported in a fixed order; the code is the first of them",
      };
    });

    it("rejects every replay of the consumed mandate and never acts on a redelivery", async () => {
      await j.refuseReplays(task, rootSignature, {
        authorize: authorizeTx,
        begin: beginTx,
        perform: performTx,
      });
    });

    it("lets only the recipient withdraw, and the owner recovers the stake", async () => {
      const withdrawAll = encodeFunctionData({
        abi: cakeStakePositionAbi,
        functionName: "withdrawAll",
      });
      const byExecutor = await refused(
        () =>
          j.client.call({
            account: j.executorAccount.address,
            data: withdrawAll,
            to: holder,
          }),
        STAKE_ERRORS,
      );
      expect(byExecutor).toBe("WrongAccountCaller");
      const bySession = await refused(
        () => j.sessionCall({ data: withdrawAll, target: holder }),
        STAKE_ERRORS,
      );
      expect(bySession).toMatch(/^FailedOp/u);

      const shares = await sharesOf(holder);
      const cakeBeforeWithdraw = await j.balanceOf(CAKE, j.account);
      const staked = BigInt(task.mandate.maxInput);
      const withdrawal = await j.rootOperation(
        encodeAccountExecute({ data: withdrawAll, target: holder, value: 0n }),
      );
      const returned =
        (await j.balanceOf(CAKE, j.account)) - cakeBeforeWithdraw;
      expect(await sharesOf(holder)).toBe(0n);
      expect(await j.balanceOf(CAKE, holder)).toBe(0n);
      // Inside the fee period the pool keeps its withdrawal fee, so less than the stake returns.
      expect(returned).toBeGreaterThan(0n);
      expect(returned).toBeLessThan(staked);

      j.evidence.withdraw = {
        refusals: [
          {
            caller: "executor key calling holder.withdrawAll directly",
            refusal: byExecutor,
          },
          {
            caller: "executor session UserOperation calling holder.withdrawAll",
            refusal: bySession,
          },
        ],
        withdrawal,
        sharesWithdrawn: shares.toString(),
        cakeReturned: returned.toString(),
        cakeStaked: staked.toString(),
        note: "the owner's root UserOperation made the account call CakeStakePosition.withdrawAll; the pool kept its early-withdrawal fee",
      };
    });

    it("keeps the executor key and worker token out of every log line", async () => {
      await j.checkLogsAndWriteEvidence();
    });
  });
}
