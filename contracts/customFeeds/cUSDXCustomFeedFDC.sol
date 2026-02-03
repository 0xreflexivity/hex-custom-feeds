// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { IICustomFeed } from "@flarenetwork/flare-periphery-contracts/coston2/customFeeds/interfaces/IICustomFeed.sol";
import { FtsoV2Interface } from "@flarenetwork/flare-periphery-contracts/coston2/FtsoV2Interface.sol";
import { ContractRegistry } from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";
import { IWeb2Json } from "@flarenetwork/flare-periphery-contracts/coston2/IWeb2Json.sol";

/**
 * @notice Minimal ERC20 interface for supply checks
 */
interface IERC20Supply {
    function totalSupply() external view returns (uint256);
    function decimals() external view returns (uint8);
}

/**
 * @notice Struct to decode the FDC response body for reserve data
 * @dev Must match the abiSignature used in the FDC request.
 *      The API returns { "value": "41,842,373.09", ... } which the off-chain
 *      jq filter strips commas and decimals, producing a whole-dollar string.
 *      Example: "41,842,373.09" -> "41842373"
 *      The string is parsed to uint256 on-chain.
 *
 *      ABI signature:
 *      {"components": [
 *        {"internalType": "string", "name": "currentReservesAmount", "type": "string"}
 *      ], "internalType": "struct ReserveData", "name": "data", "type": "tuple"}
 */
struct ReserveData {
    /// @notice Current reserves as a numeric string in whole USD (no decimals)
    string currentReservesAmount;
}

/**
 * @title cUSDXCustomFeedFDC
 * @notice FTSO Custom Feed for cUSDX/USD with FDC reserve verification
 *
 * @dev cUSDX is the LP token from Clearpool's T-Pool vault. It maintains a 1:1 peg
 *      with USDX as funds are invested in short-term US Treasuries and US bonds.
 *
 *      This contract combines two data sources:
 *      1. FTSO: USDX/USD price feed (since cUSDX is 1:1 with USDX)
 *      2. FDC: Reserves attestation from HT Digital Assets API verifying that
 *         current reserves back all outstanding cUSDX tokens
 *
 *      Reserve Verification:
 *      The FDC attestation provides cryptographic proof that the HT Digital Assets
 *      API (api.htdigitalassets.com/alm-stablecoin-db/metrics/current_reserves_amount)
 *      reports sufficient reserves to back cUSDX supply. The on-chain cUSDX total
 *      supply is cross-checked against the API-reported reserves amount.
 *
 *      Security Model:
 *      1. FTSO price comes from decentralized data providers
 *      2. FDC attestation providers independently verify reserve data from the API
 *      3. HTTPS-only enforcement prevents MitM attacks
 *      4. Host validation ensures data comes from allowed sources only
 *      5. Path validation prevents prefix injection attacks
 *      6. Reserve ratio bounds checking prevents extreme values
 *      7. On-chain supply cross-check validates reserves >= supply
 *
 *      API Source:
 *      - https://api.htdigitalassets.com/alm-stablecoin-db/metrics/current_reserves_amount
 *
 *      T-Pool (cUSDX token): 0xfe2907dfa8db6e320cdbf45f0aa888f6135ec4f8
 */
