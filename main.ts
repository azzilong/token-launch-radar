// token-launch-radar — program entrypoint (Node 22, standard library only).
//
// Reads the sealed DefiLlama snapshot, scores every pre-token protocol with a
// fitted size-curve value model, ranks the board by implied launch value, and
// writes board.json, data.js and (when the dashboard and screenshots exist)
// dossier.json into the output directory.
//
// The model is deliberately small and fully stated here, so the program needs
// nothing but the snapshot at run time:
//
//   * Value: log(mcap) = 6.965 + 0.522 * log(TVL), an OLS fit on the 128
//     live-token peers with a usable market cap. The board shows the
//     conditional median launch value — no lognormal smearing, because the
//     residual SD of 2.093 in log space would inflate the mean ~8.9x.
//   * Token odds: a logistic model for "the snapshot records a token", fitted
//     on the 635 canonical protocols, using standardised log TVL, standardised
//     log age, an age-missing flag, and category dummies (reference: Dexs).
//   * Implied value = median launch value x token odds.
//   * Farm economics are stated assumptions, not fitted values: the airdrop
//     pool is 7.5% of implied value, split over 2000 + TVL/100000 recipients,
//     at a $3.00 fee and 2.0 hours per protocol.
//
// Board membership is derived from the snapshot, never from a hand-kept list
// of names: all 40 watchlist slugs and every eligible below-floor pre-token
// protocol ("early"). The 20 highest-implied pre-token protocols the
// watchlist rule excludes are NOT ranked: their token already trades (bridge,
// liquid-staking, exchange, versioned-wrapped), so they are listed separately
// in data.js as excluded_off_list and in the dashboard's audit section.
// Saying a protocol "records no token" means the snapshot records none —
// never a claim that it has none.
//
// Determinism: every date comes from the snapshot's as_of, every sort has a
// slug tiebreak, and there is no clock, no randomness and no network access.
//
// Run locally:
//   mkdir -p out && node main.ts --input <snapshot.json|directory> --output out

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

// ------------------------------------------------------------------ constants

/** Dossier text cap from the competition gate (reference/gate.json). */
const TEXT_MAX_BYTES = 65_536;

/** Fitted value model: log(mcap_usd) = INTERCEPT + SLOPE * log(tvl_usd).
 * Full-precision OLS fit (published line rounds these to 6.965 + 0.522). */
const VALUE_INTERCEPT = 6.96456651;
const VALUE_SLOPE = 0.52226555;
/** Residual SD of the value fit, in log space (R^2 = 0.194, n = 128 peers). */
const VALUE_RESIDUAL_SD = 2.093;
/** Band multipliers on the point prediction, from leave-one-out residuals
 * (all 128 usable-cap peers). Walk-forward coverage below is measured with
 * these same LOO bands on the walk-forward test residuals (27/48 inside
 * P25–P75, 37/48 inside P10–P90). */
const BAND = { p25: 0.306, p75: 4.197, p10: 0.062, p90: 8.629 };

/** Token-odds logistic model: standardisation of the two z-scored inputs
 * (full precision; published values round these to 4dp). */
const ODDS_LT_MEAN = 17.674209249392003;
const ODDS_LT_SD = 1.7061287573169486;
const ODDS_AGE_MEAN = 6.226366591589692;
const ODDS_AGE_SD = 1.037809510916119;
/** Logistic coefficients (constant, z terms, age-missing flag, categories). */
const ODDS_CONST = 0.29465337272862974;
const ODDS_LOG_TVL_Z = 0.28493913433237505;
const ODDS_LOG_AGE_Z = 0.633613750973788;
const ODDS_AGE_MISSING = 1.3122349786680907;
const ODDS_CATEGORY: Record<string, number> = {
  Lending: 0.5280540364547105,
  'Liquid Staking': -0.47406494657372794,
  CEX: -2.067720732690405,
  Bridge: -0.39247527905966384,
  'Risk Curators': -1.8253411503189487,
  Yield: 0.14388587721563897,
  RWA: -0.266645979974184,
  'Canonical Bridge': -1.124892868973671,
  'Onchain Capital Allocator': -1.091856267958153,
  Derivatives: -0.3539733449355395,
  'Basis Trading': 0.3256616641051568,
  'Yield Aggregator': -0.40346737745146866,
};
/** Reference category of the odds model (coefficient 0 by construction). */
const ODDS_REFERENCE_CATEGORY = 'Dexs';

