const {
	Borrowable,
	Collateral,
	ImpermaxCallee,
	ReentrantCallee,
	Recipient,
	Liquidator,
	makeFactory,
	makeTokenizedCLPosition,
	makeErc20Token,
} = require('./Utils/Impermax');
const {
	expectAlmostEqualMantissa,
	expectRevert,
	expectEvent,
	bnMantissa,
	BN,
} = require('./Utils/JS');
const {
	address,
	encode,
} = require('./Utils/Ethereum');
const { keccak256, toUtf8Bytes } = require('ethers/utils');

const oneMantissa = (new BN(10)).pow(new BN(18));
const _2_96 = (new BN(2)).pow(new BN(96));
const ZERO = new BN(0);

const K_TRACKER = (new BN(2)).pow(new BN(128));
const INITIAL_EXCHANGE_RATE = oneMantissa;
const TOKEN_ID = new BN(1000);

function slightlyIncrease(bn) {
	return bn.mul( bnMantissa(1.00001) ).div( oneMantissa );
}
function slightlyDecrease(bn) {
	return bn.mul( oneMantissa ).div( bnMantissa(1.00001) );
}

contract('Borrowable', function (accounts) {
	let root = accounts[0];
	let user = accounts[1];
	let admin = accounts[2];		
	let borrower = accounts[3];		
	let receiver = accounts[4];		
	let liquidator = accounts[5];		
	let reservesManager = accounts[6];		
	let reservesAdmin = accounts[6];		
	
	describe('exchangeRate, borrowBalance', () => {
		let borrowable;
		let factory;
		beforeEach(async () => {
			borrowable = await Borrowable.new();			
			factory = await makeFactory({admin});
			await borrowable.setFactoryHarness(factory.address);
			await borrowable.setReserveFactor('0');
		});
			
		it(`exchangeRate`, async () => {
			await borrowable.setTotalSupply(bnMantissa(0));
			await borrowable.setTotalBalance(bnMantissa(500));
			await borrowable.setTotalBorrows(bnMantissa(500));
			expectAlmostEqualMantissa(await borrowable.exchangeRate.call(), INITIAL_EXCHANGE_RATE);
			await borrowable.setTotalSupply(bnMantissa(500));
			await borrowable.setTotalBalance(bnMantissa(0));
			await borrowable.setTotalBorrows(bnMantissa(0));
			expectAlmostEqualMantissa(await borrowable.exchangeRate.call(), INITIAL_EXCHANGE_RATE);
			await borrowable.setTotalSupply(bnMantissa(500));
			await borrowable.setTotalBalance(bnMantissa(500));
			await borrowable.setTotalBorrows(bnMantissa(500));
			expectAlmostEqualMantissa(await borrowable.exchangeRate.call(), bnMantissa(2));
			await borrowable.setTotalSupply(bnMantissa(500));
			await borrowable.setTotalBalance(bnMantissa(0));
			await borrowable.setTotalBorrows(bnMantissa(2000));
			expectAlmostEqualMantissa(await borrowable.exchangeRate.call(), bnMantissa(4));
		});
		
		it(`borrowBalance`, async () => {
			const borrowIndex = await borrowable.borrowIndex();
			expect(await borrowable.borrowBalance(TOKEN_ID) * 1).to.eq(0);
			await borrowable.setBorrowBalances(TOKEN_ID, bnMantissa(100), borrowIndex);
			expectAlmostEqualMantissa(await borrowable.borrowBalance(TOKEN_ID), bnMantissa(100));
			await borrowable.setBorrowIndex(borrowIndex.mul(new BN(12)).div(new BN(10)));
			expectAlmostEqualMantissa(await borrowable.borrowBalance(TOKEN_ID), bnMantissa(120));
		});
	});
	
	describe('borrow and repay', () => {
		let borrowable;
		let underlying;
		let collateral;
		let recipient;
		const borrowAmount = oneMantissa.mul(new BN(20));
		const borrowedAmount = borrowAmount;
		
		async function makeBorrow(params) {
			const {
				borrowAmount,
				repayAmount,
				maxBorrowableNew,
			} = params;
			
			const borrowedAmount = borrowAmount;
			const initialBorrowAmount = await borrowable.borrowBalance(TOKEN_ID);
			const maxBorrowable = initialBorrowAmount.add(maxBorrowableNew);
			const newBorrowAmount = initialBorrowAmount.add(borrowedAmount);
			const actualRepayAmount = repayAmount.gt(newBorrowAmount) ? newBorrowAmount : repayAmount;
			const expectedAccountBorrows = newBorrowAmount.sub(actualRepayAmount);
			const expectedReceiverBalance = borrowAmount.add(await underlying.balanceOf(receiver));
			const expectedTotalBorrows = borrowedAmount.add(await borrowable.totalBorrows()).sub(actualRepayAmount);

			//FOR DEBUG
			//console.log('borrowAmount:', borrowAmount / 1e18);
			//console.log('repayAmount:', repayAmount / 1e18);
			//console.log('maxBorrowable:', maxBorrowable / 1e18);
			//console.log('borrowedAmount:', borrowedAmount / 1e18);
			//console.log('expectedAccountBorrows:', expectedAccountBorrows / 1e18);
			//console.log('expectedReceiverBalance:', expectedReceiverBalance / 1e18);
			//console.log('expectedTotalBorrows:', expectedTotalBorrows / 1e18);
			
			await collateral.setMaxBorrowable(TOKEN_ID, borrowable.address, maxBorrowable);
			await underlying.setBalanceHarness(borrowable.address, borrowAmount);
			await underlying.setBalanceHarness(recipient.address, repayAmount);
			await borrowable.sync();
			await borrowable.borrowApprove(root, borrowAmount, {from: borrower});
			expect(await borrowable.borrowAllowance(borrower, root) * 1).to.eq(borrowAmount * 1);
			const borrowAction = borrowable.borrow(TOKEN_ID, receiver, borrowAmount, '0x1');
			if (maxBorrowable.lt(expectedAccountBorrows)) {
				await expectRevert(borrowAction, 'ImpermaxV3Borrowable: INSUFFICIENT_LIQUIDITY');
				return false;
			}
			const receipt = await borrowAction;
			
			const borrowBalance = await borrowable.borrowBalance(TOKEN_ID);
			expect(await borrowable.borrowAllowance(borrower, root) * 1).to.eq(0);
			expect(await underlying.balanceOf(borrowable.address) * 1).to.eq(repayAmount * 1);
			expect(await underlying.balanceOf(receiver) * 1).to.eq(expectedReceiverBalance * 1);
			expect(borrowBalance * 1).to.eq(expectedAccountBorrows * 1);
			expect(await borrowable.totalBorrows() * 1).to.eq(expectedTotalBorrows * 1);
			expect(await borrowable.totalBalance() * 1).to.eq(repayAmount * 1);
			expectEvent(receipt, 'Transfer', {});
			expectEvent(receipt, 'Sync', {});
			expectEvent(receipt, 'CalculateBorrowRate', {});
			expectEvent(receipt, 'Borrow', {
				'sender': root,
				'tokenId': TOKEN_ID,
				'receiver': receiver,
				'borrowAmount': borrowAmount,
				'repayAmount': repayAmount,
				'accountBorrowsPrior': initialBorrowAmount,
				'accountBorrows': expectedAccountBorrows,
				'totalBorrows': expectedTotalBorrows,
			});
			
			const borrowIndex = await borrowable.borrowIndex();
			
			return true;
		}
		
		before(async () => {
			borrowable = await Borrowable.new();
			factory = await makeFactory({admin});		
			underlying = await makeErc20Token();
			collateral = await Collateral.new();
			recipient = await Recipient.new();
			receiver = (await ImpermaxCallee.new(recipient.address, underlying.address)).address;
			await borrowable.setFactoryHarness(factory.address);	
			await borrowable.setUnderlyingHarness(underlying.address);
			await borrowable.setCollateralHarness(collateral.address);
			await borrowable.sync(); //avoid undesired borrowBalance growing 
			await collateral.setOwnerHarness(borrower, TOKEN_ID);
		});
		
		it(`fail if cash is insufficient`, async () => {
			await underlying.setBalanceHarness(borrowable.address, '0');
			await borrowable.sync();
			await expectRevert(borrowable.borrow(TOKEN_ID, receiver, '1', '0x'), 'ImpermaxV3Borrowable: INSUFFICIENT_CASH');			
		});

		it(`fail if not allowed`, async () => {
			await underlying.setBalanceHarness(borrowable.address, '1');
			await borrowable.sync();
			await expectRevert(borrowable.borrow(TOKEN_ID, receiver, '1', '0x'), 'ImpermaxV3Borrowable: BORROW_NOT_ALLOWED');
		});

		it(`fail if above debt ceiling`, async () => {
			await underlying.setBalanceHarness(borrowable.address, borrowAmount);
			await borrowable.sync();
			await borrowable.borrowApprove(root, borrowAmount, {from: borrower});
			await borrowable._setDebtCeiling(borrowAmount.sub(new BN(1)), {from: admin});
			await collateral.setMaxBorrowable(TOKEN_ID, borrowable.address, borrowAmount);
			await expectRevert(borrowable.borrow(TOKEN_ID, receiver, borrowAmount, '0x'), 'ImpermaxV3Borrowable: TOTAL_BORROWS_ABOVE_DEBT_CEILING');
		});

		it(`borrow succeds with enough collateral`, async () => {
			const repayAmount = ZERO;
			const maxBorrowableNew = borrowAmount; // TODO update in fucntion
			await borrowable._setDebtCeiling(borrowAmount, {from: admin});
			const result = await makeBorrow({borrowAmount, repayAmount, maxBorrowableNew});
			await borrowable._setDebtCeiling(borrowAmount.mul(new BN(2)), {from: admin});
			expect(result).to.eq(true);
		});

		it(`borrow fails without enough collateral`, async () => {
			const repayAmount = ZERO;
			const maxBorrowableNew = borrowAmount.sub(new BN(1));
			const result = await makeBorrow({borrowAmount, repayAmount, maxBorrowableNew});
			expect(result).to.eq(false);
		});

		it(`borrow succeds without collateral if repaid`, async () => {
			const repayAmount = borrowedAmount.mul( oneMantissa ).div(oneMantissa);
			const maxBorrowableNew = ZERO;
			const result = await makeBorrow({borrowAmount, repayAmount, maxBorrowableNew});
			expect(result).to.eq(true);
		});

		it(`borrow succeds without collateral if overly repaid`, async () => {
			const repayAmount = borrowedAmount.mul( oneMantissa.mul(new BN(12)).div(new BN(10)) ).div(oneMantissa);
			const maxBorrowableNew = ZERO;
			const result = await makeBorrow({borrowAmount, repayAmount, maxBorrowableNew});
			expect(result).to.eq(true);
		});

		it(`borrow fails without collateral if not fully repaid`, async () => {
			const repayAmount = borrowedAmount.mul( oneMantissa.mul(new BN(999999)).div(new BN(1000000)) ).div(oneMantissa);
			const maxBorrowableNew = ZERO;
			const result = await makeBorrow({borrowAmount, repayAmount, maxBorrowableNew});
			expect(result).to.eq(false);
		});

		it(`borrow succeds with half collateral if half repaid`, async () => {
			const repayAmount = borrowedAmount.mul( oneMantissa.div(new BN(2)) ).div(oneMantissa);
			const maxBorrowableNew = borrowAmount.div(new BN(2));
			const result = await makeBorrow({borrowAmount, repayAmount, maxBorrowableNew});
			expect(result).to.eq(true);
		});

		it(`borrow fails with half collateral if not repaid`, async () => {
			const repayAmount = borrowedAmount.mul( oneMantissa.div(new BN(2)).mul(new BN(999999)).div(new BN(1000000)) ).div(oneMantissa);
			const maxBorrowableNew = borrowAmount.div(new BN(2));
			const result = await makeBorrow({borrowAmount, repayAmount, maxBorrowableNew});
			expect(result).to.eq(false);
		});

		it(`repay succeeds`, async () => {
			const borrowAmount = ZERO;
			const repayAmount = oneMantissa.mul(new BN(5));
			const maxBorrowableNew = ZERO;
			const result = await makeBorrow({borrowAmount, repayAmount, maxBorrowableNew});
			expect(result).to.eq(true);
		});

		it(`no cashback if over-repaid`, async () => {
			const borrowAmount = ZERO;
			const repayAmount = oneMantissa.mul(new BN(1000));
			const maxBorrowableNew = ZERO;
			const result = await makeBorrow({borrowAmount, repayAmount, maxBorrowableNew});
			expect(result).to.eq(true);
		});
	});
	
	describe('liquidate', () => {
		let factory;
		let borrowable;
		let borrowableB;
		let underlying;
		let tokenizedCLPosition;
		let collateral;
		let recipient;
		
		//const exchangeRate = oneMantissa.mul(new BN(2));
		const liquidationIncentive = oneMantissa.mul(new BN(102)).div(new BN(100));
		const liquidationFee = oneMantissa.mul(new BN(2)).div(new BN(100));
		const liquidationPenalty = oneMantissa.mul(new BN(104)).div(new BN(100));
		const price = new BN(3);
		const priceSqrtX96 = _2_96.mul(new BN(173205081)).div(new BN(100000000));
		const paSqrtX96 = priceSqrtX96.div(new BN(2));
		const pbSqrtX96 = priceSqrtX96.mul(new BN(2));
		const liquidityUnderwater = oneMantissa.mul(new BN(14));
		const liquidityOverwater = oneMantissa.mul(new BN(16));
			
		
		const repayAmount = oneMantissa.mul(new BN(20));
		const seizeLiquidity = repayAmount.mul(price).div(price.add(new BN(1))).mul(liquidationPenalty).div(oneMantissa);
		const seizeLiquidityLiquidator = repayAmount.mul(price).div(price.add(new BN(1))).mul(liquidationIncentive).div(oneMantissa);
		const seizeLiquidityReserves = repayAmount.mul(price).div(price.add(new BN(1))).mul(liquidationFee).div(oneMantissa);
		
		async function pretendHasBorrowed(TOKEN_ID, amount) {
			const borrowIndex = await borrowable.borrowIndex();
			await borrowable.setTotalBorrows(amount);
			await borrowable.setBorrowBalances(TOKEN_ID, amount, borrowIndex);
		}
		
		before(async () => {
			factory = await makeFactory({admin, reservesAdmin});
			borrowable = await Borrowable.new();
			borrowableB = await Borrowable.new();
			underlying = await makeErc20Token();
			tokenizedCLPosition = await makeTokenizedCLPosition();
			collateral = await Collateral.new();
			recipient = await Recipient.new();
			await factory._setReservesManager(reservesManager, {from: reservesAdmin});
			await borrowable.setUnderlyingHarness(underlying.address);
			await borrowable.setCollateralHarness(collateral.address);
			await borrowable.sync(); //avoid undesired borrowBalance growing 
			await collateral.setFactoryHarness(factory.address);
			await collateral.setUnderlyingHarness(tokenizedCLPosition.address);
			await collateral.setBorrowable0Harness(borrowable.address);				
			await collateral.setBorrowable1Harness(borrowableB.address);				
			await collateral._setLiquidationIncentive(liquidationIncentive, {from: admin});
			await collateral._setLiquidationFee(liquidationFee, {from: admin});
			await tokenizedCLPosition.setPriceSqrtX96Harness(priceSqrtX96);
		});
		
		beforeEach(async () => {
			await underlying.setBalanceHarness(borrowable.address, '0');
			await borrowable.sync();
		});
		
		it(`fail if not liquidatable`, async () => {
			await tokenizedCLPosition.setPositionHarness(
				TOKEN_ID, 
				liquidityOverwater,
				liquidityOverwater,
				liquidityOverwater,
				liquidityOverwater,
				liquidityOverwater,
				liquidityOverwater
			);
			await tokenizedCLPosition.setOwnerHarness(collateral.address, TOKEN_ID);
			await expectRevert(borrowable.liquidate(TOKEN_ID, repayAmount, liquidator, "0x"), "ImpermaxV3Collateral: INSUFFICIENT_SHORTFALL");		
		});
		
		it(`fail if underwater`, async () => {
			await tokenizedCLPosition.setPositionHarness(
				TOKEN_ID, 
				liquidityUnderwater,
				liquidityUnderwater,
				liquidityUnderwater,
				liquidityUnderwater,
				liquidityUnderwater,
				liquidityUnderwater
			);
			await pretendHasBorrowed( TOKEN_ID, repayAmount.mul(new BN(101)).div(new BN(100)) );
			await expectRevert(borrowable.liquidate(TOKEN_ID, repayAmount, liquidator, "0x"), "ImpermaxV3Collateral: CANNOT_LIQUIDATE_UNDERWATER_POSITION");		
		});
		
		it(`fail if insufficient repay`, async () => {
			await tokenizedCLPosition.setPositionHarness(
				TOKEN_ID, 
				liquidityUnderwater,
				liquidityUnderwater,
				liquidityOverwater,
				liquidityOverwater,
				liquidityUnderwater,
				liquidityUnderwater
			);
			await pretendHasBorrowed(TOKEN_ID, repayAmount);
			await underlying.setBalanceHarness(borrowable.address, repayAmount.sub(new BN(1)));
			await expectRevert(borrowable.liquidate(TOKEN_ID, repayAmount, liquidator, "0x"), "ImpermaxV3Borrowable: INSUFFICIENT_ACTUAL_REPAY");
		});
		
		it(`repayAmount equal accountBorrows`, async () => {
			await tokenizedCLPosition.setPositionHarness(
				TOKEN_ID, 
				liquidityUnderwater,
				liquidityUnderwater,
				liquidityOverwater,
				liquidityOverwater,
				liquidityUnderwater,
				liquidityUnderwater
			);
			await pretendHasBorrowed(TOKEN_ID, repayAmount);
			await underlying.setBalanceHarness(borrowable.address, repayAmount);
			const seizeTokenId = await borrowable.liquidate.call(TOKEN_ID, repayAmount, liquidator, "0x");
			const receipt = await borrowable.liquidate(TOKEN_ID, repayAmount, liquidator, "0x");
			
			const position = await tokenizedCLPosition.getPositionData.call(seizeTokenId, 0);
			expectAlmostEqualMantissa(position.realXYs.currentPrice.realX, seizeLiquidityLiquidator);
			expectAlmostEqualMantissa(position.realXYs.currentPrice.realY, seizeLiquidityLiquidator);
			expect(await borrowable.totalBorrows() * 1).to.eq(0);
			expect(await borrowable.borrowBalance(TOKEN_ID) * 1).to.eq(0);
			expect(await borrowable.totalBalance() * 1).to.eq(repayAmount * 1);
			expectEvent(receipt, 'Liquidate', {
				sender: root,
				tokenId: TOKEN_ID,
				liquidator: liquidator,
				seizeTokenId: seizeTokenId,
				repayAmount: repayAmount,
				accountBorrowsPrior: repayAmount,
				accountBorrows: '0',
				totalBorrows: '0',
			});
		});
		
		it(`if repayAmount <= accountBorrowsPrior -> actualRepayAmount = repayAmount`, async () => {
			const accountBorrowsPrior = repayAmount.mul(new BN(2));
			const actualRepayAmount = repayAmount;
			await tokenizedCLPosition.setPositionHarness(
				TOKEN_ID, 
				liquidityUnderwater.mul(new BN(2)),
				liquidityUnderwater.mul(new BN(2)),
				liquidityOverwater.mul(new BN(2)),
				liquidityOverwater.mul(new BN(2)),
				liquidityUnderwater.mul(new BN(2)),
				liquidityUnderwater.mul(new BN(2))
			);
			await pretendHasBorrowed(TOKEN_ID, accountBorrowsPrior);
			await underlying.setBalanceHarness(borrowable.address, repayAmount);
			const seizeTokenId = await borrowable.liquidate.call(TOKEN_ID, repayAmount, liquidator, "0x");
			const receipt = await borrowable.liquidate(TOKEN_ID, repayAmount, liquidator, "0x");
			const accountBorrows = accountBorrowsPrior.sub(actualRepayAmount);
			
			const position = await tokenizedCLPosition.getPositionData.call(seizeTokenId, 0);
			expectAlmostEqualMantissa(position.realXYs.currentPrice.realX, seizeLiquidityLiquidator);
			expectAlmostEqualMantissa(position.realXYs.currentPrice.realY, seizeLiquidityLiquidator);
			expect(await borrowable.totalBorrows() * 1).to.eq(accountBorrows * 1);
			expect(await borrowable.borrowBalance(TOKEN_ID) * 1).to.eq(accountBorrows * 1);
			expect(await borrowable.totalBalance() * 1).to.eq(repayAmount * 1);
			expectEvent(receipt, 'Liquidate', {
				sender: root,
				tokenId: TOKEN_ID,
				liquidator: liquidator,
				seizeTokenId: seizeTokenId,
				repayAmount: actualRepayAmount,
				accountBorrowsPrior: accountBorrowsPrior,
				accountBorrows: accountBorrows,
				totalBorrows: accountBorrows,
			});
		});
		
		it(`if repayAmount > accountBorrowsPrior -> actualRepayAmount = accountBorrowsPrior`, async () => {
			const accountBorrowsPrior = repayAmount.div(new BN(2));
			const actualRepayAmount = accountBorrowsPrior;
			await tokenizedCLPosition.setPositionHarness(
				TOKEN_ID, 
				liquidityUnderwater.div(new BN(2)),
				liquidityUnderwater.div(new BN(2)),
				liquidityOverwater.div(new BN(2)),
				liquidityOverwater.div(new BN(2)),
				liquidityUnderwater.div(new BN(2)),
				liquidityUnderwater.div(new BN(2))
			);
			await pretendHasBorrowed(TOKEN_ID, accountBorrowsPrior);
			await underlying.setBalanceHarness(borrowable.address, repayAmount);
			const seizeTokenId = await borrowable.liquidate.call(TOKEN_ID, repayAmount, liquidator, "0x");
			const receipt = await borrowable.liquidate(TOKEN_ID, repayAmount, liquidator, "0x");
			const accountBorrows = accountBorrowsPrior.sub(actualRepayAmount);
			
			const position = await tokenizedCLPosition.getPositionData.call(seizeTokenId, 0);
			expectAlmostEqualMantissa(position.realXYs.currentPrice.realX, seizeLiquidityLiquidator.div(new BN(2)));
			expectAlmostEqualMantissa(position.realXYs.currentPrice.realY, seizeLiquidityLiquidator.div(new BN(2)));
			expect(await borrowable.totalBorrows() * 1).to.eq(accountBorrows * 1);
			expect(await borrowable.borrowBalance(TOKEN_ID) * 1).to.eq(accountBorrows * 1);
			expect(await borrowable.totalBalance() * 1).to.eq(repayAmount * 1);
			expectEvent(receipt, 'Liquidate', {
				sender: root,
				tokenId: TOKEN_ID,
				liquidator: liquidator,
				seizeTokenId: seizeTokenId,
				repayAmount: actualRepayAmount,
				accountBorrowsPrior: accountBorrowsPrior,
				accountBorrows: accountBorrows,
				totalBorrows: accountBorrows,
			});
		});
		
		it(`flash liquidation`, async () => {
			let liquidatorContract = await Liquidator.new(underlying.address, borrowable.address);
			await tokenizedCLPosition.setPositionHarness(
				TOKEN_ID, 
				liquidityUnderwater,
				liquidityUnderwater,
				liquidityOverwater,
				liquidityOverwater,
				liquidityUnderwater,
				liquidityUnderwater
			);
			await pretendHasBorrowed(TOKEN_ID, repayAmount);
			await underlying.setBalanceHarness(liquidatorContract.address, repayAmount);
			const seizeTokenId = await liquidatorContract.liquidate.call(TOKEN_ID, repayAmount);
			const receipt = await liquidatorContract.liquidate(TOKEN_ID, repayAmount);
			//const seizeTokenId = await borrowable.liquidate.call(TOKEN_ID, repayAmount, liquidatorContract.address, encode(['uint'], [repayAmount.toString()]));
			//const receipt = await borrowable.liquidate(TOKEN_ID, repayAmount, liquidatorContract.address, encode(['uint'], [repayAmount.toString()]));
			
			const position = await tokenizedCLPosition.getPositionData.call(seizeTokenId, 0);
			expectAlmostEqualMantissa(position.realXYs.currentPrice.realX, seizeLiquidityLiquidator);
			expectAlmostEqualMantissa(position.realXYs.currentPrice.realY, seizeLiquidityLiquidator);
			expect(await borrowable.totalBorrows() * 1).to.eq(0);
			expect(await borrowable.borrowBalance(TOKEN_ID) * 1).to.eq(0);
			expect(await borrowable.totalBalance() * 1).to.eq(repayAmount * 1);
			expect(await tokenizedCLPosition.ownerOf(seizeTokenId)).to.eq(liquidatorContract.address);
			//expectEvent(receipt, 'Liquidate', {
			//	sender: liquidatorContract.address,
			//	tokenId: TOKEN_ID,
			//	liquidator: liquidatorContract.address,
			//	seizeTokenId: seizeTokenId,
			//	repayAmount: repayAmount,
			//	accountBorrowsPrior: repayAmount,
			//	accountBorrows: '0',
			//	totalBorrows: '0',
			//});
		});
	});
	
	describe('mint reserves', () => {
		let factory;
		let borrowable;
		let underlying;
		const er = oneMantissa.mul(new BN(3));
		const totalBalance = oneMantissa.mul(new BN(150));
		const totalBorrows = oneMantissa.mul(new BN(150));
		const totalSupply = oneMantissa.mul(new BN(100));
		const reserveFactor = oneMantissa.div(new BN(8));
		before(async () => {
			factory = await makeFactory({admin, reservesAdmin});
			borrowable = await Borrowable.new();
			underlying = await makeErc20Token();
			await borrowable.setUnderlyingHarness(underlying.address);
			await borrowable.setFactoryHarness(factory.address);
			await borrowable._setReserveFactor(reserveFactor, {from: admin});
			await factory._setReservesManager(reservesManager, {from: reservesAdmin});
			await borrowable.setTotalBalance(totalBalance);
			await borrowable.setTotalBorrows(totalBorrows);
			await underlying.mint(borrowable.address, totalBalance);
		});
		
		beforeEach(async () => {
			await borrowable.setTotalSupply(totalSupply);
			const reserveTokens = await borrowable.balanceOf(reservesManager);
			await borrowable.transfer(address(0), reserveTokens, {from: reservesManager});
		});
		
		it(`er = erLast`, async () => {
			const erLast = er;
			await borrowable.setExchangeRateLast(erLast);
			await borrowable.exchangeRate();
			expect(await borrowable.balanceOf(reservesManager) * 1).to.eq(0);
			expect(await borrowable.totalSupply() * 1).to.eq(totalSupply * 1);
			expect(await borrowable.exchangeRate.call() * 1).to.eq(er * 1);
			expect(await borrowable.exchangeRateLast() * 1).to.eq(erLast * 1);
		});
		
		it(`er < erLast`, async () => {
			const erLast = er.mul(new BN(2));
			await borrowable.setExchangeRateLast(erLast);
			await borrowable.exchangeRate();
			expect(await borrowable.balanceOf(reservesManager) * 1).to.eq(0);
			expect(await borrowable.totalSupply() * 1).to.eq(totalSupply * 1);
			expect(await borrowable.exchangeRate.call() * 1).to.eq(er * 1);
			expect(await borrowable.exchangeRateLast() * 1).to.eq(erLast * 1);
		});
		
		it(`er > erLast`, async () => {
			const erLast = oneMantissa.mul(new BN(2));
			const erNew = oneMantissa.mul(new BN(2875)).div(new BN(1000));
			const mintedReserves = bnMantissa(4.347826);
			await borrowable.setExchangeRateLast(erLast);
			await borrowable.exchangeRate();
			expectAlmostEqualMantissa(await borrowable.balanceOf(reservesManager), mintedReserves);
			expectAlmostEqualMantissa(await borrowable.totalSupply(), totalSupply.add(mintedReserves));
			expect(await borrowable.exchangeRate.call() * 1).to.eq(erNew * 1);
			expect(await borrowable.exchangeRateLast() * 1).to.eq(erNew * 1);
		});
		
		it(`mint and redeem cause mint reserves`, async () => {
			const erLastA = oneMantissa.mul(new BN(2));
			const erNewA = oneMantissa.mul(new BN(2875)).div(new BN(1000));
			const profitA = er.sub(erLastA).mul(totalSupply).div(oneMantissa);
			const mintedReservesA = profitA.mul(reserveFactor).div(erNewA);
			await borrowable.setExchangeRateLast(erLastA);
			await underlying.mint(user, erNewA);
			await underlying.transfer(borrowable.address, erNewA, {from: user});
			await borrowable.mint(user);
			expect(await borrowable.balanceOf(user) * 1).to.eq(oneMantissa * 1);
			expectAlmostEqualMantissa(await borrowable.balanceOf(reservesManager), mintedReservesA);
			expect(await borrowable.exchangeRate.call() * 1).to.eq(erNewA * 1);
			
			const totalSupplyB = await borrowable.totalSupply();
			const erLastB = oneMantissa.mul(new BN(2));
			const erNewB = oneMantissa.mul(new BN(2765625)).div(new BN(1000000));
			const profitB = erNewA.sub(erLastB).mul(totalSupplyB).div(oneMantissa);
			const mintedReservesB = profitB.mul(reserveFactor).div(erNewB).add(mintedReservesA);
			await borrowable.setExchangeRateLast(erLastB);
			await borrowable.transfer(borrowable.address, oneMantissa, {from: user});
			await borrowable.redeem(user);
			expect(await underlying.balanceOf(user) * 1).to.eq(erNewB * 1);
			expectAlmostEqualMantissa(await borrowable.balanceOf(reservesManager), mintedReservesB);
			expect(await borrowable.exchangeRate.call() * 1).to.eq(erNewB * 1);
		});
	});
	
	describe('restructureDebt', () => {
		let borrowable;
		let underlying;
		
		const currentBorrowBalance = oneMantissa.mul(new BN(20));
		const expectedRepayAmount = oneMantissa.mul(new BN(4));
		const expectedAccountBorrows = oneMantissa.mul(new BN(16));
		
		const reduceToRatio = oneMantissa.mul(new BN(8)).div(new BN(10));
		const reduceToRatioFail = oneMantissa.add(new BN(1));
		
		async function pretendHasBorrowed(TOKEN_ID, amount) {
			const borrowIndex = await borrowable.borrowIndex();
			await borrowable.setTotalBorrows(amount);
			await borrowable.setBorrowBalances(TOKEN_ID, amount, borrowIndex);
		}
		
		before(async () => {
			factory = await makeFactory({admin, reservesAdmin});
			borrowable = await Borrowable.new();
			underlying = await makeErc20Token();
			await borrowable.setUnderlyingHarness(underlying.address);
			await borrowable.setCollateralHarness(root);
			await borrowable.setFactoryHarness(factory.address);
			
			await borrowable.setExchangeRateLast(oneMantissa);
			await borrowable.setTotalSupply(currentBorrowBalance);
			await pretendHasBorrowed(TOKEN_ID, currentBorrowBalance);
		});
		
		it(`fail if not collateral`, async () => {
			await expectRevert(borrowable.restructureDebt(TOKEN_ID, reduceToRatio, {from: borrower}), "ImpermaxV3Borrowable: UNAUTHORIZED");		
		});
		
		it(`fail if not underwater`, async () => {
			await expectRevert(borrowable.restructureDebt(TOKEN_ID, reduceToRatioFail), "ImpermaxV3Borrowable: NOT_UNDERWATER");
		});
		
		it(`reduceToRatio = 0.8`, async () => {
			const exchangeRatePrior = await borrowable.exchangeRate.call();
			const receipt = await borrowable.restructureDebt(TOKEN_ID, reduceToRatio);
			const exchangeRateAfter = await borrowable.exchangeRate.call();
			expectEvent(receipt, 'Sync', {});
			expectEvent(receipt, 'CalculateBorrowRate', {});
			expectEvent(receipt, 'RestructureDebt', {
				'tokenId': TOKEN_ID,
				'reduceToRatio': reduceToRatio,
				'repayAmount': expectedRepayAmount,
				'accountBorrowsPrior': currentBorrowBalance,
				'accountBorrows': expectedAccountBorrows,
				'totalBorrows': expectedAccountBorrows,
			});
			expectAlmostEqualMantissa(exchangeRatePrior.mul(reduceToRatio).div(oneMantissa), exchangeRateAfter);
		});
	});
	
	describe('reentrancy', () => {
		let factory;
		let borrowable;
		let receiver;
		before(async () => {
			factory = await makeFactory({admin});
			borrowable = await Borrowable.new();
			collateral = await Collateral.new();
			await borrowable.setCollateralHarness(collateral.address);
			await collateral.setOwnerHarness(borrower, TOKEN_ID);
			await borrowable.setFactoryHarness(factory.address);
			receiver = (await ReentrantCallee.new()).address;
		});
		
		it(`borrow reentrancy`, async () => {
			await expectRevert(borrowable.borrow(TOKEN_ID, receiver, '0', encode(['uint'], [1])), 'PoolToken: REENTERED');
			await expectRevert(borrowable.borrow(TOKEN_ID, receiver, '0', encode(['uint'], [2])), 'PoolToken: REENTERED');
			await expectRevert(borrowable.borrow(TOKEN_ID, receiver, '0', encode(['uint'], [3])), 'PoolToken: REENTERED');
			await expectRevert(borrowable.borrow(TOKEN_ID, receiver, '0', encode(['uint'], [4])), 'PoolToken: REENTERED');
			await expectRevert(borrowable.borrow(TOKEN_ID, receiver, '0', encode(['uint'], [5])), 'PoolToken: REENTERED');
			await expectRevert(borrowable.borrow(TOKEN_ID, receiver, '0', encode(['uint'], [6])), 'PoolToken: REENTERED');
			await expectRevert(borrowable.borrow(TOKEN_ID, receiver, '0', encode(['uint'], [7])), 'PoolToken: REENTERED');
			await expectRevert(borrowable.borrow(TOKEN_ID, receiver, '0', encode(['uint'], [0])), 'TEST');
		});
	});
});