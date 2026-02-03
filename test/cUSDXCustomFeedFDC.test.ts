import { expect } from "chai";
import { web3 } from "hardhat";

const cUSDXCustomFeedFDCHarness = artifacts.require("cUSDXCustomFeedFDCHarness");

describe("cUSDXCustomFeedFDC Tests", function () {
    let harness: any;
    let feedId: string;

    const FEED_SYMBOL = "cUSDX";
    // Dummy addresses for testing (not real contracts on hardhat network)
    const DUMMY_CUSDX_TOKEN = "0x0000000000000000000000000000000000000001";
    const USDX_FEED_ID = "0x01555344582f555344000000000000000000000000";

    beforeEach(async function () {
        const feedIdString = `${FEED_SYMBOL}/USD`;
        const feedNameHash = web3.utils.keccak256(feedIdString);
        feedId = `0x21${feedNameHash.substring(2, 42)}`;
        harness = await cUSDXCustomFeedFDCHarness.new(feedId, DUMMY_CUSDX_TOKEN, USDX_FEED_ID);
    });

    describe("Constructor", function () {
        it("should initialize reservesVerified to false", async function () {
            const { verified } = await harness.getReserveStatus();
            expect(verified).to.equal(false);
        });

        it("should initialize verifiedReserveRatio to 1000000", async function () {
            const { ratio } = await harness.getReserveStatus();
            expect(ratio.toString()).to.equal("1000000");
        });

        it("should initialize reserveVerificationCount to 0", async function () {
            const count = await harness.reserveVerificationCount();
            expect(count.toString()).to.equal("0");
        });
    });

    describe("HTTPS Enforcement", function () {
        it("should REJECT HTTP URLs", async function () {
            try {
                await harness.exposed_validateUrl(
                    "http://0xreflexivity.github.io/hex-custom-feeds/api/v1/tpool/reserves.json"
                );
                expect.fail("Should reject HTTP URL");
            } catch (error: any) {
                expect(error.message).to.include("InvalidUrlProtocol");
            }
        });

        it("should ACCEPT HTTPS URLs", async function () {
            await harness.exposed_validateUrl(
                "https://0xreflexivity.github.io/hex-custom-feeds/api/v1/tpool/reserves.json"
            );
        });
    });

    describe("Host Validation", function () {
        it("should accept lowercase github.io host", async function () {
            await harness.exposed_validateUrl(
                "https://0xreflexivity.github.io/hex-custom-feeds/api/v1/tpool/reserves.json"
            );
        });

        it("should accept UPPERCASE github.io host", async function () {
            await harness.exposed_validateUrl(
                "https://0XREFLEXIVITY.GITHUB.IO/hex-custom-feeds/api/v1/tpool/reserves.json"
            );
        });

        it("should accept production host", async function () {
            await harness.exposed_validateUrl("https://api.htmarkets.com/api/v1/tpool/reserves");
        });

        it("should REJECT unknown host", async function () {
            try {
                await harness.exposed_validateUrl("https://evil.com/api/v1/tpool/reserves");
                expect.fail("Should reject unknown host");
            } catch (error: any) {
                expect(error.message).to.include("InvalidUrlHost");
            }
        });

        it("should REJECT similar-looking host", async function () {
            try {
                await harness.exposed_validateUrl(
                    "https://0xreflexivity.github.io.evil.com/hex-custom-feeds/api/v1/tpool/reserves"
                );
                expect.fail("Should reject lookalike host");
            } catch (error: any) {
                expect(error.message).to.include("InvalidUrlHost");
            }
        });
    });

    describe("Path Validation", function () {
        it("should ACCEPT valid GitHub Pages path", async function () {
            await harness.exposed_validateUrl(
                "https://0xreflexivity.github.io/hex-custom-feeds/api/v1/tpool/reserves.json"
            );
        });

        it("should ACCEPT valid production path", async function () {
            await harness.exposed_validateUrl("https://api.htmarkets.com/api/v1/tpool/reserves");
        });

        it("should REJECT path with prefix injection (GitHub)", async function () {
            try {
                await harness.exposed_validateUrl(
                    "https://0xreflexivity.github.io/malicious/hex-custom-feeds/api/v1/tpool/reserves"
                );
                expect.fail("Should reject prefixed path");
            } catch (error: any) {
                expect(error.message).to.include("InvalidUrlPath");
            }
        });

        it("should REJECT path with prefix injection (production)", async function () {
            try {
                await harness.exposed_validateUrl("https://api.htmarkets.com/malicious/api/v1/tpool/reserves");
                expect.fail("Should reject prefixed path");
            } catch (error: any) {
                expect(error.message).to.include("InvalidUrlPath");
            }
        });

        it("should ACCEPT path with query params", async function () {
            await harness.exposed_validateUrl("https://api.htmarkets.com/api/v1/tpool/reserves?timestamp=123");
        });

        it("should REJECT wrong endpoint path", async function () {
            try {
                await harness.exposed_validateUrl("https://api.htmarkets.com/api/v1/xpool/nav");
                expect.fail("Should reject wrong endpoint");
            } catch (error: any) {
                expect(error.message).to.include("InvalidUrlPath");
            }
        });
    });

    describe("Reserve Ratio Validation", function () {
        it("should accept ratio at 1:1 (1000000)", async function () {
            await harness.exposed_validateReserveRatio(1000000);
        });

        it("should accept ratio at lower bound (950000 = 95%)", async function () {
            await harness.exposed_validateReserveRatio(950000);
        });

        it("should accept ratio at upper bound (1050000 = 105%)", async function () {
            await harness.exposed_validateReserveRatio(1050000);
        });

        it("should REJECT ratio below 95%", async function () {
            try {
                await harness.exposed_validateReserveRatio(949999);
                expect.fail("Should reject low ratio");
            } catch (error: any) {
                expect(error.message).to.include("ReserveRatioOutOfBounds");
            }
        });

        it("should REJECT ratio above 105%", async function () {
            try {
                await harness.exposed_validateReserveRatio(1050001);
                expect.fail("Should reject high ratio");
            } catch (error: any) {
                expect(error.message).to.include("ReserveRatioOutOfBounds");
            }
        });

        it("should REJECT zero ratio", async function () {
            try {
                await harness.exposed_validateReserveRatio(0);
                expect.fail("Should reject zero");
            } catch (error: any) {
                expect(error.message).to.include("ReserveRatioOutOfBounds");
            }
        });
    });

    describe("Supply Match Validation", function () {
        it("should accept matching supplies", async function () {
            await harness.exposed_validateSupplyMatch(1000000, 1000000);
        });

        it("should accept both zero", async function () {
            await harness.exposed_validateSupplyMatch(0, 0);
        });

        it("should accept within 1% discrepancy", async function () {
            // 1% of 1000000 = 10000
            await harness.exposed_validateSupplyMatch(1010000, 1000000);
        });

        it("should REJECT if API is zero but on-chain is not", async function () {
            try {
                await harness.exposed_validateSupplyMatch(0, 1000000);
                expect.fail("Should reject mismatch");
            } catch (error: any) {
                expect(error.message).to.include("SupplyMismatch");
            }
        });

        it("should REJECT if on-chain is zero but API is not", async function () {
            try {
                await harness.exposed_validateSupplyMatch(1000000, 0);
                expect.fail("Should reject mismatch");
            } catch (error: any) {
                expect(error.message).to.include("SupplyMismatch");
            }
        });

        it("should REJECT >1% discrepancy", async function () {
            try {
                // 2% difference
                await harness.exposed_validateSupplyMatch(1020000, 1000000);
                expect.fail("Should reject large discrepancy");
            } catch (error: any) {
                expect(error.message).to.include("SupplyMismatch");
            }
        });
    });

    describe("View Functions", function () {
        it("should return correct decimals", async function () {
            const dec = await harness.decimals();
            expect(dec.toString()).to.equal("6");
        });

        it("should return zero fee", async function () {
            const fee = await harness.calculateFee();
            expect(fee.toString()).to.equal("0");
        });

        it("should return correct feed id", async function () {
            const result = await harness.feedId();
            expect(result).to.equal(feedId);
        });
    });

    describe("Constants Verification", function () {
        it("MIN_RESERVE_RATIO should be 950000 (95%)", async function () {
            const min = await harness.MIN_RESERVE_RATIO();
            expect(min.toString()).to.equal("950000");
        });

        it("MAX_RESERVE_RATIO should be 1050000 (105%)", async function () {
            const max = await harness.MAX_RESERVE_RATIO();
            expect(max.toString()).to.equal("1050000");
        });

        it("MAX_SUPPLY_DISCREPANCY_BPS should be 100 (1%)", async function () {
            const bps = await harness.MAX_SUPPLY_DISCREPANCY_BPS();
            expect(bps.toString()).to.equal("100");
        });

        it("EXPECTED_API_PATH should be /api/v1/tpool/reserves", async function () {
            const path = await harness.EXPECTED_API_PATH();
            expect(path).to.equal("/api/v1/tpool/reserves");
        });
    });
});