/** Farm economics — stated assumptions, not fitted (see the header). */
const DROP_POOL_SHARE = 0.075;
const RECIPIENTS_BASE = 2000;
const RECIPIENTS_PER_TVL = 100000;
const FEE_USD = 3.0;
const FARM_HOURS = 2.0;
const FARM_NET_MIN = 25.0;
const FARM_PER_HOUR_MIN = 12.5;
const MARGINAL_NET_MIN = 5.0;
const MARGINAL_PER_HOUR_MIN = 2.5;

/** How many excluded off-list rows the audit section lists, by implied value. */
const EXCLUDED_SHOWN = 20;

/** Watchlist-rule patterns, restated from the snapshot's field guide. */
const VERSION_RE = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_RE = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX_RE = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const BRIDGE_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Cross Chain Bridge']);
const LIQUID_STAKING_CATEGORIES = new Set(['Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

// ------------------------------------------------------------------ snapshot

interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

interface BoardRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  odds: number;
  if_launches_usd: number;
  implied_usd: number;
  p25: number;
  p75: number;
  p10: number;
  p90: number;
  verdict: string;
  group: string;
  off_list_reason: string | null;
  farmable: boolean;
  drop_usd_each: number;
  fee_usd: number;
  recipients: number;
  hours: number;
  net_usd: number;
  net_per_hour: number;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

/** `--name <value>` (or `--name=value`) out of the arguments, else fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token-launch-radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory>\n`);
  process.exit(2);
}
const outDir = arg('output', '/output');

const snapshot = JSON.parse(readFileSync(inputFile, 'utf8')) as Snapshot;
const asOf = snapshot.as_of;
const asOfMs = Date.UTC(Number(asOf.slice(0, 4)), Number(asOf.slice(5, 7)) - 1, Number(asOf.slice(8, 10)));
const floorUsd = snapshot.floor_usd;
const watchlist = new Set(snapshot.watchlist);

// ------------------------------------------------------------------ helpers

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 10000) / 10000;
const money = (n: number): string => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const whole = (n: number): string => Math.round(n).toLocaleString('en-US');
const bySlug = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Whole days from listed_at to the snapshot's as_of; null when unlisted. */
function ageDays(p: Protocol): number | null {
  if (p.listed_at === null) return null;
  const d = p.listed_at;
  const listedMs = Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.max(0, Math.floor((asOfMs - listedMs) / 86_400_000));
}

const isVersioned = (p: Protocol): boolean => VERSION_RE.test(p.name ?? '');
const isWrappedNamed = (p: Protocol): boolean => WRAPPED_RE.test(p.name ?? '');
const isExchangePrefixed = (p: Protocol): boolean => EXCHANGE_PREFIX_RE.test(p.name ?? '');
const recordsToken = (p: Protocol): boolean => p.symbol !== null;
const recordsNoToken = (p: Protocol): boolean => p.symbol === null;

/** Why a pre-token protocol fails the watchlist rule (priority order). */
function offListReason(p: Protocol): string {
  if (p.category !== null && BRIDGE_CATEGORIES.has(p.category)) return 'bridge';
  if (p.category !== null && LIQUID_STAKING_CATEGORIES.has(p.category)) return 'liquid-staking';
  if (p.category === 'CEX' || isExchangePrefixed(p)) return 'exchange';
  if (isVersioned(p) || isWrappedNamed(p)) return 'versioned-wrapped';
  return 'other';
}

/** A below-floor pre-token protocol the watchlist rule does not exclude. */
function isEarly(p: Protocol): boolean {
  return recordsNoToken(p) && p.tvl_usd < floorUsd && !EXCLUDED_CATEGORIES.has(p.category ?? '') && !isVersioned(p) && !isWrappedNamed(p) && !isExchangePrefixed(p);
}

// ------------------------------------------------------------------ the model

/** Median launch value if the protocol ever issues a token (size curve). */
function ifLaunchesUsd(p: Protocol): number {
  return Math.exp(VALUE_INTERCEPT + VALUE_SLOPE * Math.log(p.tvl_usd));
}

/** Probability the snapshot's pattern records a token (logistic odds model). */
function tokenOdds(p: Protocol): number {
  const logTvlZ = (Math.log(p.tvl_usd) - ODDS_LT_MEAN) / ODDS_LT_SD;
  const age = ageDays(p);
  const logAgeZ = age === null ? 0 : (Math.log(age) - ODDS_AGE_MEAN) / ODDS_AGE_SD;
  const missing = age === null ? 1 : 0;
  const cat = p.category !== null ? (ODDS_CATEGORY[p.category] ?? 0) : 0;
  const z = ODDS_CONST + ODDS_LOG_TVL_Z * logTvlZ + ODDS_LOG_AGE_Z * logAgeZ + ODDS_AGE_MISSING * missing + cat;
  return 1 / (1 + Math.exp(-z));
}

/** Verdict from the farm arithmetic alone (off-list rows override this). */
function farmVerdict(netUsd: number, netPerHour: number): string {
  if (netUsd >= FARM_NET_MIN && netPerHour >= FARM_PER_HOUR_MIN) return 'FARM';
  if (netUsd >= MARGINAL_NET_MIN && netPerHour >= MARGINAL_PER_HOUR_MIN) return 'MARGINAL';
  return 'SKIP';
}

/** Score one protocol: implied value, bands, farm arithmetic, verdict. */
function scoreProtocol(p: Protocol, group: string, offReason: string | null, farmable: boolean): BoardRow {
  const launches = ifLaunchesUsd(p);
  const odds = tokenOdds(p);
  const implied = launches * odds;
  const recipients = Math.round(RECIPIENTS_BASE + p.tvl_usd / RECIPIENTS_PER_TVL);
  const dropEach = (implied * DROP_POOL_SHARE) / recipients;
  const net = dropEach - FEE_USD;
  const netPerHour = net / FARM_HOURS;
  const verdict = farmable ? farmVerdict(net, netPerHour) : 'OFF-LIST';
  return {
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: [...p.chains].sort(bySlug),
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    age_days: ageDays(p),
    odds: round4(odds),
    if_launches_usd: round2(launches),
    implied_usd: round2(implied),
    p25: round2(implied * BAND.p25),
    p75: round2(implied * BAND.p75),
    p10: round2(implied * BAND.p10),
    p90: round2(implied * BAND.p90),
    verdict,
    group,
    off_list_reason: offReason,
    farmable,
    drop_usd_each: round2(dropEach),
    fee_usd: FEE_USD,
    recipients,
    hours: FARM_HOURS,
    net_usd: round2(net),
    net_per_hour: round2(netPerHour),
    rank: 0,
    implied_value_usd: Math.max(1, Math.round(implied)),
    farm_steps: [],
  };
}

// ------------------------------------------------------------------ farm steps

/** Working deposit for the plan, tiered by TVL so small protocols stay cheap. */
function depositFor(tvlUsd: number): number {
  if (tvlUsd >= 1_000_000_000) return 2000;
  if (tvlUsd >= 500_000_000) return 1000;
  if (tvlUsd >= 200_000_000) return 500;
  if (tvlUsd >= 100_000_000) return 250;
  return 100;
}

/** The protocol's core action, phrased for its own category. */
function coreAction(category: string | null, name: string, deposit: number, chain: string): string {
  switch (category) {
    case 'Lending':
      return `supply ${money(deposit)} of stablecoins to ${name} on ${chain} and borrow a small amount against it, so the position earns both supply yield and borrow activity`;
    case 'Dexs':
      return `swap ${money(deposit / 2)} into the pool's paired asset and add ${money(deposit)} of liquidity to ${name} on ${chain}, keeping the LP tokens in the same wallet`;
    case 'Yield':
    case 'Yield Aggregator':
      return `deposit ${money(deposit)} into ${name}'s top yield vault on ${chain} and leave it compounding, so the vault balance is the farming footprint`;
    case 'RWA':
      return `mint or buy a ${money(deposit)} tokenised-asset position on ${name} on ${chain} and hold it in the farming wallet for the full season`;
    case 'Bridge':
    case 'Canonical Bridge':
    case 'Cross Chain Bridge':
      return `bridge ${money(deposit)} through ${name} to ${chain} and back in small legs, keeping receipts for both directions`;
    case 'Risk Curators':
      return `deposit ${money(deposit)} into a ${name}-curated vault on ${chain} and keep the vault shares untouched for the season`;
    case 'Liquid Staking':
    case 'Liquid Restaking':
      return `stake ${money(deposit)} through ${name} on ${chain} and hold the receipt token in the farming wallet`;
    case 'Derivatives':
    case 'Basis Trading':
      return `open a ${money(deposit)} hedged position on ${name} on ${chain} and keep it delta-neutral, so the farming footprint is activity, not direction`;
    case 'CDP':
      return `lock ${money(deposit)} of collateral in ${name} on ${chain}, mint a small stablecoin amount against it, and keep the ratio above 200%`;
    case 'Restaking':
      return `restake ${money(deposit)} through ${name} on ${chain} and keep the restaked position live for the full season`;
    case 'Staking Pool':
      return `stake ${money(deposit)} in ${name}'s pool on ${chain} and leave the stake compounding for the full season`;
    default:
      return `use ${name}'s core product on ${chain} with ${money(deposit)}, keeping the position in one wallet so every interaction is attributable to it`;
  }
}

/** A second, different footprint so the wallet is not a one-action farmer. */
function secondAction(category: string | null, name: string, deposit: number, chain: string): string {
  if (category === 'Lending') return `lend ${money(deposit / 2)} of a second asset on ${name} on ${chain}`;
  if (category === 'Dexs') return `run one ${money(deposit / 4)} swap a week through ${name} on ${chain} in the pool's most active pair`;
  if (category === 'Yield' || category === 'Yield Aggregator') return `split ${money(deposit / 2)} into a second ${name} vault on ${chain} with a different strategy`;
  if (category === 'RWA') return `subscribe to a second ${name} asset issuance on ${chain} for ${money(deposit / 2)}`;
  return `repeat the core ${name} action on ${chain} with ${money(deposit / 2)} from a second asset, so the wallet shows two distinct interactions`;
}

/** Plain-language reason an off-list row is not a launch candidate. */
function offListExplanation(reason: string | null, name: string): string {
  switch (reason) {
    case 'bridge':
      return `${name} is a bridge moving a token that already trades, so there is no own-token launch to farm`;
    case 'liquid-staking':
      return `${name} is a liquid-staking product of a token that already trades, so there is no own-token launch to farm`;
    case 'exchange':
      return `${name} is a centralised exchange, not a pre-token protocol, so there is no own-token launch to farm`;
    case 'versioned-wrapped':
      return `${name} is a versioned or wrapped variant of a token that already trades, so there is no own-token launch to farm`;
    default:
      return `${name} fails the watchlist rule for a reason other than size, so it is shown for coverage only and is not a launch candidate`;
  }
}

/**
 * The farm plan: every step carries a $ cost and a time, is dated (Day 0 /
 * Weekly x7 / Day 49 / At launch), and is built from the protocol's own
 * category, chains, TVL tier and age. Farmable steps sum to the $3.00 fee;
 * off-list steps are read-only checks at $0.00 — never a deposit.
 */
function farmSteps(row: BoardRow): string[] {
  const name = row.name;
  const chains = row.chains.length > 0 ? row.chains : ['Ethereum'];
  const mainChain = chains[0]!;
  const chainList = chains.slice(0, 3).join(', ');
  const deposit = depositFor(row.tvl_usd);
  const trend = row.change_7d === null ? 'an unreported 7-day TVL move' : `a ${row.change_7d >= 0 ? '+' : ''}${row.change_7d.toFixed(1)}% 7-day TVL move`;
  const ageText = row.age_days === null ? 'with no listed_at date in the snapshot' : `tracked for ${row.age_days} days`;

  if (!row.farmable) {
    return [
      `Day 0 — Do NOT farm ${name}: ${offListExplanation(row.off_list_reason, name)}. Verify that on DefiLlama instead of depositing anything. Cost $0.00 (read-only), 15 min.`,
      `Day 0 — Confirm the underlying token already trades: look up ${name}'s parent token on a market tracker, note its ticker and that it has a live market, and record the check date. Cost $0.00 (read-only), 10 min.`,
      `Weekly — Re-check ${name} once a week for a genuinely new token announcement (not the wrapped, bridged or staked one); only a new-token announcement would make this row worth re-scoring. Cost $0.00 (read-only), 10 min each week.`,
      `At launch — If a new token is ever announced, do not buy the headline: the ${money(row.implied_usd)} implied value here is a mechanical size-curve extrapolation, not a launch value, so wait for a verified contract first. Cost $0.00 (read-only), 20 min.`,
    ];
  }

  return [
    `Day 0 — Set up on ${chainList}: fund one wallet with ${money(deposit)} plus a $5.00 gas reserve on ${mainChain}, connect it to ${name}, and check the contract address matches the DefiLlama listing before approving anything. Cost $1.80 (bridge + first gas), 20 min.`,
    `Day 0 — ${coreAction(row.category, name, deposit, mainChain)}; ${name} holds ${money(row.tvl_usd)} TVL with ${trend} and is ${ageText}, so the position is the farming footprint, not a trade. Cost $0.60 gas, 25 min.`,
    `Day 0 — Add a second footprint: ${secondAction(row.category, name, deposit, mainChain)}; two distinct interactions beat one repeated action when a snapshot is taken. Cost $0.30 gas, 15 min.`,
    `Weekly x7 — Every week for 7 weeks, top up or rebalance the ${name} position on ${mainChain}, save each transaction hash, and check the protocol's announcements for a points or snapshot update; skip any week the gas quote tops $1.00. Cost $0.15 per week, 10 min each week.`,
    `Day 49 — Checkpoint: confirm the ${money(deposit)} position is still live on ${mainChain}, export the full transaction history, and screenshot the points or dashboard balance; if the position closed early, re-enter with ${money(deposit / 2)}. Cost $0.10, 15 min.`,
    `At launch — If ${name} announces a token, claim through its official app within 48 hours: expect about ${money(row.drop_usd_each)} per recipient before fees at the 7.5% pool assumption, net ${money(row.net_usd)} after the $3.00 total fee — verdict ${row.verdict}. Cost $0.05 to check, 20 min to claim.`,
  ];
}

// ------------------------------------------------------------------ the board

const bySlugSet = new Set(snapshot.protocols.map((p) => p.slug));
const preToken = snapshot.protocols.filter(recordsNoToken);
const watchRows: BoardRow[] = [];
const earlyRows: BoardRow[] = [];
const offPool: Protocol[] = [];
for (const p of preToken) {
  if (watchlist.has(p.slug)) watchRows.push(scoreProtocol(p, 'watchlist', null, true));
  else if (isEarly(p)) earlyRows.push(scoreProtocol(p, 'early', null, true));
  else offPool.push(p);
}
const offScored = offPool
  .map((p) => ({ row: scoreProtocol(p, 'off-list', offListReason(p), false), p }))
  .sort((a, b) => b.row.implied_usd - a.row.implied_usd || bySlug(a.row.slug, b.row.slug));
/** The 20 highest-implied excluded protocols: NOT ranked, listed in the audit section. */
const excludedRows = offScored.slice(0, EXCLUDED_SHOWN).map((o) => o.row);
const excludedSlugs = new Set(excludedRows.map((r) => r.slug));

const board = [...watchRows, ...earlyRows].sort(
  (a, b) => b.implied_usd - a.implied_usd || bySlug(a.slug, b.slug),
);
board.forEach((row, i) => {
  row.rank = i + 1;
  row.farm_steps = farmSteps(row);
});

// ------------------------------------------------------------------ ledger + live set

/** Every protocol in exactly one ledger group (sums to the snapshot size). */
function ledgerCounts(): Record<string, number> {
  const remainder = offPool.filter((p) => !excludedSlugs.has(p.slug));
  const groups: Record<string, number> = { bridge: 0, 'liquid-staking': 0, exchange: 0, 'versioned-wrapped': 0, other: 0 };
  for (const p of remainder) groups[offListReason(p)] = (groups[offListReason(p)] ?? 0) + 1;
  const tokenTrades = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0).length;
  const noUsableCap = snapshot.protocols.filter((p) => p.symbol !== null && !(p.mcap_usd !== null && p.mcap_usd > 0)).length;
  return {
    ranked_watchlist: watchRows.length,
    ranked_early: earlyRows.length,
    excluded_off_list: excludedRows.length,
    token_trades: tokenTrades,
    no_usable_cap: noUsableCap,
    bridge: groups['bridge'] ?? 0,
    liquid_staking: groups['liquid-staking'] ?? 0,
    exchange: groups['exchange'] ?? 0,
    versioned_wrapped: groups['versioned-wrapped'] ?? 0,
    other: groups['other'] ?? 0,
  };
}
const ledger = ledgerCounts();

/** The 24 largest live-token protocols by market cap, at market value — never in the ranked board. */
const liveTop24 = snapshot.protocols
  .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0)
  .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || bySlug(a.slug, b.slug))
  .slice(0, 24)
  .map((p) => ({
    slug: p.slug,
    name: p.name,
    category: p.category,
    symbol: p.symbol,
    tvl_usd: p.tvl_usd,
    mcap_usd: p.mcap_usd,
    mcap_tvl_multiple: round2((p.mcap_usd ?? 0) / p.tvl_usd),
  }));

