import { it, expect, afterEach } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { perpsAgentSecret } from "../apps/server/src/perps/agent.ts";

/** The real .data/perps-secret belongs to the operator; tests never open it. */
const home = process.cwd();
const dirs: string[] = [];
const exists = (p: string) => {
  try {
    readFileSync(p);
    return true;
  } catch {
    return false;
  }
};
function temp(work: () => void) {
  const dir = mkdtempSync(join(tmpdir(), "perps-secret-"));
  dirs.push(dir);
  process.chdir(dir);
  try {
    work();
  } finally {
    process.chdir(home);
  }
}
afterEach(() => {
  process.chdir(home);
  for (const d of dirs.splice(0).reverse())
    rmSync(d, { recursive: true, force: true });
});

it("reads the deployed secret as hex or base64 and refuses a wrong length", () => {
  temp(() => {
    const key = randomBytes(32);
    expect(
      perpsAgentSecret({ JACKPOT_PERPS_SECRET: key.toString("hex") }),
    ).toEqual(key);
    expect(
      perpsAgentSecret({ JACKPOT_PERPS_SECRET: key.toString("base64") }),
    ).toEqual(key);
    expect(() => perpsAgentSecret({ JACKPOT_PERPS_SECRET: "abcd" })).toThrow(
      /32 bytes/,
    );
  });
});

it("will not invent a deployment key in public mode", () => {
  // The failure this prevents: the mount is missing, the process picks a fresh
  // key, boots healthy, and no stored agent key can be decrypted any more.
  for (const mode of ["public", "public-testnet"])
    temp(() => {
      expect(() => perpsAgentSecret({ JACKPOT_MODE: mode })).toThrow(
        /JACKPOT_PERPS_SECRET/,
      );
      expect(exists(".data/perps-secret")).toBe(false);
    });
});

it("keeps the operator's mounted file and only self-generates locally", () => {
  temp(() => {
    const key = randomBytes(32);
    mkdirSync(".data", { recursive: true });
    writeFileSync(join(".data", "perps-secret"), key);
    expect(perpsAgentSecret({ JACKPOT_MODE: "public" })).toEqual(key);
    writeFileSync(join(".data", "perps-secret"), randomBytes(7));
    expect(() => perpsAgentSecret({ JACKPOT_MODE: "public" })).toThrow(
      /not 32 bytes/,
    );
  });
  temp(() => {
    const made = perpsAgentSecret({});
    expect(made).toHaveLength(32);
    expect(readFileSync(join(".data", "perps-secret"))).toEqual(made);
    expect(perpsAgentSecret({ JACKPOT_MODE: "local" })).toEqual(made);
  });
});
