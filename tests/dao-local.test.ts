import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDao } from "../apps/dao/local-model.ts";
import { buildDaoServer } from "../apps/dao/server.ts";
const agent = {
  account_id: "judge.testnet",
  worker_code_hash: "a".repeat(64),
  rubric_hash: "b".repeat(64),
};
function setup() {
  let now = 1700000000000;
  const d = new LocalDao(undefined, () => now);
  const call = (m: string, a: any = {}, who = "alice.testnet") =>
    d.call(m, a, who);
  const pass = (action: any) => {
    let id = call("propose", {
      action,
      description: "Reviewed local proposal",
    });
    call("vote", { proposal_id: id, approve: true });
    call("vote", { proposal_id: id, approve: true }, "bob.testnet");
    now += 3600001;
    call("execute", { proposal_id: id });
    return id as number;
  };
  return { d, call, pass, tick: (ms: number) => (now += ms) };
}
function authorize(s: ReturnType<typeof setup>, pr = 1) {
  return s.pass({
    kind: "review_contribution",
    value: {
      request: {
        repo: "nvq2309/therascals",
        pr_number: pr,
        merge_sha: "c".repeat(40),
        beneficiary: "builder.testnet",
      },
    },
  });
}
describe("isolated DAO flow", () => {
  it("requires governance, funded reservations, challenge delay and a unique claim", () => {
    let s = setup();
    s.pass({ kind: "appoint_agent", value: { agent } });
    expect(() => authorize(s)).toThrow("funded budget");
    expect(s.d.state.jobs).toHaveLength(0);
    s.call("fund", { bucket: "rewards", amount: "1000000000" });
    s.call("fund", { bucket: "agents", amount: "10000000" });
    let id = authorize(s, 2);
    expect(s.d.state.treasury.reward_reserved).toBe("100000000");
    s.call("judge", { job_id: id });
    expect(() =>
      s.call("claim_reward", { job_id: id }, "builder.testnet"),
    ).toThrow("window");
    s.tick(3600001);
    s.call("claim_reward", { job_id: id }, "builder.testnet");
    expect(s.d.state.treasury.reward_paid).toBe("60000000");
    expect(() =>
      s.call("claim_reward", { job_id: id }, "builder.testnet"),
    ).toThrow("Already claimed");
    s.call("claim_agent_fee", { job_id: id }, "judge.testnet");
    expect(() => authorize(s, 2)).toThrow("PR already");
  });
  it("prevents unauthorized votes, double votes, and worker binding substitution", () => {
    let s = setup();
    let id = s.call("propose", {
      action: { kind: "appoint_agent", value: { agent } },
      description: "Agent appointment",
    });
    expect(() =>
      s.call("vote", { proposal_id: id, approve: true }, "observer.testnet"),
    ).toThrow("Council");
    s.call("vote", { proposal_id: id, approve: true });
    expect(() => s.call("vote", { proposal_id: id, approve: true })).toThrow(
      "Already voted",
    );
    s.call("vote", { proposal_id: id, approve: true }, "bob.testnet");
    s.tick(3600001);
    s.call("execute", { proposal_id: id });
    s.call("fund", { bucket: "rewards", amount: "1000000000" });
    s.call("fund", { bucket: "agents", amount: "10000000" });
    let job = authorize(s);
    expect(() =>
      s.call(
        "submit_verdict",
        { job_id: job, score: 100, merge_sha: "d".repeat(40) },
        "judge.testnet",
      ),
    ).toThrow("binding");
    expect(s.d.state.jobs[0].score).toBeNull();
  });
  it("blocks disputed rewards until a governance resolution and returns rejected reservation", () => {
    let s = setup();
    s.pass({ kind: "appoint_agent", value: { agent } });
    s.call("fund", { bucket: "rewards", amount: "1000000000" });
    s.call("fund", { bucket: "agents", amount: "10000000" });
    let id = authorize(s);
    s.call("judge", { job_id: id });
    s.call(
      "challenge",
      { job_id: id, reason: "Missing test evidence" },
      "observer.testnet",
    );
    s.tick(3600001);
    expect(() =>
      s.call("claim_reward", { job_id: id }, "builder.testnet"),
    ).toThrow("challenge");
    s.pass({
      kind: "resolve_challenge",
      value: { job_id: id, approve: false },
    });
    expect(s.d.state.treasury.reward_reserved).toBe("0");
    expect(s.d.state.treasury.reward_available).toBe("1000000000");
  });
  it("rejects expired jobs and returns both budgets without permitting a second job", () => {
    let s = setup();
    s.pass({ kind: "appoint_agent", value: { agent } });
    s.call("fund", { bucket: "rewards", amount: "1000000000" });
    s.call("fund", { bucket: "agents", amount: "10000000" });
    let id = authorize(s);
    s.tick(86400001);
    s.call("expire_job", { job_id: id });
    expect(s.d.state.treasury.agent_available).toBe("10000000");
    expect(() => s.call("judge", { job_id: id })).toThrow("expired");
    expect(() => authorize(s)).toThrow("PR already");
  });
  it("HTTP refuses foreign origins, nonce omission and non-loopback Host headers", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dao-api-"));
    const app = buildDaoServer({ store: join(dir, "state.json") });
    try {
      const state = (
        await app.inject({
          method: "GET",
          url: "/api/dao/state",
          headers: { host: "localhost" },
        })
      ).json();
      const payload = {
        method: "fund",
        actor: "alice.testnet",
        args: { bucket: "rewards", amount: "1" },
      };
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/dao/call",
            headers: {
              host: "localhost",
              origin: "https://evil.example",
              "x-dao-local": state.local_token,
            },
            payload,
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/dao/call",
            headers: { host: "localhost", origin: "http://127.0.0.1:5190" },
            payload,
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: "GET",
            url: "/api/dao/state",
            headers: { host: "evil.example" },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/dao/call",
            headers: {
              host: "localhost",
              origin: "http://127.0.0.1:5190",
              "x-dao-local": state.local_token,
            },
            payload,
          })
        ).statusCode,
      ).toBe(200);
    } finally {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
