// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {PeragoAcpHook} from "../src/hooks/PeragoAcpHook.sol";
import {IACPHook, IERC165} from "../src/interfaces/IACPHook.sol";

contract PeragoAcpHookTest {
    address private constant OTHER_KERNEL = address(0xACC);

    /// The kernel gates `createJob` on this exact interface id, so a wrong answer
    /// makes every Perago job uncreatable on the deployed APEX kernel.
    function testAnswersTheInterfaceIdTheKernelChecks() external {
        PeragoAcpHook hook = new PeragoAcpHook(OTHER_KERNEL);

        assert(hook.supportsInterface(type(IACPHook).interfaceId));
        assert(hook.supportsInterface(type(IERC165).interfaceId));
        assert(!hook.supportsInterface(0xffffffff));
    }

    /// A hook that reverts on a legitimate callback would freeze the job lifecycle.
    function testAcceptsCallbacksFromItsKernel() external {
        PeragoAcpHook hook = new PeragoAcpHook(address(this));

        hook.beforeAction(1, IACPHook.beforeAction.selector, "");
        hook.afterAction(1, IACPHook.afterAction.selector, hex"1234");
    }

    function testRejectsCallbacksFromAnyOtherCaller() external {
        PeragoAcpHook hook = new PeragoAcpHook(OTHER_KERNEL);

        (bool beforeOk, bytes memory beforeData) =
            address(hook).call(abi.encodeCall(IACPHook.beforeAction, (1, IACPHook.beforeAction.selector, "")));
        (bool afterOk, bytes memory afterData) =
            address(hook).call(abi.encodeCall(IACPHook.afterAction, (1, IACPHook.afterAction.selector, "")));

        assert(!beforeOk);
        assert(!afterOk);
        assert(bytes4(beforeData) == PeragoAcpHook.UnauthorizedCaller.selector);
        assert(bytes4(afterData) == PeragoAcpHook.UnauthorizedCaller.selector);
    }

    function testRejectsAZeroKernel() external {
        (bool ok,) = address(this).call(abi.encodeCall(this.deployWithZeroKernel, ()));

        assert(!ok);
    }

    function deployWithZeroKernel() external returns (address) {
        return address(new PeragoAcpHook(address(0)));
    }
}
