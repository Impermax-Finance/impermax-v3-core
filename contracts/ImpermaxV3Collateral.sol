pragma solidity =0.5.16;

import "./CSetter.sol";
import "./interfaces/IBorrowable.sol";
import "./interfaces/ICollateral.sol";
import "./interfaces/IFactory.sol";
import "./interfaces/ITokenizedCLPosition.sol";
import "./libraries/CollateralMath.sol";

contract ImpermaxV3Collateral is ICollateral, CSetter {	
	using CollateralMath for CollateralMath.PositionObject;

	constructor() public {}
	
	/*** Collateralization Model ***/
	
	function _getPriceSqrtX96() internal returns (uint) {
		return ITokenizedCLPosition(underlying).oraclePriceSqrtX96();
	}
	
	function _getPositionObjectAmounts(uint tokenId, uint debtX, uint debtY) internal view returns (CollateralMath.PositionObject memory positionObject) {
		if (debtX == uint(-1)) debtX = IBorrowable(borrowable0).borrowBalance(tokenId);
		if (debtY == uint(-1)) debtY = IBorrowable(borrowable1).borrowBalance(tokenId);
		(uint128 liquidity, uint160 paSqrtX96, uint160 pbSqrtX96) = 
			ITokenizedCLPosition(underlying).position(tokenId);
		positionObject = CollateralMath.newPosition(liquidity, paSqrtX96, pbSqrtX96, debtX, debtY, liquidationPenalty(), safetyMarginSqrt);
	}
	
	function _getPositionObject(uint tokenId) internal view returns (CollateralMath.PositionObject memory positionObject) {
		return _getPositionObjectAmounts(tokenId, uint(-1), uint(-1));
	}
	
	/*** ERC721 Wrapper ***/
	
	function mint(address to, uint256 tokenId) external nonReentrant {
		require(ownerOf[tokenId] == address(0), "ImpermaxV3Collateral: NFT_ALREADY_MINTED");
		require(ITokenizedCLPosition(underlying).ownerOf(tokenId) == address(this), "ImpermaxV3Collateral: NFT_NOT_RECEIVED");
		_mint(to, tokenId);
		emit Mint(to, tokenId);
	}

	function redeem(address to, uint256 tokenId, uint256 percentage, bytes memory data) public nonReentrant returns (uint256 newTokenId) {
		require(percentage <= 1e18, "ImpermaxV3Collateral: PERCENTAGE_ABOVE_100");
		_checkAuthorized(ownerOf[tokenId], msg.sender, tokenId);
		
		// optimistically redeem
		if (percentage == 1e18) {
			_burn(tokenId);
			ITokenizedCLPosition(tokenizedCLPosition).safeTransferFrom(address(this), to, tokenId, data);
		} else {
			newTokenId = ITokenizedCLPosition(tokenizedCLPosition).split(tokenId, percentage);
			ITokenizedCLPosition(tokenizedCLPosition).safeTransferFrom(address(this), to, newTokenId, data);
		}
		
		// finally check that the position is not left underwater
		require(!isLiquidatable(tokenId));
		
		emit Redeem(to, tokenId, percentage, newTokenId);
	}
	function redeem(address to, uint256 tokenId, uint256 percentage) external returns (uint256 newTokenId) {
		return redeem(to, tokenId, percentage, "");
	}

	
	/*** Collateral ***/
	
	function isLiquidatable(uint tokenId) public returns (bool) {
		uint priceSqrtX96 = _getPriceSqrtX96();
		CollateralMath.PositionObject memory positionObject = _getPositionObject(tokenId);
		return positionObject.isLiquidatable(priceSqrtX96);
	}
	
	function isUnderwater(uint tokenId) public returns (bool) {
		uint priceSqrtX96 = _getPriceSqrtX96();
		CollateralMath.PositionObject memory positionObject = _getPositionObject(tokenId);
		return positionObject.isUnderwater(priceSqrtX96);
	}
	
	function canBorrow(uint tokenId, address borrowable, uint accountBorrows) public returns (bool) {
		address _borrowable0 = borrowable0;
		address _borrowable1 = borrowable1;
		require(borrowable == _borrowable0 || borrowable == _borrowable1, "ImpermaxV3Collateral: INVALID_BORROWABLE");
		
		uint priceSqrtX96 = _getPriceSqrtX96();
		uint debtX = borrowable == _borrowable0 ? accountBorrows : uint(-1);
		uint debtY = borrowable == _borrowable1 ? accountBorrows : uint(-1);
		
		CollateralMath.PositionObject memory positionObject = _getPositionObjectAmounts(tokenId, debtX, debtY);
		return !positionObject.isLiquidatable(priceSqrtX96);
	}
	
	function restructureBadDebt(uint tokenId) external nonReentrant {
		uint priceSqrtX96 = _getPriceSqrtX96();
		CollateralMath.PositionObject memory positionObject = _getPositionObject(tokenId);
		uint postLiquidationCollateralRatio = positionObject.getPostLiquidationCollateralRatio(priceSqrtX96);
		require(postLiquidationCollateralRatio < 1e18, "ImpermaxV3Collateral: NOT_UNDERWATER");
		IBorrowable(borrowable0).restructureDebt(tokenId, postLiquidationCollateralRatio);
		IBorrowable(borrowable1).restructureDebt(tokenId, postLiquidationCollateralRatio);
		positionObject = _getPositionObject(tokenId);
		require(!positionObject.isUnderwater(priceSqrtX96), "this should never happen");
		
		// TODO emit events
	}
	
	// this function must be called from borrowable0 or borrowable1
	function seize(uint tokenId, uint repayAmount, address liquidator, bytes calldata data) external nonReentrant returns (uint seizeTokenId) {
		require(msg.sender == borrowable0 || msg.sender == borrowable1, "ImpermaxV3Collateral: UNAUTHORIZED");
		
		uint repayToCollateralRatio;
		{
			uint priceSqrtX96 = _getPriceSqrtX96();
			CollateralMath.PositionObject memory positionObject = _getPositionObject(tokenId);
			
			require(positionObject.isLiquidatable(priceSqrtX96), "ImpermaxV3Collateral: INSUFFICIENT_SHORTFALL");
			require(!positionObject.isUnderwater(priceSqrtX96), "ImpermaxV3Collateral: CANNOT_LIQUIDATE_UNDERWATER_POSITION");
			
			uint collateralValue = positionObject.getCollateralValue(priceSqrtX96);
			uint repayValue = msg.sender == borrowable0
				? CollateralMath.getValue(priceSqrtX96, repayAmount, 0)
				: CollateralMath.getValue(priceSqrtX96, 0, repayAmount);
				
			repayToCollateralRatio = repayValue.mul(1e18).div(collateralValue);
			require(repayToCollateralRatio.mul(liquidationPenalty()) <= 1e36, "ImpermaxV3Collateral: LIQUIDATING_TOO_MUCH");
		}
		
		uint seizePercentage = repayToCollateralRatio.mul(liquidationIncentive).div(1e18);
		uint feePercentage = liquidationFee.mul(1e18).div(uint(1e18).sub(seizePercentage));	
		
		seizeTokenId = ITokenizedCLPosition(tokenizedCLPosition).split(tokenId, seizePercentage);
		ITokenizedCLPosition(tokenizedCLPosition).safeTransferFrom(address(this), liquidator, seizeTokenId, data);
		emit Seize(liquidator, tokenId, seizePercentage, seizeTokenId);
		
		if (feePercentage > 0) {
			uint feeTokenId = ITokenizedCLPosition(underlying).split(tokenId, feePercentage);		
			address reservesManager = IFactory(factory).reservesManager();
			_mint(reservesManager, feeTokenId);
			emit Seize(reservesManager, tokenId, feePercentage, feeTokenId);
		}
	}
}