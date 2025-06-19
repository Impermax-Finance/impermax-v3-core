const {
	makeFactory,
	makeTokenizedUniswapV2Position,
} = require('./Utils/Impermax');
const {
	expectEqual,
	expectAlmostEqualMantissa,
	expectRevert,
	expectEvent,
	bnMantissa,
	BN,
	uq112,
} = require('./Utils/JS');
const {
	freezeTime,
	increaseTime,
} = require('./Utils/Ethereum');

const oneMantissa = (new BN(10)).pow(new BN(18));
const SECONDS_IN_YEAR = 3600 * 24 * 365;
const SECONDS_IN_DAY = 3600 * 24;

function slightlyIncrease(bn) {
	return bn.mul( bnMantissa(1.00001) ).div( oneMantissa );
}
function slightlyDecrease(bn) {
	return bn.mul( oneMantissa ).div( bnMantissa(1.00001) );
}

const MockERC20 = artifacts.require('MockERC20');
const MockUniswapV2Pair = artifacts.require('MockUniswapV2Pair');
const MockOracle = artifacts.require('MockOracle');
const BDeployer = artifacts.require('BDeployer');
const CDeployer = artifacts.require('CDeployer');
const Factory = artifacts.require('ImpermaxV3Factory');
const Collateral = artifacts.require('ImpermaxV3Collateral');
const Borrowable = artifacts.require('ImpermaxV3Borrowable');
const Liquidator = artifacts.require('Liquidator');

