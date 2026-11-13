import { evaluateContributionWithNearAi } from "./near-ai.ts";
import Fastify from "fastify";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { LocalDao, type LocalState } from "./local-model.ts";
const methods = [
  "fund",
  "advance_time",
  "reset",
  "propose",
  "vote",
  "execute",
  "judge",
  "ai_judge",
  "submit_verdict",
  "challenge",
  "expire_job",
  "claim_reward",
  "claim_agent_fee",
] as const;
const envelope = z
  .object({
    method: z.enum(methods),
    actor: z.string().min(2).max(64),
    args: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export function buildDaoServer(
  options: { store?: string; clock?: () => number; uiPort?: number } = {},
) {
  const app = Fastify({ logger: false, bodyLimit: 24000 });
  const token = randomBytes(32).toString("hex"),
    store = options.store ?? resolve(".local-dev/dao/state.json");
  let saved: LocalState | undefined;
  try {
    saved = JSON.parse(readFileSync(store, "utf8"));
    if (saved?.version !== 1) throw Error("Unsupported DAO store version");
  } catch (e: any) {
    if (e.code !== "ENOENT")
      throw Error(
        "Local DAO state cannot be read; preserve the file and restore a valid backup.",
      );
  }
  const model = new LocalDao(saved, options.clock),
    port = options.uiPort ?? 5190,
    origins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
  let serial = Promise.resolve();
  app.addHook("onRequest", async (req, reply) => {
    let host = "";
    try {
      host = new URL("http://" + req.headers.host).hostname;
    } catch {}
    if (!["127.0.0.1", "localhost"].includes(host))
      return reply.code(403).send({ error: "Local host required" });
    if (
      req.method !== "GET" &&
      (typeof req.headers.origin !== "string" ||
        !origins.has(req.headers.origin) ||
        req.headers["x-dao-local"] !== token)
    )
      return reply.code(403).send({
        error:
          "Open the local DAO interface to authorize this simulation action.",
      });
  });
  app.get("/api/dao/state", async () => ({
    ...model.snapshot(),
    local_token: token,
    network: "Local simulation — no chain funds",
    contract_id: null,
    token_symbol: "LOCAL",
    token_decimals: 6,
  }));
  app.post("/api/dao/call", async (req, reply) => {
    const parsed = envelope.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "Invalid DAO action envelope" });
    let unlock!: () => void;
    const previous = serial;
    serial = new Promise<void>((r) => (unlock = r));
    await previous;
    const before = structuredClone(model.state);
    try {
      const { method, args, actor } = parsed.data;
      let result: unknown;
      if (method === "ai_judge") {
        const jobId = Number(args.job_id);
        const j = model.state.jobs.find((job) => job.id === jobId);
        if (!j) throw Error("Job not found");
        const aiAssessment = await evaluateContributionWithNearAi({
          repo: j.request.repo,
          prNumber: j.request.pr_number,
          mergeSha: j.request.merge_sha,
        });
        result = model.call(
          "judge",
          {
            job_id: jobId,
            assessment: {
              impact: aiAssessment.impact,
              security: aiAssessment.security,
              verification: aiAssessment.verification,
              maintenance: aiAssessment.maintenance,
            },
            rationale: `NEAR AI TEE review (${aiAssessment.model}): ${aiAssessment.rationale}`,
            source: "near-ai-qwen-3.8-tee",
          },
          actor,
        );
      } else {
        result = model.call(method, args, actor);
      }
      mkdirSync(dirname(store), { recursive: true, mode: 0o700 });
      const temp = store + ".pending";
      writeFileSync(temp, JSON.stringify(model.state, null, 2), {
        mode: 0o600,
      });
      renameSync(temp, store);
      return {
        result,
        state: {
          ...model.snapshot(),
          local_token: token,
          network: "Local simulation — no chain funds",
          contract_id: null,
          token_symbol: "LOCAL",
          token_decimals: 6,
        },
      };
    } catch (e) {
      model.state = before;
      return reply.code(400).send({
        error: e instanceof Error ? e.message : "Local action failed",
      });
    } finally {
      unlock();
    }
  });
  return app;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const port = Number(process.env.DAO_API_PORT ?? 4390);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw Error("Invalid DAO_API_PORT");
  const app = buildDaoServer();
  app
    .listen({ host: "127.0.0.1", port })
    .then(() =>
      console.log(
        `Local DAO simulation API: http://127.0.0.1:${port} (no chain funds or attestation)`,
      ),
    )
    .catch(() => {
      console.error(
        "Local DAO API could not start; check the port and local state file.",
      );
      process.exitCode = 1;
    });
}
