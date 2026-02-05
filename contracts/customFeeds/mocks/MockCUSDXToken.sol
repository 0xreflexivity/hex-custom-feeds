// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/**
 * @title MockCUSDXToken
 * @notice Mock ERC20 token for testing cUSDX custom feed on testnets
 * @dev Simulates cUSDX with configurable totalSupply for reserve ratio testing
 */
contract MockCUSDXToken {
    string public constant name = "Mock cUSDX";
    string public constant symbol = "mcUSDX";
    uint8 public constant decimals = 6;

    uint256 private _totalSupply;
    address public owner;

    mapping(address => uint256) private _balances;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event SupplySet(uint256 newSupply);

    constructor(uint256 initialSupply) {
        owner = msg.sender;
        _totalSupply = initialSupply;
        _balances[msg.sender] = initialSupply;
    }

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    /**
     * @notice Sets total supply for testing different reserve ratios
     * @param newSupply The new total supply (6 decimals)
     */
    function setTotalSupply(uint256 newSupply) external {
        require(msg.sender == owner, "Only owner");
        _totalSupply = newSupply;
        emit SupplySet(newSupply);
    }

    /**
     * @notice Mint tokens to an address (for testing)
     */
    function mint(address to, uint256 amount) external {
        require(msg.sender == owner, "Only owner");
        _totalSupply += amount;
        _balances[to] += amount;
        emit Transfer(address(0), to, amount);
    }
}