contract('Highlevel-UniswapV2', function (accounts) {
	const root = accounts[0];
	const user = accounts[1];
	const reservesAdmin = accounts[2];		
	const borrower = accounts[3];		
	const lender = accounts[4];		
	const admin = accounts[5];		
	let liquidatorContract0;
	let liquidatorContract1;
	const reservesManager = accounts[6];	

	let tokenizedPosition, factory, simpleUniswapOracle, uniswapV2Pair, token0, token1, collateral, borrowable0, borrowable1;
	let TOKEN_ID;
		
	async function testAccountLiquidity(percentage) {
		await collateral.redeem.call(borrower, TOKEN_ID, slightlyDecrease(percentage), {from: borrower});
		if (percentage.lt(oneMantissa))
			await expectRevert(
				collateral.redeem.call(borrower, TOKEN_ID, slightlyIncrease(percentage), {from: borrower}),
				"ImpermaxV3Collateral: INSUFFICIENT_LIQUIDITY"
			);
	}
	
	const lendAmount0 = bnMantissa(20);
	const lendAmount1 = bnMantissa(1000);
	const collateralAmount = bnMantissa(300);
	const price0A = 5;
	const price1A = 0.2;	
	const borrowAmount0 = bnMantissa(20);
	const borrowAmount1 = bnMantissa(500);
	const expectedBorrowAmont0A = bnMantissa(20);
	const expectedBorrowAmont1A = bnMantissa(500);
	const expectedAccountLiquidityA = bnMantissa(69.7862);
	const expectedBorrowRate0A = bnMantissa(0.2 * 2 / SECONDS_IN_YEAR);
	const expectedBorrowRate1A = bnMantissa(0.2 * 50 / 75 / SECONDS_IN_YEAR);
	const timeElapsed = 100000; //1.157 days 
	const expectedBorrowAmont0B = bnMantissa(20.025367);
	const expectedBorrowAmont1B = bnMantissa(500.21140);
	const expectedAccountLiquidityB = bnMantissa(69.5500);
	const expectedBorrowRate0B = bnMantissa(0.315741 * 2 / SECONDS_IN_YEAR);
	const expectedBorrowRate1B = bnMantissa(0.107613 / SECONDS_IN_YEAR);
	const price0B = 7.645966;
	const price1B = 0.13078792;
	const expectedAccountLiquidityC = bnMantissa(5.191604);
	const price0C = 7.874008;
	const price1C = 0.1270001;
	const liquidatedAmount = bnMantissa(163.9871);
	const liquidatedAmountLiquidator = bnMantissa(160.8335);
	const liquidatedAmountReserves = bnMantissa(3.15360);
	const expectedLenderProfit0 = bnMantissa(0.0228327);
	const expectedProtocolProfit0 = bnMantissa(0.00253695);
	const price0D = 2;
	const price1D = 0.1270001;
	const expectedLenderLoss1 = bnMantissa(84.84232);
	const expectedProtocolProfit1 = bnMantissa(0.03495842);

	before(async () => {
		await freezeTime();
	});

	it('deploy factory', async () => {
		factory = await makeFactory({admin, reservesAdmin});
		await factory._setReservesManager(reservesManager, {from: reservesAdmin});
	});

	it('deploy lending pool', async () => {
		tokenizedPosition = await makeTokenizedUniswapV2Position();
		uniswapV2Pair = tokenizedPosition.obj.uniswapV2Pair;
		token0 = uniswapV2Pair.obj.token0;
		token1 = uniswapV2Pair.obj.token1;
		const collateralAddress = await factory.createCollateral.call(tokenizedPosition.address);
		const borrowable0Address = await factory.createBorrowable0.call(tokenizedPosition.address);
		const borrowable1Address = await factory.createBorrowable1.call(tokenizedPosition.address);
		const receiptCollateral = await factory.createCollateral(tokenizedPosition.address);
		const receiptBorrowable0 = await factory.createBorrowable0(tokenizedPosition.address);
		const receiptBorrowable1 = await factory.createBorrowable1(tokenizedPosition.address);
		const receiptInitialize = await factory.initializeLendingPool(tokenizedPosition.address);
		collateral = await Collateral.at(collateralAddress);
		borrowable0 = await Borrowable.at(borrowable0Address);
		borrowable1 = await Borrowable.at(borrowable1Address);
		await token0.mint(lender, lendAmount0);
		await token1.mint(lender, lendAmount1);
		await uniswapV2Pair.mint(borrower, collateralAmount);
		simpleUniswapOracle = tokenizedPosition.obj.tokenizedUniswapV2Factory.obj.simpleUniswapOracle;
		await simpleUniswapOracle.setPrice(uniswapV2Pair.address, uq112(price0A / price1A));
		await uniswapV2Pair.setReserves(bnMantissa(price1A * 1000), bnMantissa(price0A * 1000));
		await uniswapV2Pair.setTotalSupply(bnMantissa(2000));
		//console.log(receiptCollateral.receipt.gasUsed + ' createCollateral');
		//console.log(receiptBorrowable0.receipt.gasUsed + ' createBorrowable0');
		//console.log(receiptBorrowable1.receipt.gasUsed + ' createBorrowable1');
		//console.log(receiptInitialize.receipt.gasUsed + ' initialize');
		liquidatorContract0 = await Liquidator.new(token0.address, borrowable0.address);
		liquidatorContract1 = await Liquidator.new(token1.address, borrowable1.address);

		await collateral._setLiquidationIncentive(bnMantissa(1.02), {from: admin});
		await collateral._setLiquidationFee(bnMantissa(0.02), {from: admin});
	});
	
	it('settings sanity check', async () => {
		//For Highlevel tests to pass, the lending pool should have these default settings
		expectAlmostEqualMantissa(await collateral.underlying(), tokenizedPosition.address);
		expectAlmostEqualMantissa(await collateral.liquidationIncentive(), bnMantissa(1.02));
		expectAlmostEqualMantissa(await collateral.liquidationFee(), bnMantissa(0.02));
		expectAlmostEqualMantissa(await collateral.safetyMarginSqrt(), bnMantissa(Math.sqrt(2.5)));
		expectAlmostEqualMantissa(await borrowable0.exchangeRate.call(), oneMantissa);
		expectAlmostEqualMantissa(await borrowable0.kinkUtilizationRate(), bnMantissa(0.75));
		expectAlmostEqualMantissa(await borrowable0.kinkBorrowRate(), bnMantissa(0.2 / SECONDS_IN_YEAR));
		expectAlmostEqualMantissa(await borrowable0.reserveFactor(), bnMantissa(0.1));
		expectEqual(await borrowable0.KINK_MULTIPLIER(), 2);
		expectAlmostEqualMantissa(await borrowable0.adjustSpeed(), bnMantissa(0.5 / SECONDS_IN_DAY));
	});
	
	it('lend', async () => {
		await token0.transfer(borrowable0.address, lendAmount0, {from: lender});
		const receiptMintBorrowable = await borrowable0.mint(lender);
		await token1.transfer(borrowable1.address, lendAmount1, {from: lender});
		await borrowable1.mint(lender);
		expectAlmostEqualMantissa(await borrowable0.totalSupply(), lendAmount0);
		expectAlmostEqualMantissa(await borrowable0.totalBalance(), lendAmount0);
		expectAlmostEqualMantissa(await borrowable0.balanceOf(lender), lendAmount0);
		expectAlmostEqualMantissa(await borrowable1.totalSupply(), lendAmount1);
		expectAlmostEqualMantissa(await borrowable1.totalBalance(), lendAmount1);
		expectAlmostEqualMantissa(await borrowable1.balanceOf(lender), lendAmount1);
		//console.log(receiptMintBorrowable.receipt.gasUsed + ' mintBorrowable');
	});
	
	it('deposit collateral', async () => {
		await uniswapV2Pair.transfer(tokenizedPosition.address, collateralAmount, {from: borrower});
		TOKEN_ID = await tokenizedPosition.mint.call(borrower);
		const receiptMintTokenizedPosition = await tokenizedPosition.mint(borrower);
		await tokenizedPosition.transferFrom(borrower, collateral.address, TOKEN_ID, {from: borrower});
		const receiptMintCollateral = await collateral.mint(borrower, TOKEN_ID);
		expectAlmostEqualMantissa(await collateral.ownerOf(TOKEN_ID), borrower);
		await testAccountLiquidity(oneMantissa);
		//console.log(receiptMintCollateral.receipt.gasUsed + ' mintCollateral');
	});
	
	it('borrow token0 succeeds', async () => {
		const receiptBorrow0 = await borrowable0.borrow(TOKEN_ID, borrower, borrowAmount0, '0x', {from: borrower});
		expectAlmostEqualMantissa(await borrowable0.totalSupply(), lendAmount0);
		expectAlmostEqualMantissa(await borrowable0.totalBalance(), lendAmount0.sub(borrowAmount0));
		expectAlmostEqualMantissa(await borrowable0.borrowBalance(TOKEN_ID), expectedBorrowAmont0A);
		expectAlmostEqualMantissa(await token0.balanceOf(borrower), borrowAmount0);
		//console.log(receiptBorrow0.receipt.gasUsed + ' borrow0');
	});
	
	it('borrow token1 fails', async () => {
		await expectRevert(
			borrowable1.borrow(TOKEN_ID, borrower, lendAmount1, '0x', {from: borrower}), 
			"ImpermaxV3Borrowable: INSUFFICIENT_LIQUIDITY"
		);
	});
	
	it('borrow token1 succeeds', async () => {
		const receiptBorrow1 = await borrowable1.borrow(TOKEN_ID, borrower, borrowAmount1, '0x', {from: borrower});
		expectAlmostEqualMantissa(await borrowable1.totalSupply(), lendAmount1);
		expectAlmostEqualMantissa(await borrowable1.totalBalance(), lendAmount1.sub(borrowAmount1));
		expectAlmostEqualMantissa(await borrowable1.borrowBalance(TOKEN_ID), expectedBorrowAmont1A);
		expectAlmostEqualMantissa(await token1.balanceOf(borrower), borrowAmount1);
		//console.log(receiptBorrow1.receipt.gasUsed + ' borrow1');
	});
	
	it('check account liquidity', async () => {
		await testAccountLiquidity(expectedAccountLiquidityA.mul(oneMantissa).div(collateralAmount));
	});
	
	it('check borrow rate', async () => {
		expectAlmostEqualMantissa(await borrowable0.borrowRate(), expectedBorrowRate0A);
		expectAlmostEqualMantissa(await borrowable1.borrowRate(), expectedBorrowRate1A);
	});
	
	it('phase B: check borrow amount', async () => {
		await increaseTime(timeElapsed);
		const receiptSync = await borrowable0.sync();
		await borrowable1.sync();
		expectAlmostEqualMantissa(await borrowable0.borrowBalance(TOKEN_ID), expectedBorrowAmont0B);
		expectAlmostEqualMantissa(await borrowable1.borrowBalance(TOKEN_ID), expectedBorrowAmont1B);
		//console.log(receiptSync.receipt.gasUsed + ' sync');
	});
	
	it('check account liquidity', async () => {
		await testAccountLiquidity(expectedAccountLiquidityB.mul(oneMantissa).div(collateralAmount));
	});
	
	it('check borrow rate', async () => {
		expectAlmostEqualMantissa(await borrowable0.borrowRate(), expectedBorrowRate0B);
		expectAlmostEqualMantissa(await borrowable1.borrowRate(), expectedBorrowRate1B);
	});
	
	it('liquidation fail', async () => {
		await simpleUniswapOracle.setPrice(uniswapV2Pair.address, uq112(price0B / price1B));
		await testAccountLiquidity(expectedAccountLiquidityC.mul(oneMantissa).div(collateralAmount));
		await expectRevert(liquidatorContract0.liquidate(TOKEN_ID, 0), 'ImpermaxV3Collateral: INSUFFICIENT_SHORTFALL');
	});
	
	it('flash liquidate token0', async () => {
		await simpleUniswapOracle.setPrice(uniswapV2Pair.address, uq112(price0C / price1C));
		const currentBorrowAmount0 = (await borrowable0.borrowBalance(TOKEN_ID));
		await token0.mint(liquidatorContract0.address, currentBorrowAmount0);
		const seizeTokenId = await liquidatorContract0.liquidate.call(TOKEN_ID, currentBorrowAmount0);
		const receiptLiquidate = await liquidatorContract0.liquidate(TOKEN_ID, currentBorrowAmount0);
		const reserveSeizeTokenId = seizeTokenId * 1 + 1;
		expect(await borrowable0.borrowBalance(TOKEN_ID) / 1e18).to.lt(0.01);
		expectAlmostEqualMantissa(await tokenizedPosition.liquidity(seizeTokenId), liquidatedAmountLiquidator);
		expectAlmostEqualMantissa(await tokenizedPosition.liquidity(reserveSeizeTokenId), liquidatedAmountReserves);
		expectAlmostEqualMantissa(await tokenizedPosition.liquidity(TOKEN_ID), collateralAmount.sub(liquidatedAmount));
		expect(await tokenizedPosition.ownerOf(seizeTokenId)).to.eq(liquidatorContract0.address);
		expect(await collateral.ownerOf(reserveSeizeTokenId)).to.eq(reservesManager);
		expect(await tokenizedPosition.ownerOf(reserveSeizeTokenId)).to.eq(collateral.address);
		//console.log(receiptLiquidate.receipt.gasUsed + ' liquidate from liquidator contract');
	});
	
	it('redeem token0', async () => {
		const lenderTokens = await borrowable0.balanceOf(lender);
		await borrowable0.transfer(borrowable0.address, lenderTokens, {from: lender});
		const receiptRedeem = await borrowable0.redeem(lender);
		expectAlmostEqualMantissa(await token0.balanceOf(lender), lendAmount0.add(expectedLenderProfit0));
		const reservesManagerTokens = await borrowable0.balanceOf(reservesManager);
		const reservesManagerAmount = (await borrowable0.exchangeRate.call()).mul(reservesManagerTokens).div(oneMantissa);
		expectAlmostEqualMantissa(reservesManagerAmount, expectedProtocolProfit0);
		//console.log(receiptRedeem.receipt.gasUsed + ' redeem');
	});
	
	it('increaseTime, flash restructure and liquidate token1', async () => {
		// reduce collateral
		await collateral.redeem(borrower, TOKEN_ID, bnMantissa(0.2), {from: borrower});
		
		await simpleUniswapOracle.setPrice(uniswapV2Pair.address, uq112(price0D / price1D));				
		increaseTime(timeElapsed);
		await borrowable1.exchangeRate();
		increaseTime(timeElapsed);
		
		// TODO currentBorrowBalance
		const currentBorrowAmount0 = (await borrowable0.currentBorrowBalance.call(TOKEN_ID));
		const currentBorrowAmount1 = (await borrowable1.currentBorrowBalance.call(TOKEN_ID));
		const position = await tokenizedPosition.getPositionData.call(TOKEN_ID, oneMantissa);
		const collateralValues = position.realXYs.currentPrice;
		const expectedDecrease = (collateralValues.realX * price0D + collateralValues.realY * price1D) / (currentBorrowAmount0 * price0D + currentBorrowAmount1 * price1D) / 1.04;
		const decreaseAmount = (1 - expectedDecrease) * currentBorrowAmount1;
		//console.log(expectedDecrease);
		//console.log(decreaseAmount / 1e18);
		const exchangeRateBefore = await borrowable1.exchangeRate.call() / 1e18;
		
		const liquidateAmount = bnMantissa(currentBorrowAmount1 / 1e18 * expectedDecrease);
		await token1.mint(liquidatorContract1.address, liquidateAmount);
		const seizeTokenId = await liquidatorContract1.restructureAndLiquidate.call(TOKEN_ID, liquidateAmount);
		const receiptLiquidate = await liquidatorContract1.restructureAndLiquidate(TOKEN_ID, liquidateAmount);
		const reserveSeizeTokenId = seizeTokenId * 1 + 1;
		const exchangeRateAfter = await borrowable1.exchangeRate.call() / 1e18;
		//console.log(exchangeRateBefore, exchangeRateAfter, exchangeRateAfter / exchangeRateBefore)
		
		expect(await borrowable1.borrowBalance(TOKEN_ID) / 1e18).to.lt(0.01);
		expect(await tokenizedPosition.ownerOf(seizeTokenId)).to.eq(liquidatorContract1.address);
		expect(await collateral.ownerOf(reserveSeizeTokenId)).to.eq(reservesManager);
		expect(await tokenizedPosition.ownerOf(reserveSeizeTokenId)).to.eq(collateral.address);
	});
	
	it('redeem token1', async () => {
		const lenderTokens = await borrowable1.balanceOf(lender);
		await borrowable1.transfer(borrowable1.address, lenderTokens, {from: lender});
		const receiptRedeem = await borrowable1.redeem(lender);
		expectAlmostEqualMantissa(await token1.balanceOf(lender), lendAmount1.sub(expectedLenderLoss1));
		const reservesManagerTokens = await borrowable1.balanceOf(reservesManager);
		const reservesManagerAmount = (await borrowable1.exchangeRate.call()).mul(reservesManagerTokens).div(oneMantissa);
		expectAlmostEqualMantissa(reservesManagerAmount, expectedProtocolProfit1);
		//console.log(receiptRedeem.receipt.gasUsed + ' redeem');
	});
});