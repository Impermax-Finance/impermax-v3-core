pragma solidity =0.5.16;

import "../../contracts/interfaces/IBorrowTracker.sol";
import "../../contracts/libraries/SafeMath.sol";

contract MockBorrowTracker is IBorrowTracker {
	using SafeMath for uint;
	
	constructor () public {}
	
	mapping(uint => uint) public relativeBorrow;
	uint public totalRelativeBorrows;

	function trackBorrow(uint tokenId, uint borrowBalance, uint borrowIndex) external {
		uint _relativeBorrowPrior = relativeBorrow[tokenId];
		uint _relativeBorrow = borrowBalance.mul(2**128).div(borrowIndex);
		relativeBorrow[tokenId] = _relativeBorrow;
		if (_relativeBorrow > _relativeBorrowPrior) {
			uint increaseAmount = _relativeBorrow - _relativeBorrowPrior;
			totalRelativeBorrows = totalRelativeBorrows.add(increaseAmount);
		}
		else {
			uint decreaseAmount = _relativeBorrowPrior - _relativeBorrow;
			totalRelativeBorrows = totalRelativeBorrows > decreaseAmount ? totalRelativeBorrows - decreaseAmount : 0;
		}
	}

	function borrowPercentage(uint tokenId) external view returns (uint) {
		if (totalRelativeBorrows == 0) return 0;
		return relativeBorrow[tokenId].mul(1e18).div(totalRelativeBorrows);
	}
}