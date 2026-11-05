import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PromotionTag,
  RiskBadge,
  drawReadiness,
} from "../apps/web/src/TokenScreening.tsx";
it("labels only fresh active paid boosts and drops expired or malformed promotion data", () => {
  const dex: any = {
    activeBoosts: 5,
    stale: false,
    fetchedAt: new Date().toISOString(),
  };
  expect(renderToStaticMarkup(<PromotionTag dex={dex} />)).toContain(
    "Promoted",
  );
  expect(renderToStaticMarkup(<PromotionTag dex={dex} />)).toContain(
    "no effect on draw odds",
  );
  for (const patch of [
    { activeBoosts: 0 },
    { activeBoosts: -1 },
    { activeBoosts: 1.2 },
    { stale: true },
    { fetchedAt: new Date(Date.now() - 61000).toISOString() },
    { fetchedAt: "bad" },
  ])
    expect(
      renderToStaticMarkup(<PromotionTag dex={{ ...dex, ...patch }} />),
    ).toBe("");
});

it("distinguishes unavailable risk reports from expired successful scans", () => {
  const unavailable: any = {
    status: "unavailable",
    checkedAt: new Date().toISOString(),
    reportAt: null,
    risks: [],
    error: "RugCheck HTTP 429",
  };
  expect(
    renderToStaticMarkup(<RiskBadge risk={unavailable} mint="mint" />),
  ).toContain("Scan unavailable");
  expect(
    renderToStaticMarkup(
      <RiskBadge
        risk={{
          ...unavailable,
          status: "checked",
          checkedAt: new Date(Date.now() - 300001).toISOString(),
          reportAt: new Date(Date.now() - 86400000).toISOString(),
        }}
        mint="mint"
      />,
    ),
  ).toContain("Scan expired");
});

it("shows a freshly fetched report for an older token as checked, not expired", () => {
  const risk: any = {
    status: "checked",
    risks: [],
    checkedAt: new Date().toISOString(),
    reportAt: new Date(Date.now() - 86400000).toISOString(),
  };
  const html = renderToStaticMarkup(<RiskBadge risk={risk} mint="mint" />);
  expect(html).toContain("Risk checked");
  expect(html).not.toContain("Scan expired");
});

it("shows terminal screening blockers instead of an endless checking state", () => {
  const response: any = {
    matching: 3,
    pool: [],
    health: { state: "live" },
    rows: [
      { matches: true, admissionReasons: ["security_flagged"] },
      { matches: true, admissionReasons: ["security_flagged"] },
      { matches: true, admissionReasons: ["unknown_pair_liquidity"] },
    ],
  };
  const status = drawReadiness(response);
  expect(status.title).toBe("No coins cleared screening");
  expect(status.detail).toContain("2 risk flagged");
  expect(status.detail).toContain("1 no pair liquidity");
  response.rows[0].admissionReasons = ["security_stale"];
  expect(drawReadiness(response).title).toBe("Fresh risk checks required");
  response.rows[0].admissionReasons = ["security_pending"];
  expect(drawReadiness(response).title).toBe("Waiting for fresh token checks");
  response.pool = [{}];
  expect(drawReadiness(response).title).toBe("One coin ready. Need two.");
  response.pool = [{}, {}];
  expect(drawReadiness(response).title).toBe("Coins ready to draw");
});
