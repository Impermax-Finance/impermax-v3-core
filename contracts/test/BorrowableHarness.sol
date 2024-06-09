pragma solidity =0.5.16;

import "../../contracts/ImpermaxV3Borrowable.sol";
import "../../contracts/interfaces/ICollateral.sol";

contract BorrowableHarness is ImpermaxV3Borrowable {
	
	function setUnderlyingHarness(address _underlying) external {
		underlying = _underlying;
	}
	
	function setFactoryHarness(address _factory) external {
		factory = _factory;
	}
	
	function setCollateralHarness(address _collateral) external {
		collateral = _collateral;
	}
	
	bool useMockBorrowBalance;
	mapping(uint => uint) public _borrowBalance;
	
	function borrowBalance(uint tokenId) public view returns (uint) {
		if (useMockBorrowBalance) return _borrowBalance[tokenId];
		return super.borrowBalance(tokenId);
	}
	
	function setBorrowBalanceHarness(uint tokenId, uint amount) external {
		useMockBorrowBalance = true;
		_borrowBalance[tokenId] = amount;
	}
	
	function restructureDebt(uint tokenId, uint reduceToRatio) public {
		if (useMockBorrowBalance) {	
			_borrowBalance[tokenId] = _borrowBalance[tokenId].mul(reduceToRatio).div(1e18);
			return;
		}
		return super.restructureDebt(tokenId, reduceToRatio);
	}
	
	function setBorrowBalances(uint tokenId, uint112 principal, uint112 interestIndex) external {
		borrowBalances[tokenId].principal = principal;
		borrowBalances[tokenId].interestIndex = interestIndex;
	}
	
	function setBorrowIndex(uint112 _borrowIndex) external {
		borrowIndex = _borrowIndex;
	}
	
	/*function seizeHarness(address collateral, address liquidator, address borrower, uint repayAmount) external returns (uint) {
		return ICollateral(collateral).seize(liquidator, borrower, repayAmount);
	}*/
	
	function setTotalBalance(uint _totalBalance) public {
		totalBalance = _totalBalance;
	}
	
	function setTotalBorrows(uint112 _totalBorrows) public {
		totalBorrows = _totalBorrows;
	}
	
	function setTotalSupply(uint _totalSupply) public {
		totalSupply = _totalSupply;
	}
	
	function setBorrowRate(uint48 _borrowRate) public {
		borrowRate = _borrowRate;
	}
	
	function setReserveFactor(uint _reserveFactor) public {
		reserveFactor = _reserveFactor;
	}
	
	uint32 _blockTimestamp;
	function getBlockTimestamp() public view returns (uint32) {
		return _blockTimestamp;
	}
	function setBlockTimestamp(uint blockTimestamp) public {
		_blockTimestamp = uint32(blockTimestamp % 2**32);
	}
	
	function setExchangeRateLast(uint128 _exchangeRateLast) public {
		exchangeRateLast = _exchangeRateLast;
	}
	
	function setBorrowTracker(address _borrowTracker) public {
		borrowTracker = _borrowTracker;
	}
	
	function restructureBadDebtAndSeizeCollateral(uint tokenId, uint repayAmount, address liquidator, bytes calldata data) external returns (uint seizeTokenId) {
		if (ICollateral(collateral).isUnderwater(tokenId)) {
			ICollateral(collateral).restructureBadDebt(tokenId);
		}
		repayAmount = repayAmount < borrowBalance(tokenId) ? repayAmount : borrowBalance(tokenId);
		seizeTokenId = ICollateral(collateral).seize(tokenId, repayAmount, liquidator, data);		
		_borrowBalance[tokenId] -= repayAmount;
	}

}