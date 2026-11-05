import { it, expect } from "vitest";
import {
  assertTestnetAccount,
  assertDevnetGenesis,
} from "../apps/server/src/execution/network.ts";
it("rejects production accounts, truncated identifiers and other chains before signing", () => {
  expect(() => assertTestnetAccount("team.near")).toThrow();
  expect(() => assertTestnetAccount("team.testnet")).not.toThrow();
  expect(() =>
    assertDevnetGenesis("5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"),
  ).toThrow();
  expect(() =>
    assertDevnetGenesis("EtWTRABZaYq6iMfeYKouRu166VU2xqa1"),
  ).toThrow();
  expect(() =>
    assertDevnetGenesis("EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"),
  ).not.toThrow();
});
