import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { NearDaoClient } from "../apps/dao/src/api.ts";
const m = vi.hoisted(() => ({
  getAccounts: vi.fn(),
  send: vi.fn(),
  select: vi.fn(),
  connect: vi.fn(),
}));
vi.mock("@hot-labs/near-connect", () => ({
  NearConnector: class {
    selectWallet = m.select;
    connect = m.connect;
  },
}));
beforeEach(() => {
  m.getAccounts.mockResolvedValue([{ accountId: "alice.testnet" }]);
  m.send.mockResolvedValue({
    status: { SuccessValue: "" },
    receipts_outcome: [],
  });
  m.select.mockResolvedValue("wallet");
  m.connect.mockResolvedValue({
    getAccounts: m.getAccounts,
    signAndSendTransaction: m.send,
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe("DAO wallet boundary", () => {
  it("rejects mainnet contracts and sends only explicit testnet calls with one yocto", async () => {
    expect(() => new NearDaoClient("dao.near")).toThrow("testnet");
    let c = new NearDaoClient("dao.testnet");
    await expect(
      c.call("vote", { proposal_id: 0, approve: true }),
    ).rejects.toThrow("Connect");
    await c.connect();
    await c.call("vote", { proposal_id: 0, approve: true });
    expect(m.send).toHaveBeenCalledWith(
      expect.objectContaining({
        network: "testnet",
        signerId: "alice.testnet",
        receiverId: "dao.testnet",
        actions: [
          expect.objectContaining({
            params: expect.objectContaining({
              methodName: "vote",
              deposit: "1",
            }),
          }),
        ],
      }),
    );
  });
  it("refuses a wallet account change before a write", async () => {
    let c = new NearDaoClient("dao.testnet");
    await c.connect();
    m.getAccounts.mockResolvedValue([{ accountId: "bob.testnet" }]);
    await expect(c.call("claim_reward", { job_id: 1 })).rejects.toThrow(
      "account changed",
    );
    expect(m.send).not.toHaveBeenCalled();
  });
  it("does not present a failed or unknown execution as success", async () => {
    let c = new NearDaoClient("dao.testnet");
    await c.connect();
    m.send.mockResolvedValueOnce({ status: { Failure: {} } });
    await expect(c.call("claim_reward", { job_id: 1 })).rejects.toThrow(
      "failed",
    );
    m.send.mockResolvedValueOnce({ status: { SuccessValue: btoa("false") } });
    await expect(c.call("execute_outlayer", { job_id: 1 })).rejects.toThrow(
      "no completed",
    );
    m.send.mockResolvedValueOnce({ transaction: { hash: "unknown" } });
    await expect(
      c.call("vote", { proposal_id: 1, approve: true }),
    ).rejects.toThrow("unknown");
  });
  it("keeps token funding separate from native compute deposits", async () => {
    let c = new NearDaoClient("dao.testnet");
    await c.connect();
    m.send.mockResolvedValueOnce({
      status: { SuccessValue: btoa(JSON.stringify("1000000")) },
    });
    await c.fundToken("agents", "1000000", "token.testnet");
    expect(m.send.mock.calls[0][0].receiverId).toBe("token.testnet");
    expect(m.send.mock.calls[0][0].actions[0].params.args.msg).toBe(
      '{"bucket":"agents"}',
    );
    await c.fundCompute("100000000000000000000000");
    expect(m.send.mock.calls[1][0].receiverId).toBe("dao.testnet");
    expect(m.send.mock.calls[1][0].actions[0].params.deposit).toBe(
      "100000000000000000000000",
    );
    expect(m.send.mock.calls[1][0].actions[0].params.args).toEqual({});
  });
  it("refuses unknown or incompatible token precision and scans sparse job pages", async () => {
    const calls: string[] = [];
    let decimals = 18;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        const p = JSON.parse(init.body).params;
        calls.push(p.method_name);
        let result: any = {};
        const args = JSON.parse(atob(p.args_base64));
        if (p.method_name === "get_config")
          result = { token_id: "token.testnet" };
        if (p.method_name === "list_proposals")
          result =
            args.from_index === 0
              ? Array.from({ length: 100 }, (_, id) => ({ id }))
              : [];
        if (p.method_name === "list_jobs")
          result = args.from_index === 100 ? [{ id: 100 }] : [];
        if (p.method_name === "ft_metadata") result = { decimals };
        return new Response(
          JSON.stringify({
            result: {
              result: [...new TextEncoder().encode(JSON.stringify(result))],
            },
          }),
          { status: 200 },
        );
      }),
    );
    let c = new NearDaoClient("dao.testnet");
    await expect(c.load()).rejects.toThrow("6 decimals");
    decimals = 6;
    let s = await c.load();
    expect(s.jobs[0].id).toBe(100);
    expect(s.token_decimals).toBe(6);
    expect(calls.filter((x) => x === "list_jobs").length).toBe(4);
  });
});

// Regression: NEP-141 transfer calls can succeed while refunding the entire deposit.
it("does not report refunded token funding as an accepted treasury deposit", async () => {
  const c = new NearDaoClient("dao.testnet");
  await c.connect();
  m.send.mockResolvedValueOnce({
    status: { SuccessValue: btoa(JSON.stringify("0")) },
  });
  await expect(
    c.fundToken("rewards", "1000000", "token.testnet"),
  ).rejects.toThrow(/refund|accepted|deposit/i);
});

it("loads Sputnik DAO v2 state and sends wallet-approved add_proposal and act_proposal calls to testnet Sputnik DAO", async () => {
  expect(() => new NearDaoClient("dao.testnet", "sputnik.near")).toThrow(
    "testnet",
  );
  const c = new NearDaoClient("dao.testnet", "therascals.sputnikv2.testnet");
  await c.connect();

  await c.sputnikProposeGrant(
    "rewards",
    "250000000",
    "token.testnet",
    "Fund Contributor DAO rewards pool via Sputnik DAO grant",
  );
  expect(m.send.mock.calls[0][0].receiverId).toBe(
    "therascals.sputnikv2.testnet",
  );
  expect(m.send.mock.calls[0][0].actions[0].params.methodName).toBe(
    "add_proposal",
  );
  expect(m.send.mock.calls[0][0].actions[0].params.deposit).toBe(
    "10000000000000000000000",
  );

  await c.sputnikVote(2, "VoteApprove");
  expect(m.send.mock.calls[1][0].receiverId).toBe(
    "therascals.sputnikv2.testnet",
  );
  expect(m.send.mock.calls[1][0].actions[0].params.methodName).toBe(
    "act_proposal",
  );
  expect(m.send.mock.calls[1][0].actions[0].params.args).toEqual({
    id: 2,
    action: "VoteApprove",
  });
});
