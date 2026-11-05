import { expect, it } from "vitest";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { createApp } from "../apps/server/src/http/app.ts";
const origin = "http://127.0.0.1:5177",
  k = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(27)),
  address = bs58.encode(k.publicKey);
const cookie = (r: any) =>
  ((r.headers["set-cookie"] as string[] | string) ?? [])
    .toString()
    .split(",")
    .map((s: string) => s.trim().split(";")[0])
    .join("; ");
it("requires a same-origin browser-bound challenge and exchanges a real signature for an HttpOnly session", async () => {
  const app = await createApp({} as any);
  for (const headers of [{}, { origin: "https://evil.example" }])
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/challenge",
          headers,
          payload: { kind: "phantom", address },
        })
      ).statusCode,
    ).toBe(403);
  const c = await app.inject({
    method: "POST",
    url: "/api/auth/challenge",
    headers: { origin },
    payload: { kind: "phantom", address },
  });
  expect(c.statusCode).toBe(200);
  expect(c.headers["set-cookie"]).toContain("HttpOnly");
  expect(c.headers["set-cookie"]).toContain("SameSite=Strict");
  expect(c.headers["cache-control"]).toBe("no-store");
  const challenge = c.json(),
    signature = bs58.encode(
      nacl.sign.detached(Buffer.from(challenge.message), k.secretKey),
    ),
    payload = { id: challenge.id, signature };
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/auth/verify",
        headers: { origin },
        payload,
      })
    ).statusCode,
  ).toBe(401);
  const v = await app.inject({
    method: "POST",
    url: "/api/auth/verify",
    headers: { origin, cookie: cookie(c) },
    payload,
  });
  expect(v.statusCode).toBe(200);
  expect(v.json().identity.address).toBe(address);
  expect(v.json().token).toBeUndefined();
  const cookies = cookie(c) + "; " + cookie(v);
  expect(
    (
      await app.inject({
        url: "/api/auth/session",
        headers: { cookie: cookies },
      })
    ).json().identity.address,
  ).toBe(address);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/auth/verify",
        headers: { origin, cookie: cookies },
        payload,
      })
    ).statusCode,
  ).toBe(401);
  const logout = await app.inject({
    method: "POST",
    url: "/api/auth/logout",
    headers: { origin, cookie: cookies },
  });
  expect(logout.statusCode).toBe(200);
  expect(
    (
      await app.inject({
        url: "/api/auth/session",
        headers: { cookie: cookies },
      })
    ).json().identity,
  ).toBeNull();
  await app.close();
});
it("validates signature payloads and rate-limits requests without a cookie", async () => {
  const app = await createApp({} as any);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/auth/challenge",
        headers: { origin },
        payload: { kind: "metamask", address: "0x1", chainId: "0x1" },
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/auth/verify",
        headers: { origin },
        payload: { id: "wrong", signature: "bad", arbitraryMessage: "sign me" },
      })
    ).statusCode,
  ).toBe(400);
  let response: any;
  for (let i = 0; i < 32; i++)
    response = await app.inject({
      method: "POST",
      url: "/api/auth/challenge",
      headers: { origin },
      payload: { kind: "phantom", address },
    });
  expect(response.statusCode).toBe(429);
  expect(response.json().code).toBe("RATE_LIMITED");
  await app.close();
});
it("logout still revokes a valid session after the sign-in request budget is exhausted", async () => {
  const app = await createApp({} as any),
    c = await app.inject({
      method: "POST",
      url: "/api/auth/challenge",
      headers: { origin },
      payload: { kind: "phantom", address },
    }),
    challenge = c.json();
  const v = await app.inject({
      method: "POST",
      url: "/api/auth/verify",
      headers: { origin, cookie: cookie(c) },
      payload: {
        id: challenge.id,
        signature: bs58.encode(
          nacl.sign.detached(Buffer.from(challenge.message), k.secretKey),
        ),
      },
    }),
    cookies = cookie(c) + "; " + cookie(v);
  for (let i = 0; i < 31; i++)
    await app.inject({
      method: "POST",
      url: "/api/auth/challenge",
      headers: { origin },
      payload: { kind: "phantom", address },
    });
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/auth/logout",
        headers: { origin, cookie: cookies },
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await app.inject({
        url: "/api/auth/session",
        headers: { cookie: cookies },
      })
    ).json().identity,
  ).toBeNull();
  await app.close();
});
