pragma solidity =0.5.16;
pragma experimental ABIEncoderV2;

import "./interfaces/IUniswapV3Oracle.sol";
import "./libraries/UniswapV3WeightedOracleLibrary.sol";
import "./libraries/TickMath.sol";

contract UniswapV3OracleTwap is IUniswapV3Oracle {
	using TickMath for int24;
	using UniswapV3WeightedOracleLibrary for UniswapV3WeightedOracleLibrary.PeriodObservation[];

	uint32 constant ORACLE_T = 1800;
	
	function oraclePriceSqrtX96(address[] calldata poolsList) external returns (uint256) {
		UniswapV3WeightedOracleLibrary.PeriodObservation[] memory observations = new UniswapV3WeightedOracleLibrary.PeriodObservation[](poolsList.length);
		for (uint i = 0; i < poolsList.length; i++) {
			observations[i] = UniswapV3WeightedOracleLibrary.consult(poolsList[i], ORACLE_T);
		}
		int24 arithmeticMeanWeightedTick = observations.getArithmeticMeanTickWeightedByLiquidity();
		return arithmeticMeanWeightedTick.getSqrtRatioAtTick();
	}
}