// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Script, console} from "forge-std/Script.sol";

import {MandateExecutor} from "../src/MandateExecutor.sol";

/// @notice Deploys the labelled `testnet-demo` MandateExecutor on BNB Smart Chain Testnet
/// (`SC-D-006`, user decision 2026-09-24). It is the production source over the production
/// swap and stake adapters, with the same `SC-D-005` window, and differs only in accepting
/// mandates that carry no ERC-8183 job, which cannot exist before Phase 6. It holds no funds
/// and has no owner, admin, or upgrade path; the production executor is not touched.
// Run from the repository root: `pnpm --filter @perago/contracts deploy:testnet-demo`.
contract DeployDemoExecutor is Script {
    string private constant PRODUCTION = "../../deployments/bsc-testnet.perago.json";
    /// `SC-D-005`: the production window, so the demo proves the same timing.
    uint48 private constant EXECUTION_WINDOW = 600;

    function run() external {
        string memory production = vm.readFile(PRODUCTION);
        require(vm.parseJsonUint(production, ".chainId") == block.chainid, "manifest is for another chain");

        address swapAdapter = vm.parseJsonAddress(production, ".contracts.swapAdapter.address");
        address stakeAdapter = vm.parseJsonAddress(production, ".contracts.stakeAdapter.address");
        require(swapAdapter.code.length != 0 && stakeAdapter.code.length != 0, "production adapters are missing");

        vm.startBroadcast(vm.envUint("PERAGO_DISPOSABLE_OWNER_KEY"));
        MandateExecutor executor = new MandateExecutor(swapAdapter, stakeAdapter, EXECUTION_WINDOW, true);
        vm.stopBroadcast();

        console.log("mandateExecutor", address(executor));
    }
}
