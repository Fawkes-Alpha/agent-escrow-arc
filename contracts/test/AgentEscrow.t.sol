// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {AgentEscrow} from "../AgentEscrow.sol";

// ─────────────────────────────────────────────────────────────
//  Standard MockERC20 — all AgentEscrow.sol entry points need
//  transfer, transferFrom, approve, balanceOf and mint.
//  Etched onto the canonical USDC address in setUp().
// ─────────────────────────────────────────────────────────────
contract MockERC20 {
    string  public name;
    string  public symbol;
    uint8   public decimals;

    mapping(address => uint256)                     private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;
    uint256 private _totalSupply;

    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name     = _name;
        symbol   = _symbol;
        decimals = _decimals;
    }

    function totalSupply() external view returns (uint256) { return _totalSupply; }
    function balanceOf(address account) external view returns (uint256) { return _balances[account]; }
    function allowance(address owner, address spender) external view returns (uint256) {
        return _allowances[owner][spender];
    }

    function mint(address to, uint256 amount) external {
        _balances[to] += amount;
        _totalSupply  += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        _allowances[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(_balances[msg.sender] >= amount, "ERC20: insufficient balance");
        _balances[msg.sender] -= amount;
        _balances[to]         += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(_balances[from] >= amount, "ERC20: insufficient balance");
        require(_allowances[from][msg.sender] >= amount, "ERC20: insufficient allowance");
        _allowances[from][msg.sender] -= amount;
        _balances[from]               -= amount;
        _balances[to]                 += amount;
        return true;
    }
}

