pragma solidity =0.5.16;

import "../../contracts/ImpermaxERC721.sol";

contract MockTokenizedCLPosition is ImpermaxERC721 {
	uint256 positionLength = 0;

	address public token0;
	address public token1;
	uint160 public oraclePriceSqrtX96;
		
	struct Position {
		uint128 liquidity;
		uint160 paSqrtX96;
		uint160 pbSqrtX96;
	}
	mapping(uint256 => Position) public position;	

	constructor(address _token0, address _token1) public ImpermaxERC721() {
		_setName("", "");
		token0 = _token0;
		token1 = _token1;
	}
	
	function split(uint256 tokenId, uint256 percentage) external returns (uint256 newTokenId) {
		require(percentage <= 1e18, "ImpermaxV3Borrowable: ABOVE_100_PERCENT");
		address owner = ownerOf[tokenId];
		_checkAuthorized(owner, msg.sender, tokenId);
		Position memory oldPosition = position[tokenId];
		uint128 newTokenLiquidity = uint128(uint256(oldPosition.liquidity).mul(percentage).div(1e18));
		position[tokenId].liquidity = oldPosition.liquidity - newTokenLiquidity;
		newTokenId = positionLength++;
		_mint(owner, newTokenId);
		position[newTokenId].liquidity = uint128(newTokenLiquidity);
		position[newTokenId].paSqrtX96 = oldPosition.paSqrtX96;
		position[newTokenId].pbSqrtX96 = oldPosition.pbSqrtX96;
		balanceOf[owner]++;		
	}
	
	function oraclePriceSqrtX96Harness(uint160 price) external {
		oraclePriceSqrtX96 = price;
	}
	
	function mintHarness(
		address to, 
		uint128 liquidity,
		uint160 paSqrtX96,
		uint160 pbSqrtX96
	) external {
		super._mint(to, positionLength);
		position[positionLength].liquidity = liquidity;
		position[positionLength].paSqrtX96 = paSqrtX96;
		position[positionLength].pbSqrtX96 = pbSqrtX96;
		positionLength++;
		balanceOf[to]++;
	}
	
	function setOwnerHarness(address to, uint tokenId) external {
		address prevOwner = ownerOf[tokenId];
		if (prevOwner != address(0)) balanceOf[prevOwner]--;
		ownerOf[tokenId] = to;
		balanceOf[to]++;
	}
	
	function setPositionHarness(
		uint tokenId, 
		uint128 liquidity,
		uint160 paSqrtX96,
		uint160 pbSqrtX96
	) external {
		position[tokenId].liquidity = liquidity;
		position[tokenId].paSqrtX96 = paSqrtX96;
		position[tokenId].pbSqrtX96 = pbSqrtX96;
	}
}