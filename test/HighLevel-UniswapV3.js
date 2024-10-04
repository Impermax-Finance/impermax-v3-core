const {
	Borrowable,
	Collateral,
	makeTokenizedUniswapV3Position,
} = require('./Utils/Impermax');
const {
	expectAlmostEqualMantissa,
	expectRevert,
	expectEvent,
	expectEqual,
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
const _2_128 = (new BN(2)).pow(new BN(128));
const ZERO = new BN(0);

let TOKEN_ID;
let USER_B_TOKEN_ID;
const MAX_UINT_256 = (new BN(2)).pow(new BN(256)).sub(new BN(1));

const FEE = 3000;
const ORACLE_T = 1800;

function X96(n) {
	return _2_96.mul(bnMantissa(n)).div(oneMantissa);
}
function X128(n) {
	return _2_128.mul(bnMantissa(n)).div(oneMantissa);
}
function sqrtX96(n) {
	return X96(Math.sqrt(n));
}

function getTickAtPrice(price) {
	const tick = Math.round(Math.log(price) / Math.log(1.0001));
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

const price = 4;
const marketPrice = 3;
const priceA = 1;
const priceB = 10;
const liquidity = 100;
const liquidityAdd = 150;
const liquidityRemove = 110;
const liquidityUserB = 250;
const totalGained0A = 1;
const totalGained1A = 10;
const totalGained0B = 2;
const totalGained1B = 15;
const totalGained0C = 3;
const totalGained1C = 35;

contract('Highlevel-UniswapV3', function (accounts) {
	let root = accounts[0];
	let user = accounts[1];
	let admin = accounts[2];
	let router = accounts[3];
	let userB = accounts[4];

	let uniswapV3Pair;
	let tokenizedCLPosition;
	let collateral;
	let borrowable0;
	let borrowable1;
	let token0;
	let token1;
	let currentLiquidity = liquidity;
	let feeGrowthLast0 = 0;
	let feeGrowthLast1 = 0;
	let removePercentage;
	
	const tickA = getTickAtPrice(priceA);
	const tickB = getTickAtPrice(priceB);
	
	before(async () => {
		tokenizedCLPosition = await makeTokenizedUniswapV3Position();
		uniswapV3Pair = tokenizedCLPosition.obj.uniswapV3Pair;
		collateral = await Collateral.new();
		borrowable0 = await Borrowable.new();
		borrowable1 = await Borrowable.new();
		await borrowable0.setCollateralHarness(collateral.address);
		await borrowable1.setCollateralHarness(collateral.address);
		await collateral.setBorrowable0Harness(borrowable0.address);				
		await collateral.setBorrowable1Harness(borrowable1.address);
		await collateral.setUnderlyingHarness(tokenizedCLPosition.address);
				
		token0 = uniswapV3Pair.obj.token0;		
		token1 = uniswapV3Pair.obj.token1;		
		
		await uniswapV3Pair.setTickCumulatives(0, getTickAtPrice(price) * ORACLE_T);
		await uniswapV3Pair.setSecondsPerLiquidityCumulativeX128s(0, bnMantissa(1));
		await uniswapV3Pair.setMarketPrice(sqrtX96(marketPrice));
		
		await token0.setBalanceHarness(uniswapV3Pair.address, bnMantissa(1000000));
		await token1.setBalanceHarness(uniswapV3Pair.address, bnMantissa(1000000));
	});
	
	it(`mint`, async () => {
		await uniswapV3Pair.setPosition(tokenizedCLPosition.address, tickA, tickB, bnMantissa(currentLiquidity), {from: router});
		TOKEN_ID = await tokenizedCLPosition.mint.call(collateral.address, FEE, tickA, tickB);
		await expectRevert(
			collateral.mint(user, TOKEN_ID,  {from: router}),
			"ImpermaxV3Collateral: NFT_NOT_RECEIVED"
		);
		await tokenizedCLPosition.mint(collateral.address, FEE, tickA, tickB, {from: router});
		await collateral.mint(user, TOKEN_ID,  {from: router});
		await expectRevert(
			collateral.mint(user, TOKEN_ID,  {from: router}),
			"ImpermaxV3Collateral: NFT_ALREADY_MINTED"
		);
	});
	
	it(`check fees 1`, async () => {
		feeGrowthLast0 = totalGained0A / currentLiquidity;
		feeGrowthLast1 = totalGained1A / currentLiquidity;
		await uniswapV3Pair.setPositionFeeGrowth(tickA, tickB, X128(feeGrowthLast0), X128(feeGrowthLast1));
		const positionObject = await collateral.getPositionObject.call(TOKEN_ID);
		await collateral.getPositionObject(TOKEN_ID);
		const [realX, realY] = getRealXAndY({price, priceA, priceB, liquidity: currentLiquidity});
		//console.log("currentPrice.realX", positionObject.realXYs.currentPrice.realX / 1e18);
		//console.log("currentPrice.realY", positionObject.realXYs.currentPrice.realY / 1e18);
		expectAlmostEqualMantissa(positionObject.realXYs.currentPrice.realX, bnMantissa(realX + totalGained0A));
		expectAlmostEqualMantissa(positionObject.realXYs.currentPrice.realY, bnMantissa(realY + totalGained1A));
	});
	
	it(`mint and join`, async () => {
		currentLiquidity += liquidityAdd;
		await uniswapV3Pair.setPosition(tokenizedCLPosition.address, tickA, tickB, bnMantissa(currentLiquidity), {from: router});
		const tokenToJoinId = await tokenizedCLPosition.mint.call(router, FEE, tickA, tickB);
		await tokenizedCLPosition.mint(router, FEE, tickA, tickB, {from: router});
		await tokenizedCLPosition.join(TOKEN_ID, tokenToJoinId, {from: router});
		const positionNFTLP = await tokenizedCLPosition.positions(TOKEN_ID);
		expectAlmostEqualMantissa(positionNFTLP.liquidity, bnMantissa(currentLiquidity));
	});
	
	it(`check fees 2`, async () => {
		feeGrowthLast0 += (totalGained0B - totalGained0A) / currentLiquidity;
		feeGrowthLast1 += (totalGained1B - totalGained1A) / currentLiquidity;
		await uniswapV3Pair.setPositionFeeGrowth(tickA, tickB, X128(feeGrowthLast0), X128(feeGrowthLast1));
		const positionObject = await collateral.getPositionObject.call(TOKEN_ID);
		//console.log("ORacle price", positionObject.priceSqrtX96 / 2**96);
		//await collateral.getPositionObject(TOKEN_ID);
		const [realX, realY] = getRealXAndY({price, priceA, priceB, liquidity: currentLiquidity});
		//console.log("currentPrice.realX", positionObject.realXYs.currentPrice.realX / 1e18);
		//console.log("currentPrice.realY", positionObject.realXYs.currentPrice.realY / 1e18);
		expectAlmostEqualMantissa(positionObject.realXYs.currentPrice.realX, bnMantissa(realX + totalGained0B));
		expectAlmostEqualMantissa(positionObject.realXYs.currentPrice.realY, bnMantissa(realY + totalGained1B));
	});
	
	it(`split and redeem`, async () => {
		removePercentage = liquidityRemove / currentLiquidity;
		currentLiquidity -= liquidityRemove;
		await collateral.approve(router, TOKEN_ID, {from: user});
		const redeemTokenId = await collateral.redeem.call(router, TOKEN_ID, bnMantissa(removePercentage), {from: router});
		await collateral.redeem(router, TOKEN_ID, bnMantissa(removePercentage), {from: router});
		const {amount0, amount1} = await tokenizedCLPosition.redeem.call(user, redeemTokenId, {from: router});
		await tokenizedCLPosition.redeem(user, redeemTokenId, {from: router});
		
		const positionNFTLP = await tokenizedCLPosition.positions(TOKEN_ID);
		const positionUnderlying = await uniswapV3Pair.getPosition(tokenizedCLPosition.address, tickA, tickB);
		const [realX, realY] = getRealXAndY({price: marketPrice, priceA, priceB, liquidity: liquidityRemove});
		
		//console.log("expected realX", realX);
		//console.log("expected realY", realY);
		//console.log("expected gain", totalGained0B * removePercentage);
		//console.log("expected gain", totalGained1B * removePercentage);
		//console.log("expected total X", realX + totalGained0B * removePercentage);
		//console.log("expected total Y", realY + totalGained1B * removePercentage);
		//console.log("actual total X", amount0 / 1e18);
		//console.log("actual total Y", amount1 / 1e18);
		
		expectAlmostEqualMantissa(amount0, bnMantissa(realX + totalGained0B * removePercentage));
		expectAlmostEqualMantissa(amount1, bnMantissa(realY + totalGained1B * removePercentage));
		expectAlmostEqualMantissa(positionNFTLP.liquidity, bnMantissa(currentLiquidity));
		expectAlmostEqualMantissa(positionUnderlying.liquidity, bnMantissa(currentLiquidity));
		expectAlmostEqualMantissa(await token0.balanceOf(user), amount0);
		expectAlmostEqualMantissa(await token1.balanceOf(user), amount1);
	});
	
	it(`mint 2nd user`, async () => {
		await uniswapV3Pair.setPosition(tokenizedCLPosition.address, tickA, tickB, bnMantissa(currentLiquidity + liquidityUserB), {from: router});
		USER_B_TOKEN_ID = await tokenizedCLPosition.mint.call(collateral.address, FEE, tickA, tickB);
		await tokenizedCLPosition.mint(collateral.address, FEE, tickA, tickB, {from: router});
		await collateral.mint(userB, USER_B_TOKEN_ID, {from: router});
		
		const positionNFTLP = await tokenizedCLPosition.positions(TOKEN_ID);
		const positionUnderlying = await uniswapV3Pair.getPosition(tokenizedCLPosition.address, tickA, tickB);
		expectAlmostEqualMantissa(positionNFTLP.liquidity, bnMantissa(currentLiquidity));
		expectAlmostEqualMantissa(positionUnderlying.liquidity, bnMantissa(currentLiquidity + liquidityUserB));
		expectAlmostEqualMantissa(await collateral.ownerOf(TOKEN_ID), user);
		expectAlmostEqualMantissa(await collateral.ownerOf(USER_B_TOKEN_ID), userB);
	});
	
	it(`check fees 3`, async () => {
		feeGrowthLast0 += (totalGained0C - totalGained0B) / currentLiquidity;
		feeGrowthLast1 += (totalGained1C - totalGained1B) / currentLiquidity;
		await uniswapV3Pair.setPositionFeeGrowth(tickA, tickB, X128(feeGrowthLast0), X128(feeGrowthLast1));
		const positionObject = await collateral.getPositionObject.call(TOKEN_ID);
		await collateral.getPositionObject(TOKEN_ID);
		const [realX, realY] = getRealXAndY({price, priceA, priceB, liquidity: currentLiquidity});
		//console.log("currentPrice.realX", positionObject.realXYs.currentPrice.realX / 1e18);
		//console.log("currentPrice.realY", positionObject.realXYs.currentPrice.realY / 1e18);
		expectAlmostEqualMantissa(
			positionObject.realXYs.currentPrice.realX, 
			bnMantissa(realX + totalGained0C - totalGained0B * removePercentage)
		);
		expectAlmostEqualMantissa(
			positionObject.realXYs.currentPrice.realY, 
			bnMantissa(realY + totalGained1C - totalGained1B * removePercentage)
		);
	});
	
	it(`redeem everything`, async () => {
		const balanceBefore0 = await token0.balanceOf(user);
		const balanceBefore1 = await token1.balanceOf(user);
		await expectRevert(
			collateral.redeem.call(router, TOKEN_ID, oneMantissa, {from: router}),
			"ImpermaxERC721: UNAUTHORIZED"
		);
		await collateral.approve(router, TOKEN_ID, {from: user});
		const redeemTokenId = await collateral.redeem.call(router, TOKEN_ID, oneMantissa, {from: router});
		await collateral.redeem(router, TOKEN_ID, oneMantissa, {from: router});
		const {amount0, amount1} = await tokenizedCLPosition.redeem.call(user, redeemTokenId, {from: router});
		await tokenizedCLPosition.redeem(user, redeemTokenId, {from: router});
		
		const positionNFTLP = await tokenizedCLPosition.positions(TOKEN_ID);
		const positionUnderlying = await uniswapV3Pair.getPosition(tokenizedCLPosition.address, tickA, tickB);
		const [realX, realY] = getRealXAndY({price: marketPrice, priceA, priceB, liquidity: currentLiquidity});
		
		//console.log("expected realX", realX);
		//console.log("expected realY", realY);
		//console.log("expected gain", totalGained0B * removePercentage);
		//console.log("expected gain", totalGained1B * removePercentage);
		//console.log("expected total X", realX + totalGained0B * removePercentage);
		//console.log("expected total Y", realY + totalGained1B * removePercentage);
		
		expectAlmostEqualMantissa(amount0, bnMantissa(realX + totalGained0C - totalGained0B * removePercentage));
		expectAlmostEqualMantissa(amount1, bnMantissa(realY + totalGained1C - totalGained1B * removePercentage));
		expect(positionNFTLP.liquidity * 1).to.eq(0);
		expectAlmostEqualMantissa(positionUnderlying.liquidity, bnMantissa(liquidityUserB));
		expectAlmostEqualMantissa((await token0.balanceOf(user)).sub(balanceBefore0), amount0);
		expectAlmostEqualMantissa((await token1.balanceOf(user)).sub(balanceBefore1), amount1);
	});

});