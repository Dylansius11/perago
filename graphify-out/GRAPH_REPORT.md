# Graph Report - perago  (2026-09-19)

## Corpus Check
- 342 files · ~167,922 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2827 nodes · 4367 edges · 225 communities (188 shown, 28 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 112 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Forge cheatcode documentation
- Brainstorming companion server
- Collection testing utilities
- Account session probe
- Bridge and access tests
- OpenZeppelin development dependencies
- Modular account tests
- Cryptographic signing keys
- Modular account SDK
- OpenZeppelin package metadata
- ERC20 behavior tests
- Execution domain models
- ERC4337 test fixtures
- Votes and clock tests
- Pull request analyzer
- Governor nonce tests
- Storage code generators
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
- Contract clone tests
- Web application package
- Ownership and burn tests
- Merkle tree generators
- ERC1155 behavior tests
- Proxy deployment helpers
- Governor behavior tests
- Bytes utility tests
- Account factory utilities
- Access manager tests
- Multisig account tests
- ECDSA signature tests
- WebAuthn cryptography tests
- Merkle proof tests
- ERC20 permit tests
- Token bridge mocks
- Upgradeable contract tests
- SafeERC20 tests
- Governance proposal tests
- EIP712 domain utilities
- ERC4626 vault tests
- Mandate executor authorization
- Contract lint configuration
- Token transfer helpers
- Test assertion helpers
- Transparent proxy tests
- Governor quorum tests
- Time utility tests
- ERC721 enumerable tests
- Access manager mocks
- Deployment script helpers
- Governor counting tests
- Account abstraction mocks
- String utility tests
- ERC20 extensions tests
- ERC721 receiver tests
- Upgradeable beacon tests
- EIP7702 account tests
- Reentrancy guard tests
- Typed structured data
- Safe casting tests
- Math utility tests
- Cryptography helper tests
- Contract manifest tooling
- Enumerable set tests
- Mandate execution lifecycle
- ERC1155 receiver tests
- Governor settings tests
- Create2 deployment tests
- Role management tests
- Upgradeable proxy utilities
- ERC721 wrapper tests
- API package configuration
- ERC20 flash mint tests
- Modular account fixtures
- Protocol manifest schema
- ERC165 interface tests
- Contract ABI exports
- Short strings tests
- Double ended queue tests
- ERC20 wrapper tests
- ECDSA recovery tests
- Account session policy
- Governor timelock tests
- ERC1155 supply tests
- Token vesting tests
- Access control utilities
- Signature checker tests
- Token timelock tests
- ERC1363 token tests
- ERC4907 rental tests
- Calldata decoding utilities
- Account permission encoding
- ERC2771 context tests
- Token holder tests
- EIP712 fixture generation
- Packed data utilities
- Governor proposal guards
- ERC20 temporary approval
- Address utility tests
- ERC1271 signature tests
- Web application configuration
- Execution adapter mocks
- ERC721 consecutive minting
- ERC2981 royalty tests
- ERC20 capped tests
- Governor votes tests
- Contract package configuration
- ERC5805 voting tests
- Enumerable map tests
- Base64 encoding tests
- RSA signature tests
- P256 cryptography tests
- Message hash tests
- SafeERC20 mock tokens
- ERC721 burnable tests
- ERC20 pausable tests
- ERC721 pausable tests
- ERC1155 pausable tests
- Token rescue tests
- Cross chain message tests
- Governor execution tests
- ERC20 votes tests
- ERC721 votes tests
- Clones library tests
- Multicall utility tests
- Initializable contract tests
- UUPS upgrade tests
- Storage slot tests
- ERC1967 proxy tests
- Beacon proxy tests
- Access managed tests
- Ownable contract tests
- Ownable two step
- Authority interface tests
- ERC721 URI storage
- ERC1155 URI storage
- ERC4626 mock vaults
- Checkpoints utility tests
- Timers utility tests
- Arrays utility tests
- BitMaps utility tests
- Comparators utility tests
- Heap utility tests
- Circular buffer tests
- Panic utility tests
- Nonces utility tests
- Nonces keyed tests
- Merkle tree tests
- Commutative cryptography tests
- Signature recovery tests
- WebAuthn verification tests
- ERC7913 signature tests
- ERC7739 signature tests
- EIP712 verifier tests
- Account signer tests
- Account modules tests
- Account execution tests
- Governor core tests
- Governor storage tests
- Governor compatibility tests
- Governor relay tests
- Governor super quorum
- Governor sequential proposal ids
- Governor prevent late quorum
- Governor timelock control
- Governor timelock compound
- Governor timelock access
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
- ERC7786 aggregator tests
- ERC3156 flash loan
- IERC1363 interface tests
- Token common mocks
- ERC721 crosschain tests
- ERC1155 crosschain tests
- ERC20 crosschain tests
- ERC1363 receiver tests
- ERC1363 spender tests
- Token safe transfer
- Governor vote counting
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
- `testScheduleOperation()` --calls--> `testAsSchedulableOperation()`  [EXTRACTED]
  packages/contracts/lib/openzeppelin-contracts/test/access/manager/AccessManager.behavior.js → packages/contracts/lib/openzeppelin-contracts/test/access/manager/AccessManager.predicate.js
- `signBallot()` --calls--> `getDomain()`  [EXTRACTED]
  packages/contracts/lib/openzeppelin-contracts/test/governance/Governor.test.js → packages/contracts/lib/openzeppelin-contracts/test/helpers/eip712.js
- `signBallot()` --calls--> `getDomain()`  [EXTRACTED]
  packages/contracts/lib/openzeppelin-contracts/test/governance/extensions/GovernorCountingOverridable.test.js → packages/contracts/lib/openzeppelin-contracts/test/helpers/eip712.js
- `signBallot()` --calls--> `getDomain()`  [EXTRACTED]
  packages/contracts/lib/openzeppelin-contracts/test/governance/extensions/GovernorNoncesKeyed.test.js → packages/contracts/lib/openzeppelin-contracts/test/helpers/eip712.js
- `signExtendedBallot()` --calls--> `getDomain()`  [EXTRACTED]
  packages/contracts/lib/openzeppelin-contracts/test/governance/extensions/GovernorNoncesKeyed.test.js → packages/contracts/lib/openzeppelin-contracts/test/helpers/eip712.js

## Import Cycles
- None detected.

## Communities (225 total, 28 thin omitted)

### Community 0 - "Forge cheatcode documentation"
Cohesion: 0.06
Nodes (23): Cheatcode, Cheatcodes, CheatcodesPrinter, cmp_cheatcode(), CmpCheatcode, Enum, EnumVariant, Error (+15 more)

### Community 1 - "Brainstorming companion server"
Cohesion: 0.06
Nodes (57): bootstrapPage(), brandMarkup(), broadcast(), browserLauncherForPlatform(), chmodOwnerOnly(), clients, companionUrl(), computeAcceptKey() (+49 more)

### Community 2 - "Collection testing utilities"
Cohesion: 0.05
Nodes (38): fromBytes32(), toBytes32(), { capitalize, mapValues }, MAP_TYPES, SET_TYPES, toMapTypeDescr(), toSetTypeDescr(), typeDescr() (+30 more)

### Community 3 - "Account session probe"
Cohesion: 0.05
Nodes (43): dependencies, @aa-sdk/core, @alchemy/aa-infra, @alchemy/common, @alchemy/smart-accounts, @perago/sdk, viem, zod (+35 more)

### Community 4 - "Bridge and access tests"
Cohesion: 0.06
Nodes (37): { ethers }, { expect }, fixture(), { impersonate }, { loadFixture }, time, { anyValue }, { ethers } (+29 more)

### Community 5 - "OpenZeppelin development dependencies"
Cohesion: 0.05
Nodes (43): devDependencies, chai, @changesets/changelog-github, @changesets/cli, @changesets/pre, @changesets/read, eslint, @eslint/compat (+35 more)

### Community 6 - "Modular account tests"
Cohesion: 0.07
Nodes (36): { ERC4337Helper }, { ethers, predeploy }, { getDomain }, { loadFixture, setBalance }, { MODULE_TYPE_VALIDATOR }, { PackedUserOperation }, { shouldBehaveLikeAccountCore, shouldBehaveLikeAccountHolder }, { shouldBehaveLikeAccountERC7579 } (+28 more)

### Community 7 - "Cryptographic signing keys"
Cohesion: 0.06
Nodes (25): { ERC4337Helper }, { ethers, predeploy }, { expect }, { getDomain }, { loadFixture }, { MAX_UINT64 }, { NonNativeSigner, P256SigningKey, RSASHA256SigningKey, MultiERC7913SigningKey }, { PackedUserOperation } (+17 more)

### Community 8 - "Modular account SDK"
Cohesion: 0.11
Nodes (38): ACCOUNT_EXECUTE_SELECTOR, AccountCall, accountFactoryAbi, allowlistInputs(), allowlistParameters, assertAddress(), assertSelectors(), assertSessionEntityId() (+30 more)

### Community 9 - "OpenZeppelin package metadata"
Cohesion: 0.06
Nodes (36): __dirname, author, bugs, url, description, files, homepage, keywords (+28 more)

### Community 10 - "ERC20 behavior tests"
Cohesion: 0.08
Nodes (26): { ethers }, { expect }, shouldBehaveLikeERC20(), shouldBehaveLikeERC20Approve(), shouldBehaveLikeERC20Transfer(), { ethers }, { expect }, { loadFixture } (+18 more)

### Community 11 - "Execution domain models"
Cohesion: 0.11
Nodes (25): CompiledPlan, StakeAction, stakeActionSchema, SwapAction, swapActionSchema, ExecutionReceipt, executionReceiptSchema, adapterIdSchema (+17 more)

### Community 12 - "ERC4337 test fixtures"
Cohesion: 0.09
Nodes (27): { ERC4337Helper }, { ethers, predeploy }, fixture(), { getDomain }, { loadFixture }, { PackedUserOperation }, { shouldBehaveLikeAccountCore, shouldBehaveLikeAccountHolder }, { shouldBehaveLikeERC1271 } (+19 more)

### Community 13 - "Votes and clock tests"
Cohesion: 0.08
Nodes (25): { expect }, shouldBehaveLikeERC6372(), time, { ethers }, { expect }, { getDomain, Delegation }, { mine }, { shouldBehaveLikeERC6372 } (+17 more)

### Community 14 - "Pull request analyzer"
Cohesion: 0.12
Nodes (27): analyze_pr(), calculate_complexity(), categorize_size(), detect_language(), estimate_review_time(), FileStats, generate_suggestions(), identify_risk_factors() (+19 more)

### Community 15 - "Governor nonce tests"
Cohesion: 0.08
Nodes (21): { ethers }, { expect }, { getDomain, Ballot, ExtendedBallot }, { GovernorHelper }, { loadFixture }, { shouldBehaveLikeNoncesKeyed }, signBallot(), signExtendedBallot() (+13 more)

### Community 16 - "Storage code generators"
Cohesion: 0.10
Nodes (12): formatLines(), indentEach(), { capitalize }, TYPES, format, { TYPES }, format, { TYPES } (+4 more)

### Community 17 - "Access control tests"
Cohesion: 0.09
Nodes (20): { ethers }, { expect }, OTHER_ROLE, ROLE, shouldBehaveLikeAccessControl(), shouldBehaveLikeAccessControlDefaultAdminRules(), shouldBehaveLikeAccessControlEnumerable(), { shouldSupportInterfaces } (+12 more)

### Community 18 - "Smart account behaviors"
Cohesion: 0.08
Nodes (24): { ethers, predeploy }, { expect }, { impersonate }, shouldBehaveLikeAccountCore(), shouldBehaveLikeAccountHolder(), { shouldSupportInterfaces }, { SIG_VALIDATION_SUCCESS, SIG_VALIDATION_FAILURE }, { ERC4337Helper } (+16 more)

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

### Community 31 - "Contract clone tests"
Cohesion: 0.10
Nodes (14): { ethers }, { expect }, { ethers }, { expect }, { generators }, { loadFixture }, shouldBehaveLikeClone, { ethers } (+6 more)

### Community 32 - "Web application package"
Cohesion: 0.10
Nodes (20): @perago/sdk, @types/node, typescript, viem, name, private, type, version (+12 more)

### Community 33 - "Ownership and burn tests"
Cohesion: 0.10
Nodes (13): { ethers }, { expect }, { loadFixture }, { ethers }, { expect }, { loadFixture }, { ethers }, { expect } (+5 more)

### Community 34 - "Merkle tree generators"
Cohesion: 0.10
Nodes (19): { anyValue }, CANCELLER_ROLE, { ethers }, EXECUTOR_ROLE, { expect }, { GovernorHelper, timelockSalt }, { loadFixture }, { PANIC_CODES } (+11 more)

### Community 35 - "ERC1155 behavior tests"
Cohesion: 0.10
Nodes (16): { addressCoder }, ethereum, { ethers }, { mapValues }, solana, { CHAINS, getLocalChain }, { ethers }, { expect } (+8 more)

### Community 36 - "Proxy deployment helpers"
Cohesion: 0.10
Nodes (13): { ethers }, { expect }, { loadFixture }, { ethers }, { expect }, { loadFixture }, { ethers }, { expect } (+5 more)

### Community 37 - "Governor behavior tests"
Cohesion: 0.11
Nodes (17): { ERC4337Helper }, { ethers, predeploy }, { getDomain }, { loadFixture }, { NonNativeSigner, P256SigningKey }, { PackedUserOperation }, { shouldBehaveLikeAccountCore, shouldBehaveLikeAccountHolder }, { shouldBehaveLikeERC1271 } (+9 more)

### Community 38 - "Bytes utility tests"
Cohesion: 0.11
Nodes (11): { ERC4337Helper }, { ethers, predeploy }, fixture(), { getDomain }, { loadFixture }, { NonNativeSigner, RSASHA256SigningKey }, { PackedUserOperation }, { shouldBehaveLikeAccountCore, shouldBehaveLikeAccountHolder } (+3 more)

### Community 39 - "Account factory utilities"
Cohesion: 0.12
Nodes (16): { ethers }, { expect }, fixture(), { getDomain, ForwardRequest }, { impersonate }, { loadFixture }, { MAX_UINT48 }, { shouldBehaveLikeRegularContext } (+8 more)

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

### Community 45 - "ERC20 permit tests"
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

### Community 47 - "Upgradeable contract tests"
Cohesion: 0.12
Nodes (15): { clock, increaseTo }, { ethers, predeploy }, { expect }, { loadFixture }, { MAX_UINT48 }, { packValidationData, UserOperation }, { ValidationRange }, clock (+7 more)

### Community 48 - "SafeERC20 tests"
Cohesion: 0.12
Nodes (13): { ethers }, { expect }, shouldBehaveLikeERC6909(), { shouldSupportInterfaces }, { ethers }, { expect }, { loadFixture }, { shouldBehaveLikeERC6909 } (+5 more)

### Community 49 - "Governance proposal tests"
Cohesion: 0.12
Nodes (16): author, bugs, url, description, files, homepage, keywords, license (+8 more)

### Community 50 - "EIP712 domain utilities"
Cohesion: 0.12
Nodes (14): {
  argv: { pattern, skipPatterns, verbose, concurrency, _: artifacts },
}, { compile }, getContractsMetadata, { hideBin }, limit, semver, yargs, { coerce, inc, rsort } (+6 more)

### Community 51 - "ERC4626 vault tests"
Cohesion: 0.13
Nodes (10): { default: readChangesets }, { fetch }, getState(), isPublishedOnNpm(), { join }, readChangesetState(), { readPreState }, { version, name: packageName } (+2 more)

### Community 52 - "Mandate executor authorization"
Cohesion: 0.12
Nodes (16): { anyValue }, { ethers }, { expect }, { GovernorHelper }, { hashOperation }, { loadFixture }, { max }, prepareOperation() (+8 more)

### Community 53 - "Contract lint configuration"
Cohesion: 0.12
Nodes (13): { ethers }, { expect }, { getDomain, Ballot }, { GovernorHelper }, { loadFixture }, { ProposalState, VoteType }, { shouldBehaveLikeERC6372 }, { shouldSupportInterfaces } (+5 more)

### Community 54 - "Token transfer helpers"
Cohesion: 0.13
Nodes (15): CANCELLER_ROLE, { ethers }, EXECUTOR_ROLE, { expect }, genOperation(), genOperationBatch(), getAddress(), { GovernorHelper } (+7 more)

### Community 55 - "Test assertion helpers"
Cohesion: 0.15
Nodes (11): max(), min(), { ethers }, { expect }, { loadFixture }, { max, min }, { shouldBehaveLikeERC20 }, { ethers } (+3 more)

### Community 56 - "Transparent proxy tests"
Cohesion: 0.12
Nodes (11): modExp(), { ethers }, { expect }, { generators }, { loadFixture }, { min, max, modExp }, { PANIC_CODES }, { product, range } (+3 more)

### Community 57 - "Governor quorum tests"
Cohesion: 0.12
Nodes (12): { anyValue }, { ethers }, { expect }, { RevertType }, shouldBehaveLikeERC1155(), { shouldSupportInterfaces }, { ethers }, { expect } (+4 more)

### Community 58 - "Time utility tests"
Cohesion: 0.12
Nodes (15): files, includes, formatter, enabled, indentStyle, indentWidth, quoteStyle, semicolons (+7 more)

### Community 59 - "ERC721 enumerable tests"
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

### Community 63 - "Account abstraction mocks"
Cohesion: 0.13
Nodes (13): batchInBlock(), { expect }, { network }, { unique }, { batchInBlock }, { ethers }, { expect }, { getDomain, Delegation } (+5 more)

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

### Community 68 - "EIP7702 account tests"
Cohesion: 0.14
Nodes (11): Enum(), { ethers }, { Enum }, { ethers }, { expect }, { loadFixture }, { PANIC_CODES }, NOTE: Bruce's assets spent got rounded towards infinity (+3 more)

### Community 69 - "Reentrancy guard tests"
Cohesion: 0.13
Nodes (12): sum(), { ethers }, { expect }, fixture(), { getDomain, ForwardRequest }, { loadFixture }, { sum }, time (+4 more)

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

### Community 74 - "Contract manifest tooling"
Cohesion: 0.16
Nodes (9): TYPES, bigintSign(), { capitalize }, comparator(), { ethers }, { expect }, { generators }, { loadFixture } (+1 more)

### Community 75 - "Enumerable set tests"
Cohesion: 0.14
Nodes (8): format, { OPTS }, VALUE_SIZES, IMPORTANT: Never accept \`key\` as a user input, since an arbitrary…, NOTE: This is a variant of {upperLookup} that is optimized to find "recent"…, { capitalize }, format, { OPTS }

### Community 76 - "Mandate execution lifecycle"
Cohesion: 0.18
Nodes (10): format, formatArgsMultiline(), { OPTS }, OPTS, { product }, NOTE: The _empty set_ (i.e. the case where \`proof.length == 1 && leaves.length…, IMPORTANT: Consider memory side-effects when using custom hashing functions, NOTE: This library supports proof verification for merkle trees built using (+2 more)

### Community 77 - "ERC1155 receiver tests"
Cohesion: 0.14
Nodes (13): { ERC4337Helper }, { ethers, predeploy }, { getDomain }, { loadFixture }, { NonNativeSigner, P256SigningKey, RSASHA256SigningKey, WebAuthnSigningKey }, { PackedUserOperation }, { shouldBehaveLikeAccountCore, shouldBehaveLikeAccountHolder }, { shouldBehaveLikeERC1271 } (+5 more)

### Community 78 - "Governor settings tests"
Cohesion: 0.14
Nodes (13): CANCELLER_ROLE, delay, { ethers }, EXECUTOR_ROLE, { expect }, { GovernorHelper }, { loadFixture }, { ProposalState, VoteType } (+5 more)

### Community 79 - "Create2 deployment tests"
Cohesion: 0.16
Nodes (10): { artifacts, ethers }, { generators }, { setCode }, { ethers }, generators, { ethers }, { expect }, { generators } (+2 more)

### Community 80 - "Role management tests"
Cohesion: 0.14
Nodes (11): aliceP256, bobP256, { ethers }, { expect }, { loadFixture }, { P256SigningKey, NonNativeSigner }, precompile, TEST_MESSAGE (+3 more)

### Community 81 - "Upgradeable proxy utilities"
Cohesion: 0.14
Nodes (7): { ethers }, { expect }, { generators }, { loadFixture }, lorem, { MAX_UINT128, MAX_UINT64, MAX_UINT32, MAX_UINT16 }, present

### Community 82 - "ERC721 wrapper tests"
Cohesion: 0.15
Nodes (9): { ethers }, { expect }, { MAX_UINT64 }, { ethers }, { expect }, { generators }, { loadFixture }, { MAX_UINT64 } (+1 more)

### Community 83 - "API package configuration"
Cohesion: 0.15
Nodes (10): { batchInBlock }, { BlockTries }, { Enum }, { ethers }, { expect }, { generators }, { MerklePatriciaTrie, createMerkleProof }, ProofError (+2 more)

### Community 84 - "ERC20 flash mint tests"
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

### Community 88 - "Contract ABI exports"
Cohesion: 0.21
Nodes (12): shouldBehaveLikeDelayedAdminOperation(), shouldBehaveLikeNotDelayedAdminOperation(), testScheduleOperation(), shouldBehaveLikeRoleAdminOperation(), afterGrantDelay(), testAsRestrictedOperation(), testAsSchedulableOperation(), callerHasAnExecutionDelay() (+4 more)

### Community 89 - "Short strings tests"
Cohesion: 0.17
Nodes (11): { ERC4337Helper }, { ethers, predeploy }, { getDomain }, { loadFixture }, { NonNativeSigner, P256SigningKey, WebAuthnSigningKey }, p256Signer, { PackedUserOperation }, { shouldBehaveLikeAccountCore, shouldBehaveLikeAccountHolder } (+3 more)

### Community 90 - "Double ended queue tests"
Cohesion: 0.17
Nodes (10): { anyValue }, { ethers }, { expect }, { GovernorHelper }, iterate, { loadFixture }, TOKENS, tokenSupply (+2 more)

### Community 91 - "ERC20 wrapper tests"
Cohesion: 0.17
Nodes (11): { anyValue }, defaultDelay, { ethers }, { expect }, { GovernorHelper }, { loadFixture }, { ProposalState, VoteType }, time (+3 more)

### Community 93 - "Account session policy"
Cohesion: 0.20
Nodes (9): { ethers }, { expect }, shouldBehaveLikeERC2981(), { shouldSupportInterfaces }, { ethers }, { expect }, { loadFixture }, { shouldBehaveLikeERC2981 } (+1 more)

### Community 94 - "Governor timelock tests"
Cohesion: 0.17
Nodes (9): { ethers }, { loadFixture }, { shouldSupportInterfaces }, { expect }, GOVERNOR_INTERFACE, INTERFACE_IDS, { interfaceId }, { mapValues } (+1 more)

### Community 95 - "ERC1155 supply tests"
Cohesion: 0.18
Nodes (10): compilerOptions, allowImportingTsExtensions, declaration, outDir, rewriteRelativeImportExtensions, rootDir, types, extends (+2 more)

### Community 96 - "Token vesting tests"
Cohesion: 0.18
Nodes (8): RFC-4055, RFC-8017, fs, path, { ethers }, { expect }, { loadFixture }, parse

### Community 97 - "Access control utilities"
Cohesion: 0.18
Nodes (10): { ERC4337Helper }, { ethers, predeploy }, fixture(), { getDomain }, { loadFixture }, { NonNativeSigner }, { PackedUserOperation }, { shouldBehaveLikeAccountCore, shouldBehaveLikeAccountHolder } (+2 more)

### Community 98 - "Signature checker tests"
Cohesion: 0.18
Nodes (10): { ethers }, { expect }, { GovernorHelper }, { loadFixture }, { sum }, TOKENS, tokenSupply, value (+2 more)

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

### Community 103 - "Account permission encoding"
Cohesion: 0.18
Nodes (8): { ethers }, { expect }, { generators }, { loadFixture }, { PANIC_CODES }, { range }, { StandardMerkleTree }, ZERO

### Community 104 - "ERC2771 context tests"
Cohesion: 0.20
Nodes (8): attributes, { ethers }, { expect }, { generators }, { getLocalChain }, { loadFixture }, payload, NOTE: here we are only testing the receiver. Failures of the gateway itself…

### Community 105 - "Token holder tests"
Cohesion: 0.20
Nodes (9): { ethers }, { expect }, { GovernorHelper }, { impersonate }, { loadFixture }, { ProposalState }, TOKENS, tokenSupply (+1 more)

### Community 106 - "EIP712 fixture generation"
Cohesion: 0.20
Nodes (9): { ethers }, { expect }, { GovernorHelper }, { loadFixture, mine }, { ProposalState, VoteType }, time, TOKENS, tokenSupply (+1 more)

### Community 107 - "Packed data utilities"
Cohesion: 0.20
Nodes (9): { ethers }, { expect }, { GovernorHelper }, { loadFixture }, { ProposalState, VoteType }, time, TOKENS, tokenSupply (+1 more)

### Community 108 - "Governor proposal guards"
Cohesion: 0.20
Nodes (9): AMOUNTS, { ethers }, { expect }, { loadFixture }, MODES, { shouldBehaveLikeVotes }, { sum }, time (+1 more)

### Community 109 - "ERC20 temporary approval"
Cohesion: 0.24
Nodes (8): concatSorted(), customHash(), defaultHash(), { ethers }, { expect }, { PANIC_CODES }, { SimpleMerkleTree }, @openzeppelin/merkle-tree

### Community 110 - "Address utility tests"
Cohesion: 0.20
Nodes (8): { ethers }, { expect }, { loadFixture }, returnValue1, returnValue2, storageSlot, storageValue, value

### Community 111 - "ERC1271 signature tests"
Cohesion: 0.42
Nodes (7): connect(), nextReconnectDelay(), reloadAfterRecovery(), sessionKey(), setStatus(), showTombstone(), websocketUrl()

### Community 112 - "Web application configuration"
Cohesion: 0.22
Nodes (6): nextConfig, workspaceRoot, metadata, viewport, next, react

### Community 113 - "Execution adapter mocks"
Cohesion: 0.22
Nodes (7): { argv }, { extractStorageLayout }, { findAll, astDereferencer, srcDecoder }, fs, { hideBin }, skipKind, skipPath

### Community 114 - "ERC721 consecutive minting"
Cohesion: 0.22
Nodes (8): { argv }, config, { ethers }, fs, { hideBin }, path, { request }, undici

### Community 115 - "ERC2981 royalty tests"
Cohesion: 0.22
Nodes (7): files, fs, gitStatus, proc, semver, [tag], { version }

### Community 116 - "ERC20 capped tests"
Cohesion: 0.22
Nodes (8): CONSUMING_SCHEDULE_STORAGE_SLOT, { ethers }, EXPIRATION, formatAccess(), { MAX_UINT64 }, MINSETBACK, time, { upgradeableSlot }

### Community 117 - "Governor votes tests"
Cohesion: 0.25
Nodes (8): forceDeployCode(), { ethers }, { expect }, fixture(), { forceDeployCode }, { loadFixture }, { product }, { SIZES }

### Community 118 - "Contract package configuration"
Cohesion: 0.36
Nodes (8): erc1967Slot(), erc7201format(), erc7201Slot(), { ethers }, getSlot(), setSlot(), { setStorageAt }, upgradeableSlot()

### Community 119 - "ERC5805 voting tests"
Cohesion: 0.22
Nodes (6): { ethers }, { loadFixture }, shouldBehaveLikeProxy, { ethers }, { expect }, { getAddressInSlot, ImplementationSlot }

### Community 120 - "Enumerable map tests"
Cohesion: 0.22
Nodes (7): coder, { ethers }, { expect }, fakeContract, { loadFixture }, { PANIC_CODES }, returndata

### Community 121 - "Base64 encoding tests"
Cohesion: 0.25
Nodes (6): decode(), { ethers }, { expect }, FALLBACK_SENTINEL, length(), { loadFixture }

### Community 122 - "RSA signature tests"
Cohesion: 0.22
Nodes (7): { ethers }, { expect }, { generators }, { loadFixture }, otherSlot, slot, TYPES

### Community 123 - "P256 cryptography tests"
Cohesion: 0.22
Nodes (7): { ethers }, { expect }, { generators }, { loadFixture }, otherSlot, slot, TYPES

### Community 124 - "Message hash tests"
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

### Community 128 - "ERC721 pausable tests"
Cohesion: 0.32
Nodes (7): shouldBehaveLikeAManagedRestrictedOperation(), testScheduleOperation(), shouldBehaveLikeASelfRestrictedOperation(), revertUnauthorized(), testScheduleOperation(), testAsCanCall(), testAsClosable()

### Community 129 - "ERC1155 pausable tests"
Cohesion: 0.25
Nodes (7): { ethers }, { expect }, { GovernorHelper }, { loadFixture }, TOKENS, value, { VoteType }

### Community 130 - "Token rescue tests"
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

### Community 136 - "Multicall utility tests"
Cohesion: 0.25
Nodes (5): { ethers }, { expect }, { generators }, { loadFixture }, { PANIC_CODES }

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

### Community 141 - "Beacon proxy tests"
Cohesion: 0.29
Nodes (4): RFC-4648, { ethers }, { expect }, { loadFixture }

### Community 142 - "Access managed tests"
Cohesion: 0.29
Nodes (6): { argv }, fs, { getStorageUpgradeReport }, { hideBin }, newLayout, oldLayout

### Community 143 - "Ownable contract tests"
Cohesion: 0.29
Nodes (3): { capitalize }, format, { TYPES }

### Community 144 - "Ownable two step"
Cohesion: 0.29
Nodes (5): { ethers }, { expect }, ids, { loadFixture }, values

### Community 145 - "Authority interface tests"
Cohesion: 0.29
Nodes (5): { ethers }, { expect }, { getDomain, domainSeparator, Permit }, { loadFixture }, time

### Community 146 - "ERC721 URI storage"
Cohesion: 0.29
Nodes (5): { ethers }, { expect }, { loadFixture }, { PANIC_CODES }, { RevertType }

### Community 147 - "ERC1155 URI storage"
Cohesion: 0.29
Nodes (5): { erc7201Slot }, { ethers }, { expect }, { generators }, { loadFixture }

### Community 148 - "ERC4626 mock vaults"
Cohesion: 0.33
Nodes (5): access, baseBranch, changelog, commit, $schema

### Community 149 - "Checkpoints utility tests"
Cohesion: 0.40
Nodes (5): extractSection(), { join }, makeWordRegExp(), { readFileSync }, { version }

### Community 150 - "Timers utility tests"
Cohesion: 0.33
Nodes (4): { ethers }, { expect }, { loadFixture }, { MAX_UINT32, MAX_UINT64 }

### Community 151 - "Arrays utility tests"
Cohesion: 0.33
Nodes (3): { ethers, config }, { expect }, { loadFixture }

### Community 152 - "BitMaps utility tests"
Cohesion: 0.33
Nodes (4): { ethers }, { expect }, { getAddressInSlot, setSlot, ImplementationSlot, AdminSlot, BeaconSlot }, { loadFixture }

### Community 153 - "Comparators utility tests"
Cohesion: 0.33
Nodes (4): { ethers }, { expect }, { getAddressInSlot, ImplementationSlot }, { loadFixture }

### Community 154 - "Heap utility tests"
Cohesion: 0.33
Nodes (4): { ethers }, { expect }, { getAddressInSlot, ImplementationSlot }, { loadFixture }

### Community 155 - "Circular buffer tests"
Cohesion: 0.33
Nodes (3): { ethers }, { expect }, { loadFixture }

### Community 156 - "Panic utility tests"
Cohesion: 0.33
Nodes (4): { ethers }, { expect }, { loadFixture }, { shouldSupportInterfaces }

### Community 157 - "Nonces utility tests"
Cohesion: 0.33
Nodes (4): { ethers }, { expect }, { loadFixture }, { shouldSupportInterfaces }

### Community 158 - "Nonces keyed tests"
Cohesion: 0.33
Nodes (4): data, { ethers }, { expect }, { loadFixture }

### Community 159 - "Merkle tree tests"
Cohesion: 0.33
Nodes (4): { ethers }, { expect }, { loadFixture }, { shouldSupportInterfaces }

### Community 160 - "Commutative cryptography tests"
Cohesion: 0.33
Nodes (4): { ethers }, { expect }, { loadFixture }, { range }

### Community 161 - "Signature recovery tests"
Cohesion: 0.33
Nodes (4): { ethers }, { expect }, { loadFixture }, { PANIC_CODES }

### Community 162 - "WebAuthn verification tests"
Cohesion: 0.33
Nodes (4): { ethers }, { expect }, { loadFixture }, { PANIC_CODES }

### Community 163 - "ERC7913 signature tests"
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

### Community 166 - "Account signer tests"
Cohesion: 0.40
Nodes (4): { ethers }, { MerklePatriciaTrie, createMerkleProof }, @ethereumjs/mpt, ethers

### Community 167 - "Account modules tests"
Cohesion: 0.40
Nodes (3): { ethers }, { expect }, { loadFixture }

### Community 168 - "Account execution tests"
Cohesion: 0.40
Nodes (3): { ethers }, { expect }, { loadFixture, mine }

### Community 169 - "Governor core tests"
Cohesion: 0.40
Nodes (3): { ethers }, { expect }, { loadFixture }

### Community 170 - "Governor storage tests"
Cohesion: 0.40
Nodes (3): { ethers }, { expect }, { loadFixture }

### Community 171 - "Governor compatibility tests"
Cohesion: 0.40
Nodes (3): { ethers }, { expect }, { loadFixture }

### Community 172 - "Governor relay tests"
Cohesion: 0.40
Nodes (3): { ethers }, { expect }, { loadFixture }

### Community 173 - "Governor super quorum"
Cohesion: 0.40
Nodes (3): { ethers }, { expect }, { loadFixture }

### Community 174 - "Governor sequential proposal ids"
Cohesion: 0.40
Nodes (3): { ethers }, { expect }, { loadFixture }

### Community 175 - "Governor prevent late quorum"
Cohesion: 0.40
Nodes (3): { ethers }, { expect }, { loadFixture }

### Community 176 - "Governor timelock control"
Cohesion: 0.40
Nodes (3): { ethers }, { expect }, { loadFixture }

### Community 177 - "Governor timelock compound"
Cohesion: 0.40
Nodes (3): { ethers }, { expect }, { loadFixture }

### Community 178 - "Governor timelock access"
Cohesion: 0.40
Nodes (4): { ethers }, { expect }, { loadFixture }, { OPTS }

### Community 179 - "Votes delegation tests"
Cohesion: 0.50
Nodes (4): artifactUrl(), blocks, EXPORTS, target

### Community 181 - "Votes timestamp tests"
Cohesion: 0.67
Nodes (3): callBundler(), JsonRpcResponse, main()

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

### Community 196 - "ERC7786 aggregator tests"
Cohesion: 0.67
Nodes (3): lint-staged, {contracts,test}/**/*.sol, **/*.{js,ts}

### Community 197 - "ERC3156 flash loan"
Cohesion: 0.67
Nodes (3): repository, type, url

## Knowledge Gaps
- **1612 isolated node(s):** `crypto`, `http`, `fs`, `path`, `OPCODES` (+1607 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 1949 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **28 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `hardhat` connect `Proxy deployment helpers` to `Collection testing utilities`, `Bridge and access tests`, `Modular account tests`, `Cryptographic signing keys`, `OpenZeppelin package metadata`, `ERC20 behavior tests`, `ERC4337 test fixtures`, `Votes and clock tests`, `Governor nonce tests`, `Access control tests`, `Smart account behaviors`, `User operation helpers`, `Account signature utilities`, `ERC721 behavior tests`, `Access scheduling predicates`, `EIP712 typed data tests`, `Vesting wallet tests`, `Contract clone tests`, `Ownership and burn tests`, `Merkle tree generators`, `ERC1155 behavior tests`, `Governor behavior tests`, `Bytes utility tests`, `Account factory utilities`, `ERC20 permit tests`, `Token bridge mocks`, `Upgradeable contract tests`, `SafeERC20 tests`, `Mandate executor authorization`, `Contract lint configuration`, `Token transfer helpers`, `Test assertion helpers`, `Transparent proxy tests`, `Governor quorum tests`, `Governor counting tests`, `Account abstraction mocks`, `EIP7702 account tests`, `Reentrancy guard tests`, `Contract manifest tooling`, `ERC1155 receiver tests`, `Governor settings tests`, `Create2 deployment tests`, `Role management tests`, `Upgradeable proxy utilities`, `ERC721 wrapper tests`, `API package configuration`, `ERC20 flash mint tests`, `Short strings tests`, `Double ended queue tests`, `ERC20 wrapper tests`, `Account session policy`, `Governor timelock tests`, `Token vesting tests`, `Access control utilities`, `Signature checker tests`, `Token timelock tests`, `ERC1363 token tests`, `ERC4907 rental tests`, `Calldata decoding utilities`, `Account permission encoding`, `ERC2771 context tests`, `Token holder tests`, `EIP712 fixture generation`, `Packed data utilities`, `Governor proposal guards`, `ERC20 temporary approval`, `Address utility tests`, `ERC20 capped tests`, `Governor votes tests`, `Contract package configuration`, `ERC5805 voting tests`, `Enumerable map tests`, `Base64 encoding tests`, `RSA signature tests`, `P256 cryptography tests`, `ERC1155 pausable tests`, `Token rescue tests`, `Cross chain message tests`, `Governor execution tests`, `ERC20 votes tests`, `ERC721 votes tests`, `Clones library tests`, `Multicall utility tests`, `Beacon proxy tests`, `Ownable two step`, `Authority interface tests`, `ERC721 URI storage`, `ERC1155 URI storage`, `Timers utility tests`, `Arrays utility tests`, `BitMaps utility tests`, `Comparators utility tests`, `Heap utility tests`, `Circular buffer tests`, `Panic utility tests`, `Nonces utility tests`, `Nonces keyed tests`, `Merkle tree tests`, `Commutative cryptography tests`, `Signature recovery tests`, `WebAuthn verification tests`, `ERC7913 signature tests`, `Account modules tests`, `Account execution tests`, `Governor core tests`, `Governor storage tests`, `Governor compatibility tests`, `Governor relay tests`, `Governor super quorum`, `Governor sequential proposal ids`, `Governor prevent late quorum`, `Governor timelock control`, `Governor timelock compound`, `Governor timelock access`?**
  _High betweenness centrality (0.167) - this node is a cross-community bridge._
- **Why does `@nomicfoundation/hardhat-network-helpers` connect `Ownership and burn tests` to `Collection testing utilities`, `Bridge and access tests`, `Modular account tests`, `Cryptographic signing keys`, `OpenZeppelin package metadata`, `ERC20 behavior tests`, `ERC4337 test fixtures`, `Votes and clock tests`, `Governor nonce tests`, `Access control tests`, `Smart account behaviors`, `Account signature utilities`, `ERC721 behavior tests`, `Access scheduling predicates`, `EIP712 typed data tests`, `Vesting wallet tests`, `Contract clone tests`, `Merkle tree generators`, `ERC1155 behavior tests`, `Proxy deployment helpers`, `Governor behavior tests`, `Bytes utility tests`, `Account factory utilities`, `ERC20 permit tests`, `Token bridge mocks`, `Upgradeable contract tests`, `SafeERC20 tests`, `Mandate executor authorization`, `Contract lint configuration`, `Token transfer helpers`, `Test assertion helpers`, `Transparent proxy tests`, `Governor quorum tests`, `Governor counting tests`, `Account abstraction mocks`, `EIP7702 account tests`, `Reentrancy guard tests`, `Contract manifest tooling`, `ERC1155 receiver tests`, `Governor settings tests`, `Create2 deployment tests`, `Role management tests`, `Upgradeable proxy utilities`, `ERC721 wrapper tests`, `ERC20 flash mint tests`, `Short strings tests`, `Double ended queue tests`, `ERC20 wrapper tests`, `Account session policy`, `Governor timelock tests`, `Token vesting tests`, `Access control utilities`, `Signature checker tests`, `Token timelock tests`, `ERC1363 token tests`, `ERC4907 rental tests`, `Calldata decoding utilities`, `Account permission encoding`, `ERC2771 context tests`, `Token holder tests`, `EIP712 fixture generation`, `Packed data utilities`, `Governor proposal guards`, `Address utility tests`, `Governor votes tests`, `Contract package configuration`, `ERC5805 voting tests`, `Enumerable map tests`, `Base64 encoding tests`, `RSA signature tests`, `P256 cryptography tests`, `ERC1155 pausable tests`, `Token rescue tests`, `Cross chain message tests`, `Governor execution tests`, `ERC20 votes tests`, `ERC721 votes tests`, `Clones library tests`, `Multicall utility tests`, `Beacon proxy tests`, `Ownable two step`, `Authority interface tests`, `ERC721 URI storage`, `ERC1155 URI storage`, `Timers utility tests`, `Arrays utility tests`, `BitMaps utility tests`, `Comparators utility tests`, `Heap utility tests`, `Circular buffer tests`, `Panic utility tests`, `Nonces utility tests`, `Nonces keyed tests`, `Merkle tree tests`, `Commutative cryptography tests`, `Signature recovery tests`, `WebAuthn verification tests`, `ERC7913 signature tests`, `Account modules tests`, `Account execution tests`, `Governor core tests`, `Governor storage tests`, `Governor compatibility tests`, `Governor relay tests`, `Governor super quorum`, `Governor sequential proposal ids`, `Governor prevent late quorum`, `Governor timelock control`, `Governor timelock compound`, `Governor timelock access`?**
  _High betweenness centrality (0.122) - this node is a cross-community bridge._
- **Why does `chai` connect `Contract clone tests` to `Collection testing utilities`, `Bridge and access tests`, `Modular account tests`, `Cryptographic signing keys`, `OpenZeppelin package metadata`, `ERC20 behavior tests`, `Votes and clock tests`, `Governor nonce tests`, `Access control tests`, `Smart account behaviors`, `Account signature utilities`, `ERC721 behavior tests`, `Access scheduling predicates`, `EIP712 typed data tests`, `Vesting wallet tests`, `Ownership and burn tests`, `Merkle tree generators`, `ERC1155 behavior tests`, `Proxy deployment helpers`, `Governor behavior tests`, `Account factory utilities`, `ERC20 permit tests`, `Token bridge mocks`, `Upgradeable contract tests`, `SafeERC20 tests`, `Mandate executor authorization`, `Contract lint configuration`, `Token transfer helpers`, `Test assertion helpers`, `Transparent proxy tests`, `Governor quorum tests`, `Governor counting tests`, `Account abstraction mocks`, `EIP7702 account tests`, `Reentrancy guard tests`, `Contract manifest tooling`, `Governor settings tests`, `Create2 deployment tests`, `Role management tests`, `Upgradeable proxy utilities`, `ERC721 wrapper tests`, `API package configuration`, `ERC20 flash mint tests`, `Double ended queue tests`, `ERC20 wrapper tests`, `Account session policy`, `Governor timelock tests`, `Token vesting tests`, `Signature checker tests`, `Token timelock tests`, `ERC1363 token tests`, `ERC4907 rental tests`, `Calldata decoding utilities`, `Account permission encoding`, `ERC2771 context tests`, `Token holder tests`, `EIP712 fixture generation`, `Packed data utilities`, `Governor proposal guards`, `ERC20 temporary approval`, `Address utility tests`, `Governor votes tests`, `ERC5805 voting tests`, `Enumerable map tests`, `Base64 encoding tests`, `RSA signature tests`, `P256 cryptography tests`, `ERC1155 pausable tests`, `Token rescue tests`, `Cross chain message tests`, `Governor execution tests`, `ERC20 votes tests`, `ERC721 votes tests`, `Clones library tests`, `Multicall utility tests`, `Beacon proxy tests`, `Ownable two step`, `Authority interface tests`, `ERC721 URI storage`, `ERC1155 URI storage`, `Timers utility tests`, `Arrays utility tests`, `BitMaps utility tests`, `Comparators utility tests`, `Heap utility tests`, `Circular buffer tests`, `Panic utility tests`, `Nonces utility tests`, `Nonces keyed tests`, `Merkle tree tests`, `Commutative cryptography tests`, `Signature recovery tests`, `WebAuthn verification tests`, `ERC7913 signature tests`, `Account modules tests`, `Account execution tests`, `Governor core tests`, `Governor storage tests`, `Governor compatibility tests`, `Governor relay tests`, `Governor super quorum`, `Governor sequential proposal ids`, `Governor prevent late quorum`, `Governor timelock control`, `Governor timelock compound`, `Governor timelock access`?**
  _High betweenness centrality (0.105) - this node is a cross-community bridge._
- **What connects `crypto`, `http`, `fs` to the rest of the system?**
  _1612 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Forge cheatcode documentation` be split into smaller, more focused modules?**
  _Cohesion score 0.06327006327006326 - nodes in this community are weakly interconnected._
- **Should `Brainstorming companion server` be split into smaller, more focused modules?**
  _Cohesion score 0.05628415300546448 - nodes in this community are weakly interconnected._
- **Should `Collection testing utilities` be split into smaller, more focused modules?**
  _Cohesion score 0.053544494720965306 - nodes in this community are weakly interconnected._