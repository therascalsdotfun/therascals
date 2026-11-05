export const DEGEN_ODDS_VERSION = "full-degen-v1";
export const DEGEN_AMOUNTS = Object.freeze(
  [
    { dollars: 1, weight: 2000 },
    { dollars: 2, weight: 1500 },
    { dollars: 3, weight: 1200 },
    { dollars: 4, weight: 1000 },
    { dollars: 5, weight: 800 },
    { dollars: 7, weight: 650 },
    { dollars: 10, weight: 550 },
    { dollars: 12, weight: 450 },
    { dollars: 15, weight: 350 },
    { dollars: 20, weight: 300 },
    { dollars: 25, weight: 250 },
    { dollars: 30, weight: 220 },
    { dollars: 35, weight: 180 },
    { dollars: 40, weight: 150 },
    { dollars: 45, weight: 120 },
    { dollars: 50, weight: 100 },
    { dollars: 60, weight: 75 },
    { dollars: 70, weight: 50 },
    { dollars: 85, weight: 35 },
    { dollars: 100, weight: 20 },
  ].map((choice) => Object.freeze(choice)),
);

/** Uniform integer entropy is supplied by server crypto or a domain-separated chain draw. */
export function degenAmountForRoll(roll: number): number {
  if (!Number.isInteger(roll) || roll < 0 || roll >= 10_000)
    throw Error("Amount roll must be an integer in 0..9999");
  let boundary = 0;
  for (const choice of DEGEN_AMOUNTS) {
    boundary += choice.weight;
    if (roll < boundary) return choice.dollars;
  }
  throw Error("Invalid amount distribution");
}
export function degenExpectedAmount(): number {
  return DEGEN_AMOUNTS.reduce(
    (sum, choice) => sum + (choice.dollars * choice.weight) / 10_000,
    0,
  );
}
