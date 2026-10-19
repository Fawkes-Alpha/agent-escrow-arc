# AgentEscrow — USDC escrow for agent-to-agent payments on Arc

Built end to end in [Arc Studio](https://studio.arc.io) and deployed to **Arc mainnet**.

A client locks USDC in a contract against a named provider. The provider marks the work
delivered. The client approves and the money moves. If the client goes quiet, the
provider can claim after a review window. If the provider never delivers, the client
gets a refund after the deadline. Neither side can take the money unilaterally.

| | |
|---|---|
| **Live app** | **https://stunning-kangaroo-c3921a.netlify.app** |
| **Contract** | [`0xd7589da91061f2f27ac118b22fcc3822f569359c`](https://explorer.arc.io/address/0xd7589da91061f2f27ac118b22fcc3822f569359c) |
| **Network** | Arc mainnet, chainId 5042 |
| **Asset** | USDC `0x3600…0000`, 6 decimals via the ERC-20 interface |
| **Arc Studio project** | `https://studio.arc.io/app/5f13d241-ffb2-42c5-87e3-f9714aa3f82c` |
| **Tests** | 39 passing, written and run in Arc Studio |

---

## Proof: nine real transactions, three complete cycles

Every hash below is on Arc mainnet and moves or settles real USDC.

### Job #1 — 0.1 USDC

| Step | Block | Transaction |
|---|---|---|
| `createJob` | 26,581,500 | [`0xe3d90574…b516123`](https://explorer.arc.io/tx/0xe3d9057421e48c64c28c5f8d4dfc0af162238f588f4104b7e993a1186b516123) |
| `submitWork` | 26,583,487 | [`0x1b8865e9…2ac4961`](https://explorer.arc.io/tx/0x1b8865e90fd71c1d3ff467463fa8108fbc3179f9cc4ff3b2276b5724a2ac4961) |
| `approve` | 26,583,609 | [`0x457eb9a1…f4ef31f9`](https://explorer.arc.io/tx/0x457eb9a15f856b1dba7bbb36934dccfd0dcf125417529bf2340dd745f4ef31f9) |

### Job #2 — 0.05 USDC

| Step | Block | Transaction |
|---|---|---|
| `createJob` | 26,701,860 | [`0x2c2db05d…9d69d3f`](https://explorer.arc.io/tx/0x2c2db05dbb5e06248e8043b976406992efaffd72faefff432e72a39699d69d3f) |
| `submitWork` | 26,702,652 | [`0xddd8bb24…5fd42793`](https://explorer.arc.io/tx/0xddd8bb247df72d84b87c7e5629d97903b83c95dd8107f4ea3c7845fa5fd42793) |
| `approve` | 26,702,831 | [`0xf1a616e0…c6241ece`](https://explorer.arc.io/tx/0xf1a616e0f847c7b41500462099f993ff1823195edba413fb6915b1a4c6241ece) |

### Job #3 — 0.01 USDC — every step through the app

| Step | Block | Transaction |
|---|---|---|
| `createJob` | 26,705,336 | [`0xdb7d4b36…3f890ac6`](https://explorer.arc.io/tx/0xdb7d4b364559aeb1212d1f0968593ef02643cb37030c2c5221fcd5423f890ac6) |
| `submitWork` | 26,705,901 | [`0x1f6cf69f…02f40b47`](https://explorer.arc.io/tx/0x1f6cf69f3bf9b97d07beb33efe7417fe40c2bad6241bff0674f9af0802f40b47) |
| `approve` | 26,706,622 | [`0x320d437e…aa5afa39`](https://explorer.arc.io/tx/0x320d437e0f03faa46fbb894601a059ccc4d797fa4465bf8b7a5f94a5aa5afa39) |

After each cycle the contract holds **0 USDC**. Gas was identical across all three runs —
36,034 for `submitWork` and 67,961 for `approve` — same code path, same cost.

Contract deployment:
[`0x58d79434…2c8455d3`](https://explorer.arc.io/tx/0x58d79434c552b92f548726a735c4cbb4ce67674092fb8ded546fcd592c8455d3),
block 26,576,946, 837,070 gas, **0.01757847 USDC**.

Total cost of the entire experiment, deployment and all nine transactions: **under 0.03 USDC.**

---

## How the contract works

```
createJob(provider, amount, deadline)   client locks USDC   →  Funded
submitWork(jobId)                       provider delivers   →  Submitted
approve(jobId)                          client releases     →  Approved
refund(jobId)                           after deadline      →  Refunded   (Funded only)
claimTimeout(jobId)                     after review window →  Approved   (Submitted only)
```

Two guards decide who can take the money and when:

- **`refund` only accepts `Funded`.** Once work is submitted the client cannot wait out
  the deadline and claw the money back.
- **`submitWork` is blocked after the deadline.** Otherwise a provider could submit at the
  last block and lock the client's funds for the whole review window.

`REVIEW_BLOCKS = 5000`. Arc blocks are **0.506 s** — measured over 1,000 blocks, not
taken from docs — so the review window is about **42 minutes**.

---

## Arc-specific decisions

**USDC is the native gas currency and has two interfaces over one balance** — native at 18
decimals, ERC-20 at 6. The contract and the UI use the ERC-20 interface and read
`decimals()` rather than assuming 18.

**`block.timestamp` on Arc is non-decreasing but not strictly increasing**, so every
deadline in this contract is a **block number**, never a timestamp.

**`PREVRANDAO` always returns 0 on Arc**, so nothing here depends on on-chain randomness.

**Arc enforces a 20 Gwei minimum base fee** and silently drops anything below it — no
error, no receipt. The deploy script sets the fee to twice the floor. At deploy time the
network was at **21 Gwei**, just above the floor, so the limit is live, not theoretical.

**Compiled with `evmVersion: paris`**, not a newer target, to avoid the `PUSH0` opcode
in case Arc's EVM does not support it.

---

## How Arc Studio was used

| Stage | Where |
|---|---|
| Contract written and reviewed | Arc Studio |
| 39 tests, including fuzz suites | Arc Studio |
| Testnet deploys during development | Arc Studio, one click |
| Frontend | Arc Studio |
| **Mainnet deploy** | **Done by me, with my own key** — Arc Studio does not transact on mainnet |

Arc Studio's built-in review caught real issues. It is not an audit, and this code has
not had one.

### Four bugs found while building

**The review missed a rule, not a syntax error.** The first contract let `refund` accept
a `Submitted` job, so a client could take delivery and then reclaim the money at the
deadline. Tests passed, both audit subagents reported no findings — because it compiles
and behaves exactly as written. The fix added `claimTimeout` so a provider can collect
when the client goes quiet.

**State and event disagreed.** `claimTimeout` has a fallback that refunds the client if
paying the provider fails, but it left `status = Approved` while emitting `JobRefunded`.
Anything reading `getJob()` would have permanently disagreed with the event log. 39 tests
still passed, because the tests checked events and nobody compared them to state.

**The UI sent a relative deadline.** The input is labelled "blocks from now" and the app
passed that number straight through, while the contract expects an absolute block.
MetaMask simulated it and returned `0xbec00580` = `DeadlineInPast()`. That guard had been
added in the second review round and looked redundant at the time; without it the
transaction would have succeeded and created a job that was expired from birth.

**The app froze the browser tab after every transaction.** Four
`useWaitForTransactionReceipt` calls polled the RPC with no interval, plus one block-number
watcher per job card. Fixed with `pollingInterval: 1_000` and a single shared watcher.
Job #3 above is the first cycle run entirely in the UI after that fix.

---

## Run it yourself

```bash
bun install
cp .env.example .env     # only needed for Arc Studio's own deploy scripts
bun run dev
```

The frontend talks to `https://rpc.mainnet.arc.io` directly and has the contract address
compiled in, so it works without any credentials. Connect a wallet on Arc, and the UI will
show only the actions that wallet is actually allowed to take on each job.

Contract tests:

```bash
forge test
```

---

## What is not done

One contract, one job type, no partial payments and no milestones. No dispute resolution —
the only arbiter is the review window. No indexer, so the job list reads `jobCount` and
then calls `getJob` once per id, which will not scale past a few hundred jobs. The app
still leaves both action buttons showing "Done" after a transaction until the panel is
refreshed.

The contract has not been audited.

---

## Author

[@Fawkes_Alpha1](https://x.com/Fawkes_Alpha1) · [github.com/Fawkes-Alpha](https://github.com/Fawkes-Alpha)

Self-taught TypeScript developer in Hanoi, building on Arc since testnet.
