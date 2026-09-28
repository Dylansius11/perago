import {
  type ExecutionReceipt,
  executionReceiptSchema,
  type Hash,
  hashSchema,
  REASON_MESSAGES,
  reasonCodeSchema,
} from "@perago/sdk";
import type { JSONValue, Sql } from "postgres";
import { bscTestnet } from "viem/chains";
import type { MandateRecordStatus } from "../executions/chain.js";
import type { FinalizedCommerceState } from "./receipt-index.js";

const hex = (value: Buffer) => `0x${value.toString("hex")}` as `0x${string}`;

interface ReceiptRow {
  status: "SUCCEEDED" | "FAILED" | "REVOKED" | "EXPIRED";
  chain_id: string;
  account_address: Buffer;
  mandate_executor_address: Buffer;
  mandate_hash: Buffer;
  policy_hash: Buffer;
  intent_hash: Buffer;
  plan_hash: Buffer;
  simulation_hash: Buffer;
  action_hash: Buffer;
  postcondition_hash: Buffer;
  nonce: string;
  authority_consumed: boolean;
  terminal_reason_code: string;
  authorize_tx_hash: Buffer;
  authorization_block_number: string;
  authorization_block_hash: Buffer;
  begin_block_number: string | null;
  begin_block_hash: Buffer | null;
  begin_tx_hash: Buffer | null;
  execute_user_operation_hash: Buffer | null;
  execution_tx_hash: Buffer | null;
  erc8183_contract: Buffer | null;
  erc8183_job_id: string | null;
  settlement_tx_hash: Buffer | null;
  verification_hash: Buffer | null;
  terminal_transaction_hash: Buffer;
  terminal_block_number: string;
  terminal_block_hash: Buffer;
  terminal_log_index: number;
  terminal_decoded_args: Record<string, JSONValue> | null;
}

const ZERO_HASH = `0x${"0".repeat(64)}`;

/** A confirmed DB event cannot override the finalized contract's commitments. */
export function assertReceiptCommitments(
  receipt: Pick<ExecutionReceipt, "status" | "verification">,
  record: {
    recordStatus: MandateRecordStatus;
    verificationHash: Hash;
    failureReasonHash: Hash;
  },
): void {
  const expectedVerification =
    record.recordStatus === "SUCCEEDED"
      ? "PASSED"
      : record.recordStatus === "FAILED"
        ? "NOT_VERIFIED"
        : "NOT_APPLICABLE";
  if (
    receipt.status !== record.recordStatus ||
    receipt.verification.status !== expectedVerification ||
    (receipt.verification.hash ?? ZERO_HASH) !==
      record.verificationHash.toLowerCase() ||
    (receipt.verification.failureReasonHash ?? ZERO_HASH) !==
      record.failureReasonHash.toLowerCase()
  ) {
    throw new Error(
      "public receipt commitment disagrees with finalized MandateExecutor",
    );
  }
}

/** Only the finalized index observation may turn a bound success into paid. */
export function publicReceiptSettlement(input: {
  status: ReceiptRow["status"];
  commerceContract: `0x${string}` | null;
  jobId: string | null;
  settlementTxHash: `0x${string}` | null;
  commerce: FinalizedCommerceState | null;
}) {
  if (input.commerceContract === null || input.jobId === null)
    return { status: "NOT_BOUND" as const };
  const binding = {
    commerceContract: input.commerceContract,
    jobId: input.jobId,
  };
  if (input.status !== "SUCCEEDED")
    return { status: "INELIGIBLE" as const, ...binding };
  if (input.commerce?.status === "UNPAID")
    return { status: "UNPAID" as const, ...binding };
  if (
    input.commerce?.status !== "CONFIRMED" ||
    input.settlementTxHash !== input.commerce.settlementTxHash ||
    !input.commerce.evidence
  ) {
    return { status: "PENDING" as const, ...binding };
  }
  return {
    status: "CONFIRMED" as const,
    ...binding,
    ...input.commerce.evidence,
  };
}

