import { it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

/** Guard the actual options argument, rather than nearby lines or source offsets. */
type Site = { file: string; where: string; pinsRedirect: boolean };
function scan(dir: string): Site[] {
  return readdirSync(dir).flatMap((name) => {
    const file = join(dir, name);
    if (statSync(file).isDirectory()) return scan(file);
    if (!file.endsWith(".ts")) return [];
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const sites: Site[] = [];
    function visit(node: ts.Node) {
      if (
        ts.isCallExpression(node) &&
        ((ts.isIdentifier(node.expression) &&
          node.expression.text === "fetch") ||
          (ts.isPropertyAccessExpression(node.expression) &&
            node.expression.name.text === "fetcher" &&
            node.expression.expression.kind === ts.SyntaxKind.ThisKeyword))
      ) {
        const options = node.arguments[1];
        // The final redirect property wins. A later spread could override it.
        let pinsRedirect = false;
        if (options && ts.isObjectLiteralExpression(options)) {
          for (const property of options.properties) {
            if (ts.isSpreadAssignment(property)) pinsRedirect = false;
            else if (
              ts.isPropertyAssignment(property) &&
              (ts.isIdentifier(property.name) ||
                ts.isStringLiteral(property.name)) &&
              property.name.text === "redirect"
            )
              pinsRedirect =
                ts.isStringLiteral(property.initializer) &&
                property.initializer.text === "error";
          }
        }
        sites.push({
          file,
          where: `${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`,
          pinsRedirect,
        });
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    return sites;
  });
}
const sites = scan("apps/server/src");
it("inventories every outbound fetch without coupling the guard to line numbers", () => {
  expect(sites.map((site) => site.file).sort()).toEqual([
    "apps/server/src/auth/proof.ts",
    "apps/server/src/execution/network.ts",
    "apps/server/src/execution/network.ts",
    "apps/server/src/intents/service.ts",
    "apps/server/src/intents/user-session.ts",
    "apps/server/src/intents/user-session.ts",
    "apps/server/src/mainnet/evm.ts",
    "apps/server/src/mainnet/funding.ts",
    "apps/server/src/market/base.ts",
    "apps/server/src/market/dexscreener.ts",
    "apps/server/src/market/gecko.ts",
    "apps/server/src/market/security.ts",
    "apps/server/src/market/service.ts",
    "apps/server/src/portfolio/service.ts",
  ]);
});
it("refuses to follow redirects at every configured outbound request", () => {
  for (const site of sites) expect(site.pinsRedirect, site.where).toBe(true);
});
