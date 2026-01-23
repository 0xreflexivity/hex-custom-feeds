// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { yUSDXCustomFeedFDC } from "../yUSDXCustomFeedFDC.sol";

/**
 * @title yUSDXCustomFeedFDCHarness
 * @notice Test harness to expose internal functions for testing
 */
contract yUSDXCustomFeedFDCHarness is yUSDXCustomFeedFDC {
    constructor(bytes21 _feedId, address _xPoolVault) yUSDXCustomFeedFDC(_feedId, _xPoolVault) {}

    function exposed_extractHost(string memory _url) external pure returns (string memory) {
        return _extractHost(_url);
    }

    function exposed_extractPath(string memory _url) external pure returns (string memory) {
        return _extractPath(_url);
    }

    function exposed_validateUrl(string memory _url) external pure {
        _validateUrl(_url);
    }

    function exposed_validateNav(uint256 _nav) external pure {
        _validateNav(_nav);
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
