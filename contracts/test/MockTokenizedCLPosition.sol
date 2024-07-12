pragma solidity =0.5.16;
pragma experimental ABIEncoderV2;

import "../../contracts/ImpermaxERC721.sol";
import "../../contracts/interfaces/INFTLP.sol";

contract MockTokenizedCLPosition is INFTLP, ImpermaxERC721 {
	uint256 positionLength = 0;

	address public token0;
	address public token1;
	uint256 public oraclePriceSqrtX96;
		
	mapping(uint256 => INFTLP.RealXYs) public position;	

	constructor(address _token0, address _token1) public ImpermaxERC721() {
		_setName("", "");
		token0 = _token0;
		token1 = _token1;
	}

	function getPositionData(uint256 _tokenId, uint256 _safetyMarginSqrt) external returns (
		uint256 priceSqrtX96,
		RealXYs memory realXYs
	) {
		_safetyMarginSqrt;
		priceSqrtX96 = oraclePriceSqrtX96;
		realXYs = position[_tokenId];
	}
	
	function split(uint256 tokenId, uint256 percentage) external returns (uint256 newTokenId) {
		require(percentage <= 1e18, "ImpermaxV3Borrowable: ABOVE_100_PERCENT");
		address owner = ownerOf[tokenId];
		_checkAuthorized(owner, msg.sender, tokenId);
		newTokenId = positionLength++;
		_mint(owner, newTokenId);
		
		INFTLP.RealXYs storage oldPosition = position[tokenId];
		INFTLP.RealXYs storage newPosition = position[newTokenId];
		
		newPosition.lowestPrice.realX = oldPosition.lowestPrice.realX.mul(percentage).div(1e18);
		newPosition.lowestPrice.realY = oldPosition.lowestPrice.realY.mul(percentage).div(1e18);
		newPosition.currentPrice.realX = oldPosition.currentPrice.realX.mul(percentage).div(1e18);
		newPosition.currentPrice.realY = oldPosition.currentPrice.realY.mul(percentage).div(1e18);
		newPosition.highestPrice.realX = oldPosition.highestPrice.realX.mul(percentage).div(1e18);
		newPosition.highestPrice.realY = oldPosition.highestPrice.realY.mul(percentage).div(1e18);
		oldPosition.lowestPrice.realX -= newPosition.lowestPrice.realX;
		oldPosition.lowestPrice.realY -= newPosition.lowestPrice.realY;
		oldPosition.currentPrice.realX -= newPosition.currentPrice.realX;
		oldPosition.currentPrice.realY -= newPosition.currentPrice.realY;
		oldPosition.highestPrice.realX -= newPosition.highestPrice.realX;
		oldPosition.highestPrice.realY -= newPosition.highestPrice.realY;
	}

	function join(uint256 tokenIdFrom, uint256 tokenIdTo) external {
		tokenIdFrom; tokenIdTo;
	}
	
	function setPriceSqrtX96Harness(uint256 price) external {
		oraclePriceSqrtX96 = price;
	}
	
	function mintHarness(
		address to, 
		uint256 lowestPriceRealX,
		uint256 lowestPriceRealY,
		uint256 currentPriceRealX,
		uint256 currentPriceRealY,
		uint256 highestPriceRealX,
		uint256 highestPriceRealY
	) external {
		super._mint(to, positionLength);
		INFTLP.RealXYs storage newPosition = position[positionLength++];
		newPosition.lowestPrice.realX = lowestPriceRealX;
		newPosition.lowestPrice.realY = lowestPriceRealY;
		newPosition.currentPrice.realX = currentPriceRealX;
		newPosition.currentPrice.realY = currentPriceRealY;
		newPosition.highestPrice.realX = highestPriceRealX;
		newPosition.highestPrice.realY = highestPriceRealY;
	}
	
	function setOwnerHarness(address to, uint tokenId) external {
		address prevOwner = ownerOf[tokenId];
		if (prevOwner != address(0)) balanceOf[prevOwner]--;
		ownerOf[tokenId] = to;
		balanceOf[to]++;
	}
	
	function setPositionHarness(
		uint tokenId, 
		uint256 lowestPriceRealX,
		uint256 lowestPriceRealY,
		uint256 currentPriceRealX,
		uint256 currentPriceRealY,
		uint256 highestPriceRealX,
		uint256 highestPriceRealY
	) external {
		INFTLP.RealXYs storage _position = position[tokenId];
		_position.lowestPrice.realX = lowestPriceRealX;
		_position.lowestPrice.realY = lowestPriceRealY;
		_position.currentPrice.realX = currentPriceRealX;
		_position.currentPrice.realY = currentPriceRealY;
		_position.highestPrice.realX = highestPriceRealX;
		_position.highestPrice.realY = highestPriceRealY;
	}
}