/** Read only the canonical, confirmed receipt and its public commitment fields. */
export async function getPublicReceipt(
  sql: Sql,
  mandateHash: string,
  commerce: FinalizedCommerceState | null = null,
): Promise<ExecutionReceipt | null> {
  const key = Buffer.from(hashSchema.parse(mandateHash).slice(2), "hex");
  const [row] = await sql<ReceiptRow[]>`
    select r.status, m.chain_id::text, m.account_address, m.mandate_executor_address,
      r.mandate_hash, r.policy_hash, r.intent_hash, r.plan_hash, r.simulation_hash,
      r.action_hash, r.postcondition_hash, m.nonce::text,
      r.authority_consumed, m.terminal_reason_code,
      r.authorize_tx_hash, authorized.block_number::text as authorization_block_number,
      authorized.block_hash as authorization_block_hash,
      begun.transaction_hash as begin_tx_hash,
      begun.block_number::text as begin_block_number,
      begun.block_hash as begin_block_hash,
      case when e.execute_tx_hash = r.execution_tx_hash
        then e.execute_user_operation_hash else null end as execute_user_operation_hash,
      r.execution_tx_hash, r.settlement_tx_hash, r.erc8183_contract,
      r.erc8183_job_id::text, r.verification_hash,
      terminal.transaction_hash as terminal_transaction_hash,
      terminal.block_number::text as terminal_block_number,
      terminal.block_hash as terminal_block_hash,
      terminal.log_index as terminal_log_index,
      terminal.decoded_args as terminal_decoded_args
    from execution_receipts r
    join mandates m on m.mandate_hash = r.mandate_hash
    left join executions e on e.mandate_hash = r.mandate_hash
    join chain_events authorized on authorized.chain_id = m.chain_id
      and authorized.transaction_hash = r.authorize_tx_hash
      and authorized.status = 'CONFIRMED'
      and authorized.decoded_name = 'MandateAuthorized'
      and authorized.decoded_args->>'mandateHash' = ${hex(key)}
      and authorized.contract_address = m.mandate_executor_address
    join chain_events terminal on terminal.chain_id = m.chain_id
      and terminal.transaction_hash = m.terminal_tx_hash
      and terminal.status = 'CONFIRMED'
      and terminal.decoded_args->>'mandateHash' = ${hex(key)}
      and terminal.decoded_name in ('ExecutionReceiptRecorded', 'MandateRevoked', 'MandateExpired')
      and terminal.block_number = r.terminal_block_number
      and terminal.contract_address = m.mandate_executor_address
    left join chain_events begun on begun.chain_id = m.chain_id
      and begun.status = 'CONFIRMED'
      and begun.decoded_name = 'ExecutionBegun'
      and begun.decoded_args->>'mandateHash' = ${hex(key)}
      and begun.contract_address = m.mandate_executor_address
    where r.mandate_hash = ${key}
  `;
  if (!row) return null;
  if (row.terminal_reason_code === null) {
    throw new Error("terminal receipt is missing its reason code");
  }
  if (
    row.terminal_decoded_args?.status !== undefined &&
    row.terminal_decoded_args.status !== row.status
  ) {
    throw new Error("receipt status disagrees with confirmed event");
  }
  const executed = row.status === "SUCCEEDED" || row.status === "FAILED";
  const eventHash = executed
    ? hashSchema.parse(row.terminal_decoded_args?.verificationHash)
    : null;
  if (
    eventHash !==
    (row.verification_hash === null ? null : hex(row.verification_hash))
  ) {
    throw new Error(
      "receipt verification commitment disagrees with confirmed event",
    );
  }
  const failureReasonHash = executed
    ? hashSchema.parse(row.terminal_decoded_args?.failureReasonHash)
    : null;
  if ((row.erc8183_contract === null) !== (row.erc8183_job_id === null)) {
    throw new Error("receipt commerce binding is incomplete");
  }
  const settlement = publicReceiptSettlement({
    status: row.status,
    commerceContract:
      row.erc8183_contract === null ? null : hex(row.erc8183_contract),
    jobId: row.erc8183_job_id,
    settlementTxHash:
      row.settlement_tx_hash === null ? null : hex(row.settlement_tx_hash),
    commerce,
  });
  if (row.chain_id !== String(bscTestnet.id)) {
    throw new Error("public receipt has no configured explorer for this chain");
  }
  const explorer = bscTestnet.blockExplorers.default.url;
  const txLink = (hash: Buffer | null) =>
    hash === null ? null : `${explorer}/tx/${hex(hash)}`;
  const result = {
    schemaVersion: "1",
    status: row.status,
    chainId: row.chain_id,
    account: hex(row.account_address),
    mandateExecutor: hex(row.mandate_executor_address),
    mandateHash: hex(row.mandate_hash),
    policyHash: hex(row.policy_hash),
    intentHash: hex(row.intent_hash),
    planHash: hex(row.plan_hash),
    simulationHash: hex(row.simulation_hash),
    actionHash: hex(row.action_hash),
    postconditionHash: hex(row.postcondition_hash),
    nonce: row.nonce,
    authorityConsumed: row.authority_consumed,
    terminalMessage:
      REASON_MESSAGES[reasonCodeSchema.parse(row.terminal_reason_code)],
    terminalReasonCode: row.terminal_reason_code,
    transactions: {
      authorize: hex(row.authorize_tx_hash),
      begin: row.begin_tx_hash === null ? null : hex(row.begin_tx_hash),
      userOperation:
        row.execute_user_operation_hash === null ||
        row.execution_tx_hash === null ||
        !row.execution_tx_hash.equals(row.terminal_transaction_hash)
          ? null
          : hex(row.execute_user_operation_hash),
      execution:
        row.execution_tx_hash === null ? null : hex(row.execution_tx_hash),
    },
    authorization: {
      blockNumber: row.authorization_block_number,
      blockHash: hex(row.authorization_block_hash),
    },
    begin:
      row.begin_block_number === null || row.begin_block_hash === null
        ? null
        : {
            blockNumber: row.begin_block_number,
            blockHash: hex(row.begin_block_hash),
          },
    terminal: {
      transactionHash: hex(row.terminal_transaction_hash),
      blockNumber: row.terminal_block_number,
      blockHash: hex(row.terminal_block_hash),
      logIndex: row.terminal_log_index,
    },
    explorer: {
      authorization: `${explorer}/tx/${hex(row.authorize_tx_hash)}`,
      begin: txLink(row.begin_tx_hash),
      execution: txLink(row.execution_tx_hash),
      terminal: `${explorer}/tx/${hex(row.terminal_transaction_hash)}`,
      block: `${explorer}/block/${row.terminal_block_number}`,
    },
    verification: {
      status:
        row.status === "SUCCEEDED"
          ? "PASSED"
          : row.status === "FAILED"
            ? "NOT_VERIFIED"
            : "NOT_APPLICABLE",
      hash: eventHash,
      failureReasonHash,
      reasonCode: row.terminal_reason_code,
    },
    settlement,
  };
  return executionReceiptSchema.parse(result);
}
