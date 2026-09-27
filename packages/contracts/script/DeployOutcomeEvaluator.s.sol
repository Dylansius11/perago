// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Script, console} from "forge-std/Script.sol";

import {OutcomeEvaluator} from "../src/OutcomeEvaluator.sol";
import {MandateExecutor} from "../src/MandateExecutor.sol";
import {IACP} from "../src/interfaces/IACP.sol";

interface IApexAdmin {
    function owner() external view returns (address);
    function paused() external view returns (bool);
    function platformFeeBP() external view returns (uint256);
}

/// @notice Preflight without a key: forge script script/DeployOutcomeEvaluator.s.sol --sig 'check()' --rpc-url bsc_testnet
/// @notice Broadcast only after review: use deploy:testnet-evaluator with a disposable funded key and an explicit provider address.
contract DeployOutcomeEvaluator is Script {
    string private constant PROTOCOLS = "../../deployments/bsc-testnet.protocols.json";
    string private constant PERAGO = "../../deployments/bsc-testnet.perago.json";
    bytes32 private constant IMPLEMENTATION_SLOT = bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1);

    function check() public view returns (address executor, address commerce, address hook, address paymentToken) {
        string memory protocols = vm.readFile(PROTOCOLS);
        string memory perago = vm.readFile(PERAGO);
        require(block.chainid == 97 && vm.parseJsonUint(protocols, ".chainId") == 97, "wrong protocol chain");
        require(vm.parseJsonUint(perago, ".chainId") == 97, "wrong Perago chain");

        executor = _checked(perago, "mandateExecutor");
        commerce = _checked(protocols, "apexKernel");
        hook = _checked(protocols, "peragoAcpHook");
        paymentToken = _checked(protocols, "apexPaymentToken");
        _implementation(protocols, commerce, "apexKernel");
        _implementation(protocols, paymentToken, "apexPaymentToken");

        _checkExecutor(perago, executor);
        _checkApex(commerce, paymentToken);
        console.log("chain", block.chainid);
        console.log("block", block.number);
        console.log("executor", executor);
        console.log("APEX proxy", commerce);
    }

    function run() external {
        (address executor, address commerce, address hook, address paymentToken) = check();
        address provider = vm.envAddress("PERAGO_SETTLEMENT_PROVIDER");
        require(provider != address(0), "provider required");
        vm.startBroadcast(vm.envUint("PERAGO_DISPOSABLE_OWNER_KEY"));
        OutcomeEvaluator evaluator = new OutcomeEvaluator(executor, commerce, provider, hook, paymentToken);
        vm.stopBroadcast();
        console.log("outcomeEvaluator", address(evaluator));
    }

    function _checkExecutor(string memory perago, address executor) private view {
        MandateExecutor mandateExecutor = MandateExecutor(executor);
        require(!mandateExecutor.allowUnboundCommerceJobs(), "unbound jobs allowed");
        require(
            mandateExecutor.swapAdapter() == vm.parseJsonAddress(perago, ".contracts.swapAdapter.address")
                && mandateExecutor.stakeAdapter() == vm.parseJsonAddress(perago, ".contracts.stakeAdapter.address")
                && mandateExecutor.swapVerifier() == vm.parseJsonAddress(perago, ".contracts.swapVerifier.address")
                && mandateExecutor.stakeVerifier() == vm.parseJsonAddress(perago, ".contracts.stakeVerifier.address"),
            "executor pair changed"
        );
    }

    function _checkApex(address commerce, address paymentToken) private view {
        require(IACP(commerce).paymentToken() == paymentToken, "kernel payment token changed");
        IApexAdmin admin = IApexAdmin(commerce);
        address owner = admin.owner();
        require(owner != address(0), "kernel owner missing");
        require(!admin.paused(), "kernel paused");
        require(admin.platformFeeBP() == 0, "kernel fee changed");
        console.log("upstream owner (can upgrade kernel)", owner);
    }

    function _checked(string memory manifest, string memory key) private view returns (address target) {
        string memory base = string.concat(".contracts.", key);
        target = vm.parseJsonAddress(manifest, string.concat(base, ".address"));
        require(target.codehash == vm.parseJsonBytes32(manifest, string.concat(base, ".codeHash")), "code hash changed");
    }

    function _implementation(string memory manifest, address proxy, string memory key) private view {
        string memory base = string.concat(".contracts.", key);
        address implementation = address(uint160(uint256(vm.load(proxy, IMPLEMENTATION_SLOT))));
        require(
            implementation == vm.parseJsonAddress(manifest, string.concat(base, ".erc1967Implementation")),
            "implementation changed"
        );
        require(
            implementation.codehash == vm.parseJsonBytes32(manifest, string.concat(base, ".implementationCodeHash")),
            "implementation code changed"
        );
    }
}
