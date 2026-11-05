/** Published input price checked 2026-10-29. Collection/API charges excluded. */
export const JEV_INPUT_USD_PER_MILLION = 0.042;
export function jevDailyEstimate(
  activeTokens: number,
  inputTokensPerReview: number,
  reviewMinutes = 60,
) {
  if (
    ![activeTokens, inputTokensPerReview, reviewMinutes].every(
      (v) => Number.isSafeInteger(v) && v > 0,
    ) ||
    activeTokens > 1e6 ||
    inputTokensPerReview > 64000 ||
    reviewMinutes < 10 ||
    1440 % reviewMinutes !== 0
  )
    throw Error(
      "Use positive bounded counts and a review interval dividing 1440 minutes (at least 10).",
    );
  const reviewsPerDay = (activeTokens * 1440) / reviewMinutes;
  const inputTokensPerDay = reviewsPerDay * inputTokensPerReview;
  return {
    activeTokens,
    inputTokensPerReview,
    reviewMinutes,
    schedulerTicksPerDay: 144,
    reviewsPerDay,
    inputTokensPerDay,
    modelUsdPerDay: (inputTokensPerDay / 1e6) * JEV_INPUT_USD_PER_MILLION,
  };
}
