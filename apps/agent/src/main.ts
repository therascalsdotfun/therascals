import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createAgentServer } from "./server.ts";

// stdout belongs exclusively to the MCP protocol. Never import wallet signers here.
try {
  const server = createAgentServer(
    process.env.RASCALS_API_ORIGIN ?? "http://127.0.0.1:4317",
  );
  await server.connect(new StdioServerTransport());
} catch {
  process.stderr.write(
    "Rascals MCP could not start. Check RASCALS_API_ORIGIN and installation.\n",
  );
  process.exitCode = 1;
}
