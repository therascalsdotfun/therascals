import { expect, it } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createAgentServer, apiOrigin } from "../apps/agent/src/server.ts";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { resolve } from "node:path";

it("starts the shipped stdio entry point with a clean MCP handshake and no stdout logging", async () => {
  const client = new Client({ name: "stdio-probe", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", resolve("apps/agent/src/main.ts")],
    cwd: process.cwd(),
    env: { RASCALS_API_ORIGIN: "http://127.0.0.1:4317" },
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    expect((await client.listTools()).tools).toHaveLength(8);
    expect(
      JSON.stringify(await client.readResource({ uri: "rascals://guide" })),
    ).toContain("read-only");
  } finally {
    await client.close();
  }
});

it("exposes real MCP read-only tools/resources, preserves a visitor and never exposes execution", async () => {
  const calls: { url: string; init: any }[] = [];
  const server = createAgentServer(
    "https://rascals.example",
    async (url: any, init: any) => {
      calls.push({ url, init });
      if (url.includes("/markets"))
        return Response.json(
          { rows: [], viewer: { identity: "must-not-forward" } },
          {
            headers: {
              "set-cookie": "jackpot_view=public-fixture; Path=/api; HttpOnly",
            },
          },
        );
      if (url.endsWith("/quote"))
        return Response.json({
          dry: true,
          network: "mainnet",
          amountOut: "12",
        });
      return Response.json({ ok: true });
    },
  );
  const client = new Client({ name: "test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  try {
    const tools = await client.listTools();
    expect(tools.tools).toHaveLength(8);
    expect(tools.tools.every((t) => t.annotations?.readOnlyHint)).toBe(true);
    expect(tools.tools.map((t) => t.name).join(" ")).not.toMatch(
      /execute|sign|deposit|withdraw|buy/,
    );
    const markets = await client.callTool({
      name: "list_tokens",
      arguments: { limit: 20 },
    });
    expect(JSON.stringify(markets)).not.toContain("must-not-forward");
    await client.callTool({ name: "get_platform_status", arguments: {} });
    expect(calls.at(-1)?.init.headers.cookie).toBe(
      "jackpot_view=public-fixture",
    );
    const quote = await client.callTool({
      name: "quote_intents",
      arguments: { destinationAsset: "nep141:usdc", amount: "1" },
    });
    expect(quote.isError).not.toBe(true);
    expect(calls.at(-1)?.init.headers.origin).toBe("https://rascals.example");
    expect(calls.at(-1)?.init.redirect).toBe("error");
    expect(await client.readResource({ uri: "rascals://guide" })).toMatchObject(
      { contents: [{ mimeType: "text/plain" }] },
    );
    const before = calls.length;
    for (const args of [
      { mint: "https://evil.example" },
      { mint: "11111111111111111111111111111111", url: "https://evil.example" },
    ]) {
      const result = await client.callTool({
        name: "get_token_risk",
        arguments: args,
      });
      expect(result.isError).toBe(true);
    }
    expect(calls).toHaveLength(before);
  } finally {
    await client.close();
    await server.close();
  }
});

it("rejects unexpected funding responses and unsafe API origins", async () => {
  for (const origin of [
    "http://public.example",
    "https://user:password@example.com",
    "https://example.com/path",
    "https://example.com/?key=secret",
  ])
    expect(() => apiOrigin(origin)).toThrow();
  expect(apiOrigin("http://127.0.0.1:4317")).toBe("http://127.0.0.1:4317");
  const server = createAgentServer("https://rascals.example", async () =>
    Response.json({
      dry: true,
      network: "mainnet",
      quote: { depositAddress: "never-forward" },
    }),
  );
  const client = new Client({ name: "test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  try {
    const response = await client.callTool({
      name: "quote_perps_funding",
      arguments: { amount: "1" },
    });
    expect(response.isError).toBe(true);
    expect(JSON.stringify(response)).not.toContain("never-forward");
  } finally {
    await client.close();
    await server.close();
  }
});
