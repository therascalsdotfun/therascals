import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { discoveryLoading } from "../apps/web/src/discovery-loading.ts";
import { LoadingSkeleton } from "../apps/web/src/LoadingSkeleton.tsx";
const data: any = {
  pool: [],
  filters: { chains: ["bsc"] },
  health: { state: "live" },
  coverage: { chainSources: { bsc: { observed: 0, loading: true } } },
  rows: [],
};
it("shows skeletons before discovery and during initial selected-chain loading", () => {
  expect(discoveryLoading(null, null)).toBe(true);
  expect(discoveryLoading(data, null)).toBe(true);
  expect(discoveryLoading({ ...data, pool: [{}, {}] }, null)).toBe(false);
  expect(discoveryLoading({ ...data, pool: [{}, {}] }, "discovery")).toBe(true);
});
it("distinguishes completed empty results and provider failures from data still being checked", () => {
  const loaded = {
    ...data,
    coverage: { chainSources: { bsc: { observed: 0, loading: false } } },
  };
  expect(discoveryLoading(loaded, null)).toBe(false);
  expect(
    discoveryLoading(
      {
        ...loaded,
        rows: [{ matches: true, admissionReasons: ["security_pending"] }],
      },
      null,
    ),
  ).toBe(true);
  expect(
    discoveryLoading(
      {
        ...loaded,
        rows: [{ matches: true, admissionReasons: ["security_unavailable"] }],
      },
      null,
    ),
  ).toBe(false);
});
it("renders an accessible skeleton without empty-state warnings or invented token values", () => {
  const html = renderToStaticMarkup(<LoadingSkeleton kind="machine" />);
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain('role="status"');
  expect(html).not.toContain("not ready");
  expect(html).not.toContain("Adjust filters");
  expect(html).not.toContain("No coins");
});
it("stops the skeleton after a failed market read or terminal feed failure with pending pair data", () => {
  expect(discoveryLoading(null, null, true)).toBe(false);
  const failed = {
    ...data,
    filters: { chains: ["solana"] },
    health: { state: "error" },
    coverage: {
      chainSources: {
        solana: { loading: true, error: "Provider unavailable" },
      },
    },
    rows: [{ matches: true, admissionReasons: ["reference_pair_pending"] }],
  };
  expect(discoveryLoading(failed, null)).toBe(false);
  expect(
    discoveryLoading({ ...failed, health: { state: "rate_limited" } }, null),
  ).toBe(false);
  expect(
    discoveryLoading(
      {
        ...failed,
        health: { state: "live" },
        coverage: { chainSources: { solana: { loading: false, error: null } } },
      },
      null,
    ),
  ).toBe(true);
});

it("keeps an already loaded machine visible during draw selection, even if polling changes eligibility", () => {
  expect(discoveryLoading({ ...data, pool: [{}, {}] } as any, "draw")).toBe(
    false,
  );
  expect(
    discoveryLoading(
      {
        ...data,
        pool: [],
        rows: [{ matches: true, admissionReasons: ["security_pending"] }],
      } as any,
      "draw",
    ),
  ).toBe(false);
  expect(discoveryLoading(null, "draw")).toBe(true);
});