// ─────────────────────────────────────────────────────────────
//  SelectiveFailMockERC20 — identical to MockERC20 except
//  transfer() returns false when the recipient matches the
//  configured `blocklisted` address.  Used for the
//  test_ClaimTimeout_FallsBackToClientOnProviderTransferFail
//  test to simulate a USDC blocklist hit on the provider.
// ─────────────────────────────────────────────────────────────
contract SelectiveFailMockERC20 {
    string  public name;
    string  public symbol;
    uint8   public decimals;

    mapping(address => uint256)                     private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;
    uint256 private _totalSupply;

    address public blocklisted; // transfer to this address returns false

    constructor(string memory _name, string memory _symbol, uint8 _decimals, address _blocklisted) {
        name        = _name;
        symbol      = _symbol;
        decimals    = _decimals;
        blocklisted = _blocklisted;
    }

    function totalSupply() external view returns (uint256) { return _totalSupply; }
    function balanceOf(address account) external view returns (uint256) { return _balances[account]; }
    function allowance(address owner, address spender) external view returns (uint256) {
        return _allowances[owner][spender];
    }

    function mint(address to, uint256 amount) external {
        _balances[to] += amount;
        _totalSupply  += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        _allowances[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        // Simulate blocklist: return false without moving tokens.
        if (to == blocklisted) return false;
        require(_balances[msg.sender] >= amount, "ERC20: insufficient balance");
        _balances[msg.sender] -= amount;
        _balances[to]         += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(_balances[from] >= amount, "ERC20: insufficient balance");
        require(_allowances[from][msg.sender] >= amount, "ERC20: insufficient allowance");
        _allowances[from][msg.sender] -= amount;
        _balances[from]               -= amount;
        _balances[to]                 += amount;
        return true;
    }
}

// ─────────────────────────────────────────────────────────────
//  Test suite
// ─────────────────────────────────────────────────────────────
contract AgentEscrowTest is Test {

    // The address hardcoded inside AgentEscrow.
    address internal constant USDC_ADDR = 0x3600000000000000000000000000000000000000;

    AgentEscrow internal escrow;
    MockERC20   internal usdc;      // bound handle at the canonical address

    address internal client   = makeAddr("client");
    address internal provider = makeAddr("provider");
    address internal stranger = makeAddr("stranger");

    uint256 internal constant JOB_AMOUNT  = 1_000e6;   // 1 000 USDC (6-dec)

    // A far-future deadline: block.number at forge test start is typically 1,
    // so type(uint64).max is always > block.number and is safe for any test
    // that does NOT deliberately roll past a deadline.
    uint64  internal constant FAR_DEADLINE = type(uint64).max;

    // A safe near-future deadline offset: used wherever a createJob call must
    // succeed and the test does NOT subsequently roll past the deadline.
    uint64 internal constant NEAR_OFFSET = 100;

    // REVIEW_BLOCKS mirrors AgentEscrow.REVIEW_BLOCKS (5 000 blocks).
    uint64 internal constant REVIEW_BLOCKS = 5_000;

    // ── setUp ──────────────────────────────────────────────────
    // Runs before EVERY test; forge reverts state between tests.
    function setUp() public {
        // 1. Deploy the mock at a scratch address to obtain its runtime bytecode.
        MockERC20 scratch = new MockERC20("Mock USDC", "mUSDC", 6);

        // 2. Copy that runtime bytecode to the canonical USDC constant address.
        //    vm.etch does NOT copy storage — balances start at zero.
        vm.etch(USDC_ADDR, address(scratch).code);

        // 3. Bind the typed handle at the canonical address.
        usdc = MockERC20(USDC_ADDR);

        // 4. Seed the client with tokens via mint on the bound handle.
        usdc.mint(client, 100_000e6);

        // 5. Deploy the contract under test.
        escrow = new AgentEscrow();

        // 6. Client pre-approves the escrow to pull tokens.
        vm.prank(client);
        usdc.approve(address(escrow), type(uint256).max);
    }

    // ── Internal helpers ──────────────────────────────────────

    /// @dev Create a funded job.  deadline must be > block.number.
    function _createJob(uint64 deadline) internal returns (uint256 jobId) {
        vm.prank(client);
        jobId = escrow.createJob(provider, JOB_AMOUNT, deadline);
    }

    /// @dev Create a job at a safe future deadline (block.number + NEAR_OFFSET).
    function _createJobNear() internal returns (uint256 jobId, uint64 deadline) {
        deadline = uint64(block.number) + NEAR_OFFSET;
        jobId    = _createJob(deadline);
    }

    /// @dev Create job → submitWork.  Returns jobId and the reviewDeadline
    ///      that was set by submitWork (block.number + REVIEW_BLOCKS).
    function _createAndSubmit() internal returns (uint256 jobId, uint64 reviewDeadline) {
        // Deadline must survive submitWork without having passed.
        // submitWork is called at current block, so deadline = block.number + NEAR_OFFSET is safe.
        (jobId, ) = _createJobNear();
        reviewDeadline = uint64(block.number) + REVIEW_BLOCKS;
        vm.prank(provider);
        escrow.submitWork(jobId);
    }

    // ═══════════════════════════════════════════════════════════
    // 1.  DEPLOYMENT & INITIALIZATION
    // ═══════════════════════════════════════════════════════════

    function test_InitialJobCountIsZero() public view {
        assertEq(escrow.jobCount(), 0, "jobCount should start at 0");
    }

    function test_UsdcConstantIsCorrectAddress() public view {
        assertEq(address(escrow.usdc()), USDC_ADDR, "usdc constant mismatch");
    }

    // ═══════════════════════════════════════════════════════════
    // 2.  createJob — happy path
    // ═══════════════════════════════════════════════════════════

    function test_CreateJob_StoresJobCorrectly() public {
        uint256 clientBefore = usdc.balanceOf(client);
        uint64  deadline     = uint64(block.number) + NEAR_OFFSET;

        vm.prank(client);
        uint256 jobId = escrow.createJob(provider, JOB_AMOUNT, deadline);

        AgentEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(jobId,             1,          "first jobId should be 1");
        assertEq(job.client,        client,     "client mismatch");
        assertEq(job.provider,      provider,   "provider mismatch");
        assertEq(job.amount,        JOB_AMOUNT, "amount mismatch");
        assertEq(job.deadline,      deadline,   "deadline mismatch");
        assertEq(job.reviewDeadline, 0,         "reviewDeadline should be 0 before submitWork");
        assertEq(uint8(job.status), 0,          "status should be Funded(0)");

        // USDC transferred into the escrow.
        assertEq(usdc.balanceOf(address(escrow)), JOB_AMOUNT,                "escrow balance wrong");
        assertEq(usdc.balanceOf(client),          clientBefore - JOB_AMOUNT, "client balance wrong");
    }

    function test_CreateJob_IncrementsJobCount() public {
        uint64 dl = uint64(block.number) + NEAR_OFFSET;
        _createJob(dl);
        assertEq(escrow.jobCount(), 1);
        _createJob(dl);
        assertEq(escrow.jobCount(), 2);
    }

    function test_CreateJob_EmitsJobCreated() public {
        uint64 deadline = uint64(block.number) + NEAR_OFFSET;
        vm.prank(client);
        vm.expectEmit(true, true, true, true, address(escrow));
        emit AgentEscrow.JobCreated(1, client, provider, JOB_AMOUNT, deadline);
        escrow.createJob(provider, JOB_AMOUNT, deadline);
    }

    function test_CreateJob_RevertsOnZeroProvider() public {
        vm.prank(client);
        vm.expectRevert(AgentEscrow.ZeroAddress.selector);
        escrow.createJob(address(0), JOB_AMOUNT, FAR_DEADLINE);
    }

    function test_CreateJob_RevertsOnZeroAmount() public {
        vm.prank(client);
        vm.expectRevert(AgentEscrow.ZeroAmount.selector);
        escrow.createJob(provider, 0, FAR_DEADLINE);
    }

    /// @dev NEW (change #2): deadline == block.number → DeadlineInPast()
    function test_CreateJob_RevertsOnPastDeadline() public {
        uint64 deadline = uint64(block.number); // equal to block.number → <= condition triggered
        vm.prank(client);
        vm.expectRevert(AgentEscrow.DeadlineInPast.selector);
        escrow.createJob(provider, JOB_AMOUNT, deadline);
    }

    // ═══════════════════════════════════════════════════════════
    // 3.  submitWork — happy path
    // ═══════════════════════════════════════════════════════════

    function test_SubmitWork_ChangesStatusToSubmitted() public {
        uint256 jobId = _createJob(FAR_DEADLINE);

        vm.prank(provider);
        escrow.submitWork(jobId);

        AgentEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(uint8(job.status), 1, "status should be Submitted(1)");
    }

    function test_SubmitWork_SetsReviewDeadline() public {
        uint256 jobId = _createJob(FAR_DEADLINE);
        uint64  expectedReviewDeadline = uint64(block.number) + REVIEW_BLOCKS;

        vm.prank(provider);
        escrow.submitWork(jobId);

        AgentEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(job.reviewDeadline, expectedReviewDeadline, "reviewDeadline mismatch after submitWork");
    }

    function test_SubmitWork_EmitsWorkSubmitted() public {
        uint256 jobId = _createJob(FAR_DEADLINE);

        vm.prank(provider);
        vm.expectEmit(true, true, true, true, address(escrow));
        emit AgentEscrow.WorkSubmitted(jobId, client, provider, JOB_AMOUNT);
        escrow.submitWork(jobId);
    }

    /// @dev block.number > job.deadline → DeadlinePassed()
    function test_SubmitWork_RevertsAfterDeadline() public {
        // Use a near deadline so we can roll past it.
        uint64 deadline = uint64(block.number) + 2;
        uint256 jobId = _createJob(deadline);

        // Roll one block past the deadline.
        vm.roll(uint256(deadline) + 1);

        vm.prank(provider);
        vm.expectRevert(AgentEscrow.DeadlinePassed.selector);
        escrow.submitWork(jobId);
    }

    // ═══════════════════════════════════════════════════════════
    // 4.  approve — happy path
    // ═══════════════════════════════════════════════════════════

    /// @dev Scenario 1: createJob → submitWork → approve
    ///      USDC must land in provider's wallet; status must be Approved.
    function test_Approve_HappyPath_TransfersToProviderAndSetsApproved() public {
        uint256 providerBefore = usdc.balanceOf(provider);

        uint256 jobId = _createJob(FAR_DEADLINE);

        vm.prank(provider);
        escrow.submitWork(jobId);

        vm.prank(client);
        escrow.approve(jobId);

        AgentEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(uint8(job.status), 2, "status should be Approved(2)");
        assertEq(usdc.balanceOf(provider), providerBefore + JOB_AMOUNT, "provider did not receive USDC");
        assertEq(usdc.balanceOf(address(escrow)), 0, "escrow should be empty after approve");
    }

    function test_Approve_EmitsJobApproved() public {
        uint256 jobId = _createJob(FAR_DEADLINE);
        vm.prank(provider);
        escrow.submitWork(jobId);

        vm.prank(client);
        vm.expectEmit(true, true, true, true, address(escrow));
        emit AgentEscrow.JobApproved(jobId, client, provider, JOB_AMOUNT);
        escrow.approve(jobId);
    }

    // ═══════════════════════════════════════════════════════════
    // 5.  refund — happy path
    // ═══════════════════════════════════════════════════════════

    /// @dev Scenario 2: createJob (near deadline), roll past it,
    ///      refund — USDC back to client, status = Refunded.
    ///      The job must still be Funded (never submitted) for refund to work.
    function test_Refund_AfterDeadline_ReturnsUsdcToClient() public {
        uint64 deadline = uint64(block.number) + 1;
        uint256 clientBefore = usdc.balanceOf(client);

        uint256 jobId = _createJob(deadline);
        uint256 clientAfterCreate = usdc.balanceOf(client);
        assertEq(clientAfterCreate, clientBefore - JOB_AMOUNT, "client balance after createJob");

        // Roll to a block that satisfies block.number >= deadline.
        vm.roll(deadline);

        vm.prank(client);
        escrow.refund(jobId);

        AgentEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(uint8(job.status), 3, "status should be Refunded(3)");
        assertEq(usdc.balanceOf(client), clientBefore, "client should be fully refunded");
        assertEq(usdc.balanceOf(address(escrow)), 0, "escrow should be empty after refund");
    }

    function test_Refund_EmitsJobRefunded() public {
        uint64 deadline = uint64(block.number) + 1;
        uint256 jobId = _createJob(deadline);
        vm.roll(deadline);

        vm.prank(client);
        vm.expectEmit(true, true, true, true, address(escrow));
        emit AgentEscrow.JobRefunded(jobId, client, provider, JOB_AMOUNT);
        escrow.refund(jobId);
    }

    // ═══════════════════════════════════════════════════════════
    // 6.  ACCESS-CONTROL REVERTS
    // ═══════════════════════════════════════════════════════════

    /// @dev Scenario 3: submitWork called by non-provider → NotProvider()
    function test_SubmitWork_RevertsForNonProvider() public {
        uint256 jobId = _createJob(FAR_DEADLINE);

        vm.prank(stranger);
        vm.expectRevert(AgentEscrow.NotProvider.selector);
        escrow.submitWork(jobId);
    }

    /// @dev Scenario 3 variant: client calling submitWork is also not the provider.
    function test_SubmitWork_RevertsWhenCalledByClient() public {
        uint256 jobId = _createJob(FAR_DEADLINE);

        vm.prank(client);
        vm.expectRevert(AgentEscrow.NotProvider.selector);
        escrow.submitWork(jobId);
    }

    /// @dev Scenario 4: approve called by non-client → NotClient()
    function test_Approve_RevertsForNonClient() public {
        uint256 jobId = _createJob(FAR_DEADLINE);
        vm.prank(provider);
        escrow.submitWork(jobId);

        vm.prank(stranger);
        vm.expectRevert(AgentEscrow.NotClient.selector);
        escrow.approve(jobId);
    }

    /// @dev Scenario 4 variant: provider calling approve is also not the client.
    function test_Approve_RevertsWhenCalledByProvider() public {
        uint256 jobId = _createJob(FAR_DEADLINE);
        vm.prank(provider);
        escrow.submitWork(jobId);

        vm.prank(provider);
        vm.expectRevert(AgentEscrow.NotClient.selector);
        escrow.approve(jobId);
    }

    function test_Refund_RevertsForNonClient() public {
        uint64 deadline = uint64(block.number) + 1;
        uint256 jobId = _createJob(deadline);
        vm.roll(deadline);

        vm.prank(stranger);
        vm.expectRevert(AgentEscrow.NotClient.selector);
        escrow.refund(jobId);
    }

    // ═══════════════════════════════════════════════════════════
    // 7.  INVALID-STATUS REVERTS
    // ═══════════════════════════════════════════════════════════

    function test_Approve_RevertsWhenStatusIsFunded() public {
        uint256 jobId = _createJob(FAR_DEADLINE);
        // Job is Funded, not Submitted → InvalidStatus
        vm.prank(client);
        vm.expectRevert(AgentEscrow.InvalidStatus.selector);
        escrow.approve(jobId);
    }

    function test_SubmitWork_RevertsWhenStatusIsSubmitted() public {
        uint256 jobId = _createJob(FAR_DEADLINE);
        vm.prank(provider);
        escrow.submitWork(jobId);

        // Calling submitWork again → InvalidStatus (already Submitted)
        vm.prank(provider);
        vm.expectRevert(AgentEscrow.InvalidStatus.selector);
        escrow.submitWork(jobId);
    }

    function test_SubmitWork_RevertsWhenStatusIsApproved() public {
        uint256 jobId = _createJob(FAR_DEADLINE);
        vm.prank(provider);
        escrow.submitWork(jobId);
        vm.prank(client);
        escrow.approve(jobId);

        // Approved → submitWork should revert InvalidStatus
        vm.prank(provider);
        vm.expectRevert(AgentEscrow.InvalidStatus.selector);
        escrow.submitWork(jobId);
    }

    /// @dev NEW (change #4): refund on a Submitted job → InvalidStatus()
    ///      (Previously some tests may have expected this to succeed; the contract
    ///       now requires status == Funded for refund.)
    function test_Refund_RevertsOnSubmittedJob() public {
        // Near deadline so we can roll to it after submitWork if needed,
        // but here we roll past deadline first, then discover it's Submitted.
        uint64 deadline = uint64(block.number) + NEAR_OFFSET;
        uint256 jobId = _createJob(deadline);

        vm.prank(provider);
        escrow.submitWork(jobId);

        // Roll past the deadline so refund's block.number check is satisfied;
        // the InvalidStatus check comes before the deadline check in the contract
        // but we satisfy both to isolate the status gate.
        vm.roll(uint256(deadline) + 1);

        vm.prank(client);
        vm.expectRevert(AgentEscrow.InvalidStatus.selector);
        escrow.refund(jobId);
    }

    // ═══════════════════════════════════════════════════════════
    // 8.  DeadlineNotReached revert — refund
    // ═══════════════════════════════════════════════════════════

    /// @dev Scenario 5: refund called before deadline → DeadlineNotReached()
    function test_Refund_RevertsBeforeDeadline() public {
        // Deadline is far in the future so block.number < deadline.
        uint256 jobId = _createJob(FAR_DEADLINE);

        vm.prank(client);
        vm.expectRevert(AgentEscrow.DeadlineNotReached.selector);
        escrow.refund(jobId);
    }

    /// @dev Refund at exactly block.number == deadline should SUCCEED (boundary).
    function test_Refund_SucceedsAtExactDeadlineBlock() public {
        uint64 deadline = uint64(block.number) + 5;
        uint256 jobId = _createJob(deadline);
        vm.roll(deadline); // block.number == deadline → condition satisfied

        vm.prank(client);
        escrow.refund(jobId); // must not revert

        assertEq(uint8(escrow.getJob(jobId).status), 3, "status should be Refunded");
    }

    // ═══════════════════════════════════════════════════════════
    // 9.  InvalidStatus on refund of finished jobs
    // ═══════════════════════════════════════════════════════════

    /// @dev Scenario 6: refund on an Approved job → InvalidStatus()
    function test_Refund_RevertsOnApprovedJob() public {
        uint256 jobId = _createJob(FAR_DEADLINE);
        vm.prank(provider);
        escrow.submitWork(jobId);
        vm.prank(client);
        escrow.approve(jobId);

        // Job is now Approved; refund must revert regardless of block number.
        vm.roll(uint256(FAR_DEADLINE));
        vm.prank(client);
        vm.expectRevert(AgentEscrow.InvalidStatus.selector);
        escrow.refund(jobId);
    }

    /// @dev Double-refund: second refund on a Refunded job → InvalidStatus()
    function test_Refund_RevertsOnAlreadyRefundedJob() public {
        uint64 deadline = uint64(block.number) + 1;
        uint256 jobId = _createJob(deadline);
        vm.roll(deadline);

        vm.prank(client);
        escrow.refund(jobId); // first refund succeeds

        vm.prank(client);
        vm.expectRevert(AgentEscrow.InvalidStatus.selector);
        escrow.refund(jobId); // second must revert
    }

    // ═══════════════════════════════════════════════════════════
    // 10.  claimTimeout — NEW (change #5)
    // ═══════════════════════════════════════════════════════════

    /// @dev (a) Happy path: createJob → submitWork → roll to reviewDeadline →
    ///      claimTimeout → provider receives USDC, status = Approved.
    function test_ClaimTimeout_ProviderReceivesUSDC() public {
        uint256 providerBefore = usdc.balanceOf(provider);
        (uint256 jobId, uint64 reviewDeadline) = _createAndSubmit();

        // Roll to exactly the reviewDeadline so block.number >= reviewDeadline.
        vm.roll(reviewDeadline);

        vm.prank(provider);
        escrow.claimTimeout(jobId);

        AgentEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(uint8(job.status), 2, "status should be Approved(2)");
        assertEq(usdc.balanceOf(provider), providerBefore + JOB_AMOUNT, "provider should have received USDC");
        assertEq(usdc.balanceOf(address(escrow)), 0, "escrow should be empty");
    }

    /// @dev claimTimeout happy path also emits JobApproved.
    function test_ClaimTimeout_EmitsJobApproved() public {
        (uint256 jobId, uint64 reviewDeadline) = _createAndSubmit();
        vm.roll(reviewDeadline);

        vm.prank(provider);
        vm.expectEmit(true, true, true, true, address(escrow));
        emit AgentEscrow.JobApproved(jobId, client, provider, JOB_AMOUNT);
        escrow.claimTimeout(jobId);
    }

    /// @dev (b) block.number < reviewDeadline → DeadlineNotReached()
    function test_ClaimTimeout_RevertsBeforeReviewDeadline() public {
        (uint256 jobId, uint64 reviewDeadline) = _createAndSubmit();

        // Stay one block before reviewDeadline.
        vm.roll(uint256(reviewDeadline) - 1);

        vm.prank(provider);
        vm.expectRevert(AgentEscrow.DeadlineNotReached.selector);
        escrow.claimTimeout(jobId);
    }

    /// @dev (c) Non-provider caller → NotProvider()
    function test_ClaimTimeout_RevertsForNonProvider() public {
        (uint256 jobId, uint64 reviewDeadline) = _createAndSubmit();
        vm.roll(reviewDeadline);

        vm.prank(stranger);
        vm.expectRevert(AgentEscrow.NotProvider.selector);
        escrow.claimTimeout(jobId);
    }

    /// @dev (d) Status is Funded (never submitted) → InvalidStatus()
    function test_ClaimTimeout_RevertsWhenStatusFunded() public {
        uint256 jobId = _createJob(FAR_DEADLINE);
        // Job is Funded; reviewDeadline is 0 — roll to a large block just in case
        // to ensure any deadline check wouldn't mask the status check.
        vm.roll(REVIEW_BLOCKS + 1);

        vm.prank(provider);
        vm.expectRevert(AgentEscrow.InvalidStatus.selector);
        escrow.claimTimeout(jobId);
    }

    /// @dev (e) Provider is blocklisted: transfer to provider returns false →
    ///      status = Approved, JobRefunded emitted, client receives USDC.
    ///
    ///      Approach: etch SelectiveFailMockERC20 (which returns false when
    ///      `to == provider`) onto USDC_ADDR.  The escrow's claimTimeout tries
    ///      transfer(provider, ...) first; that returns false, so it falls back
    ///      to transfer(client, ...) which succeeds.
    function test_ClaimTimeout_FallsBackToClientOnProviderTransferFail() public {
        // ── Re-etch the selective-fail mock onto USDC_ADDR ──────────────
        // The blocklisted address is `provider`.
        SelectiveFailMockERC20 failMock = new SelectiveFailMockERC20(
            "Fail USDC", "fUSDC", 6, provider
        );
        vm.etch(USDC_ADDR, address(failMock).code);

        // After etch, storage is wiped — re-seed client balance and re-approve.
        // We must use the SelectiveFailMockERC20 interface at USDC_ADDR.
        SelectiveFailMockERC20 failUsdc = SelectiveFailMockERC20(USDC_ADDR);
        failUsdc.mint(client, 100_000e6);

        vm.prank(client);
        failUsdc.approve(address(escrow), type(uint256).max);

        // ── Create job & submit (using direct calls since helper uses the old
        //    `usdc` handle and setUp state, which is still valid at USDC_ADDR) ──
        uint64 deadline = uint64(block.number) + NEAR_OFFSET;
        vm.prank(client);
        uint256 jobId = escrow.createJob(provider, JOB_AMOUNT, deadline);

        // blocklisted field in SelectiveFailMockERC20 is stored at slot 0 of
        // the mock's *storage* layout — but vm.etch only copies bytecode, not
        // storage.  The constructor that set `blocklisted` ran on a different
        // address; USDC_ADDR storage is fresh.  We must set the blocklisted
        // slot on USDC_ADDR's storage directly via vm.store.
        //
        // SelectiveFailMockERC20 storage layout (in order of declaration):
        //   slot 0: name  (string, dynamic → 32-byte length slot)
        //   slot 1: symbol
        //   slot 2: decimals (uint8, packed at offset 0 of slot 2)
        //   slot 3: _balances mapping
        //   slot 4: _allowances mapping
        //   slot 5: _totalSupply
        //   slot 6: blocklisted (address, 20 bytes, packed at offset 0 of slot 6)
        //
        // We use vm.store to write the provider address into slot 6.
        vm.store(USDC_ADDR, bytes32(uint256(6)), bytes32(uint256(uint160(provider))));

        vm.prank(provider);
        escrow.submitWork(jobId);

        uint64 reviewDeadline = uint64(block.number) + REVIEW_BLOCKS;
        vm.roll(reviewDeadline);

        uint256 clientBefore = failUsdc.balanceOf(client);

        vm.prank(provider);
        vm.expectEmit(true, true, true, true, address(escrow));
        emit AgentEscrow.JobRefunded(jobId, client, provider, JOB_AMOUNT);
        escrow.claimTimeout(jobId);

        AgentEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(uint8(job.status), 3, "status should be Refunded(3) on provider-transfer fallback");
        assertEq(failUsdc.balanceOf(client), clientBefore + JOB_AMOUNT, "client should receive USDC on fallback");
        assertEq(failUsdc.balanceOf(provider), 0, "provider should NOT receive USDC when blocklisted");
        assertEq(failUsdc.balanceOf(address(escrow)), 0, "escrow should be empty");
    }

    /// @dev New test: when the provider transfer returns false, both the status
    ///      must be Refunded (not Approved) AND the client must receive the USDC.
    ///
    ///      Setup: create job → submitWork → roll to reviewDeadline.
    ///      Mechanism: re-etch SelectiveFailMockERC20 (provider blocklisted) so
    ///      transfer(provider, …) returns false.  claimTimeout then executes the
    ///      fallback path which must set status = Refunded before transferring to
    ///      the client.
    function test_ClaimTimeout_FallbackSetsStatusRefunded() public {
        // ── Re-etch the selective-fail mock; provider is the blocklisted address ──
        SelectiveFailMockERC20 failMock = new SelectiveFailMockERC20(
            "Fail USDC", "fUSDC", 6, provider
        );
        vm.etch(USDC_ADDR, address(failMock).code);

        // After etch storage is wiped — re-seed and re-approve.
        SelectiveFailMockERC20 failUsdc = SelectiveFailMockERC20(USDC_ADDR);
        failUsdc.mint(client, 100_000e6);
        vm.prank(client);
        failUsdc.approve(address(escrow), type(uint256).max);

        // Write the `blocklisted` slot (slot 6) on USDC_ADDR's storage so the
        // transfer check inside the etched bytecode actually blocks `provider`.
        vm.store(USDC_ADDR, bytes32(uint256(6)), bytes32(uint256(uint160(provider))));

        // ── Create job → submitWork ──────────────────────────────────────────
        uint64 deadline = uint64(block.number) + NEAR_OFFSET;
        vm.prank(client);
        uint256 jobId = escrow.createJob(provider, JOB_AMOUNT, deadline);

        vm.prank(provider);
        escrow.submitWork(jobId);

        // ── Roll to reviewDeadline ───────────────────────────────────────────
        uint64 reviewDeadline = uint64(block.number) + REVIEW_BLOCKS;
        vm.roll(reviewDeadline);

        uint256 clientBefore = failUsdc.balanceOf(client);

        // ── claimTimeout: provider transfer fails → fallback to client ───────
        vm.prank(provider);
        escrow.claimTimeout(jobId);

        // Status must be Refunded (3), NOT Approved (2).
        AgentEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(uint8(job.status), 3, "status must be Refunded(3) after fallback");

        // Client must have received the escrowed USDC.
        assertEq(failUsdc.balanceOf(client), clientBefore + JOB_AMOUNT, "client must receive USDC");
        assertEq(failUsdc.balanceOf(address(escrow)), 0, "escrow must be empty");
    }

    // ═══════════════════════════════════════════════════════════
    // 11.  FUZZ: createJob amount
    // ═══════════════════════════════════════════════════════════

    /// @dev For any non-zero amount up to the client's seeded balance,
    ///      createJob must succeed and the escrow must hold exactly that amount.
    function testFuzz_CreateJob_EscrowHoldsExactAmount(uint256 amount) public {
        amount = bound(amount, 1, usdc.balanceOf(client));

        vm.prank(client);
        uint256 jobId = escrow.createJob(provider, amount, FAR_DEADLINE);

        assertEq(usdc.balanceOf(address(escrow)), amount);
        assertEq(escrow.getJob(jobId).amount, amount);
    }

    /// @dev Full lifecycle with fuzzed amount: create → submit → approve.
    ///      Provider must receive exactly the fuzzed amount.
    function testFuzz_FullLifecycle_ProviderReceivesExactAmount(uint256 amount) public {
        amount = bound(amount, 1, usdc.balanceOf(client));
        uint256 providerBefore = usdc.balanceOf(provider);

        vm.prank(client);
        uint256 jobId = escrow.createJob(provider, amount, FAR_DEADLINE);

        vm.prank(provider);
        escrow.submitWork(jobId);

        vm.prank(client);
        escrow.approve(jobId);

        assertEq(usdc.balanceOf(provider), providerBefore + amount);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    // ═══════════════════════════════════════════════════════════
    // 12.  FUZZ: refund after deadline
    // ═══════════════════════════════════════════════════════════

    /// @dev For any deadline in [block.number+1, block.number+10_000] and any
    ///      valid amount, rolling to the deadline and refunding (while status is
    ///      still Funded) returns exactly that amount to the client.
    function testFuzz_Refund_ReturnsExactAmountToClient(uint256 amount, uint64 deadlineOffset) public {
        amount         = bound(amount, 1, usdc.balanceOf(client));
        deadlineOffset = uint64(bound(deadlineOffset, 1, 10_000));

        uint64 deadline = uint64(block.number) + deadlineOffset;
        uint256 clientBefore = usdc.balanceOf(client);

        vm.prank(client);
        uint256 jobId = escrow.createJob(provider, amount, deadline);

        vm.roll(deadline);

        vm.prank(client);
        escrow.refund(jobId);

        assertEq(usdc.balanceOf(client), clientBefore, "client not fully refunded");
        assertEq(usdc.balanceOf(address(escrow)), 0,   "escrow not empty");
    }

    // ═══════════════════════════════════════════════════════════
    // 13.  FUZZ: claimTimeout provider receives amount
    // ═══════════════════════════════════════════════════════════

    /// @dev For any valid amount, the full claimTimeout happy path results in
    ///      the provider receiving exactly that amount.
    function testFuzz_ClaimTimeout_ProviderReceivesExactAmount(uint256 amount) public {
        amount = bound(amount, 1, usdc.balanceOf(client));
        uint256 providerBefore = usdc.balanceOf(provider);

        uint64 deadline = uint64(block.number) + NEAR_OFFSET;
        vm.prank(client);
        uint256 jobId = escrow.createJob(provider, amount, deadline);

        uint64 reviewDeadline = uint64(block.number) + REVIEW_BLOCKS;
        vm.prank(provider);
        escrow.submitWork(jobId);

        vm.roll(reviewDeadline);
        vm.prank(provider);
        escrow.claimTimeout(jobId);

        assertEq(usdc.balanceOf(provider), providerBefore + amount, "provider amount mismatch");
        assertEq(usdc.balanceOf(address(escrow)), 0, "escrow not empty");
    }
}
