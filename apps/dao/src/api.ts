export type Mode = "local-demo" | "near-testnet";
export type Bucket = "rewards" | "agents";
export type Action =
  | { kind: "update_policy"; value: { policy: Policy } }
  | { kind: "appoint_agent"; value: { agent: Agent } }
  | { kind: "review_contribution"; value: { request: ReviewRequest } }
  | { kind: "resolve_challenge"; value: { job_id: number; approve: boolean } };

export interface Policy {
  tokens_per_point: string;
  max_score: number;
  max_reward_per_contribution: string;
  epoch_budget: string;
  epoch_agent_budget: string;
  epoch_duration_ns: number;
  challenge_period_ns: number;
  voting_period_ns: number;
  verdict_timeout_ns: number;
  verdict_fee: string;
}
export interface Agent {
  account_id: string;
  worker_code_hash: string;
  rubric_hash: string;
  outlayer?: {
    contract_id: string;
    source_url: string;
    source_hash: string;
    max_deposit: string;
    secrets_ref?: { profile: string; account_id: string } | null;
  } | null;
}
export interface ReviewRequest {
  repo: string;
  pr_number: number;
  merge_sha: string;
  beneficiary: string;
  requester?: string;
}
export interface DaoConfig {
  members: string[];
  threshold: number;
  token_id: string;
  policy: Policy;
  agent: Agent | null;
  epoch_id: number;
}
export interface Treasury {
  reward_available: string;
  reward_reserved: string;
  reward_pending: string;
  reward_paid: string;
  agent_available: string;
  agent_reserved: string;
  agent_pending: string;
  agent_paid: string;
  compute_available?: string;
  compute_pending?: string;
  compute_spent?: string;
}
export interface Proposal {
  id: number;
  proposer: string;
  description: string;
  action: Action;
  created_at_ns: number;
  voting_ends_at_ns: number;
  yes: number;
  no: number;
  voters: Array<{ account_id: string; approve: boolean }>;
  executed: boolean;
  job_id: number | null;
  review_policy?: Policy | null;
  review_agent?: Agent | null;
}
export interface ReviewJob {
  id: number;
  request: ReviewRequest;
  policy: Policy;
  agent: Agent;
  created_at_ns: number;
  verdict_deadline_ns: number;
  epoch_id: number;
  max_reward: string;
  agent_fee: string;
  score: number | null;
  rationale: string | null;
  evidence_hash: string | null;
  evidence_source?: string;
  compute_nonce?: number | null;
  compute_attempted?: boolean;
  challenge_ends_at_ns: number | null;
  challenged: boolean;
  challenge_reason: string | null;
  resolved_approved: boolean | null;
  expired: boolean;
  reward_amount: string | null;
  reward_status: "reserved" | "pending" | "paid" | "released";
  agent_status: "reserved" | "pending" | "paid" | "released";
}

export interface SputnikConfig {
  name: string;
  purpose: string;
  metadata: string;
}
export interface SputnikRole {
  name: string;
  kind: "Everyone" | { Group: string[] } | { Member: string };
  permissions: string[];
  vote_policy: Record<string, unknown>;
}
export interface SputnikPolicy {
  roles: SputnikRole[];
  default_vote_policy: {
    weight_kind: string;
    quorum: string;
    threshold: [number, number] | string;
  };
  proposal_bond: string;
  proposal_period: string;
  bounty_bond: string;
  bounty_forgiveness_period: string;
}
export interface SputnikFunctionCallAction {
  method_name: string;
  args: string;
  deposit: string;
  gas: string;
}
export type SputnikProposalKind =
  | {
      FunctionCall: {
        receiver_id: string;
        actions: SputnikFunctionCallAction[];
      };
    }
  | {
      Transfer: {
        token_id: string;
        receiver_id: string;
        amount: string;
        msg?: string | null;
      };
    }
  | {
      AddBounty: {
        bounty: {
          description: string;
          token: string;
          amount: string;
          times: number;
          max_deadline: string;
        };
      };
    }
  | Record<string, unknown>;

export type SputnikProposalStatus =
  | "InProgress"
  | "Approved"
  | "Rejected"
  | "Removed"
  | "Expired"
  | "Moved"
  | "Failed";

export type SputnikVote = "Approve" | "Reject" | "Remove";
export type SputnikVoteAction = "VoteApprove" | "VoteReject" | "VoteRemove";

