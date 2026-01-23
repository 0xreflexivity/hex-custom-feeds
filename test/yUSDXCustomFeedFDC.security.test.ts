import { expect } from "chai";
import { web3 } from "hardhat";

const yUSDXCustomFeedFDCHarness = artifacts.require("yUSDXCustomFeedFDCHarness");
const MockClearpoolVault = artifacts.require("MockClearpoolVault");

describe("yUSDXCustomFeedFDC Security Tests", function () {
    let harness: any;
    let mockVault: any;
    let feedId: string;

    const FEED_SYMBOL = "yUSDX";
    const MOCK_INITIAL_RATE = web3.utils.toWei("1.05", "ether");

    beforeEach(async function () {
        const feedIdString = `${FEED_SYMBOL}/USD`;
        const feedNameHash = web3.utils.keccak256(feedIdString);
        feedId = `0x21${feedNameHash.substring(2, 42)}`;
        mockVault = await MockClearpoolVault.new(MOCK_INITIAL_RATE);
        harness = await yUSDXCustomFeedFDCHarness.new(feedId, mockVault.address);
    });

    describe("Constructor Security", function () {
        it("should initialize lastVerifiedTimestamp to 0", async function () {
            const timestamp = await harness.lastVerifiedTimestamp();
            expect(timestamp.toString()).to.equal("0");
        });

        it("should initialize verifiedNav to 1000000", async function () {
            const nav = await harness.verifiedNav();
            expect(nav.toString()).to.equal("1000000");
        });
    });

    describe("HTTPS Enforcement (FIX VERIFIED)", function () {
        it("should REJECT HTTP URLs", async function () {
            try {
                await harness.exposed_validateUrl("http://amadiaflare.github.io/hex-custom-feeds/api/v1/xpool/nav.json");
                expect.fail("Should reject HTTP URL");
            } catch (error: any) {
                expect(error.message).to.include("InvalidUrlProtocol");
                console.log("  ✓ HTTP URL correctly rejected");
            }
        });

        it("should ACCEPT HTTPS URLs", async function () {
            await harness.exposed_validateUrl("https://amadiaflare.github.io/hex-custom-feeds/api/v1/xpool/nav.json");
            console.log("  ✓ HTTPS URL correctly accepted");
        });
    });

    describe("Case-Insensitive Host (FIX VERIFIED)", function () {
        it("should accept lowercase host", async function () {
            await harness.exposed_validateUrl("https://amadiaflare.github.io/hex-custom-feeds/api/v1/xpool/nav.json");
            console.log("  ✓ Lowercase host accepted");
        });

        it("should accept UPPERCASE host", async function () {
            await harness.exposed_validateUrl("https://AMADIAFLARE.GITHUB.IO/hex-custom-feeds/api/v1/xpool/nav.json");
            console.log("  ✓ Uppercase host accepted");
        });

        it("should accept MixedCase host", async function () {
            await harness.exposed_validateUrl("https://AmAdIaFlArE.GiThUb.Io/hex-custom-feeds/api/v1/xpool/nav.json");
            console.log("  ✓ Mixed case host accepted");
        });

        it("toLowerCase helper works correctly", async function () {
            const result = await harness.exposed_toLowerCase("AMADIAFLARE.GITHUB.IO");
            expect(result).to.equal("amadiaflare.github.io");
        });
    });

    describe("Path Prefix Injection Prevention (FIX VERIFIED)", function () {
        it("should REJECT path with malicious prefix", async function () {
            try {
                await harness.exposed_validateUrl("https://amadiaflare.github.io/malicious/hex-custom-feeds/api/v1/xpool/nav.json");
                expect.fail("Should reject path with prefix");
            } catch (error: any) {
                expect(error.message).to.include("InvalidUrlPath");
                console.log("  ✓ Path prefix injection correctly rejected");
            }
        });

        it("should ACCEPT valid GitHub Pages path", async function () {
            await harness.exposed_validateUrl("https://amadiaflare.github.io/hex-custom-feeds/api/v1/xpool/nav.json");
            console.log("  ✓ Valid GitHub Pages path accepted");
        });

        it("should ACCEPT valid production path", async function () {
            await harness.exposed_validateUrl("https://api.htmarkets.com/api/v1/xpool/nav");
            console.log("  ✓ Valid production path accepted");
        });

        it("should REJECT production URL with prefix injection", async function () {
            try {
                await harness.exposed_validateUrl("https://api.htmarkets.com/malicious/api/v1/xpool/nav");
                expect.fail("Should reject path with prefix");
            } catch (error: any) {
                expect(error.message).to.include("InvalidUrlPath");
                console.log("  ✓ Production path prefix injection rejected");
            }
        });
    });

    describe("Path Suffix Handling", function () {
        it("should ACCEPT path with .json suffix (GitHub Pages)", async function () {
            await harness.exposed_validateUrl("https://amadiaflare.github.io/hex-custom-feeds/api/v1/xpool/nav.json");
            console.log("  ✓ .json suffix accepted");
        });

        it("should ACCEPT path with query params", async function () {
            await harness.exposed_validateUrl("https://api.htmarkets.com/api/v1/xpool/nav?timestamp=123");
            console.log("  ✓ Query params accepted");
        });
    });

    describe("Host Validation", function () {
        it("should REJECT unknown host", async function () {
            try {
                await harness.exposed_validateUrl("https://evil.com/api/v1/xpool/nav");
                expect.fail("Should reject unknown host");
            } catch (error: any) {
                expect(error.message).to.include("InvalidUrlHost");
            }
        });

        it("should REJECT similar-looking host", async function () {
            try {
                await harness.exposed_validateUrl("https://amadiaflare.github.io.evil.com/hex-custom-feeds/api/v1/xpool/nav");
                expect.fail("Should reject lookalike host");
            } catch (error: any) {
                expect(error.message).to.include("InvalidUrlHost");
            }
        });
    });

    describe("NAV Bounds Validation", function () {
        it("should accept NAV at $1.00", async function () {
            await harness.exposed_validateNav(1000000);
        });

        it("should accept NAV at lower bound $0.80", async function () {
            await harness.exposed_validateNav(800000);
        });

        it("should accept NAV at upper bound $1.20", async function () {
            await harness.exposed_validateNav(1200000);
        });

        it("should REJECT NAV below $0.80", async function () {
            try {
                await harness.exposed_validateNav(799999);
                expect.fail("Should reject low NAV");
            } catch (error: any) {
                expect(error.message).to.include("NavOutOfBounds");
            }
        });

        it("should REJECT NAV above $1.20", async function () {
            try {
                await harness.exposed_validateNav(1200001);
                expect.fail("Should reject high NAV");
            } catch (error: any) {
                expect(error.message).to.include("NavOutOfBounds");
            }
        });

        it("should REJECT NAV at zero", async function () {
            try {
                await harness.exposed_validateNav(0);
                expect.fail("Should reject zero NAV");
            } catch (error: any) {
                expect(error.message).to.include("NavOutOfBounds");
            }
        });
    });

    describe("View Functions", function () {
        it("should return correct decimals", async function () {
            const decimals = await harness.decimals();
            expect(decimals.toString()).to.equal("6");
        });

        it("should return correct initial read value", async function () {
            const value = await harness.read();
            expect(value.toString()).to.equal("1000000");
        });

        it("should return zero fee", async function () {
            const fee = await harness.calculateFee();
            expect(fee.toString()).to.equal("0");
        });
    });

    describe("Constants Verification", function () {
        it("MAX_NAV_DEVIATION should be 200000 (20%)", async function () {
            const deviation = await harness.MAX_NAV_DEVIATION();
            expect(deviation.toString()).to.equal("200000");
        });

        it("EXPECTED_API_PATH should be /api/v1/xpool/nav", async function () {
            const path = await harness.EXPECTED_API_PATH();
            expect(path).to.equal("/api/v1/xpool/nav");
        });
    });
});
