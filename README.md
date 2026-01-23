# HEX Custom FTSO Feeds

Custom FTSO price feeds for **cUSDX/USD** and **yUSDX/USD** on Flare Network.

## Overview

| Feed | Description | Data Source |
|------|-------------|-------------|
| **cUSDX/USD** | T-Pool LP token, 1:1 peg with USD | USDX/USD FTSO feed |
| **yUSDX/USD** | X-Pool LP token, NAV-based pricing | Vault `getRate()` |
| **yUSDX/USD (FDC)** | X-Pool with FDC verification | Off-chain API + FDC proof |

### Token Details

- **cUSDX**: LP token from [T-Pool](https://clearpool.finance/lending/tpool) - invests in short-term US treasuries
- **yUSDX**: LP token from [X-Pool](https://vaults.clearpool.finance/vault?address=0x6b9e9d89e0e9fd93eb95d8c7715be2a8de64af07) - delta-neutral basis trading strategy on CEXs

NAV updates daily at 08:30 UTC.

## Contracts

All contracts implement `IICustomFeed` interface.

### cUSDXCustomFeed

Derives price from the existing USDX/USD FTSO feed (1:1 peg).

```solidity
function read() public view returns (uint256) {
    (uint256 usdxPrice, , ) = ftsoV2.getFeedById(USDX_FEED_ID);
    return usdxPrice; // cUSDX = USDX = $1.00
}
```

### yUSDXCustomFeed

Reads NAV directly from the X-Pool vault's `getRate()` function.

```solidity
function read() public view returns (uint256) {
    uint256 rate = IVault(xPoolVault).getRate(); // 18 decimals
    return rate / 1e12; // Convert to 6 decimals
}
```

### yUSDXCustomFeedFDC

Uses Flare Data Connector (FDC) to verify off-chain NAV data from multiple attestation providers.

**Security Features:**
- HTTPS-only URL enforcement
- Allowlist-based host validation (case-insensitive)
- Path prefix validation to prevent injection attacks
- NAV bounds checking ($0.80 - $1.20)
- ETH refund on payable interface

```solidity
function updateNavWithFDC(IWeb2Json.Proof calldata _proof) external {
    // 1. Validate URL (HTTPS, allowed host, correct path prefix)
    // 2. Verify FDC proof cryptographically
    // 3. Decode navScaled from response
    // 4. Validate NAV within bounds (80% - 120%)
    // 5. Update state
}
```

**Allowed API Sources:**
- GitHub Pages: `amadiaflare.github.io/hex-custom-feeds/api/v1/xpool/nav`
- Production: `api.htmarkets.com/api/v1/xpool/nav` *(placeholder - not yet available)*

## Setup

```bash
git clone https://github.com/AmadiaFlare/hex-custom-feeds.git
cd hex-custom-feeds
yarn install
cp .env.example .env  # Configure your keys
yarn compile
```

## Testing

```bash
# Run all tests
yarn test

# Run security tests only
npx hardhat test test/yUSDXCustomFeedFDC.security.test.ts
```

## Deployment

```bash
# Deploy cUSDX feed
yarn deploy:cusdx --network coston2

# Deploy yUSDX feed (vault-based)
yarn deploy:yusdx --network coston2

# Deploy yUSDX feed with FDC verification
yarn deploy:yusdx-fdc --network coston2
```

## Static API (GitHub Pages)

For FDC testing, a static API is hosted at:

```
https://amadiaflare.github.io/hex-custom-feeds/api/v1/xpool/nav.json
```

FDC attestation config:
```json
{
  "url": "https://amadiaflare.github.io/hex-custom-feeds/api/v1/xpool/nav.json",
  "httpMethod": "GET",
  "postProcessJq": "{navScaled: .data.navScaled}",
  "abiSignature": "{\"components\": [{\"type\": \"uint256\", \"name\": \"navScaled\"}], \"type\": \"tuple\"}"
}
```

## Contract Addresses (Coston2)

| Contract | Address |
|----------|---------|
| yUSDXCustomFeedFDC | `0x59Dd88c88c7979A06825bab0f1D18F9c55e0Cc19` |
| MockClearpoolVault | `0xacB86f3d6B50181c4ce9Bd97Bd7A1A261ae58BaF` |

## Environment Variables

```env
PRIVATE_KEY=           # Deployer private key
FLARESCAN_API_KEY=     # Contract verification
VERIFIER_API_KEY_TESTNET=  # FDC verifier
COSTON2_DA_LAYER_URL=https://ctn2-data-availability.flare.network
WEB2JSON_VERIFIER_URL_TESTNET=https://web2json-verifier-test.flare.rocks
```

## References

- [Custom Feed Guide](https://dev.flare.network/ftso/guides/create-custom-feed)
- [X-Pool Vault](https://mainnet.flarescan.com/address/0xd006185B765cA59F29FDd0c57526309726b69d99)
- [cUSDX Token](https://flarescan.com/address/0xfe2907dfa8db6e320cdbf45f0aa888f6135ec4f8)
- [USDX FTSO Feed](https://flare-systems-explorer.flare.network/price-feeds/ftso?feed=0x01555344582f555344000000000000000000000000)
