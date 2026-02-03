import { run, web3, network } from "hardhat";
import {
    prepareAttestationRequestBase,
    submitAttestationRequest,
    retrieveDataAndProofBaseWithRetry,
} from "../utils/fdc";

const cUSDXCustomFeedFDC = artifacts.require("CUSDXCustomFeedFDC");

const {
    WEB2JSON_VERIFIER_URL_TESTNET,
    WEB2JSON_VERIFIER_URL_MAINNET,
    VERIFIER_API_KEY_TESTNET,
    VERIFIER_API_KEY_MAINNET,
    COSTON2_DA_LAYER_URL,
    FLARE_DA_LAYER_URL,
} = process.env;

// yarn hardhat run scripts/customFeeds/cUSDXFDCVerification.ts --network flare
// yarn hardhat run scripts/customFeeds/cUSDXFDCVerification.ts --network coston2

// --- Configuration Constants ---
const FEED_SYMBOL = "cUSDX";

// cUSDX token address on Flare mainnet (T-Pool LP token)
const MAINNET_CUSDX_TOKEN = "0xfe2907dfa8db6e320cdbf45f0aa888f6135ec4f8";

// USDX/USD FTSO feed ID
const USDX_FEED_ID = "0x01555344582f555344000000000000000000000000";

// HT Digital Assets reserve verification API
const API_URL = "https://api.htdigitalassets.com/alm-stablecoin-db/metrics/current_reserves_amount";

// FDC Web2Json configuration
const attestationTypeBase = "Web2Json";
const sourceIdBase = "PublicWeb2";

// Request parameters
const httpMethod = "GET";
const headers = "{}";
const queryParams = "{}";
const body = "{}";

/**
 * JQ filter to extract reserve amount from the API response.
 *
 * API response format:
 * {
 *   "last_update": "2026-02-03T15:16:45Z",
 *   "metric_name": "current_reserves_amount",
 *   "value": "41,842,373.09"
 * }
 *
 * The value is a comma-formatted string with 2 decimal places.
 * We strip commas, multiply by 1e6 to get 6-decimal uint256 representation,
 * and truncate to integer for ABI encoding.
 *
 * Example: "41,842,373.09" -> 41842373090000
 */
// Strip commas, remove decimal portion, parse as whole-dollar integer
// Example: "41,842,373.09" -> "41842373" -> 41842373
// Strip commas from value, remove decimal portion, return as string
// The FDC verifier's jq doesn't support tonumber/gsub/arithmetic
// so we return a clean integer string and parse it in Solidity
// Example: "41,842,373.09" -> "41842373"
const postProcessJq = '{currentReservesAmount: (.value | split(",") | join("") | split(".") | .[0])}';

// ABI signature — string because FDC verifier can't produce numeric types
const abiSignature = `{"components": [{"internalType": "string", "name": "currentReservesAmount", "type": "string"}], "internalType": "struct ReserveData", "name": "data", "type": "tuple"}`;

/**
 * Gets the cUSDX token address based on the network
 */
async function getCUSDXTokenAddress(): Promise<string> {
    const chainId = await web3.eth.getChainId();

    if (chainId === 14) {
        console.log(`Using cUSDX token on Flare mainnet: ${MAINNET_CUSDX_TOKEN}`);
        return MAINNET_CUSDX_TOKEN;
    }

    console.log(`Testnet detected (chainId: ${chainId}). Using mainnet cUSDX address for reference.`);
    return MAINNET_CUSDX_TOKEN;
}

/**
 * Returns network-specific configuration
 */
function getNetworkConfig(chainId: number) {
    const isMainnet = chainId === 14;
    return {
        verifierUrl: isMainnet ? WEB2JSON_VERIFIER_URL_MAINNET : WEB2JSON_VERIFIER_URL_TESTNET,
        apiKey: isMainnet ? VERIFIER_API_KEY_MAINNET : VERIFIER_API_KEY_TESTNET,
        daLayerUrl: isMainnet ? FLARE_DA_LAYER_URL : COSTON2_DA_LAYER_URL,
    };
}

/**
 * Prepares the FDC attestation request for the HT Digital Assets reserves API
 */