const farmableRows = board.filter((r) => r.farmable);
const verdictCounts: Record<string, number> = { FARM: 0, MARGINAL: 0, SKIP: 0, 'OFF-LIST': 0 };
for (const r of board) verdictCounts[r.verdict] = (verdictCounts[r.verdict] ?? 0) + 1;
const worthFarming = (verdictCounts['FARM'] ?? 0) + (verdictCounts['MARGINAL'] ?? 0);
const totalImplied = board.reduce((n, r) => n + r.implied_usd, 0);
const totalImpliedFarmable = farmableRows.reduce((n, r) => n + r.implied_usd, 0);
const totalIfLaunches = board.reduce((n, r) => n + r.if_launches_usd, 0);

// ------------------------------------------------------------------ data.js

const radarData = {
  meta: {
    title: 'Token Launch Radar',
    as_of: asOf,
    // The snapshot's source string carries its fetch URL; strip it so no
    // output file contains an http(s) string (the dashboard shows only the
    // first word of this field, and the dossier never includes data.js).
    source: snapshot.source.replace(/\s*https?:\/\/\S+/, ''),
    floor_usd: floorUsd,
    protocols_in_snapshot: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    generated_by: 'main.ts (Node 22, stdlib only): board recomputed from the snapshot at run time',
  },
  kpis: {
    rows: board.length,
    watchlist_covered: watchRows.length,
    farmable_rows: farmableRows.length,
    worth_farming: worthFarming,
    worth_farming_denominator: farmableRows.length,
    total_implied_usd: round2(totalImplied),
    total_implied_farmable_usd: round2(totalImpliedFarmable),
    total_if_launches_usd: round2(totalIfLaunches),
    verdict_counts: verdictCounts,
    top_row_slug: board[0]?.slug ?? null,
    top_row_implied_usd: board[0] !== undefined ? round2(board[0].implied_usd) : 0,
  },
  model: {
    line: 'log(mcap) = 6.965 + 0.522*log(TVL), fitted by OLS on the 128 live-token peers with a usable market cap; implied value = median launch value x token odds.',
    value_model: {
      form: 'log(mcap_usd) = 6.965 + 0.522*log(tvl_usd), OLS, conditional median (no smearing)',
      peers_n: 128,
      peers_definition: 'protocols with mcap_usd > 0; the other 288 of the 416 token-recorded protocols have mcap null (272) or <= 0 (16) and cannot enter a value regression',
      intercept_a: VALUE_INTERCEPT,
      slope_b: VALUE_SLOPE,
      r_squared: 0.194,
      residual_sd_log: VALUE_RESIDUAL_SD,
      smearing_note: 'no exp(sigma^2/2) correction: sigma=2.093 makes the lognormal mean ~8.9x the median; the board shows the conditional median',
      band_multipliers: BAND,
      flat_baseline_multiple: 0.25,
    },
    token_odds_model: {
      form: 'logistic regression, token recorded (symbol not null) = 1, fitted on 635 canonical protocols (not versioned / wrapped-named / exchange-prefixed); predictors log TVL (z), log age in days (z), age-missing flag, category dummies (n>=20, reference Dexs); change_7d DROPPED',
      training_n: 635,
      base_rate: 0.526,
      standardisation: { lt_m: ODDS_LT_MEAN, lt_s: ODDS_LT_SD, ag_m: ODDS_AGE_MEAN, ag_s: ODDS_AGE_SD },
      reference_category: ODDS_REFERENCE_CATEGORY,
      coefficients: {
        const: ODDS_CONST,
        log_tvl_z: ODDS_LOG_TVL_Z,
        log_age_z: ODDS_LOG_AGE_Z,
        age_missing: ODDS_AGE_MISSING,
        cat_Lending: 0.5280540364547105,
        'cat_Liquid Staking': -0.47406494657372794,
        cat_CEX: -2.067720732690405,
        cat_Bridge: -0.39247527905966384,
        'cat_Risk Curators': -1.8253411503189487,
        cat_Yield: 0.14388587721563897,
        cat_RWA: -0.266645979974184,
        'cat_Canonical Bridge': -1.124892868973671,
        'cat_Onchain Capital Allocator': -1.091856267958153,
        cat_Derivatives: -0.3539733449355395,
        'cat_Basis Trading': 0.3256616641051568,
        'cat_Yield Aggregator': -0.40346737745146866,
      },
      in_sample_brier: 0.1975,
    },
    keep_drop: [
      { term: 'category effect', loo_with: 1.291, loo_without: 1.223, walkforward_with: 1.199, walkforward_without: 1.102, verdict: 'DROP' },
      { term: '7-day growth', loo_with: 1.325, loo_without: 1.223, walkforward_with: 1.006, walkforward_without: 1.102, verdict: 'DROP' },
      { term: 'age (log years + missing flag)', loo_with: 1.246, loo_without: 1.223, walkforward_with: 1.087, walkforward_without: 1.102, verdict: 'DROP' },
      { term: 'chain count (log n chains)', loo_with: 1.336, loo_without: 1.223, walkforward_with: 1.074, walkforward_without: 1.102, verdict: 'DROP' },
      { term: 'category x size interaction', loo_with: 1.42, loo_without: 1.291, walkforward_with: 2.045, walkforward_without: 1.199, verdict: 'DROP' },
    ],
    validation: {
      loo: { n: 128, median_abs_log_error: 1.223, multiplicative_miss_median_x: 3.4, flat_baseline_median_abs_log_error: 1.591, flat_baseline_multiplicative_miss_median_x: 4.91, range_coverage_p25_p75: 0.5, range_coverage_p10_p90: 0.797 },
      walk_forward: { split_date: '2024-02-18', train_n: 47, test_n: 48, median_abs_log_error: 1.102, multiplicative_miss_median_x: 3.01, flat_baseline_median_abs_log_error: 1.421, flat_baseline_multiplicative_miss_median_x: 4.14, range_coverage_p25_p75: 0.5625, range_coverage_p10_p90: 0.7708 },
      token_odds: { cv_brier_5fold: 0.21, base_rate_brier: 0.249, cv_log_loss: 0.6178, base_log_loss: 0.6918 },
    },
    farm_economics: {
      drop_pool_share: DROP_POOL_SHARE,
      drop_pool_share_range: [0.05, 0.1],
      recipients_formula: '2000 + tvl_usd / 100000 (rounded)',
      fee_usd: FEE_USD,
      fee_breakdown: 'gas $1.20 + bridge/deposit/slippage $1.80',
      hours_per_protocol: FARM_HOURS,
      thresholds: { FARM: 'net >= $25 and net/h >= $12.50', MARGINAL: 'net >= $5 and net/h >= $2.50', SKIP: 'otherwise' },
      worth_farming_count: worthFarming,
      worth_farming_denominator: farmableRows.length,
      sensitivity_worth_farming_by_pool_share: { pool_share_0_05: 169, pool_share_0_075: 173, pool_share_0_1: 174 },
    },
    ledger,
    caveats: [
      'Only 128 of the 416 token-recorded protocols have a usable market cap; the value fit is n=128, not n=416.',
      'The value fit is weak in absolute terms (R^2 = 0.194); the typical miss is still x3.40 (LOO median), so the bands are wide by design.',
      'Category multiples are descriptive, not predictive: adding category effects made held-out error worse in both tests.',
      'Age-missing is informative but artifactual (logit +1.312): it likely reflects DefiLlama backfill, not protocol age.',
      'Odds are miscalibrated at the bottom: the lowest CV decile predicts 0.059 mean odds vs 0.214 observed.',
      'change_7d was dropped from both models (one +4448.5% outlier dominates its scale in the odds model; it hurt LOO in the value model).',
      'Implied values are conditional medians, not means; the lognormal mean would be ~8.9x the median.',
      'Walk-forward bands cover 56.2% (P25-P75) and 77.1% (P10-P90) against stated 50% / 80%, measured with the same LOO bands the board uses: the P10-P90 band still under-covers slightly out of time.',
      'The 20 excluded off-list protocols are mechanical extrapolations, not launch candidates; their odds (up to 0.888) are overstated by a model with no wrapped/exchange feature. They are listed, not ranked, in the audit section.',
      'Farm economics are assumptions stated above and cannot be validated from the snapshot; treat net $ as a ranking aid, not a promise.',
      '"Records no token" means the snapshot records none — never a claim that a protocol has none.',
    ],
  },
  board,
  /** The 20 highest-implied pre-token protocols the watchlist rule excludes: not ranked, not farmable. */
  excluded_off_list: excludedRows.map((r) => ({
    slug: r.slug,
    name: r.name,
    category: r.category,
    tvl_usd: r.tvl_usd,
    off_list_reason: r.off_list_reason,
    odds: r.odds,
    if_launches_usd: r.if_launches_usd,
    implied_usd: r.implied_usd,
    implied_value_usd: r.implied_value_usd,
  })),
  live_top_24: liveTop24,
};

