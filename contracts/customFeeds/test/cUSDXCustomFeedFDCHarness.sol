// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { CUSDXCustomFeedFDC } from "../cUSDXCustomFeedFDC.sol";

/**
 * @title CUSDXCustomFeedFDCHarness
 * @notice Test harness to expose internal functions for testing
 */
contract CUSDXCustomFeedFDCHarness is CUSDXCustomFeedFDC {
    constructor(
        bytes21 _feedId,
        address _cUSDXToken,
        bytes21 _usdxFeedId
    ) CUSDXCustomFeedFDC(_feedId, _cUSDXToken, _usdxFeedId) {}

    function exposed_extractHost(string memory _url) external pure returns (string memory) {
        return _extractHost(_url);
    }

    function exposed_extractPath(string memory _url) external pure returns (string memory) {
        return _extractPath(_url);
    }

    function exposed_validateUrl(string memory _url) external pure {
        _validateUrl(_url);
    }

    function exposed_stringsEqual(string memory a, string memory b) external pure returns (bool) {
        return _stringsEqual(a, b);
    }

    function exposed_toLowerCase(string memory str) external pure returns (string memory) {
        return _toLowerCase(str);
    }

    function exposed_startsWith(bytes memory data, bytes memory prefix) external pure returns (bool) {
        return _startsWith(data, prefix);
    }
}
