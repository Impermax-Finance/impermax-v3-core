pragma solidity =0.5.16;

import "../../contracts/extensions/interfaces/AggregatorInterface.sol";

contract MockAggregator is AggregatorInterface {
	uint8 public decimals = 8;
	int256 public latestAnswer;
	uint256 public latestTimestamp;
	uint256 public latestRound;
	
	constructor () public {}
	
	function setDecimals(uint8 _decimals) external {
		decimals = _decimals;
	}
	function setLatestAnswer(int256 _latestAnswer) external {
		latestAnswer = _latestAnswer;
	}
	function setLatestTimestamp(uint256 _latestTimestamp) external {
		latestTimestamp = _latestTimestamp;
	}
	function setLatestRound(uint256 _latestRound) external {
		latestRound = _latestRound;
	}
}
