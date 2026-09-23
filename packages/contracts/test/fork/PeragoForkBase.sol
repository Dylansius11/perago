// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {MandateExecutor} from "../../src/MandateExecutor.sol";
import {IPeragoAdapter} from "../../src/interfaces/IPeragoAdapter.sol";
import {PeragoTypes} from "../../src/types/PeragoTypes.sol";

/// @notice Shared harness for tests that run against a pinned BNB Smart Chain Testnet
/// fork. Protocol addresses come from the reviewed deployment manifest, never from
/// literals, and every fork test is skipped - not failed - when no RPC is configured,
/// so the offline suite stays deterministic.
abstract contract PeragoForkBase is Test {
    /// A chain-97 block after the manifest's verification block; pinned so quotes,
    /// pool state, and gas are reproducible across runs.
    uint256 internal constant FORK_BLOCK = 132_658_000;
    uint48 internal constant EXECUTION_WINDOW = 15 minutes;
    uint48 internal constant MANDATE_LIFETIME = 30 minutes;
    uint48 internal constant PROOF_LIFETIME = 5 minutes;
    string private constant MANIFEST = "../../deployments/bsc-testnet.protocols.json";

    bool internal forkReady;

    uint256 internal rootOwnerKey = 0xA11CE;
    uint256 internal executorKey = 0xE0E0;
    address internal rootOwner;
    address internal executorSigner;
    address internal account;
    uint256 private nextNonce = 1;

    MandateExecutor internal executor;

    modifier onFork() {
        if (!forkReady) vm.skip(true, "PERAGO_BSC_TESTNET_RPC is not set");
        _;
    }

    function _selectFork() internal {
        string memory rpc = vm.envOr("PERAGO_BSC_TESTNET_RPC", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc, FORK_BLOCK);
        forkReady = true;
        rootOwner = vm.addr(rootOwnerKey);
        executorSigner = vm.addr(executorKey);
        account = makeAddr("perago-smart-account");
    }

    function _manifestAddress(string memory key) internal view returns (address) {
        return vm.parseJsonAddress(vm.readFile(MANIFEST), string.concat(".contracts.", key, ".address"));
    }

    function _register() internal {
        PeragoTypes.AccountPolicy memory policy = PeragoTypes.AccountPolicy({
            account: account,
            rootOwner: rootOwner,
            ownerEpoch: 1,
            chainId: block.chainid,
            policyHash: keccak256("policy.v1"),
            permissionHash: keccak256("permission.v1"),
            validUntil: uint48(block.timestamp) + 1 days
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(rootOwnerKey, executor.hashAccountPolicy(policy));
        vm.prank(account);
        executor.setAccountPolicy(policy, abi.encodePacked(r, s, v));
    }

    /// @dev A mandate for `adapter` with every commitment left for the caller to bind.
    function _mandate(address adapter, address inputToken, uint256 maxInput, address outputToken, uint256 minOutput)
        internal
        returns (PeragoTypes.TaskMandate memory mandate)
    {
        PeragoTypes.AccountConfig memory config = executor.accountConfig(account);
        mandate = PeragoTypes.TaskMandate({
            account: account,
            rootOwner: config.rootOwner,
            ownerEpoch: config.ownerEpoch,
            executor: executorSigner,
            chainId: block.chainid,
            nonce: nextNonce,
            expiresAt: uint48(block.timestamp) + MANDATE_LIFETIME,
            policyHash: config.activePolicyHash,
            intentHash: keccak256("intent"),
            planHash: keccak256("plan"),
            simulationHash: keccak256("simulation"),
            adapter: adapter,
            adapterSelector: IPeragoAdapter.execute.selector,
            inputToken: inputToken,
            maxInput: maxInput,
            outputToken: outputToken,
            minOutput: minOutput,
            recipient: account,
            actionHash: bytes32(0),
            postconditionHash: bytes32(0),
            commerceContract: address(0),
            commerceJobId: 0
        });
        nextNonce += 1;
    }

    /// @dev Authorizes, begins, approves exactly `maxInput`, and performs as the account.
    function _execute(PeragoTypes.TaskMandate memory mandate, bytes memory action)
        internal
        returns (bytes32 mandateHash, PeragoTypes.MandateStatus status)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(rootOwnerKey, executor.hashMandate(mandate));
        vm.prank(executorSigner);
        mandateHash = executor.authorize(mandate, abi.encodePacked(r, s, v));
        vm.prank(executorSigner);
        executor.beginExecution(mandateHash);

        PeragoTypes.ExecutionProof memory proof = PeragoTypes.ExecutionProof({
            mandateHash: mandateHash,
            account: account,
            executor: executorSigner,
            validUntil: uint48(block.timestamp) + PROOF_LIFETIME
        });
        (v, r, s) = vm.sign(executorKey, executor.hashExecutionProof(proof));

        vm.startPrank(account);
        (bool approved,) = mandate.inputToken
            .call(abi.encodeWithSignature("approve(address,uint256)", address(executor), mandate.maxInput));
        require(approved, "approve failed");
        status = executor.perform(mandate, action, proof, abi.encodePacked(r, s, v));
        vm.stopPrank();
    }
}
