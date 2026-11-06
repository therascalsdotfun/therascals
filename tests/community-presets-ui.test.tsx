import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CommunityPresets } from "../apps/web/src/CommunityPresets.tsx";
import { DEFAULT_FILTERS } from "../apps/server/src/market/model.ts";

it("renders community preset tabs and navigation controls", () => {
  const html = renderToStaticMarkup(
    <CommunityPresets
      currentFilters={{ ...DEFAULT_FILTERS }}
      activePresetId={null}
      onApplyPreset={() => {}}
      userAddress="11111111111111111111111111111111"
    />,
  );
  expect(html).toContain("Community Presets");
  expect(html).toContain("My Presets");
  expect(html).toContain("Publish My Setup");
  expect(html).toContain("role=\"tablist\"");
});

it("displays active preset status when a preset is loaded", () => {
  const html = renderToStaticMarkup(
    <CommunityPresets
      currentFilters={{ ...DEFAULT_FILTERS }}
      activePresetId="preset-uuid-1"
      onApplyPreset={() => {}}
    />,
  );
  expect(html).toContain("community-presets-container");
});

it("renders search bar and sort controls", () => {
  const html = renderToStaticMarkup(
    <CommunityPresets
      currentFilters={{ ...DEFAULT_FILTERS }}
      activePresetId={null}
      onApplyPreset={() => {}}
    />,
  );
  expect(html).toContain("Search by title or wallet address");
  expect(html).toContain("Most Popular");
  expect(html).toContain("Most Traded");
  expect(html).toContain("Newest");
});
