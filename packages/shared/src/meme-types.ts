/** Narrative hints only. Names and symbols are untrusted and do not verify identity. */
export const MEME_TYPES = [
  {
    id: "politics",
    label: "Politics",
    terms: [
      "trump",
      "biden",
      "obama",
      "maga",
      "harris",
      "putin",
      "zelensky",
      "election",
      "president",
      "politics",
      "netanyahu",
      "bibi",
    ],
  },
  {
    id: "crypto-twitter",
    label: "Crypto Twitter",
    terms: [
      "ct",
      "degen",
      "gm",
      "wagmi",
      "ngmi",
      "anon",
      "ansem",
      "gcr",
      "cobie",
      "hsaka",
      "toly",
      "mert",
    ],
  },
  {
    id: "famous",
    label: "Famous memes",
    terms: [
      "pepe",
      "doge",
      "wojak",
      "chad",
      "bonk",
      "shiba",
      "ponke",
      "popcat",
      "moodeng",
      "gigachad",
      "nyan",
    ],
  },
  {
    id: "celebrity",
    label: "Celebrity",
    terms: [
      "elon",
      "musk",
      "taylor",
      "swift",
      "kanye",
      "ye",
      "drake",
      "rihanna",
      "beyonce",
      "celebrity",
      "celeberity",
      "mrbeast",
    ],
  },
  {
    id: "tech",
    label: "Tech & AI",
    terms: [
      "ai",
      "gpt",
      "chatgpt",
      "openai",
      "claude",
      "gemini",
      "deepseek",
      "robot",
      "agent",
      "tech",
      "nvidia",
      "nvda",
    ],
  },
  {
    id: "stocks",
    label: "Stocks",
    terms: [
      "stock",
      "stocks",
      "nasdaq",
      "sp500",
      "aapl",
      "tsla",
      "nvda",
      "gme",
      "amc",
      "spy",
      "nvidia",
    ],
  },
  {
    id: "animals",
    label: "Animals",
    terms: [
      "cat",
      "dog",
      "kitten",
      "puppy",
      "inu",
      "shiba",
      "frog",
      "penguin",
      "hippo",
      "goat",
      "monkey",
      "hamster",
      "capybara",
    ],
  },
  { id: "other", label: "Uncategorized", terms: [] },
] as const;
export type MemeType = (typeof MEME_TYPES)[number]["id"];
export function inferMemeTypes(token: {
  name: string;
  symbol: string;
}): MemeType[] {
  const words = new Set(
    (token.name + " " + token.symbol)
      .normalize("NFKD")
      .toLowerCase()
      .match(/[a-z0-9]+/g) ?? [],
  );
  const found = MEME_TYPES.filter(
    (c) => c.id !== "other" && c.terms.some((term) => words.has(term)),
  ).map((c) => c.id);
  return found.length ? found : ["other"];
}
