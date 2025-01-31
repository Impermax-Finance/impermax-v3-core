const {
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

const UniswapV3OracleChainlink = artifacts.require('UniswapV3OracleChainlink');
const ERC20 = artifacts.require('MockERC20');
const Aggregator = artifacts.require('MockAggregator');

const oneMantissa = (new BN(10)).pow(new BN(18));
const _2_96 = (new BN(2)).pow(new BN(96));
const _2_128 = (new BN(2)).pow(new BN(128));
const ZERO = new BN(0);

function X96(n) {
	return _2_96.mul(bnMantissa(n)).div(oneMantissa);
}
function X128(n) {
	return _2_128.mul(bnMantissa(n)).div(oneMantissa);
}
function sqrtX96(n) {
	return X96(Math.sqrt(n));
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

contract('Oracle-UniswapV3Chainlink', function (accounts) {
	let root = accounts[0];
	let user = accounts[1];
	let admin = accounts[2];
	let router = accounts[3];
	let userB = accounts[4];

	describe('admin', () => {
		let oracle;
		beforeEach(async () => {
			oracle = await UniswapV3OracleChainlink.new(admin);
		});
		it("change admin", async () => {
			await expectRevert(oracle._setPendingAdmin(root, {from: root}), "UniswapV3OracleChainlink: UNAUTHORIZED");
			await expectRevert(oracle._setPendingAdmin(root, {from: user}), "UniswapV3OracleChainlink: UNAUTHORIZED");
			await expectRevert(oracle._acceptAdmin({from: root}), "UniswapV3OracleChainlink: UNAUTHORIZED");
			expectEvent(await oracle._setPendingAdmin(root, {from: admin}), "NewPendingAdmin", {
				'oldPendingAdmin': address(0),
				'newPendingAdmin': root,
			});
			expect(await oracle.admin()).to.eq(admin);
			expect(await oracle.pendingAdmin()).to.eq(root);
			receipt = await oracle._acceptAdmin({from: root});
			expectEvent(receipt, "NewAdmin", {
				'oldAdmin': admin,
				'newAdmin': root,
			});
			expectEvent(receipt, "NewPendingAdmin", {
				'oldPendingAdmin': root,
				'newPendingAdmin': address(0),
			});
			expect(await oracle.admin()).to.eq(root);
			expect(await oracle.pendingAdmin()).to.eq(address(0));
		});
		it("change fallback oracle", async () => {
			const fallbackOracle = address(1);
			expect(await oracle.fallbackOracle()).to.eq(address(0));
			await expectRevert(oracle._setFallbackOracle(fallbackOracle, {from: root}), "UniswapV3OracleChainlink: UNAUTHORIZED");
			expectEvent(await oracle._setFallbackOracle(fallbackOracle, {from: admin}), "NewFallbackOracle", {
				'oldFallbackOracle': address(0),
				'newFallbackOracle': fallbackOracle,
			});
			expect(await oracle.fallbackOracle()).to.eq(fallbackOracle);
			await oracle._setFallbackOracle(root, {from: admin});
			expect(await oracle.fallbackOracle()).to.eq(root);
		});
		it("change verifyTokenSource", async () => {
			expect(await oracle.verifyTokenSource()).to.eq(true);
			await expectRevert(oracle._setVerifyTokenSource(false, {from: root}), "UniswapV3OracleChainlink: UNAUTHORIZED");
			expectEvent(await oracle._setVerifyTokenSource(false, {from: admin}), "SetVerifyTokenSource", {
				'enable': false,
			});
			expect(await oracle.verifyTokenSource()).to.eq(false);
			await oracle._setVerifyTokenSource(true, {from: admin});
			expect(await oracle.verifyTokenSource()).to.eq(true);
		});
		it("add token sources", async () => {
			await oracle._setVerifyTokenSource(false, {from: admin});
			const tokens = [address(1), address(2), address(3), address(4), address(5)];
			const sources = [address(11), address(12), address(13), address(14), address(15)];
			const addTokens1 = [tokens[0], tokens[1], tokens[2]];
			const addSources1 = [sources[0], sources[1], sources[2]];
			const addTokens2 = [tokens[2]];
			const addSources2 = [sources[2]];
			const addTokens3 = [tokens[3]];
			const addSources3 = [sources[2], sources[3]];
			const addTokens4 = [tokens[3], tokens[4]];
			const addSources4 = [sources[3], sources[4]];
			
			await expectRevert(oracle._addTokenSources(addTokens1, addSources1, {from: root}), "UniswapV3OracleChainlink: UNAUTHORIZED");
			await oracle._addTokenSources(addTokens1, addSources1, {from: admin});
			await expectRevert(oracle._addTokenSources(addTokens2, addSources2, {from: admin}), "UniswapV3OracleChainlink: TOKEN_INITIALIZED");
			await expectRevert(oracle._addTokenSources(addTokens3, addSources3, {from: admin}), "UniswapV3OracleChainlink: INCONSISTENT_PARAMS_LENGTH");
			await oracle._addTokenSources(addTokens4, addSources4, {from: admin});
			
			expect((await oracle.tokenSources(tokens[0])).toLowerCase()).to.eq(sources[0].toLowerCase());
			expect((await oracle.tokenSources(tokens[1])).toLowerCase()).to.eq(sources[1].toLowerCase());
			expect((await oracle.tokenSources(tokens[2])).toLowerCase()).to.eq(sources[2].toLowerCase());
			expect((await oracle.tokenSources(tokens[3])).toLowerCase()).to.eq(sources[3].toLowerCase());
			expect((await oracle.tokenSources(tokens[4])).toLowerCase()).to.eq(sources[4].toLowerCase());
		});
		it("test verifyTokenSource", async () => {
			token = await ERC20.new("", "XYZ");
			source = await Aggregator.new();
			
			await token.setDecimals(18);
			await source.setDecimals(8);
			await source.setDescription("XYZ / USD");
			await source.setLatestAnswer(oneMantissa);
			
			// Verification passes
			await oracle._addTokenSources.call([token.address], [source.address], {from: admin});
			
			// Price out of range
			await source.setLatestAnswer(100);
			await expectRevert(oracle._addTokenSources.call([token.address], [source.address], {from: admin}), "UniswapV3OracleChainlink: PRICE_OUT_OF_RANGE");
			await source.setLatestAnswer(X128(1));
			await expectRevert(oracle._addTokenSources.call([token.address], [source.address], {from: admin}), "UniswapV3OracleChainlink: PRICE_OUT_OF_RANGE");
			await source.setLatestAnswer("101");
			await oracle._addTokenSources.call([token.address], [source.address], {from: admin});
			await source.setLatestAnswer(X96(1));
			await oracle._addTokenSources.call([token.address], [source.address], {from: admin});
			
			// Decimals out of range
			await token.setDecimals(4);
			await source.setDecimals(3);
			await expectRevert(oracle._addTokenSources.call([token.address], [source.address], {from: admin}), "UniswapV3OracleChainlink: DECIMALS_OUT_OF_RANGE");
			await token.setDecimals(18);
			await source.setDecimals(31);
			await expectRevert(oracle._addTokenSources.call([token.address], [source.address], {from: admin}), "UniswapV3OracleChainlink: DECIMALS_OUT_OF_RANGE");
			await source.setDecimals(30);
			await oracle._addTokenSources.call([token.address], [source.address], {from: admin});
			await token.setDecimals(4);
			await source.setDecimals(4);
			await oracle._addTokenSources.call([token.address], [source.address], {from: admin});
			
			// Inconsistent description
			await source.setDescription("XYZ / EUR");
			await expectRevert(oracle._addTokenSources.call([token.address], [source.address], {from: admin}), "UniswapV3OracleChainlink: INCONSISTENT_DESCRIPTION");
			await source.setDescription("ETH / USD");
			await expectRevert(oracle._addTokenSources.call([token.address], [source.address], {from: admin}), "UniswapV3OracleChainlink: INCONSISTENT_DESCRIPTION");
		});
	});
	
	describe('workflow', () => {
		let oracle;
		let fallbackOracle;
		
		let unsupportedToken;
		
		let token0;
		let token0Source;
		
		let token1;
		let token1Source;
		
		let token2;
		let token2BadSource;
		let token2GoodSource;
		
		const PRICE_0 = 1;
		const PRICE_1 = 4;
		const PRICE_2 = 17;
		
		before(async () => {
			// oracles
			oracle = 			await UniswapV3OracleChainlink.new(admin);
			fallbackOracle = 	await UniswapV3OracleChainlink.new(admin);
			await oracle._setVerifyTokenSource(false, {from: admin});
			await fallbackOracle._setVerifyTokenSource(false, {from: admin});
			
			// tokens
			unsupportedToken =	await ERC20.new("", "");
			token0 =			await ERC20.new("", "");
			token1 =			await ERC20.new("", "");
			token2 =			await ERC20.new("", "");
			
			// sources
			token0Source =		await Aggregator.new();
			token1Source =		await Aggregator.new();
			token2BadSource =	await Aggregator.new();
			token2GoodSource =	await Aggregator.new();
			
			// set prices
			await token0Source.setLatestAnswer(PRICE_0.toString());
			await token1Source.setLatestAnswer(PRICE_1.toString());
			await token2GoodSource.setLatestAnswer(PRICE_2.toString());
			
			await oracle._addTokenSources([
				token0.address,
				token1.address,
				token2.address,
			], [
				token0Source.address,
				token1Source.address,
				token2BadSource.address,
			], {from: admin});
			
			await fallbackOracle._addTokenSources([
				token0.address,
				token2.address,
				unsupportedToken.address, 
			], [
				token0Source.address,
				token2GoodSource.address,
				address(1), // this will never get called
			], {from: admin});
		});
		
		it("succeed if pair is supported", async () => {
			const priceSqrtX96A = await oracle.oraclePriceSqrtX96.call(token0.address, token1.address);
			const priceSqrtX96B = await oracle.oraclePriceSqrtX96.call(token1.address, token0.address);
			expectAlmostEqualMantissa(priceSqrtX96A, sqrtX96(PRICE_0 / PRICE_1));
			expectAlmostEqualMantissa(priceSqrtX96B, sqrtX96(PRICE_1 / PRICE_0));
		});
		
		it("revert if bad price and no fallback", async () => {
			await expectRevert(
				oracle.oraclePriceSqrtX96.call(token0.address, token2.address), 
				"UniswapV3OracleChainlink: PRICE_CALCULATION_ERROR"
			);
			await expectRevert(
				oracle.oraclePriceSqrtX96.call(token2.address, token0.address), 
				"UniswapV3OracleChainlink: PRICE_CALCULATION_ERROR"
			);
		});
		
		it("succeed with fallback", async () => {
			await oracle._setFallbackOracle(fallbackOracle.address, {from: admin});
			const priceSqrtX96A = await oracle.oraclePriceSqrtX96.call(token0.address, token2.address);
			const priceSqrtX96B = await oracle.oraclePriceSqrtX96.call(token2.address, token0.address);
			expectAlmostEqualMantissa(priceSqrtX96A, sqrtX96(PRICE_0 / PRICE_2));
			expectAlmostEqualMantissa(priceSqrtX96B, sqrtX96(PRICE_2 / PRICE_0));
		});
		
		it("revert if bad price and usupported by fallback", async () => {
			await expectRevert(
				oracle.oraclePriceSqrtX96.call(token1.address, token2.address), 
				"UniswapV3OracleChainlink: UNSUPPORTED_PAIR"
			);
			await expectRevert(
				oracle.oraclePriceSqrtX96.call(token2.address, token1.address), 
				"UniswapV3OracleChainlink: UNSUPPORTED_PAIR"
			);
		});
		
		it("revert if pair is unsupported", async () => {
			await expectRevert(
				oracle.oraclePriceSqrtX96.call(unsupportedToken.address, token0.address), 
				"UniswapV3OracleChainlink: UNSUPPORTED_PAIR"
			);
			await expectRevert(
				oracle.oraclePriceSqrtX96.call(token0.address, unsupportedToken.address), 
				"UniswapV3OracleChainlink: UNSUPPORTED_PAIR"
			);
		});
	});
	
	describe('math', () => {
		[
			/***
			 * Params:
			 * usd price of token0
			 * usd price of token1
			 * decimals of token0
			 * decimals of token1
			 * decimals of source0
			 * decimals of source1
			***/
			{realPrice0:	3400,	realPrice1:	1,		dt0:	18,	dt1:	6,	do0:	8,	do1:	8},
			{realPrice0:	3400,	realPrice1:	1,		dt0:	18,	dt1:	18,	do0:	8,	do1:	8},
			{realPrice0:	3400,	realPrice1:	1,		dt0:	6,	dt1:	4,	do0:	8,	do1:	8},
			{realPrice0:	3400,	realPrice1:	1,		dt0:	18,	dt1:	28,	do0:	8,	do1:	8},
			{realPrice0:	3400,	realPrice1:	1,		dt0:	18,	dt1:	6,	do0:	4,	do1:	18},
			{realPrice0:	3400,	realPrice1:	1,		dt0:	4,	dt1:	16,	do0:	1,	do1:	13},
			{realPrice0:	.00394,	realPrice1:	19384.2,dt0:	18,	dt1:	6,	do0:	14,	do1:	6},
			{realPrice0:	.00394,	realPrice1:	19384.2,dt0:	18,	dt1:	6,	do0:	6,	do1:	14},
			{realPrice0:	.00394,	realPrice1:	19384.2,dt0:	6,	dt1:	18,	do0:	14,	do1:	6},
			{realPrice0:	.00394,	realPrice1:	19384.2,dt0:	6,	dt1:	18,	do0:	6,	do1:	14},
			{realPrice0:	101953,	realPrice1:	0.113,	dt0:	8,	dt1:	18,	do0:	8,	do1:	8},
			{realPrice0:	5.69483,realPrice1:	293.56,	dt0:	18,	dt1:	27,	do0:	8,	do1:	8},
			// the oracle will support this scenario, but our tests won't
			//{realPrice0:	100000000000,realPrice1:	0.00005,	dt0:	6,	dt1:	18,	do0:	8,	do1:	8},
		].forEach((testCase) => {
			it(`Chainlink oracle tests for ${JSON.stringify(testCase)}`, async () => {
				const {realPrice0, realPrice1, dt0, dt1, do0, do1} = testCase;
				
				const pricePerUnit0 = realPrice0 / Math.pow(10, dt0);
				const pricePerUnit1 = realPrice1 / Math.pow(10, dt1);
				const priceOracle0 = Math.floor(realPrice0 * Math.pow(10, do0));
				const priceOracle1 = Math.floor(realPrice1 * Math.pow(10, do1));
				
				const oracle = await UniswapV3OracleChainlink.new(admin);
				await oracle._setVerifyTokenSource(false, {from: admin});
				
				const token0 = await ERC20.new("", "");
				const token1 = await ERC20.new("", "");
				const token0Source = await Aggregator.new();
				const token1Source = await Aggregator.new();
				
				await token0.setDecimals(dt0);
				await token1.setDecimals(dt1);
				await token0Source.setDecimals(do0);
				await token1Source.setDecimals(do1);
				
				await token0Source.setLatestAnswer(priceOracle0.toString());
				await token1Source.setLatestAnswer(priceOracle1.toString());
				
				await oracle._addTokenSources([
					token0.address,
					token1.address,
				], [
					token0Source.address,
					token1Source.address,
				], {from: admin});
				
				
				const priceSqrtX96A = await oracle.oraclePriceSqrtX96.call(token0.address, token1.address);
				const priceSqrtX96B = await oracle.oraclePriceSqrtX96.call(token1.address, token0.address);
				expectAlmostEqualMantissa(priceSqrtX96A, sqrtX96(pricePerUnit0 / pricePerUnit1));
				expectAlmostEqualMantissa(priceSqrtX96B, sqrtX96(pricePerUnit1 / pricePerUnit0));
			});
		});
	});

});