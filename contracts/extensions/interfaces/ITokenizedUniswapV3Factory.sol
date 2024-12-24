pragma solidity >=0.5.0;
pragma experimental ABIEncoderV2;

interface ITokenizedUniswapV3Factory {
	event NFTLPCreated(address indexed token0, address indexed token1, address NFTLP, uint);
	
	function uniswapV3Factory() external view returns (address);
	function getNFTLP(address tokenA, address tokenB) external view returns (address);
	function allNFTLP(uint) external view returns (address);
	function allNFTLPLength() external view returns (uint);
	
	function createNFTLP(address tokenA, address tokenB) external returns (address NFTLP);
}
