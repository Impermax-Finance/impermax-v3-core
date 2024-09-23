pragma solidity =0.5.16;
pragma experimental ABIEncoderV2;

import "../../contracts/interfaces/IERC20.sol";
import "../../contracts/libraries/Math.sol";
import "../../contracts/libraries/SafeMath.sol";
import "../../contracts/extensions/libraries/UniswapV3Position.sol";
import "../../contracts/extensions/libraries/TickMath.sol";

contract MockUniswapV3Pair {
	using SafeMath for uint256;
	using TickMath for int24;
	
	uint constant Q96 = 2**96;
	uint constant Q128 = 2**128;

	struct Info {
		// the amount of liquidity owned by this position
		uint128 liquidity;
		// fee growth per unit of liquidity as of the last update to liquidity or fees owed
		uint256 feeGrowthInside0LastX128;
		uint256 feeGrowthInside1LastX128;
		// the fees owed to the position owner in token0/token1
		uint128 tokensOwed0;
		uint128 tokensOwed1;
	}
	
	address public token0;
	address public token1;
	uint public priceSqrtX96;
	
	mapping(bytes32 => Info) public positions;
	
	mapping(int24 => mapping(int24 => uint256)) public nextFeeGrowthInside0LastX128;
	mapping(int24 => mapping(int24 => uint256)) public nextFeeGrowthInside1LastX128;
	
	int56[2] private mockTickCumulatives;
	uint160[2] private mockSecondsPerLiquidityCumulativeX128s;
	
	constructor (address _token0, address _token1) public {
		token0 = _token0;
		token1 = _token1;
	}
	
	function getVirtualX(uint liquidity, uint _priceSqrtX96) internal pure returns (uint) {
		return liquidity.mul(Q96).div(_priceSqrtX96);
	}
	function getVirtualY(uint liquidity, uint _priceSqrtX96) internal pure returns (uint) {
		return liquidity.mul(_priceSqrtX96).div(Q96);
	}
	function getRealX(int24 tickLower, int24 tickUpper, uint liquidity) internal view returns (uint) {
		uint paSqrtX96 = tickLower.getSqrtRatioAtTick();
		uint pbSqrtX96 = tickUpper.getSqrtRatioAtTick();
		uint surplusX = getVirtualX(liquidity, pbSqrtX96);
		uint virtualX = getVirtualX(liquidity, Math.max(priceSqrtX96, paSqrtX96));
		return virtualX > surplusX ? virtualX - surplusX : 0;
	}
	function getRealY(int24 tickLower, int24 tickUpper, uint liquidity) internal view returns (uint) {
		uint paSqrtX96 = tickLower.getSqrtRatioAtTick();
		uint pbSqrtX96 = tickUpper.getSqrtRatioAtTick();
		uint surplusY = getVirtualY(liquidity, paSqrtX96);
		uint virtualY = getVirtualY(liquidity, Math.min(priceSqrtX96, pbSqrtX96));
		return virtualY > surplusY ? virtualY - surplusY : 0;
	}
	
	function updateTokensOwed(address to, int24 tickLower, int24 tickUpper) internal {
		bytes32 hash = UniswapV3Position.getHash(to, tickLower, tickUpper);
		
		uint deltaFG0 = nextFeeGrowthInside0LastX128[tickLower][tickUpper] - positions[hash].feeGrowthInside0LastX128;
		uint deltaFG1 = nextFeeGrowthInside1LastX128[tickLower][tickUpper] - positions[hash].feeGrowthInside1LastX128;
		
		positions[hash].feeGrowthInside0LastX128 = nextFeeGrowthInside0LastX128[tickLower][tickUpper];
		positions[hash].feeGrowthInside1LastX128 = nextFeeGrowthInside1LastX128[tickLower][tickUpper];
		positions[hash].tokensOwed0 += uint128(deltaFG0 * positions[hash].liquidity / Q128);
		positions[hash].tokensOwed1 += uint128(deltaFG1 * positions[hash].liquidity / Q128);
	}
	
	function setMarketPrice(uint _priceSqrtX96) external {
		priceSqrtX96 = _priceSqrtX96;
	}
	
	function setPosition(address to, int24 tickLower, int24 tickUpper, uint128 liquidity) external {
		updateTokensOwed(to, tickLower, tickUpper);
		bytes32 hash = UniswapV3Position.getHash(to, tickLower, tickUpper);
		positions[hash].liquidity = liquidity;
	}
	
	function getPosition(address to, int24 tickLower, int24 tickUpper) external view returns (Info memory) {
		bytes32 hash = UniswapV3Position.getHash(to, tickLower, tickUpper);
		return positions[hash];
	}
	
	// this is applied after burn()
	function setPositionFeeGrowth(int24 tickLower, int24 tickUpper, uint256 fg0, uint256 fg1) external {
		nextFeeGrowthInside0LastX128[tickLower][tickUpper] = fg0;
		nextFeeGrowthInside1LastX128[tickLower][tickUpper] = fg1;
	}
	
	function setTickCumulatives(int56 old, int56 current) external {
		mockTickCumulatives = [old, current];
	}
	
	function setSecondsPerLiquidityCumulativeX128s(uint160 old, uint160 current) external {
		mockSecondsPerLiquidityCumulativeX128s = [old, current];
	}
	
	function burn(
		int24 tickLower,
		int24 tickUpper,
		uint128 amount
	) external returns (uint256 amount0, uint256 amount1) {
		updateTokensOwed(msg.sender, tickLower, tickUpper);
		bytes32 hash = UniswapV3Position.getHash(msg.sender, tickLower, tickUpper);
		
		amount0 = getRealX(tickLower, tickUpper, amount);
		amount1 = getRealY(tickLower, tickUpper, amount);
		
		positions[hash].tokensOwed0 += uint128(amount0);
		positions[hash].tokensOwed1 += uint128(amount1);
		positions[hash].liquidity -= amount;
	}
	
	function collect(
		address recipient,
		int24 tickLower,
		int24 tickUpper,
		uint128 amount0Requested,
		uint128 amount1Requested
	) external returns (uint128 amount0, uint128 amount1) {
		bytes32 hash = UniswapV3Position.getHash(msg.sender, tickLower, tickUpper);	
		Info storage position = positions[hash];

		amount0 = amount0Requested > position.tokensOwed0 ? position.tokensOwed0 : amount0Requested;
		amount1 = amount1Requested > position.tokensOwed1 ? position.tokensOwed1 : amount1Requested;

		if (amount0 > 0) {
			position.tokensOwed0 -= amount0;
			IERC20(token0).transfer(recipient, amount0);
		}
		if (amount1 > 0) {
			position.tokensOwed1 -= amount1;
			IERC20(token1).transfer(recipient, amount1);
		}
	}
	
	function observe(uint32[] calldata secondsAgos)
		external
		view
		returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s)
	{
		require(secondsAgos.length == 2, "MockUniswapV3Pair: SECONDS_AGOS_LENGTH_NOT_2");
		tickCumulatives = new int56[](2);
		secondsPerLiquidityCumulativeX128s = new uint160[](2);
		tickCumulatives[0] = mockTickCumulatives[0];
		tickCumulatives[1] = mockTickCumulatives[1];
		secondsPerLiquidityCumulativeX128s[0] = mockSecondsPerLiquidityCumulativeX128s[0];
		secondsPerLiquidityCumulativeX128s[1] = mockSecondsPerLiquidityCumulativeX128s[1];
	}
	
	function getBlockTimestamp() external view returns (uint32) {
		return uint32(block.timestamp);
	}
	
}