// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract AgentEscrow {
    error NotProvider();
    error NotClient();
    error InvalidStatus();
    error DeadlineNotReached();
    error DeadlinePassed();
    error ZeroAddress();
    error ZeroAmount();
    error DeadlineInPast();
    error TransferFailed();

    enum Status {
        Funded,
        Submitted,
        Approved,
        Refunded
    }

    struct Job {
        address client;
        address provider;
        uint256 amount;
        uint64 deadline;
        uint64 reviewDeadline;
        Status status;
    }

    IERC20 public constant usdc = IERC20(0x3600000000000000000000000000000000000000);
    uint64 public constant REVIEW_BLOCKS = 5000;

    mapping(uint256 => Job) public jobs;
    uint256 public jobCount;

    event JobCreated(
        uint256 indexed jobId,
        address indexed client,
        address indexed provider,
        uint256 amount,
        uint64 deadline
    );
    event WorkSubmitted(uint256 indexed jobId, address indexed client, address indexed provider, uint256 amount);
    event JobApproved(uint256 indexed jobId, address indexed client, address indexed provider, uint256 amount);
    event JobRefunded(uint256 indexed jobId, address indexed client, address indexed provider, uint256 amount);

    function createJob(address provider, uint256 amount, uint64 deadline) external returns (uint256 jobId) {
        if (provider == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (deadline <= block.number) revert DeadlineInPast();

        jobId = ++jobCount;
        jobs[jobId] = Job({
            client: msg.sender,
            provider: provider,
            amount: amount,
            deadline: deadline,
            reviewDeadline: 0,
            status: Status.Funded
        });

        if (!usdc.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();

        emit JobCreated(jobId, msg.sender, provider, amount, deadline);
    }

    function submitWork(uint256 jobId) external {
        Job storage job = jobs[jobId];
        if (block.number > job.deadline) revert DeadlinePassed();
        if (msg.sender != job.provider) revert NotProvider();
        if (job.status != Status.Funded) revert InvalidStatus();

        job.status = Status.Submitted;
        job.reviewDeadline = uint64(block.number) + REVIEW_BLOCKS;
        emit WorkSubmitted(jobId, job.client, job.provider, job.amount);
    }

    function approve(uint256 jobId) external {
        Job storage job = jobs[jobId];
        if (msg.sender != job.client) revert NotClient();
        if (job.status != Status.Submitted) revert InvalidStatus();

        job.status = Status.Approved;
        if (!usdc.transfer(job.provider, job.amount)) revert TransferFailed();

        emit JobApproved(jobId, job.client, job.provider, job.amount);
    }

    function refund(uint256 jobId) external {
        Job storage job = jobs[jobId];
        if (msg.sender != job.client) revert NotClient();
        if (job.status != Status.Funded) revert InvalidStatus();
        if (block.number < job.deadline) revert DeadlineNotReached();

        job.status = Status.Refunded;
        if (!usdc.transfer(job.client, job.amount)) revert TransferFailed();

        emit JobRefunded(jobId, job.client, job.provider, job.amount);
    }

    function claimTimeout(uint256 jobId) external {
        Job storage job = jobs[jobId];
        if (msg.sender != job.provider) revert NotProvider();
        if (job.status != Status.Submitted) revert InvalidStatus();
        if (block.number < job.reviewDeadline) revert DeadlineNotReached();

        job.status = Status.Approved;

        // Attempt to pay the provider; fall back to refunding the client
        // if the provider address is blocklisted on Arc USDC.
        try usdc.transfer(job.provider, job.amount) returns (bool ok) {
            if (!ok) {
                // transfer returned false — refund the client
                job.status = Status.Refunded;
                if (!usdc.transfer(job.client, job.amount)) revert TransferFailed();
                emit JobRefunded(jobId, job.client, job.provider, job.amount);
                return;
            }
        } catch {
            // transfer reverted — refund the client
            job.status = Status.Refunded;
            if (!usdc.transfer(job.client, job.amount)) revert TransferFailed();
            emit JobRefunded(jobId, job.client, job.provider, job.amount);
            return;
        }

        emit JobApproved(jobId, job.client, job.provider, job.amount);
    }

    function getJob(uint256 jobId) external view returns (Job memory) {
        return jobs[jobId];
    }
}
