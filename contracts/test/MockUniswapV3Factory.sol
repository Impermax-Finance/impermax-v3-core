pragma solidity =0.5.16;

contract MockUniswapV3Factory {

	mapping(address => mapping(address => mapping(uint24 => address))) public	getPool;
	
	constructor () public {}
	
	function addPool(address token0, address token1, uint24 fee, address pool) public {
		getPool[token0][token1][fee] = pool;
		getPool[token1][token0][fee] = pool;
	}
	
}