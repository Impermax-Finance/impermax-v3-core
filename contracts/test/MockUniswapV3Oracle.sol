pragma solidity =0.5.16;

import "../../contracts/extensions/interfaces/IUniswapV3Oracle.sol";

contract MockUniswapV3Oracle is IUniswapV3Oracle {
	
	constructor() public {}
	
	mapping(address => mapping(address => uint256)) public oraclePriceSqrtX96;
	
	function setPrice(address tokenA, address tokenB, uint256 price) external {
		(address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
		oraclePriceSqrtX96[token0][token1] = price;
	}
}