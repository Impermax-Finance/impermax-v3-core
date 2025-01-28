pragma solidity =0.5.16;
pragma experimental ABIEncoderV2;

import "../../libraries/SafeMath.sol";
import "../../libraries/Math.sol";

library UniswapV3CollateralMath {
	using SafeMath for uint;

	// around 2**32
	uint constant MIN_SQRT_RATIO = 4295128739;
    
	// around 2**160
	uint constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;
    
	uint constant Q96 = 2**96;

	struct PositionObject {
		uint liquidity;
		uint paSqrtX96;
		uint pbSqrtX96;
	}
	
	function newPosition(
		uint liquidity,
		uint paSqrtX96,
		uint pbSqrtX96
	) internal pure returns (PositionObject memory) {
		require(paSqrtX96 < pbSqrtX96, "UniswapV3CollateralMath: PA > PB");
		require(paSqrtX96 >= MIN_SQRT_RATIO, "UniswapV3CollateralMath: PA outside of range");
		require(pbSqrtX96 < MAX_SQRT_RATIO, "UniswapV3CollateralMath: PB outside of range");
		return PositionObject({
			liquidity: liquidity,
			paSqrtX96: paSqrtX96,
			pbSqrtX96: pbSqrtX96
		});
	}

	// liquidity / sqrt(price)
	function getVirtualX(PositionObject memory positionObject, uint priceSqrtX96) internal pure returns (uint) {
		return positionObject.liquidity.mul(Q96).div(priceSqrtX96);
	}
	// liquidity * sqrt(price)
	function getVirtualY(PositionObject memory positionObject, uint priceSqrtX96) internal pure returns (uint) {
		return positionObject.liquidity.mul(priceSqrtX96).div(Q96);
	}
	
	// if price in range: virtualX(price) - virtualX(pb)
	// if price < pa: virtualX(pa) - virtualX(pb)
	// if price > pb: 0
	function getRealX(PositionObject memory positionObject, uint priceSqrtX96) internal pure returns (uint) {
		uint surplusX = getVirtualX(positionObject, positionObject.pbSqrtX96);
		uint virtualX = getVirtualX(positionObject, Math.max(priceSqrtX96, positionObject.paSqrtX96));
		return virtualX > surplusX ? virtualX - surplusX : 0;
	}
	// if price in range: virtualY(price) - virtualY(pa)
	// if price > pb: virtualY(pb) - virtualX(pa)
	// if price < pa: 0
	function getRealY(PositionObject memory positionObject, uint priceSqrtX96) internal pure returns (uint) {
		uint surplusY = getVirtualY(positionObject, positionObject.paSqrtX96);
		uint virtualY = getVirtualY(positionObject, Math.min(priceSqrtX96, positionObject.pbSqrtX96));
		return virtualY > surplusY ? virtualY - surplusY : 0;
	}
}