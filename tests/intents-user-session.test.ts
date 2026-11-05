import { expect, it } from "vitest";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { WalletAuthService } from "../apps/server/src/auth/service.ts";
import { IntentsUserSessions } from "../apps/server/src/intents/user-session.ts";
import { IntentsService } from "../apps/server/src/intents/service.ts";
import { signIntentsSession } from "../apps/web/src/wallets/intents-auth.ts";

async function fixture() {
  let now = Date.now();
  const auth = new WalletAuthService({ now: () => now }),
    key = nacl.sign.keyPair(),
    address = bs58.encode(key.publicKey),
    origin = "https://therascals.fun";
  async function login() {
    const browser = auth.createBrowser(),
      c = auth.issue(browser, origin, { kind: "phantom", address });
    const signed = await auth.verify(browser, origin, {
      id: c.id,
      signature: bs58.encode(
        nacl.sign.detached(Buffer.from(c.message), key.secretKey),
      ),
    });
    return { browser, token: signed.token };
  }
  const calls: any[] = [];
  let reject = false,
    delayed: (() => Promise<void>) | undefined;
  const fetcher = (async (url: any, init: any) => {
    calls.push({ url, init });
    if (url.includes("rpc.mainnet"))
      return Response.json({
        result: { result: [...Buffer.from('"252812b3"')] },
      });
    if (delayed) await delayed();
    return reject
      ? Response.json({ message: "sensitive-provider-body" }, { status: 401 })
      : Response.json({
          accessToken: "server-only-credential",
          expiresIn: 60,
          refreshToken: "discard-this",
          refreshExpiresIn: 3600,
        });
  }) as typeof fetch;
  const sessions = new IntentsUserSessions(auth, fetcher, () => now),
    first = await login();
  const proof = (payload: string) =>
    bs58.encode(nacl.sign.detached(Buffer.from(payload), key.secretKey));
  return {
    auth,
    key,
    address,
    origin,
    calls,
    sessions,
    first,
    proof,
    login,
    advance: (n: number) => {
      now += n;
    },
    reject: () => {
      reject = true;
    },
    delay: (fn: () => Promise<void>) => {
      delayed = fn;
    },
  };
}
it("binds a single-use empty intent to one browser session; credentials never appear in response", async () => {
  const f = await fixture(),
    c = await f.sessions.challenge(f.first.token, f.origin);
  const p = JSON.parse(c.payload),
    nonce = Buffer.from(p.nonce, "base64");
  expect(p.intents).toEqual([]);
  expect(p.signer_id).toBe(Buffer.from(f.key.publicKey).toString("hex"));
  expect([...nonce.subarray(0, 5)]).toEqual([86, 40, 246, 198, 0]);
  expect(nonce.subarray(5, 9).toString("hex")).toBe("252812b3");
  expect(nonce.readBigUInt64LE(9)).toBe(
    BigInt(Date.parse(c.expiresAt)) * 1000000n,
  );
  const second = await f.login();
  await expect(
    f.sessions.verify(second.token, f.origin, c.id, f.proof(c.payload)),
  ).rejects.toThrow("expired or changed");
  const status = await f.sessions.verify(
    f.first.token,
    f.origin,
    c.id,
    f.proof(c.payload),
  );
  expect(status.authorized).toBe(true);
  expect(JSON.stringify(status)).not.toContain("credential");
  expect(JSON.stringify(status)).not.toContain("refresh");
  expect(f.sessions.access(f.first.token)).toBe("server-only-credential");
  expect(f.sessions.status(second.token).authorized).toBe(false);
  await expect(
    f.sessions.verify(f.first.token, f.origin, c.id, f.proof(c.payload)),
  ).rejects.toThrow("expired or changed");
  f.auth.logout(f.first.browser, f.first.token);
  expect(() => f.sessions.access(f.first.token)).toThrow("Verify your wallet");
});
it("rejects altered signatures, origin mismatch, expired and superseded challenges before provider authentication", async () => {
  const f = await fixture();
  let c = await f.sessions.challenge(f.first.token, f.origin);
  await expect(
    f.sessions.verify(
      f.first.token,
      f.origin,
      c.id,
      bs58.encode(new Uint8Array(64)),
    ),
  ).rejects.toThrow("Signature");
  await expect(
    f.sessions.verify(f.first.token, f.origin, c.id, f.proof(c.payload)),
  ).rejects.toThrow("expired");
  c = await f.sessions.challenge(f.first.token, f.origin);
  await expect(
    f.sessions.verify(
      f.first.token,
      "https://evil.example",
      c.id,
      f.proof(c.payload),
    ),
  ).rejects.toThrow("expired");
  c = await f.sessions.challenge(f.first.token, f.origin);
  await f.sessions.challenge(f.first.token, f.origin);
  await expect(
    f.sessions.verify(f.first.token, f.origin, c.id, f.proof(c.payload)),
  ).rejects.toThrow("expired");
  c = await f.sessions.challenge(f.first.token, f.origin);
  f.advance(120001);
  await expect(
    f.sessions.verify(f.first.token, f.origin, c.id, f.proof(c.payload)),
  ).rejects.toThrow("expired");
  expect(f.calls.filter((c) => c.url.includes("/authenticate"))).toHaveLength(
    0,
  );
});
it("expires and revokes authorization without returning refresh tokens", async () => {
  const f = await fixture(),
    c = await f.sessions.challenge(f.first.token, f.origin);
  await f.sessions.verify(f.first.token, f.origin, c.id, f.proof(c.payload));
  f.advance(60001);
  expect(f.sessions.status(f.first.token).authorized).toBe(false);
  expect(() => f.sessions.access(f.first.token, true)).toThrow("Authorize");
});
it("does not install a session after logout during provider authentication", async () => {
  const f = await fixture(),
    c = await f.sessions.challenge(f.first.token, f.origin);
  let release!: () => void;
  f.delay(
    () =>
      new Promise<void>((r) => {
        release = r;
      }),
  );
  const pending = f.sessions.verify(
    f.first.token,
    f.origin,
    c.id,
    f.proof(c.payload),
  );
  await Promise.resolve();
  f.auth.logout(f.first.browser, f.first.token);
  release();
  await expect(pending).rejects.toThrow("Verify your wallet");
});
it("consumes rejected provider authorization and hides its response body", async () => {
  const f = await fixture(),
    c = await f.sessions.challenge(f.first.token, f.origin);
  f.reject();
  await expect(
    f.sessions.verify(f.first.token, f.origin, c.id, f.proof(c.payload)),
  ).rejects.toThrow("Intents rejected");
  expect(f.sessions.status(f.first.token).authorized).toBe(false);
  await expect(
    f.sessions.verify(f.first.token, f.origin, c.id, f.proof(c.payload)),
  ).rejects.toThrow("expired");
});
it("keeps quote authentication separate from user sessions and reports provider access failure accurately", async () => {
  const calls: any[] = [];
  const provider = new IntentsService(
    (async (url, init) => {
      calls.push({ url, headers: init?.headers });
      return Response.json(
        {
          message:
            "User authentication is required for confidential intent quotes",
        },
        { status: 401 },
      );
    }) as typeof fetch,
    Date.now,
    "partner-credential",
  );
  await expect(
    provider.executableRequest("/quote", { confidentiality: "basic" }),
  ).rejects.toThrow("Confidential quote access is not available");
  expect(calls[0].headers).toMatchObject({ "X-API-Key": "partner-credential" });
  expect(calls[0].headers.Authorization).toBeUndefined();
});
it("Phantom signs the exact empty intent and rejects a transaction-bearing message", async () => {
  const f = await fixture(),
    c = await f.sessions.challenge(f.first.token, f.origin);
  let signed = 0;
  const p = {
    publicKey: { toString: () => f.address },
    signMessage: async (bytes: Uint8Array) => {
      signed++;
      return { signature: nacl.sign.detached(bytes, f.key.secretKey) };
    },
  };
  const signature = await signIntentsSession(p, c, f.address, () => true);
  expect(signature).toBe(f.proof(c.payload));
  for (const payload of [
    { ...JSON.parse(c.payload), intents: [{ intent: "transfer" }] },
    { ...JSON.parse(c.payload), verifying_contract: "evil.near" },
    { ...JSON.parse(c.payload), signer_id: "0".repeat(64) },
  ])
    await expect(
      signIntentsSession(
        p,
        { ...c, payload: JSON.stringify(payload) },
        f.address,
        () => true,
      ),
    ).rejects.toThrow("Unexpected");
  expect(signed).toBe(1);
});
it("Phantom discards a late signature after account change or logout", async () => {
  const f = await fixture(),
    c = await f.sessions.challenge(f.first.token, f.origin);
  let current = true;
  const p = {
    publicKey: { toString: () => f.address },
    signMessage: async (bytes: Uint8Array) => {
      current = false;
      return { signature: nacl.sign.detached(bytes, f.key.secretKey) };
    },
  };
  await expect(
    signIntentsSession(p, c, f.address, () => current),
  ).rejects.toThrow("Wallet changed");
});

