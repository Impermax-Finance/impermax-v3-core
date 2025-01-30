const {
	Borrowable,
	Collateral,
	ImpermaxCallee,
	ReentrantCallee,
	Recipient,
	makeFactory,
	makeTokenizedCLPosition,
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
	mineBlock,
	blockNumber,
} = require('./Utils/Ethereum');
const { keccak256, toUtf8Bytes } = require('ethers/utils');

const oneMantissa = (new BN(10)).pow(new BN(18));
const _2_96 = (new BN(2)).pow(new BN(96));
const ZERO = new BN(0);

const TOKEN_ID = new BN(1000);
const TEST_AMOUNT = oneMantissa.mul(new BN(200));
const MAX_UINT_256 = (new BN(2)).pow(new BN(256)).sub(new BN(1));

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

function getLiquidityPostLiquidationAsY(params) {
	const {liquidationIncentive, liquidationFee, price, realX, realY, borrowAmountA, borrowAmountB} = params;
	const liquidationPenalty = liquidationIncentive + liquidationFee;
	const collateralValueAsY = realX * price + realY;
	const debtValueAsY = borrowAmountA * price + borrowAmountB;
	const collateralNeededAsY = debtValueAsY * liquidationPenalty;
	return collateralValueAsY - collateralNeededAsY;
}

function getAvailableLiquidityAsY(paramsLowPrice, paramsHighPrice) {
	const {borrowAmountA, borrowAmountB} = paramsLowPrice;
	const scenarios = [paramsLowPrice, paramsHighPrice];
	let availableLiquidityAsY = 1e36;
	for (let params of scenarios) {
		const tmp = getLiquidityPostLiquidationAsY(params);
		availableLiquidityAsY = tmp < availableLiquidityAsY ? tmp : availableLiquidityAsY;
	}
	return availableLiquidityAsY;
}

function getMaxBorrowableXAndY(params, paramsLowPrice, paramsHighPrice) {
	const {liquidationIncentive, liquidationFee, price, borrowAmountA, borrowAmountB} = params;
	const liquidationPenalty = liquidationIncentive + liquidationFee;
	const scenarios = [paramsLowPrice, paramsHighPrice];
	let maxBorrowables = [1e36, 1e36];
	for (let params of scenarios) {
		const availableDebtValueAsY = getLiquidityPostLiquidationAsY(params) / liquidationPenalty;
		const maxBorrowable0 = borrowAmountA + availableDebtValueAsY / params.price;
		const maxBorrowable1 = borrowAmountB + availableDebtValueAsY;
		maxBorrowables[0] = maxBorrowable0 < maxBorrowables[0] ? maxBorrowable0 : maxBorrowables[0];
		maxBorrowables[1] = maxBorrowable1 < maxBorrowables[1] ? maxBorrowable1 : maxBorrowables[1];
	}
	return maxBorrowables;
}