export interface SputnikProposal {
  id: number;
  proposer: string;
  description: string;
  kind: SputnikProposalKind;
  status: SputnikProposalStatus;
  vote_counts: Record<string, [number, number, number]>;
  votes: Record<string, SputnikVote>;
  submission_time: string;
}

export interface SputnikBounty {
  id: number;
  description: string;
  token: string;
  amount: string;
  times: number;
  max_deadline: string;
}

export interface SputnikDaoState {
  contract_id: string;
  factory_id: string;
  version: string;
  config: SputnikConfig;
  policy: SputnikPolicy;
  token_balance: string;
  proposals: SputnikProposal[];
  bounties: SputnikBounty[];
}

export interface DaoState {
  mode: Mode;
  network?: string;
  contract_id?: string | null;
  sputnik_dao_id?: string | null;
  token_symbol?: string;
  token_decimals?: number;
  config: DaoConfig;
  treasury: Treasury;
  proposals: Proposal[];
  jobs: ReviewJob[];
  sputnik?: SputnikDaoState | null;
  now_ns: number;
  local_token: string | null;
  actor: string | null;
  accounts: string[];
}

export type DaoMethod =
  | "propose"
  | "vote"
  | "execute"
  | "submit_verdict"
  | "challenge"
  | "expire_job"
  | "claim_reward"
  | "claim_agent_fee"
  | "execute_outlayer"
  | "fund_compute";

export interface DaoClient {
  readonly mode: Mode;
  load(): Promise<DaoState>;
  call(
    method: DaoMethod,
    args: Record<string, unknown>,
    actor?: string,
  ): Promise<void>;
  local(
    method: "fund" | "judge" | "ai_judge" | "advance_time" | "reset",
    args?: Record<string, unknown>,
    actor?: string,
  ): Promise<void>;
  sputnikProposeGrant?(
    bucket: Bucket,
    amountAtomic: string,
    tokenId: string,
    description: string,
    bondYocto?: string,
  ): Promise<void>;
  sputnikProposeBounty?(
    description: string,
    amountAtomic: string,
    tokenId: string,
    times: number,
    bondYocto?: string,
  ): Promise<void>;
  sputnikVote?(proposalId: number, action: SputnikVoteAction): Promise<void>;
}

export class LocalDaoClient implements DaoClient {
  readonly mode = "local-demo" as const;
  private token: string | null = null;
  private actor: string | null = null;
  setActor(actor: string) {
    this.actor = actor;
  }
  private async request<T>(path: string, body?: unknown): Promise<T> {
    const url = new URL(path, window.location.origin);
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")
      throw new Error("Local demo is restricted to this computer.");
    const response = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      signal: AbortSignal.timeout(12000),
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(this.token ? { "X-DAO-Local": this.token } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(
        typeof json.error === "string"
          ? json.error
          : `DAO server returned ${response.status}`,
      );
    return json as T;
  }
  async load(): Promise<DaoState> {
    const state = await this.request<DaoState>("/api/dao/state");
    this.token = state.local_token;
    this.actor ??= state.actor;
    state.actor = this.actor;
    return state;
  }
  async call(
    method: DaoMethod,
    args: Record<string, unknown>,
    actor = this.actor ?? undefined,
  ): Promise<void> {
    await this.request("/api/dao/call", { method, args, actor });
  }
  async local(
    method: "fund" | "judge" | "ai_judge" | "advance_time" | "reset",
    args: Record<string, unknown> = {},
    actor = this.actor ?? undefined,
  ): Promise<void> {
    await this.request("/api/dao/call", { method, args, actor });
  }
}

export const nearTestnetRpc = "https://rpc.testnet.fastnear.com";
export const defaultSputnikDaoId = "therascals.sputnikv2.testnet";
export const defaultSputnikFactoryId = "sputnikv2.testnet";

export async function viewNear<T>(
  contractId: string,
  methodName: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const bytes = new TextEncoder().encode(JSON.stringify(args));
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  const argsBase64 = btoa(binary);
  const response = await fetch(nearTestnetRpc, {
    method: "POST",
    signal: AbortSignal.timeout(15000),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "dao-ui",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: contractId,
        method_name: methodName,
        args_base64: argsBase64,
      },
    }),
  });
  const result = await response.json();
  if (!response.ok || result.error)
    throw new Error(result.error?.data ?? "NEAR testnet RPC request failed");
  const resultBytes = new Uint8Array(result.result.result as number[]);
  return JSON.parse(new TextDecoder().decode(resultBytes)) as T;
}