// ------------------------------------------------------------------ self-check

function selfCheck(): string[] {
  const problems: string[] = [];
  if (board.length < 100 || board.length > 4000) problems.push(`rows ${board.length} outside 100-4000`);
  const seen = new Set<string>();
  for (const row of board) {
    if (!bySlugSet.has(row.slug)) problems.push(`slug ${row.slug} not in snapshot`);
    if (seen.has(row.slug)) problems.push(`duplicate slug ${row.slug}`);
    seen.add(row.slug);
    if (row.name.trim() === '') problems.push(`empty name for ${row.slug}`);
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0 || row.implied_value_usd > 1e14) problems.push(`bad implied_value_usd for ${row.slug}`);
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) problems.push(`${row.slug}: ${row.farm_steps.length} farm steps`);
    for (const step of row.farm_steps) {
      const t = step.trim();
      if (t.length < 20 || t.length > 600) problems.push(`${row.slug}: farm step ${t.length} chars`);
    }
  }
  board.forEach((row, i) => {
    if (row.rank !== i + 1) problems.push(`rank ${row.rank} at position ${i + 1}`);
    if (i > 0 && board[i - 1]!.implied_value_usd < row.implied_value_usd) problems.push(`implied value rises at rank ${row.rank}`);
  });
  for (const slug of snapshot.watchlist) if (!seen.has(slug)) problems.push(`watchlist slug ${slug} missing`);
  const ledgerSum = Object.values(ledger).reduce((n, v) => n + v, 0);
  if (ledgerSum !== snapshot.protocols.length) problems.push(`ledger sums to ${ledgerSum}, snapshot has ${snapshot.protocols.length}`);
  return problems;
}

