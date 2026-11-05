import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
const css = readFileSync(
  new URL("../apps/web/src/status-theme.css", import.meta.url),
  "utf8",
);
const values = Object.fromEntries(
  [...css.matchAll(/--([\w-]+):\s*(#[\da-f]{6})/gi)].map((m) => [m[1], m[2]]),
);
const luminance = (hex: string) => {
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
};
const contrast = (a: string, b: string) => {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
it("keeps semantic status text and action links readable on their paired paper surfaces", () => {
  for (const role of ["info", "success", "error", "warning"]) {
    const bg = values[`status-${role}-bg`],
      ink = values[`status-${role}-ink`];
    expect(contrast(bg, ink), role + " text").toBeGreaterThanOrEqual(4.5);
    expect(contrast(bg, "#3557d7"), role + " links").toBeGreaterThanOrEqual(
      4.5,
    );
  }
});
