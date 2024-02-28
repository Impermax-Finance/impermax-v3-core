pragma solidity =0.5.16;
pragma experimental ABIEncoderV2;

import "./SafeMath.sol";

library CollateralMath {
	using SafeMath for uint;

    uint constant Q96 = 2**96;

	struct PositionObject {
		uint liquidity;
		uint paSqrtX96;
		uint pbSqrtX96;
		uint debtX;
		uint debtY;
		uint liquidationPenalty;
		uint safetyMarginSqrt;
	}
	
	function newPosition(
		uint liquidity,
		uint paSqrtX96,
		uint pbSqrtX96,
		uint debtX,
		uint debtY,
		uint liquidationPenalty,
		uint safetyMarginSqrt
	) internal pure returns (PositionObject memory) {
		require(paSqrtX96 < pbSqrtX96, "CollateralMath: PA > PB");
		return PositionObject({
			liquidity: liquidity,
			paSqrtX96: paSqrtX96,
			pbSqrtX96: pbSqrtX96,
			debtX: debtX,
			debtY: debtY,
			liquidationPenalty: liquidationPenalty,
			safetyMarginSqrt: safetyMarginSqrt
		});
	}
	
    function safeInt256(uint256 n) internal pure returns (int256) {
        require(n < 2**255, "Impermax: SAFE112");
        return int256(n);
    }

	// liquidity / price
	function getVirtualX(PositionObject memory positionObject, uint priceSqrtX96) private pure returns (uint) {
		return positionObject.liquidity.mul(Q96).div(priceSqrtX96);
	}
	// liquidity * price
	function getVirtualY(PositionObject memory positionObject, uint priceSqrtX96) private pure returns (uint) {
		return positionObject.liquidity.mul(priceSqrtX96).div(Q96);
	}
	
	// if price in range: virtualX(price) - virtualX(pb)
	// if price < pa: virtualX(pa) - virtualX(pb)
	// if price > pb: 0
	function getRealX(PositionObject memory positionObject, uint priceSqrtX96) private pure returns (uint) {
		if (priceSqrtX96 < positionObject.paSqrtX96) priceSqrtX96 = positionObject.paSqrtX96;
		uint surplusX = getVirtualX(positionObject, positionObject.pbSqrtX96);
		uint virtualX = getVirtualX(positionObject, priceSqrtX96);
		return virtualX > surplusX ? virtualX - surplusX : 0;
	}
	// if price in range: virtualY(price) - virtualY(pa)
	// if price > pb: virtualY(pb) - virtualX(pa)
	// if price < pa: 0
	function getRealY(PositionObject memory positionObject, uint priceSqrtX96) private pure returns (uint) {
		if (priceSqrtX96 > positionObject.pbSqrtX96) priceSqrtX96 = positionObject.pbSqrtX96;
		uint surplusY = getVirtualY(positionObject, positionObject.paSqrtX96);
		uint virtualY = getVirtualY(positionObject, priceSqrtX96);
		return virtualY > surplusY ? virtualY - surplusY : 0;
	}
	
	// price / 2
	function getPriceXSqrtX96(uint priceSqrtX96) internal pure returns (uint) {
		return priceSqrtX96 / 2;
	}
	// 1 / price / 2
	function getPriceYSqrtX96(uint priceSqrtX96) internal pure returns (uint) {
		return uint(uint192(-1)).div(priceSqrtX96) / 2;
	}
	
	// amountX * priceX + amountY * priceY
	function getValue(uint priceSqrtX96, uint amountX, uint amountY) internal pure returns (uint) {
		uint priceXSqrtX96 = getPriceXSqrtX96(priceSqrtX96);
		uint priceYSqrtX96 = getPriceYSqrtX96(priceSqrtX96);
		return amountX.mul(priceXSqrtX96).div(Q96).add(amountY.mul(priceYSqrtX96).div(Q96));
	}
	
	// realX * priceX + realY * priceY
	function getCollateralValue(PositionObject memory positionObject, uint priceSqrtX96) internal pure returns (uint) {
		uint realX = getRealX(positionObject, priceSqrtX96);
		uint realY = getRealY(positionObject, priceSqrtX96);
		return getValue(priceSqrtX96, realX, realY);
	}

	// debtX * priceX + realY * debtY	
	function getDebtValue(PositionObject memory positionObject, uint priceSqrtX96) internal pure returns (uint) {
		return getValue(priceSqrtX96, positionObject.debtX, positionObject.debtY);
	}
	
	// collateralValue - debtValue * liquidationPenalty
	function getLiquidityPostLiquidation(PositionObject memory positionObject, uint priceSqrtX96) internal pure returns (int) {
		uint collateralNeeded = getDebtValue(positionObject, priceSqrtX96).mul(positionObject.liquidationPenalty).div(1e18);
		uint collateralValue = getCollateralValue(positionObject, priceSqrtX96);
		return safeInt256(collateralValue) - safeInt256(collateralNeeded);
	}
	
	// min(getLiquidityPostLiquidation(price / safetyMargin), getLiquidityPostLiquidation(price * safetyMargin))
	function getAvailableLiquidity(PositionObject memory positionObject, uint priceSqrtX96) internal pure returns (int) {
		int a = getLiquidityPostLiquidation(positionObject, priceSqrtX96.mul(1e18).div(positionObject.safetyMarginSqrt));
		int b = getLiquidityPostLiquidation(positionObject, priceSqrtX96.mul(positionObject.safetyMarginSqrt).div(1e18));
		return a < b ? a : b;
	}
}