async function prepareAttestationRequest(verifierUrl: string, apiKey: string) {
    const requestBody = {
        url: API_URL,
        httpMethod: httpMethod,
        headers: headers,
        queryParams: queryParams,
        body: body,
        postProcessJq: postProcessJq,
        abiSignature: abiSignature,
    };

    const url = `${verifierUrl}/Web2Json/prepareRequest`;

    return await prepareAttestationRequestBase(url, apiKey ?? "", attestationTypeBase, sourceIdBase, requestBody);
}

/**
 * Retrieves the proof from the DA layer after the round is finalized
 */
async function retrieveDataAndProof(abiEncodedRequest: string, roundId: number, daLayerUrl: string) {
    const url = `${daLayerUrl}/api/v1/fdc/proof-by-request-round-raw`;
    console.log("DA Layer URL:", url, "\n");
    return await retrieveDataAndProofBaseWithRetry(url, abiEncodedRequest, roundId);
}

/**
 * Deploys and verifies the cUSDXCustomFeedFDC contract
 */
async function deployAndVerifyContract(cUSDXTokenAddress: string) {
    const feedIdString = `${FEED_SYMBOL}/USD`;
    const feedNameHash = web3.utils.keccak256(feedIdString);
    const finalFeedIdHex = `0x21${feedNameHash.substring(2, 42)}`;

    console.log(`\nDeploying cUSDXCustomFeedFDC...`);
    console.log(`  Feed ID: ${finalFeedIdHex}`);
    console.log(`  cUSDX Token: ${cUSDXTokenAddress}`);
    console.log(`  USDX Feed ID: ${USDX_FEED_ID}`);

    const customFeedArgs: any[] = [finalFeedIdHex, cUSDXTokenAddress, USDX_FEED_ID];
    const customFeed = await cUSDXCustomFeedFDC.new(...customFeedArgs);
    console.log(`cUSDXCustomFeedFDC deployed to: ${customFeed.address}\n`);

    try {
        await run("verify:verify", {
            address: customFeed.address,
            constructorArguments: customFeedArgs,
            contract: "contracts/customFeeds/cUSDXCustomFeedFDC.sol:CUSDXCustomFeedFDC",
        });
        console.log("Contract verification successful.\n");
    } catch (e: any) {
        if (e.message?.toLowerCase().includes("already verified")) {
            console.log("Contract is already verified.\n");
        } else {
            console.log("Contract verification failed:", e.message, "\n");
        }
    }

    return customFeed;
}

/**
 * Updates the contract with FDC-verified reserve data
 */
async function updateWithFDCProof(customFeed: any, proof: any) {
    console.log("Proof hex:", proof.response_hex, "\n");

    // Decode the response type from the IWeb2JsonVerification artifact
    const IWeb2JsonVerification = await artifacts.require("IWeb2JsonVerification");
    const responseType = IWeb2JsonVerification._json.abi[0].inputs[0].components[1];
    console.log("Response type:", responseType, "\n");

    const decodedResponse = web3.eth.abi.decodeParameter(responseType, proof.response_hex);
    console.log("Decoded proof:", decodedResponse, "\n");

    // Call verifyReserves with the proof
    const transaction = await customFeed.verifyReserves({
        merkleProof: proof.proof,
        data: decodedResponse,
    });
    console.log("verifyReserves Transaction:", transaction.tx, "\n");

    // Read the updated reserve status
    const { verified, ratio, reserves, verifiedAt } = await customFeed.getReserveStatus();
    const reserveRatio = Number(ratio) / 1000000;
    const reservesFormatted = Number(reserves) / 1e6;
    const updateTime = new Date(Number(verifiedAt) * 1000).toISOString();

    // Get on-chain supply for display
    const onChainSupply = await customFeed.getTotalSupply();
    const supplyFormatted = Number(onChainSupply) / 1e6;

    console.log(`Reserve Status:`);
    console.log(`  Verified: ${verified}`);
    console.log(`  Current Reserves: $${reservesFormatted.toLocaleString()}`);
    console.log(`  On-Chain cUSDX Supply: ${supplyFormatted.toLocaleString()}`);
    console.log(`  Reserve Ratio: ${reserveRatio.toFixed(6)} (${(reserveRatio * 100).toFixed(4)}%)`);
    console.log(`  Last Verified: ${updateTime}`);
    console.log(`  Verification Count: ${await customFeed.reserveVerificationCount()}\n`);
}

