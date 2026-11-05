import { jevDailyEstimate } from "../packages/shared/src/jev-cost.ts";
const estimate = jevDailyEstimate(
  Number(process.argv[2] ?? 1000),
  Number(process.argv[3] ?? 5000),
  Number(process.argv[4] ?? 60),
);
console.log(
  JSON.stringify(
    {
      ...estimate,
      model: "jev-1.14.0",
      priceCheckedAt: "2026-10-29",
      notes:
        "Estimate only; no API call. Billed state + questions assumed in input tokens. Excludes data collection, new admissions, retries, hosting and taxes. Ten-minute scheduler ticks do not imply reviewing every token every tick.",
    },
    null,
    2,
  ),
);
