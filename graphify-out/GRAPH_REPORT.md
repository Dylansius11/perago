# Graph Report - perago  (2026-09-20)

## Corpus Check
- 357 files · ~172,343 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2885 nodes · 4466 edges · 218 communities (185 shown, 27 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 112 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `cd8acc72`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Forge cheatcode documentation
- Brainstorming companion server
- EnumerableMap.test.js
- Account session probe
- BridgeERC20.test.js
- OpenZeppelin development dependencies
- Modular account tests
- Cryptographic signing keys
- Modular account SDK
- openzeppelin-contracts/package.json
- ERC20 behavior tests
- Execution domain models
- Account.behavior.js
- Votes.behavior.js
- Pull request analyzer
- Governor nonce tests
- format-lines.js
- Access control tests
- Smart account behaviors
- User operation helpers
- Account signature utilities
- Workspace package configuration
- ERC721 behavior tests
- OpenZeppelin package scripts
- Array code generator
- Access scheduling predicates
- EIP712 typed data tests
- Governor testing helper
- User operation client
- Live protocol probe
- Vesting wallet tests
- chai
- Web application package
- hardhat
- Merkle tree generators
- draft-InteroperableAddress.test.js
- DoubleEndedQueue.test.js
- AccountP256.test.js
- Bytes utility tests
- ERC2771Context.test.js
- Access manager tests
- Multisig account tests
- ECDSA signature tests
- WebAuthn cryptography tests
- Merkle proof tests
- AccessManager.predicate.js
- Token bridge mocks
- time.js
- SafeERC20 tests
- Governance proposal tests
- pragma-validity.js
- ERC4626 vault tests
- Mandate executor authorization
- Contract lint configuration
- Token transfer helpers
- Math.test.js
- Bytes.test.js
- Governor quorum tests
- biome.json
- fv/run.js
- Access manager mocks
- Deployment script helpers
- Governor counting tests
- iterate.js
- String utility tests
- ERC20 extensions tests
- ERC721 receiver tests
- Upgradeable beacon tests
- enums.js
- RLP.test.js
- Typed structured data
- Safe casting tests
- Math utility tests
- Cryptography helper tests
- Arrays.test.js
- Checkpoints.js
- Mandate execution lifecycle
- ERC1155 receiver tests
- Governor settings tests
- random.js
- Role management tests
- ERC7786Recipient.test.js
- hero.tsx
- TrieProof.test.js
- Time.test.js
- Modular account fixtures
- Protocol manifest schema
- ERC165 interface tests
- testAsSchedulableOperation
- Short strings tests
- Double ended queue tests
- ERC20 wrapper tests
- BlockTries
- shouldSupportInterfaces
- SupportsInterface.behavior.js
- ERC1155 supply tests
- Token vesting tests
- Account.test.js
- GovernorCountingFractional.test.js
- Token timelock tests
- ERC1363 token tests
- ERC4907 rental tests
- Calldata decoding utilities
- MerkleTree.test.js
- update-comment.js
- GovernorProposalGuardian.test.js
- GovernorVotesQuorumFraction.test.js
- Packed data utilities
- Memory.test.js
- MerkleProof.test.js
- Address utility tests
- ERC1271 signature tests
- Web application configuration
- Execution adapter mocks
- fetch-common-contracts.js
- impersonate
- access-manager.js
- Packing.test.js
- storage.js
- Proxy.behaviour.js
- Enumerable map tests
- Base64 encoding tests
- StorageSlot.test.js
- TransientSlot.test.js
- SlotDerivation.js
- SafeERC20 mock tokens
- ERC721 burnable tests
- ERC20 pausable tests
- shouldBehaveLikeAManagedRestrictedOperation
- SlotDerivation.t.js
- BeaconProxy.test.js
- Cross chain message tests
- Governor execution tests
- ERC20 votes tests
- ERC721 votes tests
- Clones library tests
- SlotDerivation.test.js
- Initializable contract tests
- UUPS upgrade tests
- Storage slot tests
- ERC1967 proxy tests
- Base64.test.js
- Access managed tests
- ERC20Crosschain.test.js
- Ownable two step
- ProxyAdmin.test.js
- Create2.test.js
- AccessManaged.test.js
- ERC4626 mock vaults
- Checkpoints utility tests
- AuthorityUtils.test.js
- EIP7702Utils.test.js
- ERC1967Utils.test.js
- sanity.test.js
- UUPSUpgradeable.test.js
- SafeERC20.test.js
- ERC6909ContentURI.test.js
- ERC6909Metadata.test.js
- ERC721Pausable.test.js
- ERC20Capped.test.js
- Base58.test.js
- @nomicfoundation/hardhat-network-helpers
- Strings.test.js
- Heap.test.js
- ERC7739 signature tests
- EIP712 verifier tests
- trie.js
- Pausable.test.js
- ReentrancyGuard.test.js
- account.js
- Governor storage tests
- Checkpoints.test.js
- ERC721Burnable.test.js
- lint-staged
- Governor prevent late quorum
- Votes delegation tests
- Votes timestamp tests
- ERC1155 core tests
- ERC721 core tests
- ERC20 core tests
- Payment splitter tests
- Finance vesting tests
- Metatx forwarder tests
- Create2 utility tests
- Conditional escrow tests
- Escrow contract tests
- Pull payment tests
- Crosschain signer tests
- Crosschain messenger tests
- ERC7786 gateway tests
- ERC7802 bridge tests
- repository
- IERC1363 interface tests
- Token common mocks
- ERC721 crosschain tests
- ERC1155 crosschain tests
- ERC20 crosschain tests
- ERC1363 receiver tests
- ERC1363 spender tests
- Token safe transfer
- Governor vote counting
- page.tsx
- Governor compatibility bravo
- Governor proposal threshold
- Governor voting delay
- Governor voting period
- Governor executor tests
- Account deployment helpers
- Account validation tests
- Account execution modes
- Signer ECDSA tests
- Signer P256 tests

## God Nodes (most connected - your core abstractions)
1. `hardhat` - 180 edges
2. `chai` - 149 edges
3. `@nomicfoundation/hardhat-network-helpers` - 147 edges
4. `getDomain()` - 44 edges
5. `GovernorHelper` - 40 edges
6. `CheatcodesPrinter` - 29 edges
7. `ERC4337Helper` - 28 edges
8. `shouldSupportInterfaces()` - 28 edges
9. `scripts` - 25 edges
10. `impersonate()` - 22 edges

## Surprising Connections (you probably didn't know these)
- `fixture()` --calls--> `impersonate()`  [EXTRACTED]
  packages/contracts/lib/openzeppelin-contracts/test/access/manager/AccessManaged.test.js → packages/contracts/lib/openzeppelin-contracts/test/helpers/account.js
- `fixture()` --calls--> `impersonate()`  [EXTRACTED]
  packages/contracts/lib/openzeppelin-contracts/test/crosschain/BridgeERC20.test.js → packages/contracts/lib/openzeppelin-contracts/test/helpers/account.js
- `testScheduleOperation()` --calls--> `testAsSchedulableOperation()`  [EXTRACTED]
  packages/contracts/lib/openzeppelin-contracts/test/access/manager/AccessManager.behavior.js → packages/contracts/lib/openzeppelin-contracts/test/access/manager/AccessManager.predicate.js
- `signBallot()` --calls--> `getDomain()`  [EXTRACTED]
  packages/contracts/lib/openzeppelin-contracts/test/governance/extensions/GovernorNoncesKeyed.test.js → packages/contracts/lib/openzeppelin-contracts/test/helpers/eip712.js
- `signExtendedBallot()` --calls--> `getDomain()`  [EXTRACTED]
  packages/contracts/lib/openzeppelin-contracts/test/governance/extensions/GovernorNoncesKeyed.test.js → packages/contracts/lib/openzeppelin-contracts/test/helpers/eip712.js

## Import Cycles
- None detected.

## Communities (218 total, 27 thin omitted)

### Community 0 - "Forge cheatcode documentation"
Cohesion: 0.06
Nodes (23): Cheatcode, Cheatcodes, CheatcodesPrinter, cmp_cheatcode(), CmpCheatcode, Enum, EnumVariant, Error (+15 more)

### Community 1 - "Brainstorming companion server"
Cohesion: 0.06
Nodes (57): bootstrapPage(), brandMarkup(), broadcast(), browserLauncherForPlatform(), chmodOwnerOnly(), clients, companionUrl(), computeAcceptKey() (+49 more)

### Community 2 - "EnumerableMap.test.js"
Cohesion: 0.05
Nodes (38): fromBytes32(), toBytes32(), { capitalize, mapValues }, MAP_TYPES, SET_TYPES, toMapTypeDescr(), toSetTypeDescr(), typeDescr() (+30 more)

### Community 3 - "Account session probe"
Cohesion: 0.05
Nodes (43): dependencies, @aa-sdk/core, @alchemy/aa-infra, @alchemy/common, @alchemy/smart-accounts, @perago/sdk, viem, zod (+35 more)

### Community 4 - "BridgeERC20.test.js"
Cohesion: 0.25
Nodes (7): { ethers }, { expect }, fixture(), { getLocalChain }, { impersonate }, { loadFixture }, { shouldBehaveLikeBridgeERC20 }

### Community 5 - "OpenZeppelin development dependencies"
Cohesion: 0.05
Nodes (43): devDependencies, chai, @changesets/changelog-github, @changesets/cli, @changesets/pre, @changesets/read, eslint, @eslint/compat (+35 more)

### Community 6 - "Modular account tests"
Cohesion: 0.08
Nodes (33): { ERC4337Helper }, { ethers, predeploy }, { getDomain }, { loadFixture, setBalance }, { MODULE_TYPE_VALIDATOR }, { PackedUserOperation }, { shouldBehaveLikeAccountCore, shouldBehaveLikeAccountHolder }, { shouldBehaveLikeAccountERC7579 } (+25 more)

### Community 7 - "Cryptographic signing keys"
Cohesion: 0.06
Nodes (21): { ERC4337Helper }, { ethers, predeploy }, { getDomain }, { loadFixture }, { NonNativeSigner, P256SigningKey, RSASHA256SigningKey, WebAuthnSigningKey }, { PackedUserOperation }, { shouldBehaveLikeAccountCore, shouldBehaveLikeAccountHolder }, { shouldBehaveLikeERC1271 } (+13 more)

### Community 8 - "Modular account SDK"
Cohesion: 0.11
Nodes (38): ACCOUNT_EXECUTE_SELECTOR, AccountCall, accountFactoryAbi, allowlistInputs(), allowlistParameters, assertAddress(), assertSelectors(), assertSessionEntityId() (+30 more)

### Community 9 - "openzeppelin-contracts/package.json"
Cohesion: 0.06
Nodes (36): __dirname, author, bugs, url, description, files, homepage, keywords (+28 more)

### Community 10 - "ERC20 behavior tests"
Cohesion: 0.08
Nodes (26): { ethers }, { expect }, shouldBehaveLikeERC20(), shouldBehaveLikeERC20Approve(), shouldBehaveLikeERC20Transfer(), { ethers }, { expect }, { loadFixture } (+18 more)

### Community 11 - "Execution domain models"
Cohesion: 0.11
Nodes (25): CompiledPlan, StakeAction, stakeActionSchema, SwapAction, swapActionSchema, ExecutionReceipt, executionReceiptSchema, adapterIdSchema (+17 more)

### Community 12 - "Account.behavior.js"
Cohesion: 0.07
Nodes (31): { ethers, predeploy }, { expect }, { impersonate }, shouldBehaveLikeAccountCore(), shouldBehaveLikeAccountHolder(), { shouldSupportInterfaces }, { SIG_VALIDATION_SUCCESS, SIG_VALIDATION_FAILURE }, { ERC4337Helper } (+23 more)

### Community 13 - "Votes.behavior.js"
Cohesion: 0.06
Nodes (34): { expect }, shouldBehaveLikeERC6372(), time, { ethers }, { expect }, { getDomain, Delegation }, { mine }, { shouldBehaveLikeERC6372 } (+26 more)

### Community 14 - "Pull request analyzer"
Cohesion: 0.12
Nodes (27): analyze_pr(), calculate_complexity(), categorize_size(), detect_language(), estimate_review_time(), FileStats, generate_suggestions(), identify_risk_factors() (+19 more)

### Community 15 - "Governor nonce tests"
Cohesion: 0.08
Nodes (21): { ethers }, { expect }, { getDomain, Ballot, ExtendedBallot }, { GovernorHelper }, { loadFixture }, { shouldBehaveLikeNoncesKeyed }, signBallot(), signExtendedBallot() (+13 more)

### Community 16 - "format-lines.js"
Cohesion: 0.10
Nodes (12): formatLines(), indentEach(), { capitalize }, TYPES, format, { TYPES }, format, { TYPES } (+4 more)

### Community 17 - "Access control tests"
Cohesion: 0.09
Nodes (20): { ethers }, { expect }, OTHER_ROLE, ROLE, shouldBehaveLikeAccessControl(), shouldBehaveLikeAccessControlDefaultAdminRules(), shouldBehaveLikeAccessControlEnumerable(), { shouldSupportInterfaces } (+12 more)

### Community 18 - "Smart account behaviors"
Cohesion: 0.13
Nodes (21): fixture(), fixture(), fixture(), fixture(), fixture(), fixture(), fixture(), fixture() (+13 more)

### Community 19 - "User operation helpers"
Cohesion: 0.12
Nodes (12): EIP7702SmartAccount, { ethers, config, predeploy }, getAddress(), pack(), packInitCode(), packPaymasterAndData(), packValidationData(), parseInitCode() (+4 more)

### Community 20 - "Account signature utilities"
Cohesion: 0.09
Nodes (12): ERC4337Utils, ERC7739Signer, { ethers }, { formatType }, PersonalSign, TypedDataSign(), details, { ERC4337Utils, PersonalSign } (+4 more)

### Community 21 - "Workspace package configuration"
Cohesion: 0.08
Nodes (25): devDependencies, @biomejs/biome, turbo, @types/node, typescript, vitest, engines, node (+17 more)

### Community 22 - "ERC721 behavior tests"
Cohesion: 0.10
Nodes (19): { anyValue }, { ethers }, { expect }, { PANIC_CODES }, { RevertType }, shouldBehaveLikeERC721(), shouldBehaveLikeERC721Enumerable(), shouldBehaveLikeERC721Metadata() (+11 more)

### Community 23 - "OpenZeppelin package scripts"
Cohesion: 0.08
Nodes (25): scripts, clean, compile, compile:harnesses, coverage, docs, docs:watch, gas-report (+17 more)

### Community 24 - "Array code generator"
Cohesion: 0.09
Nodes (14): { capitalize }, format, NOTE: The \`array\` is expected to be sorted in ascending order, and to, IMPORTANT: Deprecated. This implementation behaves as {lowerBound} but lacks, NOTE: this function's cost is \`O(n · log(n))\` in average and \`O(n²)\` in the…, IMPORTANT: Consider memory side-effects when using custom comparator functions…, NOTE: replicates the behavior of https://developer.mozilla.org/en-…, NOTE: replicates the behavior of https://developer.mozilla.org/en-… (+6 more)

### Community 25 - "Access scheduling predicates"
Cohesion: 0.09
Nodes (12): {
  buildBaseRoles,
  formatAccess,
  EXPIRATION,
  MINSETBACK,
  EXECUTION_ID_STORAGE_SLOT,
  CONSUMING_SCHEDULE_STORAGE_SLOT,
  prepareOperation,
  hashOperation,
}, { ethers }, { expect }, fixture(), { impersonate }, {
  LIKE_COMMON_SCHEDULABLE,
  testAsClosable,
  testAsDelay,
  testAsSchedulableOperation,
  testAsCanCall,
  testAsHasRole,
  testAsGetAccess,
}, { loadFixture }, { MAX_UINT48 } (+4 more)

### Community 26 - "EIP712 typed data tests"
Cohesion: 0.11
Nodes (17): domainType(), { ethers }, hashTypedData(), types, formatType(), { mapValues }, { ethers }, { expect } (+9 more)

### Community 28 - "User operation client"
Cohesion: 0.15
Nodes (21): short(), createUserOperationClient(), build(), rpc(), send(), submit(), delay(), DUMMY_SIGNATURE (+13 more)

### Community 29 - "Live protocol probe"
Cohesion: 0.12
Nodes (21): CAKE_SWAP_IN, cakePoolAbi, delay(), erc20Abi, expect(), JOB_BUDGET, JOB_STATUS, JobFact (+13 more)

### Community 30 - "Vesting wallet tests"
Cohesion: 0.12
Nodes (19): envSetup(), { ethers }, { expect }, shouldBehaveLikeVesting(), time, { envSetup, shouldBehaveLikeVesting }, { ethers }, { expect } (+11 more)

### Community 31 - "chai"
Cohesion: 0.08
Nodes (17): { ethers }, { expect }, { ethers }, { expect }, { generators }, { loadFixture }, shouldBehaveLikeClone, { ethers } (+9 more)

### Community 32 - "Web application package"
Cohesion: 0.10
Nodes (20): @perago/sdk, @types/node, typescript, viem, name, private, type, version (+12 more)

### Community 33 - "hardhat"
Cohesion: 0.08
Nodes (15): { ethers }, { expect }, { loadFixture }, { ethers }, { expect }, { loadFixture }, { ethers }, { expect } (+7 more)

### Community 34 - "Merkle tree generators"
Cohesion: 0.10
Nodes (19): { anyValue }, CANCELLER_ROLE, { ethers }, EXECUTOR_ROLE, { expect }, { GovernorHelper, timelockSalt }, { loadFixture }, { PANIC_CODES } (+11 more)

### Community 35 - "draft-InteroperableAddress.test.js"
Cohesion: 0.10
Nodes (16): { addressCoder }, ethereum, { ethers }, { mapValues }, solana, { CHAINS, getLocalChain }, { ethers }, { expect } (+8 more)

### Community 36 - "DoubleEndedQueue.test.js"
Cohesion: 0.33
Nodes (4): { ethers }, { expect }, { loadFixture }, { PANIC_CODES }

### Community 37 - "AccountP256.test.js"
Cohesion: 0.20
Nodes (9): { ERC4337Helper }, { ethers, predeploy }, { getDomain }, { loadFixture }, { NonNativeSigner, P256SigningKey }, { PackedUserOperation }, { shouldBehaveLikeAccountCore, shouldBehaveLikeAccountHolder }, { shouldBehaveLikeERC1271 } (+1 more)

### Community 38 - "Bytes utility tests"
Cohesion: 0.11
Nodes (11): { ERC4337Helper }, { ethers, predeploy }, fixture(), { getDomain }, { loadFixture }, { NonNativeSigner, RSASHA256SigningKey }, { PackedUserOperation }, { shouldBehaveLikeAccountCore, shouldBehaveLikeAccountHolder } (+3 more)

### Community 39 - "ERC2771Context.test.js"
Cohesion: 0.12
Nodes (15): { ethers }, { expect }, { getDomain, ForwardRequest }, { impersonate }, { loadFixture }, { MAX_UINT48 }, { shouldBehaveLikeRegularContext }, { ethers } (+7 more)

### Community 40 - "Access manager tests"
Cohesion: 0.13
Nodes (17): required(), cakePoolAbi, expect(), factoryAbi, FEE_TIERS, kernelAbi, loadManifest(), main() (+9 more)

### Community 41 - "Multisig account tests"
Cohesion: 0.16
Nodes (15): alignPattern(), { argv }, average(), center(), chalk, formatCellMarkdown(), formatCellShell(), formatCmpMarkdown() (+7 more)

### Community 42 - "ECDSA signature tests"
Cohesion: 0.11
Nodes (9): format, { product }, sanitize, { SIZES }, format, { product }, { SIZES }, iterate (+1 more)

### Community 43 - "WebAuthn cryptography tests"
Cohesion: 0.11
Nodes (17): dependencies, drizzle-orm, hono, @perago/sdk, postgres, viem, zod, @perago/sdk (+9 more)

### Community 44 - "Merkle proof tests"
Cohesion: 0.13
Nodes (14): Base, FunctionDefinition(), { hasLeadingUnderscore }, ignore, { isFallbackFunction }, minimatch, path, VariableDeclaration() (+6 more)

### Community 45 - "AccessManager.predicate.js"
Cohesion: 0.16
Nodes (16): { expect }, {
  LIKE_COMMON_IS_EXECUTING,
  LIKE_COMMON_GET_ACCESS,
  LIKE_COMMON_SCHEDULABLE,
  testAsSchedulableOperation,
  testAsRestrictedOperation,
  testAsDelayedOperation,
  testAsCanCall,
  testAsHasRole,
}, { ethers }, { EXECUTION_ID_STORAGE_SLOT, EXPIRATION, prepareOperation }, { expect }, { impersonate }, LIKE_COMMON_GET_ACCESS, LIKE_COMMON_IS_EXECUTING (+8 more)

### Community 46 - "Token bridge mocks"
Cohesion: 0.11
Nodes (17): { ERC4337Helper }, { ethers, predeploy }, { expect }, { getDomain }, { loadFixture }, { MAX_UINT64 }, { NonNativeSigner, P256SigningKey, RSASHA256SigningKey, MultiERC7913SigningKey }, { PackedUserOperation } (+9 more)

### Community 47 - "time.js"
Cohesion: 0.09
Nodes (20): { clock, increaseTo }, { ethers, predeploy }, { expect }, { loadFixture }, { MAX_UINT48 }, { packValidationData, UserOperation }, { ValidationRange }, clock (+12 more)

### Community 48 - "SafeERC20 tests"
Cohesion: 0.12
Nodes (13): { ethers }, { expect }, shouldBehaveLikeERC6909(), { shouldSupportInterfaces }, { ethers }, { expect }, { loadFixture }, { shouldBehaveLikeERC6909 } (+5 more)

### Community 49 - "Governance proposal tests"
Cohesion: 0.12
Nodes (16): author, bugs, url, description, files, homepage, keywords, license (+8 more)

### Community 50 - "pragma-validity.js"
Cohesion: 0.12
Nodes (14): {
  argv: { pattern, skipPatterns, verbose, concurrency, _: artifacts },
}, { compile }, getContractsMetadata, { hideBin }, limit, semver, yargs, { coerce, inc, rsort } (+6 more)

### Community 51 - "ERC4626 vault tests"
Cohesion: 0.13
Nodes (10): { default: readChangesets }, { fetch }, getState(), isPublishedOnNpm(), { join }, readChangesetState(), { readPreState }, { version, name: packageName } (+2 more)

### Community 52 - "Mandate executor authorization"
Cohesion: 0.12
Nodes (16): { anyValue }, { ethers }, { expect }, { GovernorHelper }, { hashOperation }, { loadFixture }, { max }, { ProposalState, VoteType } (+8 more)

### Community 53 - "Contract lint configuration"
Cohesion: 0.12
Nodes (13): { ethers }, { expect }, { getDomain, Ballot }, { GovernorHelper }, { loadFixture }, { ProposalState, VoteType }, { shouldBehaveLikeERC6372 }, { shouldSupportInterfaces } (+5 more)

### Community 54 - "Token transfer helpers"
Cohesion: 0.13
Nodes (15): CANCELLER_ROLE, { ethers }, EXECUTOR_ROLE, { expect }, genOperation(), genOperationBatch(), getAddress(), { GovernorHelper } (+7 more)

### Community 55 - "Math.test.js"
Cohesion: 0.07
Nodes (22): max(), min(), modExp(), { ethers }, { expect }, { loadFixture }, { max, min }, { shouldBehaveLikeERC20 } (+14 more)

### Community 56 - "Bytes.test.js"
Cohesion: 0.14
Nodes (7): { ethers }, { expect }, { generators }, { loadFixture }, lorem, { MAX_UINT128, MAX_UINT64, MAX_UINT32, MAX_UINT16 }, present

### Community 57 - "Governor quorum tests"
Cohesion: 0.12
Nodes (12): { anyValue }, { ethers }, { expect }, { RevertType }, shouldBehaveLikeERC1155(), { shouldSupportInterfaces }, { ethers }, { expect } (+4 more)

### Community 58 - "biome.json"
Cohesion: 0.11
Nodes (18): css, parser, files, includes, formatter, enabled, indentStyle, indentWidth (+10 more)

### Community 59 - "fv/run.js"
Cohesion: 0.12
Nodes (14): { argv }, { exec }, fs, glob, { hideBin }, limit, yargs, { findAll } (+6 more)

### Community 60 - "Access manager mocks"
Cohesion: 0.12
Nodes (13): { findAll }, graphlib, match, path, skipPatterns, filenames, fs, ignorePatterns (+5 more)

### Community 61 - "Deployment script helpers"
Cohesion: 0.16
Nodes (15): {
  argv: { pattern, skipPatterns, minVersionForContracts, minVersionForInterfaces, concurrency, _: artifacts },
}, fs, getApplicablePragmas(), getContractsMetadata, getMinimalApplicablePragma(), graph, graphlib, { hideBin } (+7 more)

### Community 62 - "Governor counting tests"
Cohesion: 0.12
Nodes (15): { anyValue }, CANCELLER_ROLE, delay, { ethers }, EXECUTOR_ROLE, { expect }, { GovernorHelper, timelockSalt }, { loadFixture } (+7 more)

### Community 63 - "iterate.js"
Cohesion: 0.10
Nodes (17): batchInBlock(), { expect }, { network }, { unique }, { batchInBlock }, { ethers }, { expect }, { getDomain, Delegation } (+9 more)

### Community 64 - "String utility tests"
Cohesion: 0.12
Nodes (15): dependencies, viem, zod, exports, viem, zod, name, private (+7 more)

### Community 65 - "ERC20 extensions tests"
Cohesion: 0.21
Nodes (13): canonicalJson(), encode(), hasDuplicates(), serviceSchema, uint64StringSchema, assetLimitSchema, WalletPolicy, walletPolicySchema (+5 more)

### Community 66 - "ERC721 receiver tests"
Cohesion: 0.12
Nodes (15): dependsOn, outputs, cache, dependsOn, persistent, $schema, tasks, build (+7 more)

### Community 67 - "Upgradeable beacon tests"
Cohesion: 0.13
Nodes (15): dependencies, class-variance-authority, clsx, gsap, @gsap/react, lucide-react, motion, next (+7 more)

### Community 68 - "enums.js"
Cohesion: 0.09
Nodes (18): { ethers }, { expect }, { GovernorHelper }, { loadFixture }, TOKENS, value, { VoteType }, Enum() (+10 more)

### Community 69 - "RLP.test.js"
Cohesion: 0.15
Nodes (9): { ethers }, { expect }, { MAX_UINT64 }, { ethers }, { expect }, { generators }, { loadFixture }, { MAX_UINT64 } (+1 more)

### Community 70 - "Typed structured data"
Cohesion: 0.17
Nodes (12): compiledPlanSchema, taskMandateSchema, asMessage(), getTaskMandateTypedData(), mandateDomainSchema, TaskMandateDomain, taskMandateTypes, taskMandateTypeString (+4 more)

### Community 71 - "Safe casting tests"
Cohesion: 0.13
Nodes (14): compilerOptions, exactOptionalPropertyTypes, forceConsistentCasingInFileNames, module, moduleResolution, noImplicitOverride, noUncheckedIndexedAccess, noUnusedLocals (+6 more)

### Community 72 - "Math utility tests"
Cohesion: 0.14
Nodes (13): compilerOptions, allowJs, jsx, lib, module, moduleResolution, noEmit, paths (+5 more)

### Community 73 - "Cryptography helper tests"
Cohesion: 0.14
Nodes (5): linksCache, { version }, { isNodeType, findAll }, { slug }, version

### Community 74 - "Arrays.test.js"
Cohesion: 0.16
Nodes (9): TYPES, bigintSign(), { capitalize }, comparator(), { ethers }, { expect }, { generators }, { loadFixture } (+1 more)

### Community 75 - "Checkpoints.js"
Cohesion: 0.14
Nodes (8): format, { OPTS }, VALUE_SIZES, IMPORTANT: Never accept \`key\` as a user input, since an arbitrary…, NOTE: This is a variant of {upperLookup} that is optimized to find "recent"…, { capitalize }, format, { OPTS }

### Community 76 - "Mandate execution lifecycle"
Cohesion: 0.18
Nodes (10): format, formatArgsMultiline(), { OPTS }, OPTS, { product }, NOTE: The _empty set_ (i.e. the case where \`proof.length == 1 && leaves.length…, IMPORTANT: Consider memory side-effects when using custom hashing functions, NOTE: This library supports proof verification for merkle trees built using (+2 more)

### Community 77 - "ERC1155 receiver tests"
Cohesion: 0.11
Nodes (17): { ERC4337Helper }, { ethers, predeploy }, { expect }, { getDomain }, { loadFixture }, { MAX_UINT64 }, { NonNativeSigner, P256SigningKey, RSASHA256SigningKey, MultiERC7913SigningKey }, { PackedUserOperation } (+9 more)

### Community 78 - "Governor settings tests"
Cohesion: 0.14
Nodes (13): CANCELLER_ROLE, delay, { ethers }, EXECUTOR_ROLE, { expect }, { GovernorHelper }, { loadFixture }, { ProposalState, VoteType } (+5 more)

### Community 79 - "random.js"
Cohesion: 0.16
Nodes (10): { artifacts, ethers }, { generators }, { setCode }, { ethers }, generators, { ethers }, { expect }, { generators } (+2 more)

### Community 80 - "Role management tests"
Cohesion: 0.14
Nodes (11): aliceP256, bobP256, { ethers }, { expect }, { loadFixture }, { P256SigningKey, NonNativeSigner }, precompile, TEST_MESSAGE (+3 more)

### Community 81 - "ERC7786Recipient.test.js"
Cohesion: 0.20
Nodes (8): attributes, { ethers }, { expect }, { generators }, { getLocalChain }, { loadFixture }, payload, NOTE: here we are only testing the receiver. Failures of the gateway itself…

### Community 82 - "hero.tsx"
Cohesion: 0.20
Nodes (8): delay(), EASE, HEADLINE_LINES, Hero(), Phase, PHASES, ReceiptSequence(), TONE_COLOR

### Community 83 - "TrieProof.test.js"
Cohesion: 0.15
Nodes (10): { batchInBlock }, { BlockTries }, { Enum }, { ethers }, { expect }, { generators }, { MerklePatriciaTrie, createMerkleProof }, ProofError (+2 more)

### Community 84 - "Time.test.js"
Cohesion: 0.18
Nodes (10): asUint(), { ethers }, { expect }, { loadFixture }, { max }, packDelay(), { product }, SOME_VALUES (+2 more)

### Community 85 - "Modular account fixtures"
Cohesion: 0.18
Nodes (10): writeEvidence(), ALLOWED_SPEND, DEPOSIT_SELECTOR, EXCESS_SPEND, MatrixCase, MINIMUM_ACCOUNT_BALANCE, SESSION_NATIVE_LIMIT, SessionCallOutcome (+2 more)

### Community 86 - "Protocol manifest schema"
Cohesion: 0.17
Nodes (11): author, bugs, description, files, homepage, license, name, repository (+3 more)

### Community 87 - "ERC165 interface tests"
Cohesion: 0.24
Nodes (10): files, getPageTitle(), glob, isString(), menuItems, path, print(), sortItems() (+2 more)

### Community 88 - "testAsSchedulableOperation"
Cohesion: 0.21
Nodes (12): shouldBehaveLikeDelayedAdminOperation(), shouldBehaveLikeNotDelayedAdminOperation(), testScheduleOperation(), shouldBehaveLikeRoleAdminOperation(), afterGrantDelay(), testAsRestrictedOperation(), testAsSchedulableOperation(), callerHasAnExecutionDelay() (+4 more)

### Community 89 - "Short strings tests"
Cohesion: 0.10
Nodes (19): { ERC4337Helper }, { ethers, predeploy }, { getDomain }, { loadFixture }, { NonNativeSigner, P256SigningKey, WebAuthnSigningKey }, p256Signer, { PackedUserOperation }, { shouldBehaveLikeAccountCore, shouldBehaveLikeAccountHolder } (+11 more)

### Community 90 - "Double ended queue tests"
Cohesion: 0.17
Nodes (10): { anyValue }, { ethers }, { expect }, { GovernorHelper }, iterate, { loadFixture }, TOKENS, tokenSupply (+2 more)

### Community 91 - "ERC20 wrapper tests"
Cohesion: 0.17
Nodes (11): { anyValue }, defaultDelay, { ethers }, { expect }, { GovernorHelper }, { loadFixture }, { ProposalState, VoteType }, time (+3 more)

### Community 93 - "shouldSupportInterfaces"
Cohesion: 0.20
Nodes (9): { ethers }, { expect }, shouldBehaveLikeERC2981(), { shouldSupportInterfaces }, { ethers }, { expect }, { loadFixture }, { shouldBehaveLikeERC2981 } (+1 more)

### Community 94 - "SupportsInterface.behavior.js"
Cohesion: 0.11
Nodes (13): { ethers }, { expect }, { loadFixture }, { shouldSupportInterfaces }, { ethers }, { loadFixture }, { shouldSupportInterfaces }, { expect } (+5 more)

### Community 95 - "ERC1155 supply tests"
Cohesion: 0.18
Nodes (10): compilerOptions, allowImportingTsExtensions, declaration, outDir, rewriteRelativeImportExtensions, rootDir, types, extends (+2 more)

### Community 96 - "Token vesting tests"
Cohesion: 0.18
Nodes (8): RFC-4055, RFC-8017, fs, path, { ethers }, { expect }, { loadFixture }, parse

### Community 97 - "Account.test.js"
Cohesion: 0.20
Nodes (9): { ERC4337Helper }, { ethers, predeploy }, { getDomain }, { loadFixture }, { NonNativeSigner }, { PackedUserOperation }, { shouldBehaveLikeAccountCore, shouldBehaveLikeAccountHolder }, { shouldBehaveLikeERC1271 } (+1 more)

### Community 98 - "GovernorCountingFractional.test.js"
Cohesion: 0.08
Nodes (22): { ethers }, { expect }, { GovernorHelper }, { loadFixture }, { sum }, TOKENS, tokenSupply, value (+14 more)

### Community 99 - "Token timelock tests"
Cohesion: 0.18
Nodes (10): { ethers }, { expect }, { getDomain, OverrideBallot }, { GovernorHelper }, { loadFixture, mine }, signBallot(), TOKENS, tokenSupply (+2 more)

### Community 100 - "ERC1363 token tests"
Cohesion: 0.18
Nodes (10): { ethers }, { expect }, { GovernorHelper }, { loadFixture }, { ProposalState, VoteType }, quorum, time, TOKENS (+2 more)

### Community 101 - "ERC4907 rental tests"
Cohesion: 0.18
Nodes (10): { ethers }, { expect }, { getDomain, ExtendedBallot }, { GovernorHelper }, { loadFixture }, params, TOKENS, tokenSupply (+2 more)

### Community 102 - "Calldata decoding utilities"
Cohesion: 0.18
Nodes (8): { ethers }, { expect }, { getAddressInSlot, ImplementationSlot, AdminSlot }, { impersonate }, { ethers }, { loadFixture }, shouldBehaveLikeProxy, shouldBehaveLikeTransparentUpgradeableProxy

### Community 103 - "MerkleTree.test.js"
Cohesion: 0.18
Nodes (8): { ethers }, { expect }, { generators }, { loadFixture }, { PANIC_CODES }, { range }, { StandardMerkleTree }, ZERO

### Community 104 - "update-comment.js"
Cohesion: 0.22
Nodes (7): files, fs, gitStatus, proc, semver, [tag], { version }

### Community 105 - "GovernorProposalGuardian.test.js"
Cohesion: 0.20
Nodes (9): { ethers }, { expect }, { GovernorHelper }, { impersonate }, { loadFixture }, { ProposalState }, TOKENS, tokenSupply (+1 more)

### Community 106 - "GovernorVotesQuorumFraction.test.js"
Cohesion: 0.20
Nodes (9): { ethers }, { expect }, { GovernorHelper }, { loadFixture, mine }, { ProposalState, VoteType }, time, TOKENS, tokenSupply (+1 more)

### Community 107 - "Packed data utilities"
Cohesion: 0.20
Nodes (9): { ethers }, { expect }, { GovernorHelper }, { loadFixture }, { ProposalState, VoteType }, time, TOKENS, tokenSupply (+1 more)

### Community 108 - "Memory.test.js"
Cohesion: 0.25
Nodes (5): { ethers }, { expect }, { generators }, { loadFixture }, { PANIC_CODES }

### Community 109 - "MerkleProof.test.js"
Cohesion: 0.24
Nodes (8): concatSorted(), customHash(), defaultHash(), { ethers }, { expect }, { PANIC_CODES }, { SimpleMerkleTree }, @openzeppelin/merkle-tree

### Community 110 - "Address utility tests"
Cohesion: 0.20
Nodes (8): { ethers }, { expect }, { loadFixture }, returnValue1, returnValue2, storageSlot, storageValue, value

### Community 111 - "ERC1271 signature tests"
Cohesion: 0.42
Nodes (7): connect(), nextReconnectDelay(), reloadAfterRecovery(), sessionKey(), setStatus(), showTombstone(), websocketUrl()

### Community 112 - "Web application configuration"
Cohesion: 0.18
Nodes (8): nextConfig, workspaceRoot, archivo, jetbrains, metadata, viewport, next, react

### Community 113 - "Execution adapter mocks"
Cohesion: 0.22
Nodes (7): { argv }, { extractStorageLayout }, { findAll, astDereferencer, srcDecoder }, fs, { hideBin }, skipKind, skipPath

### Community 114 - "fetch-common-contracts.js"
Cohesion: 0.22
Nodes (8): { argv }, config, { ethers }, fs, { hideBin }, path, { request }, undici

### Community 115 - "impersonate"
Cohesion: 0.25
Nodes (8): impersonate(), fixture(), fixture(), { ethers, predeploy }, { expect }, fixture(), { impersonate }, { loadFixture, mineUpTo, setCode }

### Community 116 - "access-manager.js"
Cohesion: 0.18
Nodes (11): prepareOperation(), CONSUMING_SCHEDULE_STORAGE_SLOT, { ethers }, EXPIRATION, formatAccess(), hashOperation(), lazyGetAddress(), { MAX_UINT64 } (+3 more)

### Community 117 - "Packing.test.js"
Cohesion: 0.25
Nodes (8): forceDeployCode(), { ethers }, { expect }, fixture(), { forceDeployCode }, { loadFixture }, { product }, { SIZES }

### Community 118 - "storage.js"
Cohesion: 0.36
Nodes (8): erc1967Slot(), erc7201format(), erc7201Slot(), { ethers }, getSlot(), setSlot(), { setStorageAt }, upgradeableSlot()

### Community 119 - "Proxy.behaviour.js"
Cohesion: 0.22
Nodes (6): { ethers }, { loadFixture }, shouldBehaveLikeProxy, { ethers }, { expect }, { getAddressInSlot, ImplementationSlot }

### Community 120 - "Enumerable map tests"
Cohesion: 0.22
Nodes (7): coder, { ethers }, { expect }, fakeContract, { loadFixture }, { PANIC_CODES }, returndata

### Community 121 - "Base64 encoding tests"
Cohesion: 0.25
Nodes (6): decode(), { ethers }, { expect }, FALLBACK_SENTINEL, length(), { loadFixture }

### Community 122 - "StorageSlot.test.js"
Cohesion: 0.22
Nodes (7): { ethers }, { expect }, { generators }, { loadFixture }, otherSlot, slot, TYPES

### Community 123 - "TransientSlot.test.js"
Cohesion: 0.22
Nodes (7): { ethers }, { expect }, { generators }, { loadFixture }, otherSlot, slot, TYPES

### Community 124 - "SlotDerivation.js"
Cohesion: 0.25
Nodes (4): format, NOTE: This library provides a way to manipulate storage locations in a non-…, sanitize, { TYPES }

### Community 125 - "SafeERC20 mock tokens"
Cohesion: 0.32
Nodes (7): cp, format, fs, generateFromTemplate(), getVersion(), needsLinter, path

### Community 126 - "ERC721 burnable tests"
Cohesion: 0.25
Nodes (3): format, LENGTHS, { range }

### Community 127 - "ERC20 pausable tests"
Cohesion: 0.29
Nodes (6): currentBranch, match, matchingDocsBranches, proc, read(), tryRead()

### Community 128 - "shouldBehaveLikeAManagedRestrictedOperation"
Cohesion: 0.32
Nodes (7): shouldBehaveLikeAManagedRestrictedOperation(), testScheduleOperation(), shouldBehaveLikeASelfRestrictedOperation(), revertUnauthorized(), testScheduleOperation(), testAsCanCall(), testAsClosable()

### Community 129 - "SlotDerivation.t.js"
Cohesion: 0.29
Nodes (3): { capitalize }, format, { TYPES }

### Community 130 - "BeaconProxy.test.js"
Cohesion: 0.29
Nodes (6): getAddressInSlot(), assertInitialized(), { ethers }, { expect }, { getAddressInSlot, BeaconSlot }, { loadFixture }

### Community 131 - "Cross chain message tests"
Cohesion: 0.25
Nodes (6): { ethers }, { expect }, ids, { loadFixture }, { shouldSupportInterfaces }, values

### Community 132 - "Governor execution tests"
Cohesion: 0.29
Nodes (7): deployReceiver(), { ethers }, { expect }, fixture(), { loadFixture }, { PANIC_CODES }, { RevertType }

### Community 133 - "ERC20 votes tests"
Cohesion: 0.29
Nodes (7): deployReceiver(), { ethers }, { expect }, fixture(), { loadFixture }, { PANIC_CODES }, { RevertType }

### Community 134 - "ERC721 votes tests"
Cohesion: 0.25
Nodes (6): { ethers }, { expect }, { loadFixture }, { secp256k1 }, TEST_MESSAGE, WRONG_MESSAGE

### Community 135 - "Clones library tests"
Cohesion: 0.29
Nodes (6): ensureLowerOrderS(), { ethers }, { expect }, { loadFixture }, prepareSignature(), { secp256r1 }

### Community 136 - "SlotDerivation.test.js"
Cohesion: 0.29
Nodes (5): { erc7201Slot }, { ethers }, { expect }, { generators }, { loadFixture }

### Community 137 - "Initializable contract tests"
Cohesion: 0.39
Nodes (4): mandateExecutorAbi, peragoAcpHookAbi, peragoAdapterAbi, peragoVerifierAbi

### Community 138 - "UUPS upgrade tests"
Cohesion: 0.25
Nodes (7): compilerOptions, declaration, outDir, rootDir, extends, include, ../../tsconfig.base.json

### Community 139 - "Storage slot tests"
Cohesion: 0.52
Nodes (6): command_has_server_id(), command_line_for_pid(), is_brainstorm_server(), mark_stopped(), read_expected_server_id(), stop-server.sh script

### Community 140 - "ERC1967 proxy tests"
Cohesion: 0.29
Nodes (7): devDependencies, tailwindcss, @tailwindcss/postcss, @types/node, @types/react, @types/react-dom, typescript

### Community 141 - "Base64.test.js"
Cohesion: 0.29
Nodes (4): RFC-4648, { ethers }, { expect }, { loadFixture }

### Community 142 - "Access managed tests"
Cohesion: 0.29
Nodes (6): { argv }, fs, { getStorageUpgradeReport }, { hideBin }, newLayout, oldLayout

### Community 143 - "ERC20Crosschain.test.js"
Cohesion: 0.17
Nodes (11): { anyValue }, { ethers }, { expect }, shouldBehaveLikeBridgeERC20(), { anyValue }, { ethers }, { expect }, { getLocalChain } (+3 more)

### Community 144 - "Ownable two step"
Cohesion: 0.29
Nodes (5): { ethers }, { expect }, ids, { loadFixture }, values

### Community 145 - "ProxyAdmin.test.js"
Cohesion: 0.33
Nodes (4): { ethers }, { expect }, { getAddressInSlot, ImplementationSlot }, { loadFixture }

### Community 146 - "Create2.test.js"
Cohesion: 0.29
Nodes (5): { ethers }, { expect }, { loadFixture }, { PANIC_CODES }, { RevertType }

### Community 147 - "AccessManaged.test.js"
Cohesion: 0.29
Nodes (6): { ethers }, { expect }, fixture(), { impersonate }, { loadFixture }, time

### Community 148 - "ERC4626 mock vaults"
Cohesion: 0.33
Nodes (5): access, baseBranch, changelog, commit, $schema

### Community 149 - "Checkpoints utility tests"
Cohesion: 0.40
Nodes (5): extractSection(), { join }, makeWordRegExp(), { readFileSync }, { version }

### Community 150 - "AuthorityUtils.test.js"
Cohesion: 0.33
Nodes (4): { ethers }, { expect }, { loadFixture }, { MAX_UINT32, MAX_UINT64 }

### Community 151 - "EIP7702Utils.test.js"
Cohesion: 0.33
Nodes (3): { ethers, config }, { expect }, { loadFixture }

### Community 152 - "ERC1967Utils.test.js"
Cohesion: 0.33
Nodes (4): { ethers }, { expect }, { getAddressInSlot, setSlot, ImplementationSlot, AdminSlot, BeaconSlot }, { loadFixture }

### Community 153 - "sanity.test.js"
Cohesion: 0.40
Nodes (3): { ethers }, { expect }, { loadFixture, mine }

### Community 154 - "UUPSUpgradeable.test.js"
Cohesion: 0.33
Nodes (4): { ethers }, { expect }, { getAddressInSlot, ImplementationSlot }, { loadFixture }

### Community 155 - "SafeERC20.test.js"
Cohesion: 0.33
Nodes (3): { ethers }, { expect }, { loadFixture }

### Community 156 - "ERC6909ContentURI.test.js"
Cohesion: 0.33
Nodes (4): { ethers }, { expect }, { loadFixture }, { shouldSupportInterfaces }

### Community 157 - "ERC6909Metadata.test.js"
Cohesion: 0.33
Nodes (4): { ethers }, { expect }, { loadFixture }, { shouldSupportInterfaces }

### Community 158 - "ERC721Pausable.test.js"
Cohesion: 0.33
Nodes (4): data, { ethers }, { expect }, { loadFixture }

### Community 159 - "ERC20Capped.test.js"
Cohesion: 0.40
Nodes (3): { ethers }, { expect }, { loadFixture }

### Community 160 - "Base58.test.js"
Cohesion: 0.40
Nodes (3): { ethers }, { expect }, { loadFixture }

### Community 161 - "@nomicfoundation/hardhat-network-helpers"
Cohesion: 0.07
Nodes (17): { ethers }, { expect }, { loadFixture }, { ethers }, { expect }, { loadFixture }, { ethers }, { expect } (+9 more)

### Community 162 - "Strings.test.js"
Cohesion: 0.33
Nodes (4): { ethers }, { expect }, { loadFixture }, { PANIC_CODES }

### Community 163 - "Heap.test.js"
Cohesion: 0.33
Nodes (4): { ethers }, { expect }, { loadFixture }, { PANIC_CODES }

### Community 164 - "ERC7739 signature tests"
Cohesion: 0.40
Nodes (5): scripts, build, dev, start, typecheck

### Community 165 - "EIP712 verifier tests"
Cohesion: 0.40
Nodes (4): markedCache, marker, { task }, {
  TASK_COMPILE_SOLIDITY_GET_COMPILATION_JOB_FOR_FILE,
  TASK_COMPILE_SOLIDITY_COMPILE,
}

### Community 166 - "trie.js"
Cohesion: 0.40
Nodes (4): { ethers }, { MerklePatriciaTrie, createMerkleProof }, @ethereumjs/mpt, ethers

### Community 167 - "Pausable.test.js"
Cohesion: 0.40
Nodes (3): { ethers }, { expect }, { loadFixture }

### Community 168 - "ReentrancyGuard.test.js"
Cohesion: 0.40
Nodes (3): { ethers }, { expect }, { loadFixture }

### Community 169 - "account.js"
Cohesion: 0.22
Nodes (6): { ethers }, { impersonateAccount, setBalance }, { ethers }, { expect }, { impersonate }, { loadFixture }

### Community 170 - "Governor storage tests"
Cohesion: 0.40
Nodes (3): { ethers }, { expect }, { loadFixture }

### Community 171 - "Checkpoints.test.js"
Cohesion: 0.40
Nodes (4): { ethers }, { expect }, { loadFixture }, { OPTS }

### Community 172 - "ERC721Burnable.test.js"
Cohesion: 0.40
Nodes (3): { ethers }, { expect }, { loadFixture }

### Community 173 - "lint-staged"
Cohesion: 0.67
Nodes (3): lint-staged, {contracts,test}/**/*.sol, **/*.{js,ts}

### Community 175 - "Governor prevent late quorum"
Cohesion: 0.40
Nodes (3): { ethers }, { expect }, { loadFixture }

### Community 179 - "Votes delegation tests"
Cohesion: 0.50
Nodes (4): artifactUrl(), blocks, EXPORTS, target

### Community 181 - "Votes timestamp tests"
Cohesion: 0.67
Nodes (3): callBundler(), JsonRpcResponse, main()

### Community 182 - "ERC1155 core tests"
Cohesion: 0.16
Nodes (12): sizes, tones, Wordmark(), NAV, SiteFooter(), TopBar(), UtcClock(), Rail() (+4 more)

### Community 183 - "ERC721 core tests"
Cohesion: 0.50
Nodes (3): { argv }, fs, path

### Community 184 - "ERC20 core tests"
Cohesion: 0.50
Nodes (3): fs, { task }, { TASK_COMPILE_GET_REMAPPINGS }

### Community 185 - "Payment splitter tests"
Cohesion: 0.50
Nodes (3): extends, labels, github>OpenZeppelin/configs

### Community 186 - "Finance vesting tests"
Cohesion: 0.50
Nodes (3): COVERAGE, FOUNDRY_FUZZ_RUNS, coverage.sh script

### Community 187 - "Metatx forwarder tests"
Cohesion: 0.50
Nodes (3): changelog, formatted, fs

### Community 188 - "Create2 utility tests"
Cohesion: 0.50
Nodes (3): customRules, rules, solhint-plugin-openzeppelin

### Community 189 - "Conditional escrow tests"
Cohesion: 0.50
Nodes (3): name, private, version

### Community 197 - "repository"
Cohesion: 0.67
Nodes (3): repository, type, url

### Community 208 - "page.tsx"
Cohesion: 0.11
Nodes (18): EASE, RiseIn(), Unveil(), Caption(), Anatomy(), BINDINGS, BOUNDS, Closing() (+10 more)

## Knowledge Gaps
- **1633 isolated node(s):** `archivo`, `jetbrains`, `metadata`, `viewport`, `railVariants` (+1628 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 1972 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **27 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `hardhat` connect `hardhat` to `EnumerableMap.test.js`, `BridgeERC20.test.js`, `Modular account tests`, `Cryptographic signing keys`, `openzeppelin-contracts/package.json`, `ERC20 behavior tests`, `Account.behavior.js`, `Votes.behavior.js`, `Governor nonce tests`, `Access control tests`, `Smart account behaviors`, `User operation helpers`, `Account signature utilities`, `ERC721 behavior tests`, `Access scheduling predicates`, `EIP712 typed data tests`, `Vesting wallet tests`, `chai`, `Merkle tree generators`, `draft-InteroperableAddress.test.js`, `DoubleEndedQueue.test.js`, `AccountP256.test.js`, `Bytes utility tests`, `ERC2771Context.test.js`, `AccessManager.predicate.js`, `Token bridge mocks`, `time.js`, `SafeERC20 tests`, `Mandate executor authorization`, `Contract lint configuration`, `Token transfer helpers`, `Math.test.js`, `Bytes.test.js`, `Governor quorum tests`, `Governor counting tests`, `iterate.js`, `enums.js`, `RLP.test.js`, `Arrays.test.js`, `ERC1155 receiver tests`, `Governor settings tests`, `random.js`, `Role management tests`, `ERC7786Recipient.test.js`, `TrieProof.test.js`, `Time.test.js`, `Short strings tests`, `Double ended queue tests`, `ERC20 wrapper tests`, `shouldSupportInterfaces`, `SupportsInterface.behavior.js`, `Token vesting tests`, `Account.test.js`, `GovernorCountingFractional.test.js`, `Token timelock tests`, `ERC1363 token tests`, `ERC4907 rental tests`, `Calldata decoding utilities`, `MerkleTree.test.js`, `GovernorProposalGuardian.test.js`, `GovernorVotesQuorumFraction.test.js`, `Packed data utilities`, `Memory.test.js`, `MerkleProof.test.js`, `Address utility tests`, `impersonate`, `access-manager.js`, `Packing.test.js`, `storage.js`, `Proxy.behaviour.js`, `Enumerable map tests`, `Base64 encoding tests`, `StorageSlot.test.js`, `TransientSlot.test.js`, `BeaconProxy.test.js`, `Cross chain message tests`, `Governor execution tests`, `ERC20 votes tests`, `ERC721 votes tests`, `Clones library tests`, `SlotDerivation.test.js`, `Base64.test.js`, `ERC20Crosschain.test.js`, `Ownable two step`, `ProxyAdmin.test.js`, `Create2.test.js`, `AccessManaged.test.js`, `AuthorityUtils.test.js`, `EIP7702Utils.test.js`, `ERC1967Utils.test.js`, `sanity.test.js`, `UUPSUpgradeable.test.js`, `SafeERC20.test.js`, `ERC6909ContentURI.test.js`, `ERC6909Metadata.test.js`, `ERC721Pausable.test.js`, `ERC20Capped.test.js`, `Base58.test.js`, `@nomicfoundation/hardhat-network-helpers`, `Strings.test.js`, `Heap.test.js`, `Pausable.test.js`, `ReentrancyGuard.test.js`, `account.js`, `Governor storage tests`, `Checkpoints.test.js`, `ERC721Burnable.test.js`, `Governor prevent late quorum`?**
  _High betweenness centrality (0.196) - this node is a cross-community bridge._
- **Why does `@nomicfoundation/hardhat-network-helpers` connect `@nomicfoundation/hardhat-network-helpers` to `EnumerableMap.test.js`, `BridgeERC20.test.js`, `Modular account tests`, `Cryptographic signing keys`, `openzeppelin-contracts/package.json`, `ERC20 behavior tests`, `Account.behavior.js`, `Votes.behavior.js`, `Governor nonce tests`, `Access control tests`, `Smart account behaviors`, `Account signature utilities`, `ERC721 behavior tests`, `Access scheduling predicates`, `EIP712 typed data tests`, `Vesting wallet tests`, `chai`, `hardhat`, `Merkle tree generators`, `draft-InteroperableAddress.test.js`, `DoubleEndedQueue.test.js`, `AccountP256.test.js`, `Bytes utility tests`, `ERC2771Context.test.js`, `AccessManager.predicate.js`, `Token bridge mocks`, `time.js`, `SafeERC20 tests`, `Mandate executor authorization`, `Contract lint configuration`, `Token transfer helpers`, `Math.test.js`, `Bytes.test.js`, `Governor quorum tests`, `Governor counting tests`, `iterate.js`, `enums.js`, `RLP.test.js`, `Arrays.test.js`, `ERC1155 receiver tests`, `Governor settings tests`, `random.js`, `Role management tests`, `ERC7786Recipient.test.js`, `Time.test.js`, `Short strings tests`, `Double ended queue tests`, `ERC20 wrapper tests`, `shouldSupportInterfaces`, `SupportsInterface.behavior.js`, `Token vesting tests`, `Account.test.js`, `GovernorCountingFractional.test.js`, `Token timelock tests`, `ERC1363 token tests`, `ERC4907 rental tests`, `Calldata decoding utilities`, `MerkleTree.test.js`, `GovernorProposalGuardian.test.js`, `GovernorVotesQuorumFraction.test.js`, `Packed data utilities`, `Memory.test.js`, `Address utility tests`, `impersonate`, `Packing.test.js`, `storage.js`, `Proxy.behaviour.js`, `Enumerable map tests`, `Base64 encoding tests`, `StorageSlot.test.js`, `TransientSlot.test.js`, `BeaconProxy.test.js`, `Cross chain message tests`, `Governor execution tests`, `ERC20 votes tests`, `ERC721 votes tests`, `Clones library tests`, `SlotDerivation.test.js`, `Base64.test.js`, `ERC20Crosschain.test.js`, `Ownable two step`, `ProxyAdmin.test.js`, `Create2.test.js`, `AccessManaged.test.js`, `AuthorityUtils.test.js`, `EIP7702Utils.test.js`, `ERC1967Utils.test.js`, `sanity.test.js`, `UUPSUpgradeable.test.js`, `SafeERC20.test.js`, `ERC6909ContentURI.test.js`, `ERC6909Metadata.test.js`, `ERC721Pausable.test.js`, `ERC20Capped.test.js`, `Base58.test.js`, `Strings.test.js`, `Heap.test.js`, `Pausable.test.js`, `ReentrancyGuard.test.js`, `account.js`, `Governor storage tests`, `Checkpoints.test.js`, `ERC721Burnable.test.js`, `Governor prevent late quorum`?**
  _High betweenness centrality (0.127) - this node is a cross-community bridge._
- **Why does `chai` connect `chai` to `EnumerableMap.test.js`, `BridgeERC20.test.js`, `Modular account tests`, `openzeppelin-contracts/package.json`, `ERC20 behavior tests`, `Account.behavior.js`, `Votes.behavior.js`, `Governor nonce tests`, `Access control tests`, `Account signature utilities`, `ERC721 behavior tests`, `Access scheduling predicates`, `EIP712 typed data tests`, `Vesting wallet tests`, `hardhat`, `Merkle tree generators`, `draft-InteroperableAddress.test.js`, `DoubleEndedQueue.test.js`, `ERC2771Context.test.js`, `AccessManager.predicate.js`, `Token bridge mocks`, `time.js`, `SafeERC20 tests`, `Mandate executor authorization`, `Contract lint configuration`, `Token transfer helpers`, `Math.test.js`, `Bytes.test.js`, `Governor quorum tests`, `Governor counting tests`, `iterate.js`, `enums.js`, `RLP.test.js`, `Arrays.test.js`, `ERC1155 receiver tests`, `Governor settings tests`, `random.js`, `Role management tests`, `ERC7786Recipient.test.js`, `TrieProof.test.js`, `Time.test.js`, `Short strings tests`, `Double ended queue tests`, `ERC20 wrapper tests`, `shouldSupportInterfaces`, `SupportsInterface.behavior.js`, `Token vesting tests`, `GovernorCountingFractional.test.js`, `Token timelock tests`, `ERC1363 token tests`, `ERC4907 rental tests`, `Calldata decoding utilities`, `MerkleTree.test.js`, `GovernorProposalGuardian.test.js`, `GovernorVotesQuorumFraction.test.js`, `Packed data utilities`, `Memory.test.js`, `MerkleProof.test.js`, `Address utility tests`, `impersonate`, `Packing.test.js`, `Proxy.behaviour.js`, `Enumerable map tests`, `Base64 encoding tests`, `StorageSlot.test.js`, `TransientSlot.test.js`, `BeaconProxy.test.js`, `Cross chain message tests`, `Governor execution tests`, `ERC20 votes tests`, `ERC721 votes tests`, `Clones library tests`, `SlotDerivation.test.js`, `Base64.test.js`, `ERC20Crosschain.test.js`, `Ownable two step`, `ProxyAdmin.test.js`, `Create2.test.js`, `AccessManaged.test.js`, `AuthorityUtils.test.js`, `EIP7702Utils.test.js`, `ERC1967Utils.test.js`, `sanity.test.js`, `UUPSUpgradeable.test.js`, `SafeERC20.test.js`, `ERC6909ContentURI.test.js`, `ERC6909Metadata.test.js`, `ERC721Pausable.test.js`, `ERC20Capped.test.js`, `Base58.test.js`, `@nomicfoundation/hardhat-network-helpers`, `Strings.test.js`, `Heap.test.js`, `Pausable.test.js`, `ReentrancyGuard.test.js`, `account.js`, `Governor storage tests`, `Checkpoints.test.js`, `ERC721Burnable.test.js`, `Governor prevent late quorum`?**
  _High betweenness centrality (0.119) - this node is a cross-community bridge._
- **What connects `archivo`, `jetbrains`, `metadata` to the rest of the system?**
  _1633 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Forge cheatcode documentation` be split into smaller, more focused modules?**
  _Cohesion score 0.06327006327006326 - nodes in this community are weakly interconnected._
- **Should `Brainstorming companion server` be split into smaller, more focused modules?**
  _Cohesion score 0.05628415300546448 - nodes in this community are weakly interconnected._
- **Should `EnumerableMap.test.js` be split into smaller, more focused modules?**
  _Cohesion score 0.053544494720965306 - nodes in this community are weakly interconnected._