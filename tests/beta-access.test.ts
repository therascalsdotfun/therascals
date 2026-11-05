import { expect, it } from "vitest";
import {
  BetaAccess,
  claimNetwork,
  subjectFor,
} from "../apps/server/src/beta/access.ts";
import {
  betaClaimPolicy,
  runtimeOptions,
  trustedProxies,
} from "../apps/server/src/http/runtime.ts";
import { MarketStore } from "../apps/server/src/market/store.ts";
const alice = {
  kind: "phantom" as const,
  address: "alice",
  expiresAt: new Date(Date.now() + 100000).toISOString(),
};
const bob = { ...alice, address: "bob" };
it("assigns distinct fixed slots durably, rejects overflow, and retains ownership after restart", () => {
  const store = new MarketStore(":memory:"),
    access = new BetaAccess(store, ["beta01", "beta02"]);
  expect(access.claim(alice)).toBe("beta01");
  expect(access.claim(alice)).toBe("beta01");
  expect(access.claim(bob)).toBe("beta02");
  expect(() => access.claim({ ...alice, address: "eve" })).toThrow(/full/i);
  expect(new BetaAccess(store, ["beta01", "beta02"]).slot(alice)).toBe(
    "beta01",
  );
  expect(access.slot({ ...alice, address: "eve" })).toBeNull();
  expect(access.available()).toBe(0);
  expect(subjectFor({ ...alice, kind: "metamask", address: "0xAbC" })).toBe(
    subjectFor({ ...alice, kind: "metamask", address: "0xabc" }),
  );
  store.close();
});
it("reserves a single funded activation per UTC day before side effects, persisting unknown outcomes", () => {
  const store = new MarketStore(":memory:"),
    access = new BetaAccess(store, ["beta01"], () =>
      Date.parse("2026-10-25T10:00:00Z"),
    );
  expect(() => access.reserveActivation(alice)).toThrow(/claim/i);
  access.claim(alice);
  access.reserveActivation(alice);
  expect(() => access.reserveActivation(alice)).toThrow(/daily/i);
  expect(() =>
    new BetaAccess(store, ["beta01"], () =>
      Date.parse("2026-10-25T20:00:00Z"),
    ).reserveActivation(alice),
  ).toThrow(/daily/i);
  new BetaAccess(store, ["beta01"], () =>
    Date.parse("2026-10-26T00:00:00Z"),
  ).reserveActivation(alice);
  store.close();
});
const slots = ["beta01", "beta02", "beta03", "beta04", "beta05"];
const policy = (over: Record<string, unknown> = {}) => ({
  allowlist: null,
  perNetworkPerDay: 2,
  ...over,
});
it("spends a sponsored slot budget per network per day, not per wallet", () => {
  const store = new MarketStore(":memory:"),
    access = new BetaAccess(store, slots, () =>
      Date.parse("2026-10-25T10:00:00Z"),
    );
  const wallet = (n: number) => ({ ...alice, address: "wallet" + n }),
    ip = (last: number) => "203.0.113." + last;
  expect(access.claim(wallet(1), ip(1))).toBe("beta01");
  // Rotating within the same /24 is one subscriber, so it is one budget.
  expect(access.claim(wallet(2), ip(2))).toBe("beta02");
  expect(() => access.claim(wallet(3), ip(3))).toThrow(/daily share/i);
  expect(access.claim(wallet(3), "198.51.100.7")).toBe("beta03");
  // Re-claiming what you already hold is never charged.
  expect(access.claim(wallet(1), ip(9))).toBe("beta01");
  expect(() => access.claim(wallet(4), ip(1))).toThrow(/daily share/i);

  // A budget survives a restart because it lives in the state store.
  expect(() =>
    new BetaAccess(store, slots, () =>
      Date.parse("2026-10-25T23:00:00Z"),
    ).claim(wallet(5), ip(1)),
  ).toThrow(/daily share/i);
  new BetaAccess(store, slots, () => Date.parse("2026-10-26T00:30:00Z")).claim(
    wallet(5),
    ip(1),
  );
  store.close();
});
it("closes claims to invited wallets when the operator lists them", () => {
  const store = new MarketStore(":memory:"),
    access = new BetaAccess(
      store,
      slots,
      () => Date.parse("2026-10-25T10:00:00Z"),
      policy({ allowlist: ["0xAbC", "invite.near"] }),
    );
  expect(access.inviteOnly()).toBe(true);
  expect(() => access.claim(alice, "203.0.113.1")).toThrow(/invited/i);
  expect(access.claim({ ...alice, address: "0xabc" }, "203.0.113.1")).toBe(
    "beta01",
  );
  expect(
    access.claim({ ...alice, address: "invite.near" }, "203.0.113.1"),
  ).toBe("beta02");
  // A rejected invite attempt never reaches the budget, while the two invited
  // claims above each spend one unit of it.
  expect(store.records("beta-claims:").length).toBe(1);
  expect(store.getRecord("beta-claims:v4:203.0.113.0/24:2026-10-25")).toEqual({
    count: 2,
  });
  store.close();
});
it("honours a zero budget as paused claims and an empty list as a closed beta", () => {
  const store = new MarketStore(":memory:"),
    paused = new BetaAccess(
      store,
      slots,
      Date.now,
      policy({ perNetworkPerDay: 0 }),
    );
  expect(() => paused.claim(alice, "203.0.113.1")).toThrow(/paused/i);
  const closed = new BetaAccess(
    store,
    slots,
    Date.now,
    policy({ allowlist: [] }),
  );
  expect(() => closed.claim(alice, "203.0.113.1")).toThrow(/invited/i);
  // Nothing to attribute means no shared bucket: unattributed clients are not
  // rate limited as one, but an invite list still applies.
  const open = new BetaAccess(store, slots, Date.now, policy());
  expect(open.claim({ ...alice, address: "solo" }, undefined)).toBe("beta01");
  expect(open.claim({ ...alice, address: "solo2" }, "unknown")).toBe("beta02");
  store.close();
});
it("collapses an address to the network a rate limiter should budget", () => {
  expect(claimNetwork("203.0.113.7")).toBe("v4:203.0.113.0/24");
  expect(claimNetwork("203.0.113.250")).toBe("v4:203.0.113.0/24");
  expect(claimNetwork("198.51.100.7")).toBe("v4:198.51.100.0/24");
  expect(claimNetwork("::ffff:203.0.113.7")).toBe("v4:203.0.113.0/24");
  expect(claimNetwork("2001:db8:1:2:3:4:5:6")).toBe(
    "v6:2001:0db8:0001:0002/64",
  );
  expect(claimNetwork("2001:DB8:1:2::99")).toBe("v6:2001:0db8:0001:0002/64");
  expect(claimNetwork("2001:db8:9:9::")).toBe("v6:2001:0db8:0009:0009/64");
  expect(claimNetwork("fe80::1")).toBe("v6:fe80:0000:0000:0000/64");
  expect(claimNetwork("::1")).toBe("v6:0000:0000:0000:0000/64");
  expect(claimNetwork("2001:db8:1:2:3:4:5")).toBe("other:2001:db8:1:2:3:4:5");
  expect(claimNetwork("2001:db8::1::2")).toBe("other:2001:db8::1::2");
  expect(claimNetwork("nope")).toBe("other:nope");
  expect(claimNetwork(null)).toBe("unknown");
  expect(claimNetwork("")).toBe("unknown");
  expect(claimNetwork("666.1.1.1")).toBe("other:666.1.1.1");
});
it("refuses proxy trust forms that would let a client pick its own address", () => {
  expect(trustedProxies({})).toBe(false);
  expect(trustedProxies({ JACKPOT_TRUST_PROXY: "0" })).toBe(false);
  expect(trustedProxies({ JACKPOT_TRUST_PROXY: "false" })).toBe(false);
  // The documented single-proxy deployment: a proxy on this host.
  expect(trustedProxies({ JACKPOT_TRUST_PROXY: "1" })).toBe("127.0.0.1, ::1");
  expect(trustedProxies({ JACKPOT_TRUST_PROXY: "10.0.0.5, 10.0.0.0/24" })).toBe(
    "10.0.0.5, 10.0.0.0/24",
  );
  expect(trustedProxies({ JACKPOT_TRUST_PROXY: " fd00::/8 " })).toBe(
    "fd00::/8",
  );
  // `true` is read as "I do have a proxy" and mapped to the safe same-host
  // list; it is never passed to Fastify as believe-everything. A bare number or
  // a nonsense address fails at startup instead of silently mis-setting trust.
  expect(trustedProxies({ JACKPOT_TRUST_PROXY: "true" })).toBe(
    "127.0.0.1, ::1",
  );
  for (const bad of [
    "2",
    "yes",
    "10.0.0.5 10.0.0.6",
    "10.0.0.0/33",
    "10.0.0.0/",
  ])
    expect(() => trustedProxies({ JACKPOT_TRUST_PROXY: bad }), bad).toThrow(
      /JACKPOT_TRUST_PROXY/,
    );
});

