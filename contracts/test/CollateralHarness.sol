pragma solidity =0.5.16;
pragma experimental ABIEncoderV2;

import "../../contracts/ImpermaxV3Collateral.sol";

contract CollateralHarness is ImpermaxV3Collateral {
	using CollateralMath for CollateralMath.PositionObject;

	function setUnderlyingHarness(address _underlying) external {
		underlying = _underlying;
	}
	
	function setFactoryHarness(address _factory) external {
		factory = _factory;
	}
	
	function setBorrowable0Harness(address _borrowable0) external {
		borrowable0 = _borrowable0;
	}
	
	function setBorrowable1Harness(address _borrowable1) external {
		borrowable1 = _borrowable1;
	}
	
	function setOwnerHarness(address to, uint tokenId) external {
		address prevOwner = ownerOf[tokenId];
		if (prevOwner != address(0)) balanceOf[prevOwner]--;
		ownerOf[tokenId] = to;
		balanceOf[to]++;
	}
	
	/*function setBalanceHarness(address account, uint balance) external {
		balanceOf[account] = balance;
	}
	
	function setTotalSupply(uint _totalSupply) external {
		totalSupply = _totalSupply;
	}*/
	
	bool public useMockPrice;
	uint public _priceSqrtX96;
	
	function _getPriceSqrtX96() internal returns (uint) {
		if (useMockPrice) return (_priceSqrtX96);
		return super._getPriceSqrtX96();
	}
	
	function setPriceSqrtX96Harness(uint priceSqrtX96) external {
		useMockPrice = true;
		_priceSqrtX96 = priceSqrtX96;
	}
	
	function canBorrowTest(uint tokenId, address borrowable, uint accountBorrows) public returns (int liquidity1, int liquidity2) {
		address _borrowable0 = borrowable0;
		address _borrowable1 = borrowable1;
		require(borrowable == _borrowable0 || borrowable == _borrowable1, "ImpermaxV3Collateral: INVALID_BORROWABLE");
		
		uint priceSqrtX96 = _getPriceSqrtX96();
		uint debtX = borrowable == _borrowable0 ? accountBorrows : uint(-1);
		uint debtY = borrowable == _borrowable1 ? accountBorrows : uint(-1);
		
		CollateralMath.PositionObject memory positionObject = _getPositionObjectAmounts(tokenId, debtX, debtY);
		liquidity1 = positionObject.getLiquidityPostLiquidation(priceSqrtX96.mul(1e18).div(positionObject.safetyMarginSqrt));
		liquidity2 = positionObject.getLiquidityPostLiquidation(priceSqrtX96.mul(positionObject.safetyMarginSqrt).div(1e18));
	}
	
	bool public useMockPosition;
	mapping(uint => uint128) public _liquidity;
	mapping(uint => uint160) public _paSqrtX96;
	mapping(uint => uint160) public _pbSqrtX96;
	
	function setPositionHarness(uint tokenId, uint128 liquidity, uint160 paSqrtX96, uint160 pbSqrtX96) external {
		useMockPosition = true;
		_liquidity[tokenId] = liquidity;
		_paSqrtX96[tokenId] = paSqrtX96;
		_pbSqrtX96[tokenId] = pbSqrtX96;
	}
	
	
	function getPositionObject(uint tokenId) public view returns (CollateralMath.PositionObject memory positionObject) {
		return _getPositionObjectAmounts(tokenId, uint(-1), uint(-1));
	}
	
	function getVirtualX(uint tokenId) external returns (uint) {
		CollateralMath.PositionObject memory positionObject = getPositionObject(tokenId);
		uint priceSqrtX96 = _getPriceSqrtX96();
		return positionObject.getVirtualX(priceSqrtX96);
	}
	
	function getVirtualY(uint tokenId) external returns (uint) {
		CollateralMath.PositionObject memory positionObject = getPositionObject(tokenId);
		uint priceSqrtX96 = _getPriceSqrtX96();
		return positionObject.getVirtualY(priceSqrtX96);
	}
	
	function getRealX(uint tokenId) external returns (uint) {
		CollateralMath.PositionObject memory positionObject = getPositionObject(tokenId);
		uint priceSqrtX96 = _getPriceSqrtX96();
		return positionObject.getRealX(priceSqrtX96);
	}
	
	function getRealY(uint tokenId) external returns (uint) {
		CollateralMath.PositionObject memory positionObject = getPositionObject(tokenId);
		uint priceSqrtX96 = _getPriceSqrtX96();
		return positionObject.getRealY(priceSqrtX96);
	}
	
	function getCollateralValue(uint tokenId) external returns (uint) {
		CollateralMath.PositionObject memory positionObject = getPositionObject(tokenId);
		uint priceSqrtX96 = _getPriceSqrtX96();
		return positionObject.getCollateralValue(priceSqrtX96);
	}
	
	function getCollateralValueWithPrice(uint tokenId, uint _priceSqrtX96) external returns (uint) {
		CollateralMath.PositionObject memory positionObject = getPositionObject(tokenId);
		return positionObject.getCollateralValue(_priceSqrtX96);
	}
	
	function getDebtValue(uint tokenId) external returns (uint) {
		CollateralMath.PositionObject memory positionObject = getPositionObject(tokenId);
		uint priceSqrtX96 = _getPriceSqrtX96();
		return positionObject.getDebtValue(priceSqrtX96);
	}
	
	function getLiquidityPostLiquidation(uint tokenId) external returns (int) {
		CollateralMath.PositionObject memory positionObject = getPositionObject(tokenId);
		uint priceSqrtX96 = _getPriceSqrtX96();
		return positionObject.getLiquidityPostLiquidation(priceSqrtX96);
	}
	
	function getPostLiquidationCollateralRatio(uint tokenId) external returns (uint) {
		CollateralMath.PositionObject memory positionObject = getPositionObject(tokenId);
		uint priceSqrtX96 = _getPriceSqrtX96();
		return positionObject.getPostLiquidationCollateralRatio(priceSqrtX96);
	}
	
	bool public useMockCanBorrow;
	mapping(uint => mapping(address => uint)) public maxBorrowable;
	
	function canBorrow(uint tokenId, address borrowable, uint accountBorrows) public returns (bool) {
		if (useMockCanBorrow){
			return maxBorrowable[tokenId][borrowable] >= accountBorrows;
		}
		return super.canBorrow(tokenId, borrowable, accountBorrows);
	}
	
	function setMaxBorrowable(uint tokenId, address borrowable, uint maxAmount) external {
		useMockCanBorrow = true;
		maxBorrowable[tokenId][borrowable] = maxAmount;
	}
	
	// this function must be called from borrowable0 or borrowable1
	function testReentrancy(address receiver, uint tokenId, bytes calldata data) external nonReentrant {
		ITokenizedCLPosition(underlying).safeTransferFrom(address(this), receiver, tokenId, data);
	}
}