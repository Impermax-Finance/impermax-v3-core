pragma solidity >=0.5.0;
pragma experimental ABIEncoderV2;

interface IUniswapV3Oracle {
	function oraclePriceSqrtX96(address[] calldata poolsList) external returns (uint256);
}
