# Design QA — English, Russian, and Japanese Strategy Card Labels

- Source visual truth: conversation attachments `Google Chrome Appshot 2026-07-16T04-57-41.655Z.png`, `Google Chrome Appshot 2026-07-16T04-57-46.497Z.png`, `Google Chrome Appshot 2026-07-16T04-57-52.496Z.png`, and `Google Chrome Appshot 2026-07-16T04-57-56.700Z.png`.
- Implementation screenshots: `/tmp/cryptobot-label-stack-en.png`, `/tmp/cryptobot-label-stack-ru.png`, and `/tmp/cryptobot-label-stack-ja.png`.
- Viewport: 1330 × 768 desktop.
- State: signed-out demo mode, `/bots`, English, Russian, and Japanese locales.

## Full-view comparison evidence

The source screenshots showed risk and strategy-type labels competing for width in a single row. Long English, Russian, and Japanese strategy-type text collapsed into narrow columns. The revised implementation keeps the favorite control beside the labels while placing the two text labels in a dedicated vertical stack.

## Focused region comparison evidence

The English capture shows `MediumRisk` above `Need to Simulate`; the Russian capture shows `СреднийРиск` above `Нужно симулировать`; the Japanese capture shows `中リスク` above `シミュレーションが必要`. All stacks have a 92px horizontal measure, balanced two-line wrapping where needed, centered text, and no character-by-character vertical collapse. Browser geometry confirmed `flex-direction: column` for all three locales.

## Required fidelity surfaces

- Fonts and typography: Existing card fonts, weights, sizes, and label styling are preserved. Only wrapping, line height, and alignment within the two localized labels changed.
- Spacing and layout rhythm: The favorite button remains in its original position. The risk/type pair now uses a consistent 0.35rem vertical gap and 5.75rem width without affecting the card body or action alignment.
- Colors and visual tokens: Existing risk, cyan, border, background, and radius tokens are unchanged.
- Image quality and asset fidelity: Existing CryptoBot mascots and chart assets are untouched.
- Copy and content: Existing localized strings are unchanged; only their presentation is adjusted.

## Findings

No actionable P0, P1, or P2 differences remain within the requested label region.

## Comparison history

- Initial source: risk and strategy-type labels were horizontal siblings; long English and Japanese strings compressed into tall narrow pills.
- Fix applied: introduced a semantic badge stack and locale-scoped English/Russian/Japanese vertical layout with balanced wrapping.
- Post-fix evidence: all three browser captures show horizontal label readability, vertical stacking, stable favorite-button placement, and no overflow.

## Interaction and console checks

- Language switcher tested across Traditional Chinese, English, Russian, and Japanese.
- Computed layout checked for English, Russian, and Japanese label stacks.
- Browser console errors: none.
- Production build: passed.

## Follow-up polish

- No follow-up is required for this scope.

## Homepage featured-card follow-up — English, Russian, and Japanese

- Source reference screenshot: `/tmp/catalog-card-reference-ja.png` from the optimized Explore Strategies card layout.
- Implementation screenshots: `/tmp/featured-cards-ru.png` and `/tmp/featured-cards-ja.png` from the homepage Hot Robots section.
- Viewport: 1330 × 768 desktop production build.
- State: signed-out homepage using verified public WEEX performance data; English, Russian, and Japanese locales checked.

### Full-view comparison evidence

The homepage cards now reuse the catalog card's resilient vertical rhythm. Card heights are equal within each language, chart and metric regions remain aligned, and action rows stay pinned to the same baseline. The existing mascot, typography, colors, chart treatment, and buttons are unchanged.

### Focused region comparison evidence

Browser geometry confirmed `flex-direction: column` for every featured-card risk/type stack in English, Russian, and Japanese. All inspected labels reported no horizontal or vertical overflow, every card reported no horizontal overflow, and all three action rows shared an identical vertical coordinate per locale. Russian, the longest tested locale, rendered both `ВысокийРиск` and `Расширенная стратегия` inside a 92px stack without clipping.

### Comparison history

- Initial homepage state: the risk and strategy-type labels were horizontal siblings and competed with localized titles for card width.
- Fix applied: extended the catalog's EN/RU/JA stacked-label rules to `.bot-grid--featured`, made the title region flexible, and pinned action rows with a consistent card column layout.
- Post-fix evidence: English card height 605px with aligned action rows; Japanese card height 605px with aligned action rows; Russian card height 651px with aligned action rows and no overflow.

### Interaction and console checks

- Language switcher exercised in English, Russian, and Japanese.
- Three featured cards rendered from verified WEEX performance data in the production build.
- Computed overflow and flex-direction checks passed for every localized badge stack.
- Production build: passed.

final result: passed