/**
 * Tests basic contract functionality
 */
async function testBasicFunctionality(customFeed: any) {
    console.log("=== Testing Basic Functionality ===\n");

    // Test feedId
    const feedIdResult = await customFeed.feedId();
    console.log(`feedId() -> ${feedIdResult}`);

    // Test decimals
    const dec = await customFeed.decimals();
    console.log(`decimals() -> ${dec.toString()}`);

    // Test fee
    const fee = await customFeed.calculateFee();
    console.log(`calculateFee() -> ${fee.toString()}`);

    // Test initial reserve status
    const { verified, ratio } = await customFeed.getReserveStatus();
    console.log(`reservesVerified -> ${verified}`);
    console.log(`initialReserveRatio -> ${(Number(ratio) / 1000000).toFixed(6)}`);

    console.log("");
}

async function main() {
    console.log(`=== cUSDX/USD Custom Feed FDC Reserve Verification ===`);
    console.log(`Network: ${network.name}`);
    console.log(`API: ${API_URL}\n`);

    const chainId = await web3.eth.getChainId();
    const isMainnet = chainId === 14;
    const netConfig = getNetworkConfig(chainId);

    // Check required environment variables
    if (!netConfig.verifierUrl || !netConfig.apiKey || !netConfig.daLayerUrl) {
        console.error(`Missing required environment variables for ${isMainnet ? "mainnet" : "testnet"}:`);
        console.error(`  Verifier URL: ${netConfig.verifierUrl ?? "MISSING"}`);
        console.error(`  API Key: ${netConfig.apiKey ? "set" : "MISSING"}`);
        console.error(`  DA Layer URL: ${netConfig.daLayerUrl ?? "MISSING"}`);
        process.exit(1);
    }

    // Step 1: Get cUSDX token address
    console.log("Step 1: Getting cUSDX token address...\n");
    const cUSDXTokenAddress = await getCUSDXTokenAddress();

    // Step 2: Deploy FDC custom feed
    console.log("Step 2: Deploying cUSDXCustomFeedFDC...\n");
    const customFeed = await deployAndVerifyContract(cUSDXTokenAddress);

    // Step 3: Test basic functionality
    console.log("Step 3: Testing basic functionality...\n");
    await testBasicFunctionality(customFeed);

    // Step 4: Prepare and submit FDC attestation request
    console.log("Step 4: Preparing FDC attestation request...\n");
    console.log(`API URL: ${API_URL}`);
    console.log(`JQ Filter: ${postProcessJq}`);
    console.log(`ABI Signature: ${abiSignature}\n`);

    try {
        const data = await prepareAttestationRequest(netConfig.verifierUrl, netConfig.apiKey);
        console.log("Attestation request prepared:", data, "\n");

        const abiEncodedRequest = data.abiEncodedRequest;

        // Step 5: Submit to FDC Hub
        console.log("Step 5: Submitting to FDC Hub...\n");
        const roundId = await submitAttestationRequest(abiEncodedRequest);

        // Step 6: Wait for proof and retrieve it
        console.log("Step 6: Waiting for round finalization and proof...\n");
        const proof = await retrieveDataAndProof(abiEncodedRequest, roundId, netConfig.daLayerUrl);

        // Step 7: Update contract with verified reserve data
        console.log("Step 7: Updating contract with FDC proof...\n");
        await updateWithFDCProof(customFeed, proof);
    } catch (error: any) {
        console.log(`FDC attestation failed: ${error.message}`);
        console.log("\nMake sure:");
        console.log("  1. Environment variables are set correctly in .env");
        console.log("  2. The API at api.htdigitalassets.com is accessible from the FDC verifiers");
        console.log("  3. The API response format matches expected schema\n");
    }

    console.log("=== Deployment Complete ===");
    console.log(`Contract: ${customFeed.address}`);
}

void main()
    .then(() => {
        process.exit(0);
    })
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