it("HTTP binds proof to its cookie and blocks confidential preparation while preserving public preparation", async () => {
  const { default: Fastify } = await import("fastify");
  const { registerIntentsExecution } =
    await import("../apps/server/src/intents/http.ts");
  const { cookies } = await import("../apps/server/src/auth/http.ts");
  const f = await fixture(),
    app = Fastify();
  let prepared = 0;
  const execution = {
    prepare: async () => {
      prepared++;
      return { id: "public-operation" };
    },
  };
  registerIntentsExecution(
    app,
    execution as any,
    {} as any,
    (req) => f.auth.session(cookies(req).jackpot_session),
    f.auth,
    f.sessions,
  );
  const headers = {
    cookie: "jackpot_session=" + f.first.token,
    origin: f.origin,
  };
  try {
    expect((await app.inject({ url: "/api/intents/session" })).statusCode).toBe(
      401,
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/intents/session/challenge",
          headers: { cookie: headers.cookie },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    const c = await app.inject({
      method: "POST",
      url: "/api/intents/session/challenge",
      headers,
      payload: {},
    });
    expect(c.statusCode).toBe(200);
    const challenge = c.json(),
      payload = { id: challenge.id, signature: f.proof(challenge.payload) };
    const verified = await app.inject({
      method: "POST",
      url: "/api/intents/session/verify",
      headers,
      payload,
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.json()).toMatchObject({
      authorized: true,
      quoteAvailable: false,
    });
    expect(verified.body).not.toContain("server-only-credential");
    const input = {
      requestId: crypto.randomUUID(),
      confidentiality: "basic",
      originAsset: "sol",
      destinationAsset: "base",
      amount: "1",
      recipient: "0x1111",
    };
    const blocked = await app.inject({
      method: "POST",
      url: "/api/intents/operations",
      headers,
      payload: input,
    });
    expect(blocked.statusCode).toBe(503);
    expect(blocked.json().error).toContain("awaiting the provider");
    expect(prepared).toBe(0);
    const publicQuote = await app.inject({
      method: "POST",
      url: "/api/intents/operations",
      headers,
      payload: { ...input, confidentiality: "public" },
    });
    expect(publicQuote.statusCode).toBe(200);
    expect(prepared).toBe(1);
    f.auth.logout(f.first.browser, f.first.token);
    expect(
      (await app.inject({ url: "/api/intents/session", headers })).statusCode,
    ).toBe(401);
  } finally {
    await app.close();
  }
});
