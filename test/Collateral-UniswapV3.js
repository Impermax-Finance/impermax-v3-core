const {
	Borrowable,
	Collateral,
	ImpermaxCallee,
	ReentrantCallee,
	Recipient,
	makeUniswapV3Factory,
	makeFactory,
	makeTokenizedUniswapV3Position,
} = require('./Utils/Impermax');
const {
	expectAlmostEqualMantissa,
	expectRevert,
	expectEvent,
	expectEqual,
	bnMantissa,
	uq112,
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

let TOKEN_ID;
const TEST_AMOUNT = oneMantissa.mul(new BN(200));
const MAX_UINT_256 = (new BN(2)).pow(new BN(256)).sub(new BN(1));

const FEE = 3000;
const ORACLE_T = 1800;

function slightlyIncrease(bn) {
	return bn.mul( bnMantissa(1.10001) ).div( oneMantissa );
}
function slightlyDecrease(bn) {
	return bn.mul( oneMantissa ).div( bnMantissa(1.10001) );
}

function X96(n) {
	return _2_96.mul(bnMantissa(n)).div(oneMantissa);
}
function sqrtX96(n) {
	return X96(Math.sqrt(n));
}

function getTickAtPrice(price) {
	const tick = Math.round(Math.log(price) / Math.log(1.0001));
	//console.log(price, tick);
	return tick;
}

function getVirtualX(liquidity, price) {
	return liquidity / Math.sqrt(price);
}
function getVirtualY(liquidity, price) {
	return liquidity * Math.sqrt(price);
}

function getRealXAndY(params) {
	const {liquidity, price, priceA, priceB} = params;
	if (priceA > price) {
		return [getVirtualX(liquidity, priceA) - getVirtualX(liquidity, priceB), 0];
	}
	if (priceB < price) {
		return [0, getVirtualY(liquidity, priceB) - getVirtualY(liquidity, priceA)];
	}
	return [
		getVirtualX(liquidity, price) - getVirtualX(liquidity, priceB),
		getVirtualY(liquidity, price) - getVirtualY(liquidity, priceA)
	]
}

function getLiquidityPostLiquidationAsY(params) {
	const {liquidationIncentive, liquidationFee, price, borrowAmountA, borrowAmountB} = params;
	const liquidationPenalty = liquidationIncentive + liquidationFee;
	const [realX, realY] = getRealXAndY(params);
	const collateralValueAsY = realX * price + realY;
	const debtValueAsY = borrowAmountA * price + borrowAmountB;
	const collateralNeededAsY = debtValueAsY * liquidationPenalty;
	return collateralValueAsY - collateralNeededAsY;
}

function getAvailableLiquidityAsY(params) {
	const {safetyMargin, liquidity, price, priceA, priceB, borrowAmountA, borrowAmountB} = params;
	const params2 = {...params};
	const prices = [price / safetyMargin, price * safetyMargin];
	let availableLiquidityAsY = 1e36;
	for (let price of prices) {
		params2.price = price;
		const tmp = getLiquidityPostLiquidationAsY(params2);
		availableLiquidityAsY = tmp < availableLiquidityAsY ? tmp : availableLiquidityAsY;
	}
	return availableLiquidityAsY;
}

function getMaxBorrowableXAndY(params) {
	const {liquidationIncentive, liquidationFee, safetyMargin, liquidity, price, priceA, priceB, borrowAmountA, borrowAmountB} = params;
	const liquidationPenalty = liquidationIncentive + liquidationFee;
	const params2 = {...params};
	const prices = [price / safetyMargin, price * safetyMargin];
	let maxBorrowables = [1e36, 1e36];
	for (let price of prices) {
		params2.price = price;
		const availableDebtValueAsY = getLiquidityPostLiquidationAsY(params2) / liquidationPenalty;
		const maxBorrowable0 = borrowAmountA + availableDebtValueAsY / price;
		const maxBorrowable1 = borrowAmountB + availableDebtValueAsY;
		maxBorrowables[0] = maxBorrowable0 < maxBorrowables[0] ? maxBorrowable0 : maxBorrowables[0];
		maxBorrowables[1] = maxBorrowable1 < maxBorrowables[1] ? maxBorrowable1 : maxBorrowables[1];
	}
	return maxBorrowables;
}

contract('Collateral-UniswapV3', function (accounts) {
	let root = accounts[0];
	let user = accounts[1];
	let admin = accounts[2];
	let borrower = accounts[3];
	let liquidator = accounts[4];
	let reservesAdmin = accounts[5];
	let reservesManager = accounts[6];
	let factory;
		
	before(async () => {
		factory = await makeFactory({admin, reservesAdmin});
		await factory._setReservesManager(reservesManager, {from: reservesAdmin});
	});
	
	[
		{safetyMargin: 2.50, liquidationIncentive: 1.01, liquidationFee: 0.08, liquidity: 100, price: 1, priceA: 0.25, priceB: 4, borrowAmountA: 20, borrowAmountB: 20},
		{safetyMargin: 2.50, liquidationIncentive: 1.01, liquidationFee: 0.08, liquidity: 100, price: 0.4, priceA: 0.25, priceB: 4, borrowAmountA: 20, borrowAmountB: 0},
		{safetyMargin: 2.50, liquidationIncentive: 1.01, liquidationFee: 0.08, liquidity: 100, price: 0.16, priceA: 0.25, priceB: 4, borrowAmountA: 20, borrowAmountB: 0},
		{safetyMargin: 2.50, liquidationIncentive: 1.01, liquidationFee: 0.08, liquidity: 100, price: 2, priceA: 0.25, priceB: 4, borrowAmountA: 20, borrowAmountB: 0},
		{safetyMargin: 2.50, liquidationIncentive: 1.01, liquidationFee: 0.08, liquidity: 100, price: 4.0004, priceA: 0.25, priceB: 4, borrowAmountA: 20, borrowAmountB: 0},
		{safetyMargin: 2.50, liquidationIncentive: 1.01, liquidationFee: 0.08, liquidity: 100, price: 10, priceA: 0.25, priceB: 3.99, borrowAmountA: 20, borrowAmountB: 0},
		{safetyMargin: 2.50, liquidationIncentive: 1.01, liquidationFee: 0.08, liquidity: 100, price: 1, priceA: 0.25, priceB: 4, borrowAmountA: 20, borrowAmountB: 40},
		{safetyMargin: 2.50, liquidationIncentive: 1.01, liquidationFee: 0.08, liquidity: 100, price: 1, priceA: 0.25, priceB: 4, borrowAmountA: 40, borrowAmountB: 30},
		{safetyMargin: 2.50, liquidationIncentive: 1.01, liquidationFee: 0.08, liquidity: 100, price: 1, priceA: 0.25, priceB: 4, borrowAmountA: 60, borrowAmountB: 40},
		{safetyMargin: 1.75, liquidationIncentive: 1.04, liquidationFee: 0.02, liquidity: 3000, price: 3334, priceA: 3000, priceB: 3500, borrowAmountA: 1.5, borrowAmountB: 2975.79},
		{safetyMargin: 1.75, liquidationIncentive: 1.04, liquidationFee: 0.02, liquidity: 200, price: 3334, priceA: 1000, priceB: 6000, borrowAmountA: 0.5, borrowAmountB: 2975.79},
		{safetyMargin: 1.75, liquidationIncentive: 1.04, liquidationFee: 0.02, liquidity: 10000, price: 3334, priceA: 3200, priceB: 3400, borrowAmountA: 0, borrowAmountB: 4100},
		{safetyMargin: 1.25, liquidationIncentive: 1.02, liquidationFee: 0, liquidity: 20, price: 0.168, priceA: 0.1, priceB: 0.22, borrowAmountA: 10, borrowAmountB: 1},
		{safetyMargin: 1.25, liquidationIncentive: 1.02, liquidationFee: 0, liquidity: 30, price: 0.168, priceA: 0.1, priceB: 0.22, borrowAmountA: 10, borrowAmountB: 1},
		{safetyMargin: 1.25, liquidationIncentive: 1.02, liquidationFee: 0, liquidity: 40, price: 0.11, priceA: 0.1, priceB: 0.22, borrowAmountA: 10, borrowAmountB: 1},
		{safetyMargin: 1.25, liquidationIncentive: 1.02, liquidationFee: 0, liquidity: 40, price: 0.18, priceA: 0.1, priceB: 0.22, borrowAmountA: 10, borrowAmountB: 1},
		{safetyMargin: 1.25, liquidationIncentive: 1.02, liquidationFee: 0, liquidity: 40, price: 0.3, priceA: 0.1, priceB: 0.22, borrowAmountA: 10, borrowAmountB: 1},
		{safetyMargin: 1.25, liquidationIncentive: 1.02, liquidationFee: 0, liquidity: 40, price: 0.05, priceA: 0.1, priceB: 0.22, borrowAmountA: 10, borrowAmountB: 1},
	].forEach((testCase) => {
		describe(`Collateral tests for ${JSON.stringify(testCase)}`, () => {
			let uniswapV3Pair;
			let tokenizedCLPosition;
			let collateral;
			let borrowable0;
			let borrowable1;
			let oracle;
			
			const {safetyMargin, liquidationIncentive, liquidationFee, liquidity, price, priceA, priceB, borrowAmountA, borrowAmountB} = testCase;
			const liquidationPenalty = liquidationIncentive + liquidationFee;
			const safetyMarginSqrtBN = bnMantissa(Math.sqrt(safetyMargin));
					
			const virtualX = getVirtualX(liquidity, price);
			const virtualY = getVirtualY(liquidity, price);
			const [realX, realY] = getRealXAndY(testCase);
			const [realXLowPrice, realYLowPrice] = getRealXAndY({liquidity, price: price / safetyMargin, priceA, priceB});
			const [realXHighPrice, realYHighPrice] = getRealXAndY({liquidity, price: price * safetyMargin, priceA, priceB});
			
			const tickA = getTickAtPrice(priceA);
			const tickB = getTickAtPrice(priceB);
			
			const concentrationFactor = 1 / (1 - 1 / Math.sqrt(Math.sqrt(priceB / priceA)));
			
			before(async () => {
				tokenizedCLPosition = await makeTokenizedUniswapV3Position();
				uniswapV3Pair = tokenizedCLPosition.obj.uniswapV3Pair;
				collateral = await Collateral.new();
				borrowable0 = await Borrowable.new();
				borrowable1 = await Borrowable.new();
				oracle = tokenizedCLPosition.obj.tokenizedUniswapV3Factory.obj.oracle;
				await borrowable0.setCollateralHarness(collateral.address);
				await borrowable1.setCollateralHarness(collateral.address);
				await collateral.setFactoryHarness(factory.address);				
				await collateral.setBorrowable0Harness(borrowable0.address);				
				await collateral.setBorrowable1Harness(borrowable1.address);
				await collateral.setUnderlyingHarness(tokenizedCLPosition.address);
				
				await collateral._setSafetyMarginSqrt(bnMantissa(Math.sqrt(safetyMargin)), {from: admin});
				await collateral._setLiquidationIncentive(bnMantissa(liquidationIncentive), {from: admin});
				await collateral._setLiquidationFee(bnMantissa(liquidationFee), {from: admin});				
				
				await oracle.setPrice(
					await tokenizedCLPosition.token0(), 
					await tokenizedCLPosition.token1(),
					sqrtX96(Math.pow(1.0001, getTickAtPrice(price)))
				);
				//await uniswapV3Pair.setTickCumulatives(0, getTickAtPrice(price) * ORACLE_T);
				//await uniswapV3Pair.setSecondsPerLiquidityCumulativeX128s(0, bnMantissa(1));
			});
			
			beforeEach(async () => {
				await uniswapV3Pair.setPosition(tokenizedCLPosition.address, tickA, tickB, bnMantissa(liquidity));
			});
			
			it(`mint and setBorrowBalance`, async () => {
				TOKEN_ID = await tokenizedCLPosition.mint.call(collateral.address, FEE, tickA, tickB);
				await tokenizedCLPosition.mint(collateral.address, FEE, tickA, tickB);
				await collateral.mint(borrower, TOKEN_ID)
				await borrowable0.setBorrowBalanceHarness(TOKEN_ID, bnMantissa(borrowAmountA));
				await borrowable1.setBorrowBalanceHarness(TOKEN_ID, bnMantissa(borrowAmountB));
			});
			
			it(`getPositionObject`, async () => {
				const positionObject = await collateral.getPositionObject.call(TOKEN_ID);
				/*console.log("lowestPrice.realX", positionObject.realXYs.lowestPrice.realX / 1e18, realXLowPrice);
				console.log("lowestPrice.realY", positionObject.realXYs.lowestPrice.realY / 1e18, realYLowPrice);
				console.log("currentPrice.realX", positionObject.realXYs.currentPrice.realX / 1e18, realX);
				console.log("currentPrice.realY", positionObject.realXYs.currentPrice.realY / 1e18, realY);
				console.log("highestPrice.realX", positionObject.realXYs.highestPrice.realX / 1e18, realXHighPrice);
				console.log("highestPrice.realY", positionObject.realXYs.highestPrice.realY / 1e18, realYHighPrice);
				console.log("debtX", positionObject.debtX / 1e18);
				console.log("debtY", positionObject.debtY / 1e18);
				console.log("safetyMarginSqrt", positionObject.safetyMarginSqrt / 1e18);
				console.log("liquidationPenalty", positionObject.liquidationPenalty / 1e18);
				console.log("price", positionObject.priceSqrtX96 * 1);*/
				expectAlmostEqualMantissa(positionObject.priceSqrtX96, sqrtX96(price));
				expectAlmostEqualMantissa(positionObject.realXYs.lowestPrice.realX, bnMantissa(realXLowPrice));
				expectAlmostEqualMantissa(positionObject.realXYs.lowestPrice.realY, bnMantissa(realYLowPrice));
				expectAlmostEqualMantissa(positionObject.realXYs.currentPrice.realX, bnMantissa(realX));
				expectAlmostEqualMantissa(positionObject.realXYs.currentPrice.realY, bnMantissa(realY));
				expectAlmostEqualMantissa(positionObject.realXYs.highestPrice.realX, bnMantissa(realXHighPrice));
				expectAlmostEqualMantissa(positionObject.realXYs.highestPrice.realY, bnMantissa(realYHighPrice));
				expectAlmostEqualMantissa(positionObject.debtX, bnMantissa(borrowAmountA));
				expectAlmostEqualMantissa(positionObject.debtY, bnMantissa(borrowAmountB));
				expectAlmostEqualMantissa(positionObject.liquidationPenalty, bnMantissa(liquidationPenalty));
				expectAlmostEqualMantissa(positionObject.safetyMarginSqrt, safetyMarginSqrtBN);
			});
			
			it(`getCollateralValue`, async () => {
				const collateralValueAsY = realX * price + realY;
				const collateralValue = await collateral.getCollateralValue.call(TOKEN_ID);
				const valueY = await collateral.getValue.call(TOKEN_ID, 0, oneMantissa);
				expectAlmostEqualMantissa(bnMantissa(valueY / 1e18 * collateralValueAsY), collateralValue);
			});
			
			it(`getDebtValue`, async () => {
				// alternative approach to check the math is ok
				const collateralValue = await collateral.getCollateralValue.call(TOKEN_ID) / 1e18;
				const debtValue = await collateral.getDebtValue.call(TOKEN_ID) / 1e18;
				const collateralValueAsY = realX * price + realY;
				const debtValueAsY = borrowAmountA * price + borrowAmountB;
				expectAlmostEqualMantissa(
					bnMantissa(debtValueAsY / collateralValueAsY), 
					bnMantissa(debtValue / collateralValue)
				);
			});
			
			it(`getLiquidityPostLiquidation`, async () => {
				const collateralValue = await collateral.getCollateralValue.call(TOKEN_ID) / 1e18;
				const debtValue = await collateral.getDebtValue.call(TOKEN_ID) / 1e18;
				const collateralNeeded = debtValue * liquidationPenalty;
				expectAlmostEqualMantissa(bnMantissa(collateralValue - collateralNeeded), await collateral.getLiquidityPostLiquidation.call(TOKEN_ID));
			});
			
			it(`getPostLiquidationCollateralRatio`, async () => {
				const collateralValue = await collateral.getCollateralValue.call(TOKEN_ID) / 1e18;
				const debtValue = await collateral.getDebtValue.call(TOKEN_ID) / 1e18;
				const collateralNeeded = debtValue * liquidationPenalty;
				expectAlmostEqualMantissa(bnMantissa(collateralValue / collateralNeeded), await collateral.getPostLiquidationCollateralRatio.call(TOKEN_ID));
			});
			
			it(`isLiquidatable`, async () => {
				const availableLiquidityAsY = getAvailableLiquidityAsY(testCase);
				const isLiquidatable = availableLiquidityAsY < 0;
				console.log(isLiquidatable)
				expect(isLiquidatable).to.eq(await collateral.isLiquidatable.call(TOKEN_ID));
			});
			
			it(`redeeming 0.01% fails if isLiquidatable`, async () => {
				const availableLiquidityAsY = getAvailableLiquidityAsY(testCase);
				const isLiquidatable = availableLiquidityAsY < 0;
				if (!isLiquidatable) {
					await collateral.redeem.call(borrower, TOKEN_ID, bnMantissa(0.01 / 100), {from: borrower});
				} else {
					await expectRevert(
						collateral.redeem.call(borrower, TOKEN_ID, bnMantissa(0.01 / 100), {from: borrower}),
						"ImpermaxV3Collateral: INSUFFICIENT_LIQUIDITY"
					);
				}
			});
			
			it(`isUnderwater`, async () => {
				const liquidityPostLiquidationAsY = getLiquidityPostLiquidationAsY(testCase);
				const isUnderwater = liquidityPostLiquidationAsY < 0;
				console.log(isUnderwater)
				expect(isUnderwater).to.eq(await collateral.isUnderwater.call(TOKEN_ID));
			});

			it(`canBorrow`, async () => {
				const availableLiquidityAsY = getAvailableLiquidityAsY(testCase);
				const [maxBorrowable0, maxBorrowable1] = getMaxBorrowableXAndY(testCase);
				
				//const initTest = await collateral.canBorrowTest.call(TOKEN_ID, borrowable0.address, bnMantissa(borrowAmountA));
				//const test1 = await collateral.canBorrowTest.call(TOKEN_ID, borrowable0.address, bnMantissa(maxBorrowable0));
				//const test2 = await collateral.canBorrowTest.call(TOKEN_ID, borrowable1.address, bnMantissa(maxBorrowable1));
				//console.log("initTest", initTest.liquidity1 / 1e18, initTest.liquidity2 / 1e18);
				//console.log("test1", test1.liquidity1 / 1e18, test1.liquidity2 / 1e18);
				//console.log("test2", test2.liquidity1 / 1e18, test2.liquidity2 / 1e18);
								
				const r = availableLiquidityAsY > 0;
				expect(await collateral.canBorrow.call(TOKEN_ID, borrowable0.address, bnMantissa(borrowAmountA))).to.eq(r);
				expect(await collateral.canBorrow.call(TOKEN_ID, borrowable1.address, bnMantissa(borrowAmountB))).to.eq(r);
				if (maxBorrowable0 < 0) {
					expect(await collateral.canBorrow.call(TOKEN_ID, borrowable0.address, "0")).to.eq(false);
				} else if (maxBorrowable0 == 0) {
					expect(await collateral.canBorrow.call(TOKEN_ID, borrowable0.address, "0")).to.eq(true);
				} else {
					const succeedAmount = slightlyDecrease( bnMantissa(maxBorrowable0) );
					const failAmount = slightlyIncrease( bnMantissa(maxBorrowable0) );
					expect(await collateral.canBorrow.call(TOKEN_ID, borrowable0.address, succeedAmount)).to.eq(true);
					expect(await collateral.canBorrow.call(TOKEN_ID, borrowable0.address, failAmount)).to.eq(false);
				}
				if (maxBorrowable1 < 0) {
					expect(await collateral.canBorrow.call(TOKEN_ID, borrowable1.address, "0")).to.eq(false);
				} else if (maxBorrowable1 == 0) {
					expect(await collateral.canBorrow.call(TOKEN_ID, borrowable1.address, "0")).to.eq(true);
				} else {
					const succeedAmount = slightlyDecrease( bnMantissa(maxBorrowable1) );
					const failAmount = slightlyIncrease( bnMantissa(maxBorrowable1) );
					expect(await collateral.canBorrow.call(TOKEN_ID, borrowable1.address, succeedAmount)).to.eq(true);
					expect(await collateral.canBorrow.call(TOKEN_ID, borrowable1.address, failAmount)).to.eq(false);
				}
			});
			
			it(`restructureBadDebt if underwater`, async () => {
				if (await collateral.isUnderwater.call(TOKEN_ID)) {
					console.log("restructureBadDebt");
					const receipt = await collateral.restructureBadDebt(TOKEN_ID);					
					expect(false).to.eq(await collateral.isUnderwater.call(TOKEN_ID));
					expectEvent(receipt, "RestructureBadDebt", {tokenId: TOKEN_ID});
				} else {
					await expectRevert(
						collateral.restructureBadDebt(TOKEN_ID),
						"ImpermaxV3Collateral: NOT_UNDERWATER"
					);
				}
			});
			
			it(`seize if is liquidatable`, async () => {
				await expectRevert(
					collateral.seize(TOKEN_ID, 0, address(0), "0x"),
					"ImpermaxV3Collateral: UNAUTHORIZED"
				);
				if (await collateral.isLiquidatable.call(TOKEN_ID)) {
					console.log("liquidate");
					
					let currentRealX = realX;
					let currentRealY = realY;
					
					const repayAmount1 = await borrowable0.borrowBalance.call(TOKEN_ID);
					if (repayAmount1 * 1 > 0) {
						const collateralValueAsY = currentRealX * price + currentRealY;
						let repayValueAsY = repayAmount1 * price / 1e18;
						
						const expectedSeizeRealX = currentRealX * repayValueAsY / collateralValueAsY * liquidationIncentive;
						const expectedFeeRealX = currentRealX * repayValueAsY / collateralValueAsY * liquidationFee;
						const expectedRealX = currentRealX - expectedFeeRealX - expectedSeizeRealX;
						
						const seizeTokenId = await borrowable0.restructureBadDebtAndSeizeCollateral.call(TOKEN_ID, repayAmount1, liquidator, "0x");	
						const feeTokenId = seizeTokenId * 1 + 1;
						
						const receipt = await borrowable0.restructureBadDebtAndSeizeCollateral(TOKEN_ID, repayAmount1, liquidator, "0x");
						
						const seizeRealX = (await tokenizedCLPosition.getPositionData.call(seizeTokenId, safetyMarginSqrtBN)).realXYs.currentPrice.realX;
						const feeRealX = expectedFeeRealX == 0 ? 0 : (await tokenizedCLPosition.getPositionData.call(feeTokenId, safetyMarginSqrtBN)).realXYs.currentPrice.realX;
						const realXAfter = (await tokenizedCLPosition.getPositionData.call(TOKEN_ID, safetyMarginSqrtBN)).realXYs.currentPrice.realX;
						
						expect(await tokenizedCLPosition.ownerOf(seizeTokenId)).to.eq(liquidator);
						if (expectedFeeRealX > 0) {
							expect(await tokenizedCLPosition.ownerOf(feeTokenId)).to.eq(collateral.address);
							expect(await collateral.ownerOf(feeTokenId)).to.eq(reservesManager);
						}
						
						expectAlmostEqualMantissa(seizeRealX, bnMantissa(expectedSeizeRealX));
						expectAlmostEqualMantissa(feeRealX, bnMantissa(expectedFeeRealX));
						expectAlmostEqualMantissa(realXAfter, bnMantissa(expectedRealX));
						
						currentRealY *= expectedRealX / currentRealX;
						currentRealX = expectedRealX;
					}

					const repayAmount2 = await borrowable1.borrowBalance.call(TOKEN_ID);	
					if (repayAmount2 * 1 > 0 && await collateral.isLiquidatable.call(TOKEN_ID)) {
						const collateralValueAsY = currentRealX * price + currentRealY;
						let repayValueAsY = repayAmount2 / 1e18;
						
						const expectedSeizeRealX = currentRealX * repayValueAsY / collateralValueAsY * liquidationIncentive;
						const expectedFeeRealX = currentRealX * repayValueAsY / collateralValueAsY * liquidationFee;
						const expectedRealX = currentRealX - expectedFeeRealX - expectedSeizeRealX;
									
						const seizeTokenId = await borrowable1.restructureBadDebtAndSeizeCollateral.call(TOKEN_ID, repayAmount2, liquidator, "0x");	
						const feeTokenId = seizeTokenId * 1 + 1;
						
						const receipt = await borrowable1.restructureBadDebtAndSeizeCollateral(TOKEN_ID, repayAmount2, liquidator, "0x");
						const seizeRealX = (await tokenizedCLPosition.getPositionData.call(seizeTokenId, safetyMarginSqrtBN)).realXYs.currentPrice.realX;
						const feeRealX = expectedFeeRealX == 0 ? 0 : (await tokenizedCLPosition.getPositionData.call(feeTokenId, safetyMarginSqrtBN)).realXYs.currentPrice.realX;
						const realXAfter = (await tokenizedCLPosition.getPositionData.call(TOKEN_ID, safetyMarginSqrtBN)).realXYs.currentPrice.realX;
						
						expect(await tokenizedCLPosition.ownerOf(seizeTokenId)).to.eq(liquidator);
						if (expectedFeeRealX > 0) {
							expect(await tokenizedCLPosition.ownerOf(feeTokenId)).to.eq(collateral.address);
							expect(await collateral.ownerOf(feeTokenId)).to.eq(reservesManager);
						}
						
						expectAlmostEqualMantissa(seizeRealX, bnMantissa(expectedSeizeRealX));
						expectAlmostEqualMantissa(feeRealX, bnMantissa(expectedFeeRealX));
						expectAlmostEqualMantissa(realXAfter, bnMantissa(expectedRealX > 0 ? expectedRealX : 0));
					}
				} else {
					await expectRevert(
						borrowable0.restructureBadDebtAndSeizeCollateral(TOKEN_ID, 0, address(0), "0x"),
						"ImpermaxV3Collateral: INSUFFICIENT_SHORTFALL"
					);
				}
			});
		});
	});

});