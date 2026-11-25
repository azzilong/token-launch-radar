# Token Launch Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/azzilong/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/azzilong/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Model in one line: log(mcap) = 6.965 + 0.522\*log(TVL), fitted by OLS on the 128 live-token peers with a usable market cap; implied value = median launch value x token odds.

Entry for [token-radar-01 on make.fun](https://make.fun/bounty/token-radar-01): a radar over pre-token DeFi protocols, ranked by what a token launch would be worth today — so a farmer can see which launches are worth chasing before they happen.

## How it works

1. **Snapshot** — a sealed DefiLlama snapshot (758 protocols as of 2026-11-14, floor $50M TVL, 40-protocol watchlist) is the only input. No network, no clock, no randomness.
2. **Fitted comps model** — the size curve `log(mcap) = 6.965 + 0.522*log(TVL)` gives the median launch value if a protocol ever issues a token; a logistic token-odds model (log TVL, log age, age-missing flag, category) gives the probability the snapshot's pattern records a token. Implied value = median launch value x token odds.
3. **Board** — all 40 watchlist slugs, every eligible below-floor pre-token protocol ("early"), and the 20 highest-implied pre-token protocols the watchlist rule excludes ("off-list", shown for coverage, verdict OFF-LIST) are scored, ranked by implied value, and given a costed farm plan (6 steps for farmable rows, 4 read-only checks for off-list rows). Farm economics are stated assumptions, not fitted values: airdrop pool 7.5% of implied value, 2000 + TVL/100000 recipients, $3.00 fee, 2.0 h per protocol; FARM iff net >= $25 and net/h >= $12.50.
4. **Dashboard** — `dashboard/` (index.html + app.css + app.js) renders the ranked board with filters, the model evidence, the live-token top 24 at market value, and the honest caveats. `main.ts` copies it into the output next to `board.json`, `data.js`, and `dossier.json`.

## Validation (out-of-sample, not in-sample)

| Check | Model | Flat TVL x 0.25 baseline |
|---|---|---|
| Leave-one-out median abs log error (n=128) | 1.223 (x3.40) | 1.591 (x4.91) |
| Walk-forward median abs log error (train < 2024-02-18, test n=48) | 1.102 (x3.01) | 1.421 (x4.14) |
| Token-odds 5-fold CV Brier (base rate 0.526) | 0.210 | 0.249 (base rate) |
| Range honesty, LOO bands | P25–P75 coverage 50.0% | P10–P90 coverage 79.7% |
| Range honesty, walk-forward bands | P25–P75 coverage 50.0% | P10–P90 coverage 66.7% |

Every added term (category effect, 7-day growth, age, chain count, category x size) made held-out error worse in at least one test, so the final model is the size curve alone; category multiples are descriptive comps, not prediction adjustments. The value fit is weak in absolute terms (R² = 0.194) — the typical miss is still x3.40, so the bands are wide by design (P25 0.306x, P75 4.197x, P10 0.062x, P90 8.629x).

## The board

198 rows: 40 watchlist, 138 early, 20 off-list. Worth farming **173 of 178** farmable rows (FARM 155, MARGINAL 18, SKIP 5; the 20 off-list rows are never counted). Total implied value **$2,083,403,257** over all 198 rows, **$804,090,570** over the 178 farmable rows. Sensitivity to the pool share: worth = 169 at 5%, 173 at 7.5%, 174 at 10%.

Caveats, stated plainly: only 128 of the 416 token-recorded protocols have a usable market cap; odds are miscalibrated at the bottom (lowest CV decile predicts 0.059 mean odds vs 0.214 observed); off-list rows are mechanical size-curve extrapolations, not launch candidates; "records no token" means the snapshot records none — never a claim that a protocol has none.

## How to run it

Node 22, standard library only — nothing to install.

```sh
node main.ts --input <snapshot.json|directory> --output <dir>
```

`<input>` is the snapshot file itself or a directory containing `snapshot.json`. The output directory gets `board.json`, `data.js`, `dashboard/` (copied from the repo), `screenshots/` (copied from the repo), and `dossier.json` (built by `vendor/makefun-board.ts`, byte-identical to what the scorer rebuilds). The program self-checks before writing (row count, slug coverage, rank order, farm-step lengths) and exits non-zero on any violation. Re-running with the same input produces byte-identical output.
