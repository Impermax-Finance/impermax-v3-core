pragma solidity >=0.5.0;

// TODO make sure we keep back-compatibility with Uniswap V2

interface ITokenizedCLPosition {
	// ERC-721
	function ownerOf(uint256 _tokenId) external view returns (address);
	function safeTransferFrom(address from, address to, uint256 tokenId, bytes calldata data) external;
	function safeTransferFrom(address from, address to, uint256 tokenId) external;
	function transferFrom(address from, address to, uint256 tokenId) external;
	
	// Global state
	function token0() external view returns (address);
	function token1() external view returns (address);
	//function marketPriceSqrtX96() external view returns (uint160);
	function oraclePriceSqrtX96() external returns (uint160);
	
	// Position state
	function position(uint256 _tokenId) external view returns (
		uint128 liquidity,
		uint160 paSqrtX96,
		uint160 pbSqrtX96
	);
	
	//function mint(address to, uint160 paSqrtX96, uint160 pbSqrtX96) external;
	//function redeem(address to, uint256 tokenId) external;
	//function join(uint256 tokenIdFrom, uint256 tokenIdTo) external; // or increase
	function split(uint256 tokenId, uint256 percentage) external returns (uint256 newTokenId);
}
