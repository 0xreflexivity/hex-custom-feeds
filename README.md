# HEX Custom FTSO Feeds

Custom FTSO price feeds for **cUSDX/USD** and **yUSDX/USD** on Flare Network.

## Overview

| Feed | Description | Data Source |
|------|-------------|-------------|
| **cUSDX/USD (FDC)** | T-Pool LP token, 1:1 peg with USDX | USDX/USD FTSO + FDC reserve verification |
| **yUSDX/USD (FDC)** | X-Pool LP token, NAV-based pricing | Vault `getRate()` + FDC NAV verification |

### Token Details

- **cUSDX**: LP token from [T-Pool](https://clearpool.finance/lending/tpool) — invests in short-term US treasuries and bonds via HT Markets. Maintains 1:1 peg with USDX.
- **yUSDX**: LP token from [X-Pool](https://vaults.clearpool.finance/vault?address=0x6b9e9d89e0e9fd93eb95d8c7715be2a8de64af07) — delta-neutral basis trading strategy on CEXs.

NAV updates daily at 08:30 UTC.

## Contracts

All contracts implement `IICustomFeed`.

### CUSDXCustomFeedFDC

Price feed for cUSDX/USD. Returns the USDX/USD price from FTSO (1:1 peg). Uses FDC Web2Json attestation to verify that off-chain reserves back on-chain cUSDX supply.

**Reserve Verification:**
- Fetches `current_reserves_amount` from the [HT Digital Assets API](https://api.htdigitalassets.com/alm-stablecoin-db/metrics/current_reserves_amount)
- FDC attestation providers independently verify the API response
- Contract compares API reserves against on-chain `cUSDX.totalSupply()` to compute a reserve ratio
- Reserve data is stored on-chain and queryable via `getReserveStatus()`

**FDC jq filter:**
```
{currentReservesAmount: (.value | split(",") | join("") | split(".") | .[0])}
```
Returns reserves as a string (whole USD), parsed to `uint256` on-chain — the FDC verifier does not support `tonumber` or arithmetic operations.

### YUSDXCustomFeedFDC

Price feed for yUSDX/USD. Uses FDC to verify off-chain NAV data from multiple attestation providers.

**Security features (both contracts):**
- HTTPS-only URL enforcement
- Allowlist-based host validation (case-insensitive)
- Path prefix validation to prevent injection attacks
- ETH refund on payable interface

## Setup

```bash
git clone https://github.com/AmadiaFlare/hex-custom-feeds.git
cd hex-custom-feeds
yarn install
cp .env.example .env
yarn compile
```

## Testing

```bash
yarn test
```

## Deployment

```bash
# cUSDX FDC feed (deploy + attestation)
yarn hardhat run scripts/customFeeds/cUSDXFDCVerification.ts --network coston2

# yUSDX FDC feed
yarn hardhat run scripts/customFeeds/yUSDXFDCVerification.ts --network coston2
```

## Environment Variables

```env
PRIVATE_KEY=
FLARESCAN_API_KEY=
VERIFIER_API_KEY_TESTNET=
VERIFIER_API_KEY_MAINNET=
WEB2JSON_VERIFIER_URL_TESTNET=https://fdc-verifiers-testnet.flare.network/verifier/web2
WEB2JSON_VERIFIER_URL_MAINNET=https://fdc-verifiers-mainnet.flare.network/verifier/web2
COSTON2_DA_LAYER_URL=https://ctn2-data-availability.flare.network
FLARE_DA_LAYER_URL=https://flr-data-availability.flare.network
```

## References

- [FDC Web2Json Attestation](https://dev.flare.network/fdc/attestation-types/web2-json)
- [FDC Proof of Reserves Guide](https://dev.flare.network/fdc/guides/hardhat/proof-of-reserves)
- [Custom Feed Guide](https://dev.flare.network/ftso/guides/create-custom-feed)
- [cUSDX Token (T-Pool)](https://flarescan.com/address/0xfe2907dfa8db6e320cdbf45f0aa888f6135ec4f8)
- [X-Pool Vault](https://mainnet.flarescan.com/address/0xd006185B765cA59F29FDd0c57526309726b69d99)
- [USDX FTSO Feed](https://flare-systems-explorer.flare.network/price-feeds/ftso?feed=0x01555344582f555344000000000000000000000000)
- [HT Digital Assets Reserves API](https://api.htdigitalassets.com/alm-stablecoin-db/metrics/current_reserves_amount)