function encodeBase64Json(obj: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

export class NearDaoClient implements DaoClient {
  readonly mode = "near-testnet" as const;
  private connector: import("@hot-labs/near-connect").NearConnector | null =
    null;
  private wallet: Awaited<
    ReturnType<import("@hot-labs/near-connect").NearConnector["wallet"]>
  > | null = null;
  private accountId: string | null = null;
  constructor(
    readonly contractId: string,
    readonly sputnikDaoId: string = defaultSputnikDaoId,
  ) {
    if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*\.testnet$/.test(contractId))
      throw new Error("Enter a NEAR testnet contract account.");
    if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*\.testnet$/.test(sputnikDaoId))
      throw new Error("Enter a NEAR testnet Sputnik DAO account.");
  }
  async connect(): Promise<string> {
    this.accountId = null;
    this.wallet = null;
    const { NearConnector } = await import("@hot-labs/near-connect");
    this.connector ??= new NearConnector({
      network: "testnet",
      autoConnect: false,
    });
    const walletId = await this.connector.selectWallet();
    this.wallet = await this.connector.connect({ walletId });
    const accounts = await this.wallet.getAccounts();
    const account = accounts.find((item) =>
      item.accountId.endsWith(".testnet"),
    );
    if (!account)
      throw new Error("Connect a NEAR testnet account in your wallet.");
    this.accountId = account.accountId;
    return this.accountId;
  }
  private async loadSputnik(tokenId: string): Promise<SputnikDaoState | null> {
    try {
      const [version, config, policy, proposals, bounties, tokenBalance] =
        await Promise.all([
          viewNear<string>(this.sputnikDaoId, "version"),
          viewNear<SputnikConfig>(this.sputnikDaoId, "get_config"),
          viewNear<SputnikPolicy>(this.sputnikDaoId, "get_policy"),
          viewNear<SputnikProposal[]>(this.sputnikDaoId, "get_proposals", {
            from_index: 0,
            limit: 50,
          }),
          viewNear<SputnikBounty[]>(this.sputnikDaoId, "get_bounties", {
            from_index: 0,
            limit: 50,
          }).catch(() => []),
          viewNear<string>(tokenId, "ft_balance_of", {
            account_id: this.sputnikDaoId,
          }).catch(() => "0"),
        ]);
      if (
        typeof version !== "string" ||
        !config ||
        typeof config.name !== "string" ||
        !policy ||
        !Array.isArray(policy.roles) ||
        !Array.isArray(proposals)
      ) {
        return null;
      }
      return {
        contract_id: this.sputnikDaoId,
        factory_id: defaultSputnikFactoryId,
        version,
        config,
        policy,
        token_balance: typeof tokenBalance === "string" ? tokenBalance : "0",
        proposals,
        bounties: Array.isArray(bounties) ? bounties : [],
      };
    } catch {
      return null;
    }
  }
  async load(): Promise<DaoState> {
    const [config, treasury] = await Promise.all([
      viewNear<DaoConfig>(this.contractId, "get_config"),
      viewNear<Treasury>(this.contractId, "get_treasury"),
    ]);
    const proposals: Proposal[] = [],
      jobs: ReviewJob[] = [];
    // Jobs are sparse in proposal-ID space. Scan each proposal page even when
    // a corresponding job page is empty.
    for (let from = 0; from < 1000; from += 100) {
      const [page, jobPage] = await Promise.all([
        viewNear<Proposal[]>(this.contractId, "list_proposals", {
          from_index: from,
          limit: 100,
        }),
        viewNear<ReviewJob[]>(this.contractId, "list_jobs", {
          from_index: from,
          limit: 100,
        }),
      ]);
      proposals.push(...page);
      jobs.push(...jobPage);
      if (page.length < 100) break;
    }
    const [tokenMetadata, sputnik] = await Promise.all([
      viewNear<{ decimals: number; symbol?: string }>(
        config.token_id,
        "ft_metadata",
      ).catch(() => null),
      this.loadSputnik(config.token_id),
    ]);
    if (!tokenMetadata || tokenMetadata.decimals !== 6)
      throw new Error(
        "This prototype currently supports only NEP-141 reward tokens with 6 decimals. Token metadata was unavailable or used a different precision.",
      );
    return {
      mode: "near-testnet",
      network: "NEAR testnet",
      contract_id: this.contractId,
      sputnik_dao_id: this.sputnikDaoId,
      token_symbol: tokenMetadata.symbol ?? config.token_id,
      token_decimals: tokenMetadata.decimals,
      config,
      treasury,
      proposals,
      jobs,
      sputnik,
      now_ns: Date.now() * 1_000_000,
      local_token: null,
      actor: this.accountId,
      accounts: [],
    };
  }
  private async verifySigner() {
    if (!this.wallet || !this.accountId)
      throw new Error("Connect a NEAR testnet wallet first.");
    const accounts = await this.wallet.getAccounts();
    if (
      accounts.find((a) => a.accountId.endsWith(".testnet"))?.accountId !==
      this.accountId
    ) {
      this.accountId = null;
      throw new Error(
        "Wallet account changed. Reconnect before approving a DAO action.",
      );
    }
  }
  private verifyOutcome(result: any) {
    const failed =
      result?.status?.Failure ||
      result?.receipts_outcome?.some((r: any) => r?.outcome?.status?.Failure);
    if (failed)
      throw new Error(
        "The DAO transaction or a downstream transfer failed. Check the wallet receipt before retrying.",
      );
    const status = result?.status;
    if (!status || !("SuccessValue" in status))
      throw new Error(
        "Transaction completion is unknown. Check the wallet receipt before retrying.",
      );
    if (status.SuccessValue) {
      try {
        if (JSON.parse(atob(status.SuccessValue)) === false)
          throw new Error(
            "DAO execution returned no completed payout or verdict. Inspect the job and original receipt before retrying.",
          );
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("DAO execution"))
          throw e;
      }
    }
  }
  async call(method: DaoMethod, args: Record<string, unknown>): Promise<void> {
    if (!this.wallet || !this.accountId)
      throw new Error("Connect a NEAR testnet wallet first.");
    await this.verifySigner();
    const result = await this.wallet.signAndSendTransaction({
      network: "testnet",
      signerId: this.accountId,
      receiverId: this.contractId,
      actions: [
        {
          type: "FunctionCall",
          params: {
            methodName: method,
            args: method === "fund_compute" ? {} : args,
            gas:
              method === "execute_outlayer"
                ? "300000000000000"
                : "250000000000000",
            deposit:
              method === "fund_compute" ? String(args.deposit ?? "0") : "1",
          },
        },
      ],
    });
    this.verifyOutcome(result);
  }
  async fundToken(
    bucket: Bucket,
    amount: string,
    tokenId: string,
  ): Promise<void> {
    if (!this.wallet || !this.accountId)
      throw new Error("Connect a NEAR testnet wallet first.");
    if (!tokenId.endsWith(".testnet"))
      throw new Error("Use a testnet token contract.");
    if (
      !/^\d{1,39}$/.test(amount) ||
      BigInt(amount) <= 0n ||
      BigInt(amount) >= 2n ** 128n
    )
      throw new Error("Enter a positive token amount in atomic units.");
    await this.verifySigner();
    const result = await this.wallet.signAndSendTransaction({
      network: "testnet",
      signerId: this.accountId,
      receiverId: tokenId,
      actions: [
        {
          type: "FunctionCall",
          params: {
            methodName: "ft_transfer_call",
            args: {
              receiver_id: this.contractId,
              amount,
              msg: JSON.stringify({ bucket }),
            },
            gas: "100000000000000",
            deposit: "1",
          },
        },
      ],
    });
    this.verifyOutcome(result);
    let accepted: unknown;
    try {
      accepted = JSON.parse(atob(result.status.SuccessValue));
    } catch {}
    if (accepted !== amount)
      throw new Error(
        "Token deposit was refunded, partially accepted or could not be verified. Check the original receipt and treasury before sending again.",
      );
  }
  async fundCompute(yoctoNear: string): Promise<void> {
    if (!this.wallet || !this.accountId)
      throw new Error("Connect a NEAR testnet wallet first.");
    if (!/^\d{1,39}$/.test(yoctoNear) || BigInt(yoctoNear) <= 0n)
      throw new Error("Enter a positive yoctoNEAR amount.");
    await this.call("fund_compute", { deposit: yoctoNear });
  }
  async sputnikProposeGrant(
    bucket: Bucket,
    amountAtomic: string,
    tokenId: string,
    description: string,
    bondYocto = "10000000000000000000000",
  ): Promise<void> {
    if (!this.wallet || !this.accountId)
      throw new Error("Connect a NEAR testnet wallet first.");
    if (!tokenId.endsWith(".testnet"))
      throw new Error("Use a testnet token contract.");
    if (
      !/^\d{1,39}$/.test(amountAtomic) ||
      BigInt(amountAtomic) <= 0n ||
      BigInt(amountAtomic) >= 2n ** 128n
    )
      throw new Error("Enter a positive token amount in atomic units.");
    if (description.trim().length < 5)
      throw new Error("Add a short explanation for the Sputnik DAO proposal.");
    await this.verifySigner();
    const callArgs = {
      receiver_id: this.contractId,
      amount: amountAtomic,
      msg: JSON.stringify({ bucket }),
    };
    const result = await this.wallet.signAndSendTransaction({
      network: "testnet",
      signerId: this.accountId,
      receiverId: this.sputnikDaoId,
      actions: [
        {
          type: "FunctionCall",
          params: {
            methodName: "add_proposal",
            args: {
              proposal: {
                description: description.trim(),
                kind: {
                  FunctionCall: {
                    receiver_id: tokenId,
                    actions: [
                      {
                        method_name: "ft_transfer_call",
                        args: encodeBase64Json(callArgs),
                        deposit: "1",
                        gas: "120000000000000",
                      },
                    ],
                  },
                },
              },
            },
            gas: "150000000000000",
            deposit: bondYocto,
          },
        },
      ],
    });
    this.verifyOutcome(result);
  }
  async sputnikProposeBounty(
    description: string,
    amountAtomic: string,
    tokenId: string,
    times = 3,
    bondYocto = "10000000000000000000000",
  ): Promise<void> {
    if (!this.wallet || !this.accountId)
      throw new Error("Connect a NEAR testnet wallet first.");
    if (!tokenId.endsWith(".testnet"))
      throw new Error("Use a testnet token contract.");
    if (
      !/^\d{1,39}$/.test(amountAtomic) ||
      BigInt(amountAtomic) <= 0n ||
      BigInt(amountAtomic) >= 2n ** 128n
    )
      throw new Error("Enter a positive bounty amount in atomic units.");
    if (description.trim().length < 5)
      throw new Error("Add a description for the Sputnik DAO bounty.");
    await this.verifySigner();
    const result = await this.wallet.signAndSendTransaction({
      network: "testnet",
      signerId: this.accountId,
      receiverId: this.sputnikDaoId,
      actions: [
        {
          type: "FunctionCall",
          params: {
            methodName: "add_proposal",
            args: {
              proposal: {
                description: `Sputnik DAO Bounty: ${description.trim()}`,
                kind: {
                  AddBounty: {
                    bounty: {
                      description: description.trim(),
                      token: tokenId,
                      amount: amountAtomic,
                      times: Math.max(1, Math.min(50, Math.round(times))),
                      max_deadline: "604800000000000",
                    },
                  },
                },
              },
            },
            gas: "150000000000000",
            deposit: bondYocto,
          },
        },
      ],
    });
    this.verifyOutcome(result);
  }
  async sputnikVote(
    proposalId: number,
    action: SputnikVoteAction,
  ): Promise<void> {
    if (!this.wallet || !this.accountId)
      throw new Error("Connect a NEAR testnet wallet first.");
    await this.verifySigner();
    const result = await this.wallet.signAndSendTransaction({
      network: "testnet",
      signerId: this.accountId,
      receiverId: this.sputnikDaoId,
      actions: [
        {
          type: "FunctionCall",
          params: {
            methodName: "act_proposal",
            args: {
              id: proposalId,
              action,
            },
            gas: "250000000000000",
            deposit: "0",
          },
        },
      ],
    });
    this.verifyOutcome(result);
  }
  async local(): Promise<void> {
    throw new Error("Local demo actions are unavailable in NEAR testnet mode.");
  }
}
