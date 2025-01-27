pragma solidity =0.5.16;

import "../../contracts/extensions/interfaces/IUniswapV3Oracle.sol";

contract MockUniswapV3Oracle is IUniswapV3Oracle {
	
	constructor() public {}
	
	mapping(address => mapping(address => uint256)) public oraclePriceSqrtX96;
	
	function setPrice(address token0, address token1, uint256 price) external {
		oraclePriceSqrtX96[token0][token1] = price;
	}
}