it("reads the claim policy from the environment and refuses nonsense", () => {
  expect(betaClaimPolicy({})).toEqual({
    allowlist: null,
    perNetworkPerDay: 2,
  });
  expect(
    betaClaimPolicy({
      JACKPOT_BETA_ALLOWLIST: " 0xABC , invite.near,, ",
      JACKPOT_BETA_CLAIMS_PER_NETWORK_PER_DAY: "5",
    }),
  ).toEqual({ allowlist: ["0xabc", "invite.near"], perNetworkPerDay: 5 });
  expect(betaClaimPolicy({ JACKPOT_BETA_ALLOWLIST: "" }).allowlist).toEqual([]);
  for (const bad of ["-1", "1.5", "two"])
    expect(() =>
      betaClaimPolicy({ JACKPOT_BETA_CLAIMS_PER_NETWORK_PER_DAY: bad }),
    ).toThrow();
});
it("rejects unsafe public deployment configuration and never implicitly publishes operator mode", () => {
  expect(runtimeOptions({}).mode).toBe("local");
  for (const env of [
    { JACKPOT_MODE: "public-testnet" },
    {
      JACKPOT_MODE: "public-testnet",
      JACKPOT_PUBLIC_ORIGIN: "http://demo.example",
      JACKPOT_BETA_SLOTS: "beta01",
    },
    {
      JACKPOT_MODE: "public-testnet",
      JACKPOT_PUBLIC_ORIGIN: "https://demo.example/path",
      JACKPOT_BETA_SLOTS: "beta01",
    },
    {
      JACKPOT_MODE: "public-testnet",
      JACKPOT_PUBLIC_ORIGIN: "https://demo.example",
      JACKPOT_BETA_SLOTS: "../secret",
    },
    { JACKPOT_MODE: "unknown" },
  ])
    expect(() => runtimeOptions(env)).toThrow();
  const publicMode = runtimeOptions({
    JACKPOT_MODE: "public-testnet",
    JACKPOT_PUBLIC_ORIGIN: "https://demo.example",
    JACKPOT_BETA_SLOTS: "beta01,beta02",
  });
  expect([...publicMode.origins]).toEqual(["https://demo.example"]);
  expect(publicMode.slots).toEqual(["beta01", "beta02"]);
});