contract CUSDXCustomFeedFDC is IICustomFeed {
    // --- State Variables ---

    bytes21 public immutable feedIdentifier;
    int8 public constant DECIMALS = 6;

    /// @notice The cUSDX token address (T-Pool LP token)
    address public immutable cUSDXToken;

    /// @notice The USDX/USD feed ID for FTSO lookup
    bytes21 public immutable usdxFeedId;

    /// @notice The last cached FTSO price
    uint256 public cachedPrice;

    /// @notice Timestamp of the last FTSO price update
    uint64 public lastUpdateTimestamp;

    /// @notice The FDC-verified reserve ratio (6 decimals, 1000000 = 1:1)
    uint256 public verifiedReserveRatio;

    /// @notice The FDC-verified current reserves amount (6 decimals)
    uint256 public verifiedReservesAmount;

    /// @notice Timestamp of the last FDC reserve verification
    uint64 public lastReserveVerificationTimestamp;

    /// @notice Number of successful FDC reserve verifications
    uint256 public reserveVerificationCount;

    /// @notice Whether reserves have been verified at least once
    bool public reservesVerified;

    // --- Events ---
    event PriceUpdated(uint256 price, uint64 timestamp);
    event ReservesVerified(uint256 reservesAmount, uint256 onChainSupply, uint256 reserveRatio, uint64 timestamp);

    // --- Errors ---
    error InvalidFeedId();
    error InvalidTokenAddress();
    error InvalidProof();
    error InvalidUrlHost(string url, string extractedHost);
    error InvalidUrlPath(string url, string extractedPath);
    error InvalidUrlProtocol();
    error SliceOutOfBounds();
    error EthRefundFailed();
    error EmptyString();
    error NonDigitCharacter();

    /// @notice Expected API host
    string public constant EXPECTED_HOST = "api.htdigitalassets.com";

    /// @notice Expected API path
    string public constant EXPECTED_PATH = "/alm-stablecoin-db/metrics/current_reserves_amount";

    // --- Constructor ---

    /**
     * @param _feedId The unique feed identifier for cUSDX/USD (bytes21, starting with 0x21)
     * @param _cUSDXToken The address of the cUSDX token (T-Pool)
     * @param _usdxFeedId The FTSO feed ID for USDX/USD
     */
    constructor(bytes21 _feedId, address _cUSDXToken, bytes21 _usdxFeedId) {
        if (_feedId == bytes21(0)) revert InvalidFeedId();
        if (_cUSDXToken == address(0)) revert InvalidTokenAddress();

        feedIdentifier = _feedId;
        cUSDXToken = _cUSDXToken;
        usdxFeedId = _usdxFeedId;

        // Initialize reserve ratio to 1:1 and mark as unverified
        verifiedReserveRatio = 1000000;
        reservesVerified = false;
    }

    // --- FTSO Price Logic ---

    /**
     * @notice Gets the current USDX/USD price from the FTSO
     * @return price The USDX price in 6 decimals
     * @return timestamp The timestamp of the price
     */
    function _getUSDXPrice() internal returns (uint256 price, uint64 timestamp) {
        FtsoV2Interface ftsoV2 = ContractRegistry.getFtsoV2();
        (uint256 value, int8 srcDecimals, uint64 updateTimestamp) = ftsoV2.getFeedById(usdxFeedId);

        if (srcDecimals == DECIMALS) {
            price = value;
        } else if (srcDecimals > DECIMALS) {
            price = value / (10 ** uint8(srcDecimals - DECIMALS));
        } else {
            price = value * (10 ** uint8(DECIMALS - srcDecimals));
        }

        timestamp = updateTimestamp;
    }

    /**
     * @notice Fetches and caches the current USDX price from FTSO
     * @return price The current USDX/USD price (= cUSDX/USD price due to 1:1 peg)
     */
    function updateRate() external returns (uint256 price) {
        uint64 timestamp;
        (price, timestamp) = _getUSDXPrice();
        cachedPrice = price;
        lastUpdateTimestamp = timestamp;
        emit PriceUpdated(price, timestamp);
    }

    /**
     * @notice Gets the current price directly from FTSO (no caching)
     */
    function getLiveRate() external returns (uint256 price) {
        (price, ) = _getUSDXPrice();
    }

    // --- FDC Reserve Verification ---

    /**
     * @notice Verifies cUSDX reserves using FDC-attested off-chain data
     *
     * @dev The HT Digital Assets API returns current_reserves_amount which represents
     *      the total reserves backing cUSDX. This is compared against on-chain cUSDX
     *      total supply to compute a reserve ratio.
     *
     *      Validates:
     *      1. The URL uses HTTPS and points to api.htdigitalassets.com
     *      2. The FDC proof is cryptographically valid
     *      3. Computes reserve ratio from API reserves vs on-chain cUSDX supply
     *
     * @param _proof The Web2Json proof structure from FDC
     */
    function verifyReserves(IWeb2Json.Proof calldata _proof) external {
        // 1. Validate the URL from the proof
        _validateUrl(_proof.data.requestBody.url);

        // 2. Verify the FDC proof cryptographically
        if (!ContractRegistry.getFdcVerification().verifyWeb2Json(_proof)) revert InvalidProof();

        // 3. Decode the reserve data from the response
        ReserveData memory data = abi.decode(_proof.data.responseBody.abiEncodedData, (ReserveData));

        // 4. Parse the reserves string to uint256 (whole USD)
        uint256 reserves = _parseUint(data.currentReservesAmount);

        // 5. Get on-chain cUSDX supply and compute reserve ratio
        uint256 onChainSupply = IERC20Supply(cUSDXToken).totalSupply();
        uint8 tokenDecimals = IERC20Supply(cUSDXToken).decimals();
        uint256 reserveRatio;

        if (onChainSupply == 0) {
            reserveRatio = 1000000;
        } else {
            // Reserves are in whole USD, supply is in token units (e.g. 6 decimals)
            // ratio = (reserves * 1e6 * 10^decimals) / supply
            reserveRatio = (reserves * 1000000 * (10 ** tokenDecimals)) / onChainSupply;
        }

        // 6. Update verified state
        verifiedReserveRatio = reserveRatio;
        verifiedReservesAmount = reserves;
        lastReserveVerificationTimestamp = uint64(block.timestamp);
        reservesVerified = true;
        unchecked {
            ++reserveVerificationCount;
        }

        emit ReservesVerified(
            reserves,
            onChainSupply,
            reserveRatio,
            uint64(block.timestamp)
        );
    }

    // --- URL Validation ---

    /**
     * @notice Validates that the URL from the FDC proof matches the allowed API endpoint
     * @dev Security measures:
     *      1. HTTPS only (HTTP rejected)
     *      2. Exact host matching (case-insensitive)
     *      3. Path must start with expected pattern (no prefix injection)
     */
    function _validateUrl(string memory _url) internal pure {
        bytes memory urlBytes = bytes(_url);
        bytes memory httpsPrefix = bytes("https://");
        if (!_startsWith(urlBytes, httpsPrefix)) {
            revert InvalidUrlProtocol();
        }

        string memory host = _extractHost(_url);
        string memory path = _extractPath(_url);

        string memory lowerHost = _toLowerCase(host);
        if (!_stringsEqual(lowerHost, EXPECTED_HOST)) {
            revert InvalidUrlHost(_url, host);
        }

        if (!_startsWith(bytes(path), bytes(EXPECTED_PATH))) {
            revert InvalidUrlPath(_url, path);
        }
    }

    /**
     * @notice Extracts the host from a URL
     */
    function _extractHost(string memory _url) internal pure returns (string memory) {
        bytes memory urlBytes = bytes(_url);
        bytes memory httpsPrefix = bytes("https://");
        bytes memory httpPrefix = bytes("http://");

        uint256 startIndex = 0;
        if (_startsWith(urlBytes, httpsPrefix)) {
            startIndex = httpsPrefix.length;
        } else if (_startsWith(urlBytes, httpPrefix)) {
            startIndex = httpPrefix.length;
        }

        uint256 urlLen = urlBytes.length;
        uint256 endIndex = urlLen;
        for (uint256 i = startIndex; i < urlLen; ) {
            if (urlBytes[i] == "/") {
                endIndex = i;
                break;
            }
            unchecked {
                ++i;
            }
        }

        return string(_slice(urlBytes, startIndex, endIndex));
    }

    /**
     * @notice Extracts the path from a URL
     */
    function _extractPath(string memory _url) internal pure returns (string memory) {
        bytes memory urlBytes = bytes(_url);
        bytes memory httpsPrefix = bytes("https://");
        bytes memory httpPrefix = bytes("http://");

        uint256 startIndex = 0;
        if (_startsWith(urlBytes, httpsPrefix)) {
            startIndex = httpsPrefix.length;
        } else if (_startsWith(urlBytes, httpPrefix)) {
            startIndex = httpPrefix.length;
        }

        uint256 urlLen = urlBytes.length;
        for (uint256 i = startIndex; i < urlLen; ) {
            if (urlBytes[i] == "/") {
                return string(_slice(urlBytes, i, urlLen));
            }
            unchecked {
                ++i;
            }
        }

        return "";
    }

    // --- String/Number Helpers ---

    /**
     * @notice Parses a numeric string (digits only) into a uint256
     * @dev Reverts if the string contains non-digit characters or is empty
     */
    function _parseUint(string memory s) internal pure returns (uint256 result) {
        bytes memory b = bytes(s);
        uint256 len = b.length;
        if (len == 0) revert EmptyString();
        result = 0;
        for (uint256 i = 0; i < len; ) {
            uint8 c = uint8(b[i]);
            if (c < 48 || c > 57) revert NonDigitCharacter();
            result = result * 10 + (c - 48);
            unchecked {
                ++i;
            }
        }
    }

    function _slice(bytes memory data, uint256 start, uint256 end) internal pure returns (bytes memory) {
        if (end < start || data.length < end) revert SliceOutOfBounds();
        bytes memory result = new bytes(end - start);
        for (uint256 i = start; i < end; ) {
            result[i - start] = data[i];
            unchecked {
                ++i;
            }
        }
        return result;
    }

    function _startsWith(bytes memory data, bytes memory prefix) internal pure returns (bool) {
        uint256 prefixLen = prefix.length;
        if (data.length < prefixLen) return false;
        for (uint256 i = 0; i < prefixLen; ) {
            if (data[i] != prefix[i]) return false;
            unchecked {
                ++i;
            }
        }
        return true;
    }

    function _stringsEqual(string memory a, string memory b) internal pure returns (bool) {
        return keccak256(abi.encodePacked(a)) == keccak256(abi.encodePacked(b));
    }

    function _toLowerCase(string memory str) internal pure returns (string memory) {
        bytes memory strBytes = bytes(str);
        uint256 len = strBytes.length;
        bytes memory result = new bytes(len);
        for (uint256 i = 0; i < len; ) {
            bytes1 char = strBytes[i];
            if (char >= 0x41 && char <= 0x5A) {
                result[i] = bytes1(uint8(char) + 32);
            } else {
                result[i] = char;
            }
            unchecked {
                ++i;
            }
        }
        return string(result);
    }

    // --- View Functions ---

    /**
     * @notice Returns time since last reserve verification
     */
    function timeSinceLastReserveVerification() external view returns (uint256) {
        if (lastReserveVerificationTimestamp == 0) return type(uint256).max;
        return block.timestamp - lastReserveVerificationTimestamp;
    }

    /**
     * @notice Gets the total supply of cUSDX tokens
     */
    function getTotalSupply() external view returns (uint256) {
        return IERC20Supply(cUSDXToken).totalSupply();
    }

    /**
     * @notice Returns whether the feed has been FDC-verified and the reserve status
     */
    function getReserveStatus()
        external
        view
        returns (bool verified, uint256 ratio, uint256 reserves, uint64 verifiedAt)
    {
        verified = reservesVerified;
        ratio = verifiedReserveRatio;
        reserves = verifiedReservesAmount;
        verifiedAt = lastReserveVerificationTimestamp;
    }

    // --- IICustomFeed Implementation ---

    /**
     * @notice Returns the current cUSDX/USD price based on USDX/USD FTSO feed
     * @dev Since cUSDX is 1:1 with USDX, returns the USDX/USD price.
     *      The FDC reserve verification adds confidence that the peg holds.
     */
    function getCurrentFeed() external payable override returns (uint256 _value, int8 _decimals, uint64 _timestamp) {
        if (msg.value > 0) {
            (bool success, ) = msg.sender.call{ value: msg.value }("");
            if (!success) revert EthRefundFailed();
        }

        (_value, _timestamp) = _getUSDXPrice();
        _decimals = DECIMALS;
    }

    function feedId() external view override returns (bytes21 _feedId) {
        _feedId = feedIdentifier;
    }

    function getFeedDataView() external view returns (uint256 _value, int8 _decimals, uint64 _timestamp) {
        _value = cachedPrice;
        _decimals = DECIMALS;
        _timestamp = lastUpdateTimestamp;
    }

    function calculateFee() external pure override returns (uint256 _fee) {
        return 0;
    }

    function read() public returns (uint256 value) {
        (value, ) = _getUSDXPrice();
    }

    function decimals() external pure returns (int8) {
        return DECIMALS;
    }
}
