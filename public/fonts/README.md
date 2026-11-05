# Self-hosted faces

Four font families, latin subset, WOFF2, 87 KB total. Baloo 2, Lilita One and Patrick Hand use SIL Open Font License 1.1; Permanent Marker uses Apache License 2.0. Served same-origin because the content security policy allows `font-src 'self' data:` and no third-party font host is permitted.

| File | Family | Weights | Author | Role | Source |
| --- | --- | --- | --- | --- | --- |
| `baloo2-latin.woff2` | Baloo 2 | variable 400–800 | Ek Type | `--display`: wordmark and every display headline | https://fonts.google.com/specimen/Baloo+2 |
| `lilita-one-latin.woff2` | Lilita One | 400 | Fontstage | `--marquee`: slot and perps cabinet marquees | https://fonts.google.com/specimen/Lilita+One |
| `patrick-hand-latin.woff2` | Patrick Hand | 400 | Patrick Design | `--hand`: lowercase margin scribbles and captions in the app | https://fonts.google.com/specimen/Patrick+Hand |
| `permanent-marker-latin.woff2` | Permanent Marker | 400 | Font Diner | `--marker`: poster accents, **marketing only, never app UI** | https://fonts.google.com/specimen/Permanent+Marker |

Retrieved from the Google Fonts CSS2 API on 2026-10-30.

**Why these four.** Before this, the brand depended on `Arial Rounded MT Bold`, `Arial Black`, `Impact` and `Chalkboard SE`, all Apple or Windows system faces, so a visitor on Linux saw a generic sans where the identity is hand-cut. The intro film additionally referenced a `Lilita One` whose stylesheet was never in the repository, and silently fell back. Each replacement was chosen to match what the system face actually looked like, which keeps this a fix rather than a redesign.

**Why not Permanent Marker in the app.** It was tried for `--hand` first. Its caps are too loud and its letterforms too wide for a scribble sitting beside a wallet button, and it visibly changed the character of `a little chaos :)` and `oops!`. Patrick Hand preserves the original handwriting register. Permanent Marker stays available as `--marker` for poster-scale accents in marketing renders, where the felt-tip weight is the point.

**Licence notices.** The three OFL families have their full notices in `baloo2-OFL.txt`, `lilita-one-OFL.txt` and `patrick-hand-OFL.txt`. Permanent Marker has its Apache 2.0 text in `permanent-marker-LICENSE.txt`. These local files were retrieved from the Google Fonts source repository. The imported fonts are unmodified binaries; retain their notices when distributing them. The upstream Permanent Marker license is https://github.com/google/fonts/blob/main/apache/permanentmarker/LICENSE.txt; the other families are under the matching `ofl/` directories. Keep the notices and source table current if a face is swapped.