contract('Collateral', function (accounts) {
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
		{safetyMargin: 2.50, liquidationIncentive: 1.01, liquidationFee: 0.08, liquidity: 100, price: 1, borrowAmountA: 20, borrowAmountB: 20},
		{safetyMargin: 2.50, liquidationIncentive: 1.01, liquidationFee: 0.08, liquidity: 100, price: 0.4, borrowAmountA: 20, borrowAmountB: 0},
		{safetyMargin: 2.50, liquidationIncentive: 1.01, liquidationFee: 0.08, liquidity: 100, price: 0.16, borrowAmountA: 20, borrowAmountB: 0},
		{safetyMargin: 2.50, liquidationIncentive: 1.01, liquidationFee: 0.08, liquidity: 100, price: 2, borrowAmountA: 20, borrowAmountB: 0},
		{safetyMargin: 2.50, liquidationIncentive: 1.01, liquidationFee: 0.08, liquidity: 100, price: 4, borrowAmountA: 20, borrowAmountB: 0},
		{safetyMargin: 2.50, liquidationIncentive: 1.01, liquidationFee: 0.08, liquidity: 100, price: 10, borrowAmountA: 20, borrowAmountB: 0},
		{safetyMargin: 2.50, liquidationIncentive: 1.01, liquidationFee: 0.08, liquidity: 100, price: 1, borrowAmountA: 20, borrowAmountB: 40},
		{safetyMargin: 2.50, liquidationIncentive: 1.01, liquidationFee: 0.08, liquidity: 100, price: 1, borrowAmountA: 40, borrowAmountB: 30},
		{safetyMargin: 2.50, liquidationIncentive: 1.01, liquidationFee: 0.08, liquidity: 100, price: 1, borrowAmountA: 60, borrowAmountB: 40},
		{safetyMargin: 1.75, liquidationIncentive: 1.04, liquidationFee: 0.02, liquidity: 120, price: 3334, borrowAmountA: 1.5, borrowAmountB: 2975.79},
		{safetyMargin: 1.75, liquidationIncentive: 1.04, liquidationFee: 0.02, liquidity: 120, price: 3334, borrowAmountA: 0.5, borrowAmountB: 2975.79},
		{safetyMargin: 1.75, liquidationIncentive: 1.04, liquidationFee: 0.02, liquidity: 60, price: 3334, borrowAmountA: 0, borrowAmountB: 4100},
		{safetyMargin: 1.25, liquidationIncentive: 1.02, liquidationFee: 0, liquidity: 5, price: 0.168, borrowAmountA: 10, borrowAmountB: 1},
		{safetyMargin: 1.25, liquidationIncentive: 1.02, liquidationFee: 0, liquidity: 7, price: 0.168, borrowAmountA: 10, borrowAmountB: 1},
		{safetyMargin: 1.25, liquidationIncentive: 1.02, liquidationFee: 0, liquidity: 7, price: 0.11, borrowAmountA: 10, borrowAmountB: 1},
		{safetyMargin: 1.25, liquidationIncentive: 1.02, liquidationFee: 0, liquidity: 7, price: 0.18, borrowAmountA: 10, borrowAmountB: 1},
		{safetyMargin: 1.25, liquidationIncentive: 1.02, liquidationFee: 0, liquidity: 7, price: 0.3, borrowAmountA: 10, borrowAmountB: 1},
		{safetyMargin: 1.25, liquidationIncentive: 1.02, liquidationFee: 0, liquidity: 7, price: 0.05, borrowAmountA: 10, borrowAmountB: 1},
	].forEach((testCase) => {
		describe(`Collateral tests for ${JSON.stringify(testCase)}`, () => {
			let tokenizedCLPosition;
			let collateral;
			let borrowable0;
			let borrowable1;
			
			const {safetyMargin, liquidationIncentive, liquidationFee, liquidity, price, borrowAmountA, borrowAmountB} = testCase;
			const liquidationPenalty = liquidationIncentive + liquidationFee;
					
			const realXBN = bnMantissa(liquidity / 2).mul(_2_96).div(sqrtX96(price));
			const realYBN = bnMantissa(liquidity / 2).mul(sqrtX96(price)).div(_2_96);
			const realXLowPriceBN = realXBN.mul(sqrtX96(safetyMargin)).div(_2_96);
			const realYLowPriceBN = realYBN.mul(_2_96).div(sqrtX96(safetyMargin));
			const realXHighPriceBN = realXBN.mul(_2_96).div(sqrtX96(safetyMargin));
			const realYHighPriceBN = realYBN.mul(sqrtX96(safetyMargin)).div(_2_96);
			const realX = realXBN / 1e18;
			const realY = realYBN / 1e18;
			const realXLowPrice = realXLowPriceBN / 1e18;
			const realYLowPrice = realYLowPriceBN / 1e18;
			const realXHighPrice = realXHighPriceBN / 1e18;
			const realYHighPrice = realYHighPriceBN / 1e18;
			
			testCase.realX = realX;
			testCase.realY = realY;
			const testCaseLowPrice = {...testCase};
			const testCaseHighPrice = {...testCase};
			testCaseLowPrice.price = price / safetyMargin; 
			testCaseLowPrice.realX = realXLowPrice; 
			testCaseLowPrice.realY = realYLowPrice; 
			testCaseHighPrice.price = price * safetyMargin; 
			testCaseHighPrice.realX = realXHighPrice; 
			testCaseHighPrice.realY = realYHighPrice;
						
			before(async () => {
				tokenizedCLPosition = await makeTokenizedCLPosition();
				collateral = await Collateral.new();
				borrowable0 = await Borrowable.new();
				borrowable1 = await Borrowable.new();
				await borrowable0.setCollateralHarness(collateral.address);
				await borrowable1.setCollateralHarness(collateral.address);
				await collateral.setFactoryHarness(factory.address);				
				await collateral.setBorrowable0Harness(borrowable0.address);				
				await collateral.setBorrowable1Harness(borrowable1.address);
				await collateral.setUnderlyingHarness(tokenizedCLPosition.address);
				
				await collateral._setSafetyMarginSqrt(bnMantissa(Math.sqrt(safetyMargin)), {from: admin});
				await collateral._setLiquidationIncentive(bnMantissa(liquidationIncentive), {from: admin});
				await collateral._setLiquidationFee(bnMantissa(liquidationFee), {from: admin});
				await tokenizedCLPosition.setPriceSqrtX96Harness(sqrtX96(price));
			});
			
			beforeEach(async () => {
				// k = x*y behaviour
				await tokenizedCLPosition.setPositionHarness(
					TOKEN_ID, 
					realXLowPriceBN,
					realYLowPriceBN,
					realXBN,
					realYBN,
					realXHighPriceBN,
					realYHighPriceBN
				);
				await tokenizedCLPosition.setOwnerHarness(collateral.address, TOKEN_ID);
				await collateral.setOwnerHarness(borrower, TOKEN_ID);
				await borrowable0.setBorrowBalanceHarness(TOKEN_ID, bnMantissa(borrowAmountA));
				await borrowable1.setBorrowBalanceHarness(TOKEN_ID, bnMantissa(borrowAmountB));
			});
			
			it(`getPositionObject`, async () => {
				const positionObject = await collateral.getPositionObject.call(TOKEN_ID);
				expectAlmostEqualMantissa(positionObject.priceSqrtX96, sqrtX96(price));
				expectAlmostEqualMantissa(positionObject.realXYs.lowestPrice.realX, realXLowPriceBN);
				expectAlmostEqualMantissa(positionObject.realXYs.lowestPrice.realY, realYLowPriceBN);
				expectAlmostEqualMantissa(positionObject.realXYs.currentPrice.realX, realXBN);
				expectAlmostEqualMantissa(positionObject.realXYs.currentPrice.realY, realYBN);
				expectAlmostEqualMantissa(positionObject.realXYs.highestPrice.realX, realXHighPriceBN);
				expectAlmostEqualMantissa(positionObject.realXYs.highestPrice.realY, realYHighPriceBN);
				expectAlmostEqualMantissa(positionObject.debtX, bnMantissa(borrowAmountA));
				expectAlmostEqualMantissa(positionObject.debtY, bnMantissa(borrowAmountB));
				expectAlmostEqualMantissa(positionObject.liquidationPenalty, bnMantissa(liquidationPenalty));
				expectAlmostEqualMantissa(positionObject.safetyMarginSqrt, bnMantissa(Math.sqrt(safetyMargin)));
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
				expectAlmostEqualMantissa(
					bnMantissa((collateralValue - collateralNeeded) / 1e12), 
					(await collateral.getLiquidityPostLiquidation.call(TOKEN_ID)).div(new BN(1e12))
				);
			});
			
			it(`getPostLiquidationCollateralRatio`, async () => {
				const collateralValue = await collateral.getCollateralValue.call(TOKEN_ID) / 1e18;
				const debtValue = await collateral.getDebtValue.call(TOKEN_ID) / 1e18;
				const collateralNeeded = debtValue * liquidationPenalty;
				expectAlmostEqualMantissa(bnMantissa(collateralValue / collateralNeeded), await collateral.getPostLiquidationCollateralRatio.call(TOKEN_ID));
			});
			
			it(`isLiquidatable`, async () => {				
				const availableLiquidityAsY = getAvailableLiquidityAsY(testCaseLowPrice, testCaseHighPrice);
				const isLiquidatable = availableLiquidityAsY < 0;
				console.log(isLiquidatable)
				expect(isLiquidatable).to.eq(await collateral.isLiquidatable.call(TOKEN_ID));
			});
			
			it(`redeeming 0.01% fails if isLiquidatable`, async () => {
				const availableLiquidityAsY = getAvailableLiquidityAsY(testCaseLowPrice, testCaseHighPrice);
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
				const availableLiquidityAsY = getAvailableLiquidityAsY(testCaseLowPrice, testCaseHighPrice);
				const [maxBorrowable0, maxBorrowable1] = getMaxBorrowableXAndY(testCase, testCaseLowPrice, testCaseHighPrice);
				
				//const initTest = await collateral.canBorrowTest.call(TOKEN_ID, borrowable0.address, bnMantissa(borrowAmountA));
				//const test1 = await collateral.canBorrowTest.call(TOKEN_ID, borrowable0.address, bnMantissa(maxBorrowable0));
				//const test2 = await collateral.canBorrowTest.call(TOKEN_ID, borrowable1.address, bnMantissa(maxBorrowable1));
				//console.log("maxBorrowable", maxBorrowable0, maxBorrowable1);
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
					let restructured = false;
					
					const repayAmount1 = await borrowable0.borrowBalance.call(TOKEN_ID);
					if (repayAmount1 * 1 > 0) {
						const collateralValueAsY = currentRealX * price + currentRealY;
						const debtValueAsY = borrowAmountA * price + borrowAmountB;
						let repayValueAsY = repayAmount1 * price / 1e18;
						if (collateralValueAsY < debtValueAsY * liquidationPenalty) {
							repayValueAsY *= collateralValueAsY / (debtValueAsY * liquidationPenalty);
						}
						
						const expectedSeizeRealX = currentRealX * repayValueAsY / collateralValueAsY * liquidationIncentive;
						const expectedFeeRealX = currentRealX * repayValueAsY / collateralValueAsY * liquidationFee;
						const expectedRealX = currentRealX - expectedFeeRealX - expectedSeizeRealX;
						
						const seizeTokenId = await borrowable0.restructureBadDebtAndSeizeCollateral.call(TOKEN_ID, repayAmount1, liquidator, "0x");	
						const feeTokenId = seizeTokenId * 1 + 1;
						
						const receipt = await borrowable0.restructureBadDebtAndSeizeCollateral(TOKEN_ID, repayAmount1, liquidator, "0x");
						const seizeRealX = (await tokenizedCLPosition.getPositionData.call(seizeTokenId, 0)).realXYs.currentPrice.realX;
						const feeRealX = (await tokenizedCLPosition.getPositionData.call(feeTokenId, 0)).realXYs.currentPrice.realX;
						const realXAfter = (await tokenizedCLPosition.getPositionData.call(TOKEN_ID, 0)).realXYs.currentPrice.realX;
						
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
						restructured = true;
					}

					const repayAmount2 = await borrowable1.borrowBalance.call(TOKEN_ID);	
					if (repayAmount2 * 1 > 0 && await collateral.isLiquidatable.call(TOKEN_ID)) {
						const collateralValueAsY = currentRealX * price + currentRealY;
						let repayValueAsY = repayAmount2 / 1e18;
						if (!restructured) {
							const debtValueAsY = borrowAmountB;
							if (collateralValueAsY < debtValueAsY * liquidationPenalty) {
								repayValueAsY *= collateralValueAsY / (debtValueAsY * liquidationPenalty);
							}
						}
						
						const expectedSeizeRealX = currentRealX * repayValueAsY / collateralValueAsY * liquidationIncentive;
						const expectedFeeRealX = currentRealX * repayValueAsY / collateralValueAsY * liquidationFee;
						const expectedRealX = currentRealX - expectedFeeRealX - expectedSeizeRealX;
									
						const seizeTokenId = await borrowable1.restructureBadDebtAndSeizeCollateral.call(TOKEN_ID, repayAmount2, liquidator, "0x");	
						const feeTokenId = seizeTokenId * 1 + 1;
						
						const receipt = await borrowable1.restructureBadDebtAndSeizeCollateral(TOKEN_ID, repayAmount2, liquidator, "0x");
						const seizeRealX = (await tokenizedCLPosition.getPositionData.call(seizeTokenId, 0)).realXYs.currentPrice.realX;
						const feeRealX = (await tokenizedCLPosition.getPositionData.call(feeTokenId, 0)).realXYs.currentPrice.realX;
						const realXAfter = (await tokenizedCLPosition.getPositionData.call(TOKEN_ID, 0)).realXYs.currentPrice.realX;
						
						expect(await tokenizedCLPosition.ownerOf(seizeTokenId)).to.eq(liquidator);
						if (expectedFeeRealX > 0) {
							expect(await tokenizedCLPosition.ownerOf(feeTokenId)).to.eq(collateral.address);
							expect(await collateral.ownerOf(feeTokenId)).to.eq(reservesManager);
						}
						
						expectAlmostEqualMantissa(seizeRealX, bnMantissa(expectedSeizeRealX));
						expectAlmostEqualMantissa(feeRealX, bnMantissa(expectedFeeRealX));
						expectAlmostEqualMantissa(realXAfter, bnMantissa(expectedRealX));
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

	describe(`restructureBadDebt unliquidatable edge scenario`, () => {
		let tokenizedCLPosition;
		let collateral;
		let borrowable0;
		let borrowable1;
		
		const liquidationIncentive = 1.02;
		const liquidationFee = 0.02;
		const liquidationPenalty = liquidationIncentive + liquidationFee;
				
		const realXBN = bnMantissa(0);
		const realYBN = bnMantissa(100);
		const borrowAmount0BN = bnMantissa(0);
		const borrowAmount1BN = bnMantissa(200);
		const liquidateAmount = bnMantissa(50);
					
		beforeEach(async () => {
			tokenizedCLPosition = await makeTokenizedCLPosition();
			collateral = await Collateral.new();
			borrowable0 = await Borrowable.new();
			borrowable1 = await Borrowable.new();
			await borrowable0.setCollateralHarness(collateral.address);
			await borrowable1.setCollateralHarness(collateral.address);
			await collateral.setFactoryHarness(factory.address);				
			await collateral.setBorrowable0Harness(borrowable0.address);				
			await collateral.setBorrowable1Harness(borrowable1.address);
			await collateral.setUnderlyingHarness(tokenizedCLPosition.address);
			
			await collateral._setLiquidationIncentive(bnMantissa(liquidationIncentive), {from: admin});
			await collateral._setLiquidationFee(bnMantissa(liquidationFee), {from: admin});
			await tokenizedCLPosition.setPriceSqrtX96Harness(sqrtX96(1));
			
			await tokenizedCLPosition.setPositionHarness(TOKEN_ID, realXBN, realYBN, realXBN, realYBN, realXBN, realYBN);
			await tokenizedCLPosition.setOwnerHarness(collateral.address, TOKEN_ID);
			await collateral.setOwnerHarness(borrower, TOKEN_ID);
			await borrowable0.setBorrowBalanceHarness(TOKEN_ID, ZERO);
			await borrowable1.setBorrowBalanceHarness(TOKEN_ID, borrowAmount1BN);
		});
		
		it(`isLiquidatable() is false after restructureBadDebt`, async () => {
			expect(await collateral.isLiquidatable.call(TOKEN_ID)).to.eq(true);
			expect(await collateral.isUnderwater.call(TOKEN_ID)).to.eq(true);
			await collateral.restructureBadDebt(TOKEN_ID);
			expect(await collateral.isLiquidatable.call(TOKEN_ID)).to.eq(false);
			expect(await collateral.isUnderwater.call(TOKEN_ID)).to.eq(false);
		});
		
		it(`liquidate will revert if it's not done in the same block as restructureBadDebt`, async () => {
			await expectRevert(borrowable1.seizeCollateral(TOKEN_ID, liquidateAmount, liquidator, "0x"), "ImpermaxV3Collateral: CANNOT_LIQUIDATE_UNDERWATER_POSITION");
			await collateral.restructureBadDebt(TOKEN_ID);
			await expectRevert(borrowable1.seizeCollateral(TOKEN_ID, liquidateAmount, liquidator, "0x"), "ImpermaxV3Collateral: INSUFFICIENT_SHORTFALL");
		});
		
		it(`liquidate will succeed if done in the same tx as restructureBadDebt`, async () => {
			await expectRevert(borrowable1.seizeCollateral(TOKEN_ID, liquidateAmount, liquidator, "0x"), "ImpermaxV3Collateral: CANNOT_LIQUIDATE_UNDERWATER_POSITION");
			await borrowable1.restructureBadDebtAndSeizeCollateral(TOKEN_ID, liquidateAmount, liquidator, "0x");
		});
	});
	

	describe(`liquidate both sides in the same block`, () => {
		let tokenizedCLPosition;
		let collateral;
		let borrowable0;
		let borrowable1;
		
		const liquidationIncentive = 1.02;
		const liquidationFee = 0.02;
		const liquidationPenalty = liquidationIncentive + liquidationFee;
		const safetyMargin = 2;
		
		const realXBN = bnMantissa(100);
		const realYBN = bnMantissa(100);
		const realXLowPriceBN = realXBN.mul(sqrtX96(safetyMargin)).div(_2_96);
		const realYLowPriceBN = realYBN.mul(_2_96).div(sqrtX96(safetyMargin));
		const realXHighPriceBN = realXBN.mul(_2_96).div(sqrtX96(safetyMargin));
		const realYHighPriceBN = realYBN.mul(sqrtX96(safetyMargin)).div(_2_96);
		const borrowAmount0BN = bnMantissa(150);
		const borrowAmount1BN = bnMantissa(10);
					
		beforeEach(async () => {
			tokenizedCLPosition = await makeTokenizedCLPosition();
			collateral = await Collateral.new();
			borrowable0 = await Borrowable.new();
			borrowable1 = await Borrowable.new();
			await borrowable0.setCollateralHarness(collateral.address);
			await borrowable1.setCollateralHarness(collateral.address);
			await collateral.setFactoryHarness(factory.address);				
			await collateral.setBorrowable0Harness(borrowable0.address);				
			await collateral.setBorrowable1Harness(borrowable1.address);
			await collateral.setUnderlyingHarness(tokenizedCLPosition.address);
			
			await collateral._setLiquidationIncentive(bnMantissa(liquidationIncentive), {from: admin});
			await collateral._setLiquidationFee(bnMantissa(liquidationFee), {from: admin});
			await collateral._setSafetyMarginSqrt(bnMantissa(Math.sqrt(safetyMargin)), {from: admin});
			await tokenizedCLPosition.setPriceSqrtX96Harness(sqrtX96(1));
			
			await tokenizedCLPosition.setPositionHarness(
				TOKEN_ID, 
				realXLowPriceBN,
				realYLowPriceBN,
				realXBN,
				realYBN,
				realXHighPriceBN,
				realYHighPriceBN
			);
			await tokenizedCLPosition.setOwnerHarness(collateral.address, TOKEN_ID);
			await collateral.setOwnerHarness(borrower, TOKEN_ID);
			await borrowable0.setBorrowBalanceHarness(TOKEN_ID, borrowAmount0BN);
			await borrowable1.setBorrowBalanceHarness(TOKEN_ID, borrowAmount1BN);
		});
		
		it(`second liquidation reverts if the position is healthty after the first liquidation`, async () => {
			expect(await collateral.isLiquidatable.call(TOKEN_ID)).to.eq(true);
			expect(await collateral.isUnderwater.call(TOKEN_ID)).to.eq(false);
			await borrowable0.seizeCollateral(TOKEN_ID, borrowAmount0BN, liquidator, "0x");
			expect(await collateral.isLiquidatable.call(TOKEN_ID)).to.eq(false);
			expect(await collateral.isUnderwater.call(TOKEN_ID)).to.eq(false);
			await expectRevert(borrowable1.seizeCollateral(TOKEN_ID, borrowAmount1BN, liquidator, "0x"), "ImpermaxV3Collateral: INSUFFICIENT_SHORTFALL");
		});
		
		it(`both sides can be liquidated if the 2 liquidations are done in the same tx`, async () => {
			await collateral.seizeThroughBothBorrowables(TOKEN_ID, borrowAmount0BN, borrowAmount1BN, liquidator);
		});
	});
	
	
	describe('mint and redeem', () => {
		let tokenizedCLPosition;
		let collateral;
		let borrowable0;
		let borrowable1;
		const safetyMargin = 2.5;
		const liquidationIncentive = 1.02;
		const liquidationFee = 0.02;
		const liquidationPenalty = liquidationIncentive + liquidationFee;
		const price = 1;
		
		before(async () => {
			tokenizedCLPosition = await makeTokenizedCLPosition();
			collateral = await Collateral.new();
			borrowable0 = await Borrowable.new();
			borrowable1 = await Borrowable.new();
			await collateral.setFactoryHarness(factory.address);
			await collateral.setBorrowable0Harness(borrowable0.address);				
			await collateral.setBorrowable1Harness(borrowable1.address);
			await collateral.setUnderlyingHarness(tokenizedCLPosition.address);
			
			await collateral._setSafetyMarginSqrt(bnMantissa(Math.sqrt(safetyMargin)), {from: admin});
			await collateral._setLiquidationIncentive(bnMantissa(liquidationIncentive), {from: admin});
			await collateral._setLiquidationFee(bnMantissa(liquidationFee), {from: admin});				
			await tokenizedCLPosition.setPriceSqrtX96Harness(sqrtX96(price));
			
			await tokenizedCLPosition.setOwnerHarness(user, TOKEN_ID);		
			await tokenizedCLPosition.setPositionHarness(
				TOKEN_ID, 
				bnMantissa(100),
				bnMantissa(100),
				bnMantissa(100),
				bnMantissa(100),
				bnMantissa(100),
				bnMantissa(100)
			);
		});
		
		it(`mint fail if nft is not received`, async () => {
			await expectRevert(collateral.mint(user, TOKEN_ID), "ImpermaxV3Collateral: NFT_NOT_RECEIVED");
		});
		
		it(`mint nft`, async () => {
			await tokenizedCLPosition.transferFrom(user, collateral.address, TOKEN_ID, {from:user});
			await collateral.mint(user, TOKEN_ID);
		});
		
		it(`mint fail if nft is already minted`, async () => {
			await expectRevert(collateral.mint(root, TOKEN_ID), "ImpermaxV3Collateral: NFT_ALREADY_MINTED");
		});
		
		it(`transfer position`, async () => {
			await collateral.transferFrom(user, borrower, TOKEN_ID, {from:user});
			expect(await collateral.ownerOf(TOKEN_ID)).to.eq(borrower);
		});
		
		it(`redeem fail if unauthorized`, async () => {
			await expectRevert(collateral.redeem(user, TOKEN_ID, oneMantissa, {from: user}), "ImpermaxERC721: UNAUTHORIZED");
		});
		
		it(`redeem fail if > 100%`, async () => {
			await expectRevert(collateral.redeem(user, TOKEN_ID, oneMantissa.add(new BN(1)), {from: borrower}), "ImpermaxV3Collateral: PERCENTAGE_ABOVE_100");
		});
		
		it(`redeem fail if liquidatable 0`, async () => {
			await borrowable0.setBorrowBalanceHarness(TOKEN_ID, new BN(1));
			await expectRevert(collateral.redeem(user, TOKEN_ID, oneMantissa, {from: borrower}), "ImpermaxV3Collateral: INSUFFICIENT_LIQUIDITY");
		});
		
		it(`redeem fail if liquidatable 1`, async () => {
			await borrowable0.setBorrowBalanceHarness(TOKEN_ID, new BN(0));
			await borrowable1.setBorrowBalanceHarness(TOKEN_ID, new BN(1));
			await expectRevert(collateral.redeem(user, TOKEN_ID, oneMantissa, {from: borrower}), "ImpermaxV3Collateral: INSUFFICIENT_LIQUIDITY");
		});
		
		it(`redeem 100%`, async () => {
			await borrowable1.setBorrowBalanceHarness(TOKEN_ID, new BN(0));
			await collateral.redeem(user, TOKEN_ID, oneMantissa, {from: borrower});
			expect(await tokenizedCLPosition.ownerOf(TOKEN_ID)).to.eq(user);
		});
		
		it(`redeem 60% fails`, async () => {
			await tokenizedCLPosition.transferFrom(user, collateral.address, TOKEN_ID, {from:user});
			await collateral.mint(user, TOKEN_ID);
			await borrowable1.setBorrowBalanceHarness(TOKEN_ID, bnMantissa(60));
			await expectRevert(collateral.redeem(user, TOKEN_ID, bnMantissa(0.6), {from: user}), "ImpermaxV3Collateral: INSUFFICIENT_LIQUIDITY");
		});
		
		it(`redeem 50% succeeds`, async () => {
			await collateral.redeem(user, TOKEN_ID, bnMantissa(0.5), {from: user});
		});
	});
		
	describe('reentrancy', () => {
		let collateral;
		let tokenizedCLPosition;
		let receiver;
		before(async () => {
			collateral = await Collateral.new();
			receiver = (await ReentrantCallee.new()).address;				
			tokenizedCLPosition = await makeTokenizedCLPosition();
			await collateral.setUnderlyingHarness(tokenizedCLPosition.address);
			await tokenizedCLPosition.setOwnerHarness(collateral.address, TOKEN_ID);
		});
		
		it(`borrow reentrancy`, async () => {
			await expectRevert(collateral.testReentrancy(receiver, TOKEN_ID, encode(['uint'], [0])), 'TEST');
			await expectRevert(collateral.testReentrancy(receiver, TOKEN_ID, encode(['uint'], [1])), 'ImpermaxV3Collateral: REENTERED');
			await expectRevert(collateral.testReentrancy(receiver, TOKEN_ID, encode(['uint'], [2])), 'ImpermaxV3Collateral: REENTERED');
			await expectRevert(collateral.testReentrancy(receiver, TOKEN_ID, encode(['uint'], [3])), 'ImpermaxV3Collateral: REENTERED');
			await expectRevert(collateral.testReentrancy(receiver, TOKEN_ID, encode(['uint'], [4])), 'ImpermaxV3Collateral: REENTERED');
		});
	});
});