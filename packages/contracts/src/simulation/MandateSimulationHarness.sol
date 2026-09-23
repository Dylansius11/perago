// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MandateExecutor} from "../MandateExecutor.sol";
import {IPeragoVerifier} from "../interfaces/IPeragoVerifier.sol";
import {PeragoTypes} from "../types/PeragoTypes.sol";

/// @title MandateSimulationHarness
/// @notice Never deployed. A pre-signature simulation installs this runtime code at the
/// smart account's address through an `eth_call` state override and calls `simulate`, so
/// the two account calls a mandate's UserOperation carries - the exact approval of the
/// signed input to MandateExecutor, then `perform` - leave the account address exactly as
/// they will onchain. MandateExecutor, the adapter, the verifier, and the protocol all run
/// their real deployed code; only the `EXECUTING` record `authorize` and `beginExecution`
/// would have written is injected, because a mandate cannot be authorized before it is
/// signed.
/// @dev Holds no state and grants nothing: outside a state override this code is inert.
contract MandateSimulationHarness {
    /// Everything a simulation reports, measured at the account address in one call frame.
    struct Observation {
        PeragoTypes.MandateStatus status;
        uint256 inputBalanceBefore;
        uint256 inputBalanceAfter;
        uint256 outcomeBefore;
        uint256 outcomeAfter;
        uint256 allowanceAfter;
        bytes32 verificationHash;
        bytes32 failureReasonHash;
        uint256 gasUsed;
    }

    error RecordOverrideMismatch();
    error ApprovalFailed();

    /// @param executor the MandateExecutor deployment the mandate names in its domain
    /// @param mandate the exact mandate fields; `simulationHash` may be a placeholder
    /// @param action the exact canonical action bytes committed by `actionHash`
    /// @param proof executor proof for the injected record's executor
    /// @param proofSignature signature over `proof` by that executor
    function simulate(
        MandateExecutor executor,
        PeragoTypes.TaskMandate calldata mandate,
        bytes calldata action,
        PeragoTypes.ExecutionProof calldata proof,
        bytes calldata proofSignature
    ) external returns (Observation memory observation) {
        bytes32 mandateHash = executor.hashMandate(mandate);
        PeragoTypes.MandateRecord memory record = executor.mandateRecord(mandateHash);
        // A storage override that missed the record would simulate nothing; fail closed.
        if (
            record.status != PeragoTypes.MandateStatus.EXECUTING || record.account != address(this)
                || mandate.account != address(this) || record.adapter != mandate.adapter
                || record.executor != proof.executor
        ) {
            revert RecordOverrideMismatch();
        }

        IERC20 input = IERC20(mandate.inputToken);
        IPeragoVerifier verifier = IPeragoVerifier(record.verifier);
        observation.inputBalanceBefore = input.balanceOf(address(this));
        (observation.outcomeBefore,) = verifier.measure(mandate, action);

        if (!input.approve(address(executor), mandate.maxInput)) revert ApprovalFailed();
        uint256 gasBefore = gasleft();
        observation.status = executor.perform(mandate, action, proof, proofSignature);
        observation.gasUsed = gasBefore - gasleft();

        observation.inputBalanceAfter = input.balanceOf(address(this));
        (observation.outcomeAfter,) = verifier.measure(mandate, action);
        observation.allowanceAfter = input.allowance(address(this), address(executor));
        record = executor.mandateRecord(mandateHash);
        observation.verificationHash = record.verificationHash;
        observation.failureReasonHash = record.failureReasonHash;
    }
}
