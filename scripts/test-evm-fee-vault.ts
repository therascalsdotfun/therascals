/** Local EVM contract acceptance only. No funded Base/BNB or DEX execution. */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { BrowserProvider, ContractFactory, id } from "ethers";
const require = createRequire(resolve(".data/evm-fee-tools/package.json"));
const solc = require("solc"),
  ganache = require("ganache");
const source = readFileSync(
  "contracts/evm-fee-vault/RascalsFeeVault.sol",
  "utf8",
);
const mocks = `pragma solidity ^0.8.30;
contract MockUSDC {
 uint8 public constant decimals=6; mapping(address=>uint) public balanceOf;mapping(address=>mapping(address=>uint))public allowance;
 constructor(){balanceOf[msg.sender]=100000000;}
 function approve(address to,uint n)external returns(bool){allowance[msg.sender][to]=n;return true;}
 function transfer(address to,uint n)external returns(bool){balanceOf[msg.sender]-=n;balanceOf[to]+=n;return true;}
 function transferFrom(address from,address to,uint n)external returns(bool){allowance[from][msg.sender]-=n;balanceOf[from]-=n;balanceOf[to]+=n;return true;}
}
interface IFeeVault{function collectFee(bytes32,address,uint)external returns(uint);}
contract MockSwapRouter {
 function buy(address vault,address token,bytes32 roll,uint gross,address recipient,bool fail)external {
  MockUSDC(token).transferFrom(msg.sender,recipient,gross-gross*50/10000);
  IFeeVault(vault).collectFee(roll,msg.sender,gross);
  require(!fail,"Mock swap failed");
 }
}`;
const compiled = JSON.parse(
  solc.compile(
    JSON.stringify({
      language: "Solidity",
      sources: {
        "RascalsFeeVault.sol": { content: source },
        "Mocks.sol": { content: mocks },
      },
      settings: {
        optimizer: { enabled: true, runs: 200 },
        evmVersion: "shanghai",
        outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
      },
    }),
  ),
);
if (compiled.errors?.some((e: any) => e.severity === "error"))
  throw Error(JSON.stringify(compiled.errors));
const local = ganache.provider({
  logging: { quiet: true },
  wallet: { totalAccounts: 3 },
  chain: { chainId: 1337, hardfork: "shanghai" },
});
try {
  const p = new BrowserProvider(local);
  p.pollingInterval = 50;
  const owner = await p.getSigner(0),
    recipient = await p.getSigner(1),
    attacker = await p.getSigner(2);
  async function deploy(file: string, name: string, args: any[] = []) {
    const c = compiled.contracts[file][name];
    const instance = await new ContractFactory(
      c.abi,
      c.evm.bytecode.object,
      owner,
    ).deploy(...args);
    await instance.waitForDeployment();
    return instance as any;
  }
  const token = await deploy("Mocks.sol", "MockUSDC"),
    router = await deploy("Mocks.sol", "MockSwapRouter");
  const vault = await deploy("RascalsFeeVault.sol", "RascalsFeeVault", [
    await token.getAddress(),
    await router.getAddress(),
    await owner.getAddress(),
  ]);
  const v = await vault.getAddress(),
    t = await token.getAddress(),
    r = await router.getAddress(),
    sink = await recipient.getAddress();
  await (await token.approve(v, 1000000n)).wait();
  await (await token.approve(r, 100000000n)).wait();
  const receipt = await (
    await router.buy(v, t, id("roll-1"), 5000000n, sink, false)
  ).wait();
  assert.equal(await token.balanceOf(v), 25000n);
  assert.equal(await token.balanceOf(sink), 4975000n);
  assert.equal(await vault.totalCollected(), 25000n);
  const before = await token.balanceOf(await owner.getAddress());
  await assert.rejects(
    router.buy.staticCall(v, t, id("roll-1"), 5000000n, sink, false),
  );
  await assert.rejects(
    router.buy.staticCall(v, t, id("roll-2"), 5000000n, sink, true),
  );
  // Execute a reverted transaction as well, proving both legs roll back.
  try {
    const tx = await router.buy(v, t, id("roll-2"), 5000000n, sink, true, {
      gasLimit: 500000,
    });
    await tx.wait();
    assert.fail("Expected revert");
  } catch (e: any) {
    if (e.code !== "CALL_EXCEPTION") throw e;
  }
  assert.equal(await vault.collected(id("roll-2")), false);
  assert.equal(await token.balanceOf(await owner.getAddress()), before);
  assert.equal(await token.balanceOf(v), 25000n);
  await assert.rejects(vault.connect(attacker).withdraw.staticCall(sink, 1n));
  await assert.rejects(
    vault
      .connect(attacker)
      .collectFee.staticCall(id("attack"), await owner.getAddress(), 5000000n),
  );
  await (await vault.setPaused(true)).wait();
  await assert.rejects(
    router.buy.staticCall(v, t, id("roll-3"), 5000000n, sink, false),
  );
  await (await vault.setPaused(false)).wait();
  await (await vault.withdraw(await owner.getAddress(), 10000n)).wait();
  assert.equal(await token.balanceOf(v), 15000n);
  mkdirSync("docs/evidence", { recursive: true });
  writeFileSync(
    "docs/evidence/evm-fee-vault-local-2026-11-01.json",
    JSON.stringify(
      {
        network: "local-ganache",
        chainId: 1337,
        compiler: solc.version(),
        sourceSha256: createHash("sha256").update(source).digest("hex"),
        vault: v,
        usdc: t,
        router: r,
        feeBps: 50,
        successfulCollectionTransaction: receipt.hash,
        checks: [
          "inclusive $5 split: 4.975 principal + 0.025 fee",
          "duplicate receipt rejected",
          "failed transaction rolls back principal and fee",
          "unauthorized collection and withdrawal rejected",
          "pause blocks collection",
          "owner withdrawal leaves 0.015 USDC",
        ],
        limitations: [
          "Mock token and simulated router; not an actual DEX swap",
          "Compatible source for Base/BNB, not deployed on those networks",
          "Existing native ETH/BNB buy paths have no USDC fee adapter yet",
          "NEAR receipt recorder requires trusted finalized-chain verification",
        ],
      },
      null,
      2,
    ) + "\n",
  );
  console.log("Local EVM fee vault: all 6 acceptance groups passed");
} finally {
  await local.disconnect();
}
