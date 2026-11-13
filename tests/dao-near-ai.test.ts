import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  evaluateContributionWithNearAi,
  NEAR_AI_QWEN_MODEL,
} from "../apps/dao/near-ai.ts";
import { buildDaoServer } from "../apps/dao/server.ts";

const agent = {
  account_id: "judge.testnet",
  worker_code_hash: "a".repeat(64),
  rubric_hash: "b".repeat(64),
};

describe("NEAR AI DAO evaluator", () => {
  it("evaluates a PR contribution with Qwen 3.8 27B Abliterated format", async () => {
    const mockFetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                impact: 4,
                security: 5,
                verification: 4,
                maintenance: 4,
                rationale: "High impact refactoring with comprehensive regression tests.",
              }),
            },
          },
        ],
      }),
    });

    const assessment = await evaluateContributionWithNearAi({
      repo: "nvq2309/therascals",
      prNumber: 42,
      mergeSha: "c".repeat(40),
      apiKey: "test-key",
      fetcher: mockFetcher as any,
    });

    expect(assessment.model).toBe(NEAR_AI_QWEN_MODEL);
    expect(assessment.tee).toBe(true);
    expect(assessment.impact).toBe(4);
    expect(assessment.security).toBe(5);
    expect(assessment.verification).toBe(4);
    expect(assessment.maintenance).toBe(4);
    expect(assessment.rationale).toContain("High impact");
  });

  it("handles fallback simulation gracefully when no API key provided", async () => {
    const assessment = await evaluateContributionWithNearAi({
      repo: "nvq2309/therascals",
      prNumber: 1,
      mergeSha: "0".repeat(40),
    });

    expect(assessment.model).toBe(NEAR_AI_QWEN_MODEL);
    expect(assessment.tee).toBe(true);
    expect(assessment.impact).toBeGreaterThanOrEqual(3);
    expect(assessment.security).toBeGreaterThanOrEqual(3);
    expect(assessment.rationale).toContain("NEAR AI");
  });

  it("executes ai_judge through the DAO server call endpoint", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dao-ai-"));
    const store = join(dir, "state.json");
    const app = buildDaoServer({ store });

    try {
      const stateRes = await app.inject("/api/dao/state");
      const token = stateRes.json().local_token;

      const call = async (method: string, args: any = {}, actor = "alice.testnet") => {
        const res = await app.inject({
          method: "POST",
          url: "/api/dao/call",
          headers: {
            origin: "http://127.0.0.1:5190",
            "x-dao-local": token,
          },
          payload: { method, args, actor },
        });
        return res.json();
      };

      // Appoint agent & fund budgets
      await call("fund", { bucket: "rewards", amount: "1000000000" });
      await call("fund", { bucket: "agents", amount: "100000000" });

      const prop1 = (await call("propose", {
        action: { kind: "appoint_agent", value: { agent } },
        description: "Appoint review agent",
      })).result;
      await call("vote", { proposal_id: prop1, approve: true });
      await call("vote", { proposal_id: prop1, approve: true }, "bob.testnet");
      await call("advance_time", { seconds: 3601 });
      await call("execute", { proposal_id: prop1 });

      // Propose & execute contribution review
      const prop2 = (await call("propose", {
        action: {
          kind: "review_contribution",
          value: {
            request: {
              repo: "nvq2309/therascals",
              pr_number: 10,
              merge_sha: "e".repeat(40),
              beneficiary: "builder.testnet",
            },
          },
        },
        description: "Review PR #10",
      })).result;
      await call("vote", { proposal_id: prop2, approve: true });
      await call("vote", { proposal_id: prop2, approve: true }, "bob.testnet");
      await call("advance_time", { seconds: 3601 });
      await call("execute", { proposal_id: prop2 });

      // Run ai_judge
      const aiVerdict = await call("ai_judge", { job_id: prop2 });
      expect(aiVerdict.result).toBeDefined();

      const latestState = (await app.inject("/api/dao/state")).json();
      const job = latestState.jobs.find((j: any) => j.id === prop2);
      expect(job.score).toBeGreaterThan(0);
      expect(job.rationale).toContain("NEAR AI");
      expect(job.rationale).toContain(NEAR_AI_QWEN_MODEL);
    } finally {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
