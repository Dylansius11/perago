// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Script, console} from "forge-std/Script.sol";

import {MandateExecutor} from "../src/MandateExecutor.sol";
import {CakeStakeAdapter} from "../src/adapters/CakeStakeAdapter.sol";
import {PancakeV3SwapAdapter} from "../src/adapters/PancakeV3SwapAdapter.sol";
import {StakeVerifier} from "../src/verifiers/StakeVerifier.sol";
import {SwapVerifier} from "../src/verifiers/SwapVerifier.sol";

/// @notice Deploys the production Perago set on BNB Smart Chain Testnet: both verifiers,
/// both adapters, and a MandateExecutor pinning them. Every protocol address, the token
/// pair, and the pool fee come from the reviewed manifest and its planner route, so the
/// deployment and the compiler cannot disagree. The deployer keeps no power afterwards:
/// none of these contracts has an owner, admin, or upgrade path.
///
///   forge script script/DeployPerago.s.sol --rpc-url bsc_testnet --broadcast
contract DeployPerago is Script {
    string private constant MANIFEST = "../../deployments/bsc-testnet.protocols.json";
    /// `SC-D-005`, user decision 2026-09-23: 600 s after `beginExecution`.
    uint48 private constant EXECUTION_WINDOW = 600;

    function run() external {
        string memory manifest = vm.readFile(MANIFEST);
        require(vm.parseJsonUint(manifest, ".chainId") == block.chainid, "manifest is for another chain");

        address router = _contract(manifest, "pancakeV3SwapRouter");
        address cakePool = _contract(manifest, "cakePool");
        string memory route = ".plannerCatalog.adapters.pancakeswap-v3.routes[0]";
        address tokenA = _contract(manifest, vm.parseJsonStringArray(manifest, string.concat(route, ".tokens"))[0]);
        address tokenB = _contract(manifest, vm.parseJsonStringArray(manifest, string.concat(route, ".tokens"))[1]);
        uint24 poolFee = uint24(vm.parseUint(vm.parseJsonString(manifest, string.concat(route, ".poolFee"))));
        address stakeAsset =
            _contract(manifest, vm.parseJsonString(manifest, ".plannerCatalog.adapters.cake-pool.asset"));

        vm.startBroadcast(vm.envUint("PERAGO_DISPOSABLE_OWNER_KEY"));
        SwapVerifier swapVerifier = new SwapVerifier();
        PancakeV3SwapAdapter swapAdapter =
            new PancakeV3SwapAdapter(router, tokenA, tokenB, poolFee, address(swapVerifier));
        StakeVerifier stakeVerifier = new StakeVerifier(cakePool, stakeAsset);
        CakeStakeAdapter stakeAdapter = new CakeStakeAdapter(cakePool, stakeAsset, address(stakeVerifier));
        MandateExecutor executor =
            new MandateExecutor(address(swapAdapter), address(stakeAdapter), EXECUTION_WINDOW, false);
        vm.stopBroadcast();

        console.log("swapVerifier", address(swapVerifier));
        console.log("swapAdapter", address(swapAdapter));
        console.log("stakeVerifier", address(stakeVerifier));
        console.log("stakeAdapter", address(stakeAdapter));
        console.log("mandateExecutor", address(executor));
    }

    function _contract(string memory manifest, string memory key) private pure returns (address) {
        return vm.parseJsonAddress(manifest, string.concat(".contracts.", key, ".address"));
    }
}