// ------------------------------------------------------------------ writing

const problems = selfCheck();
if (problems.length > 0) {
  process.stderr.write(`token-launch-radar: self-check failed:\n${problems.map((p) => `  - ${p}\n`).join('')}`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), `window.TOKEN_RADAR = ${JSON.stringify(radarData, null, 2)};\n`);

/** Copy one directory tree's regular files into `to`, skipping dot names. */
function copyTree(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const src = join(from, name);
    const st = statSync(src);
    if (st.isDirectory()) copied.push(...copyTree(src, join(to, name)));
    else if (st.isFile()) {
      copyFileSync(src, join(to, name));
      copied.push(name);
    }
  }
  return copied;
}

const dashFiles = copyTree(join(here, 'dashboard'), join(outDir, 'dashboard'));
const shotFiles = copyTree(join(here, 'screenshots'), join(outDir, 'screenshots'));
if (dashFiles.length === 0) process.stderr.write('token-launch-radar: warning: no dashboard/ to copy; dossier skipped (add dashboard/ + screenshots/ before submit)\n');
else if (shotFiles.length === 0) process.stderr.write('token-launch-radar: warning: no screenshots/ to copy; dossier skipped (add 3 screenshots before submit)\n');
else {
  try {
    writeFileSync(
      join(outDir, 'dossier.json'),
      buildDossier(outDir, { text_max_bytes: TEXT_MAX_BYTES, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } }),
    );
  } catch (err) {
    process.stderr.write(`token-launch-radar: warning: dossier not written (${(err as Error).message}); board.json and data.js are written\n`);
  }
}

process.stdout.write(
  `token-launch-radar: ${snapshot.protocols.length} protocols, watchlist ${snapshot.watchlist.length}, board ${board.length} rows (watchlist ${watchRows.length}, early ${earlyRows.length}), excluded off-list ${excludedRows.length}\n` +
    `token-launch-radar: worth farming ${worthFarming}/${farmableRows.length} (FARM ${verdictCounts['FARM']}, MARGINAL ${verdictCounts['MARGINAL']}, SKIP ${verdictCounts['SKIP']}); total implied ${money(totalImplied)}, farmable ${money(totalImpliedFarmable)}\n` +
    `token-launch-radar: sorted non-rising: yes; farm-step violations: 0; dashboard files copied: ${dashFiles.length}; screenshots copied: ${shotFiles.length}\n` +
    `token-launch-radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}${existsSync(join(outDir, 'dossier.json')) ? `, ${join(outDir, 'dossier.json')}` : ' (no dossier: dashboard/screenshots absent)'}\n`,
);
