# Nest Egg

A retirement Monte Carlo simulator that runs entirely in the browser. No build step, no accounts, no data leaves your machine — open `index.html`.

Set your age, savings, contributions, retirement spending and allocation; it simulates thousands of possible lifetimes using real historical market returns and tells you the probability your money lasts, what the range of outcomes looks like, and which inputs actually move the needle.

## Run it

Open `index.html` directly, or serve the folder (`npx serve .`) and open the URL.

## What it does

- **Fan chart** of portfolio balance by age: 10th–90th and 25th–75th percentile bands, median line, retirement marker, crosshair tooltip, linear/log toggle, and a table view.
- **Hero + KPIs**: success probability, median balance at retirement, median and 10th-percentile ending balance, typical age money runs out.
- **Depletion histogram**: at what age do the failing paths run dry.
- **Sensitivity tornado**: success rate with each input nudged down/up (retirement age ±2 yrs, spending ±10%, contributions ±10%, savings ±10%, stock allocation ±20 pts, other income ±10%, plan-to age ±5, fees ±0.5 pts). Uses the same random draws as the base run so differences are signal, not noise.
- **Scenarios**: pin up to two sets of inputs and compare them in a table; pinned medians overlay the fan chart.
- **Shareable links**: inputs are encoded in the URL hash. Light/dark theme.

## The model

Everything is in **today's (real) dollars**. Historical nominal returns are deflated by that year's CPI before use, so there is no inflation input to guess.

Each simulated year: contribute (before retirement) or withdraw spending minus other income (after), then apply the portfolio's return — `stocks% × S&P 500 real return + bonds% × 10-yr Treasury real return − fees`. A path **fails** when a withdrawal can't be covered. Optional guardrail: cut spending by X% whenever the portfolio is below Y% of its value at retirement.

Return models:

| Model | How years are drawn |
|---|---|
| Bootstrap | Each year is an independent random draw from 1928–2024 |
| Block bootstrap | Random 5-year runs of consecutive history, preserving streaks (1929–33, 1973–74, 1995–99…) |
| Every historical sequence | One path per start year 1928–2024, wrapping — the classic "would this have survived history" test (97 paths, so percentiles are coarse) |
| Normal | Independent normal draws with the mean/volatility you set; defaults match the historical real figures |

Deterministic seeded RNG (`mulberry32`); **Re-roll** picks a new seed.

## Data

`data.js` holds annual nominal total returns for the S&P 500 (with dividends), 10-year US Treasuries and 3-month T-bills from [Aswath Damodaran's historical returns dataset](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/histretSP.html) (NYU Stern), plus annual-average CPI-U from the [Federal Reserve Bank of Minneapolis](https://www.minneapolisfed.org/about-us/monetary-policy/inflation-calculator/consumer-price-index-1913-). 1928–2024. Real returns derived from these: stocks 8.6% ± 19.4%, bonds 1.8% ± 8.4%.

## Files

- `sim.js` — the engine (`Sim.run`, `Sim.sensitivity`)
- `charts.js` — SVG fan chart, histogram, tornado
- `app.js` — inputs, state, scenarios, URL sharing, theme
- `data.js` — historical returns

Not financial advice. Taxes, Social Security rules, healthcare shocks, and fund selection are outside the model.
