"use strict";

const { 
	dfn,
	bnMantissa,
	BN,
	expectEqual,
} = require('./JS');
const {
	encodeParameters,
	etherBalance,
	etherUnsigned,
	address,
	encode,
	encodePacked,
} = require('./Ethereum');
const { hexlify, keccak256, toUtf8Bytes } = require('ethers/utils');
const { ecsign } = require('ethereumjs-util');

const MockERC20 = artifacts.require('MockERC20');
const MockTokenizedCLPosition = artifacts.require('MockTokenizedCLPosition');
const BDeployer = artifacts.require('BDeployer');
const CDeployer = artifacts.require('CDeployer');
const Factory = artifacts.require('ImpermaxV3Factory');
const ImpermaxERC20 = artifacts.require('ImpermaxERC20Harness');
const ImpermaxERC721 = artifacts.require('ImpermaxERC721Harness');
const PoolToken = artifacts.require('PoolTokenHarness');
const CollateralProduction = artifacts.require('ImpermaxV3Collateral');
const BorrowableProduction = artifacts.require('ImpermaxV3Borrowable');
const Collateral = artifacts.require('CollateralHarness');
const Borrowable = artifacts.require('BorrowableHarness');
const BAllowance = artifacts.require('BAllowanceHarness');
const BInterestRateModel = artifacts.require('BInterestRateModelHarness');
const ImpermaxCallee = artifacts.require('ImpermaxCallee');
const ReentrantCallee = artifacts.require('ReentrantCallee');
const Recipient = artifacts.require('Recipient');
const MockBorrowTracker = artifacts.require('MockBorrowTracker');
const Liquidator = artifacts.require('Liquidator');

//MOCK EXTERNAL DEPLOYER

async function makeErc20Token(opts = {}) {
	const quantity = etherUnsigned(dfn(opts.quantity, 1e25));
	const decimals = etherUnsigned(dfn(opts.decimals, 18));
	const symbol = opts.symbol || 'DAI';
	const name = opts.name || `Erc20 ${symbol}`;
	return await ImpermaxERC20.new(name, symbol);
}


async function makeUniswapV2Factory(opts = {}) {
	// TODO update with uniswap V3/V4
	return address(1)
	//return await MockUniswapV2Factory.new();
}

async function makeTokenizedCLPosition(opts = {}) {
	const token0 = opts.token0 || await makeErc20Token(opts.t0);
	const token1 = opts.token1 || await makeErc20Token(opts.t1);
	const tokenizedCLPosition = await MockTokenizedCLPosition.new(token0.address, token1.address);
	return Object.assign(tokenizedCLPosition, {obj: {token0, token1}});
	/*if (opts.withFactory) {
		const tokenizedCLPosition = opts.uniswapV2Factory || await makeUniswapV2Factory(opts);
		await tokenizedCLPosition.addPair(token0.address, token1.address, uniswapV2Pair.address);
		return Object.assign(tokenizedCLPosition, {obj: {token0, token1, uniswapV2Factory}}); 
	}
	else {
		return Object.assign(uniswapV2Pair, {obj: {token0, token1}});
	}*/
}

//IMPERMAX DEPLOYER

async function makeBDeployer(opts = {}) {
	return await BDeployer.new();
}

async function makeCDeployer(opts = {}) {
	return await CDeployer.new();
}


async function makeFactory(opts = {}) {
	const admin = opts.admin || address(0);
	const reservesAdmin = opts.reservesAdmin || address(0);
	const bDeployer = opts.bDeployer || await makeBDeployer(opts);
	const cDeployer = opts.cDeployer || await makeCDeployer(opts);
	const uniswapV2Factory = opts.uniswapV2Factory || await makeUniswapV2Factory(opts);
	const factory = await Factory.new(admin, reservesAdmin, bDeployer.address, cDeployer.address);
	return Object.assign(factory, {obj: {admin, reservesAdmin, bDeployer, cDeployer, uniswapV2Factory,
		checkLendingPool: async (pair, {initialized, lendingPoolId, collateral, borrowable0, borrowable1}) => {
			const lendingPool = await factory.getLendingPool(pair.address);
			if(initialized) expect(lendingPool.initialized).to.eq(initialized);
			if(lendingPoolId) expectEqual(lendingPool.lendingPoolId, lendingPoolId);
			if(collateral) expect(lendingPool.collateral).to.eq(collateral);
			if(borrowable0) expect(lendingPool.borrowable0).to.eq(borrowable0);
			if(borrowable1) expect(lendingPool.borrowable1).to.eq(borrowable1);
		},
	}});
}

async function makePoolToken(opts = {}) {
	const underlying = opts.underlying || await makeErc20Token(opts.underlyingOpts);
	const poolToken = await PoolToken.new();
	poolToken.setUnderlying(underlying.address);
	return Object.assign(poolToken, {obj: {underlying}});	
}

async function makeLendingPool(opts = {}) {
	const factory = opts.factory || await makeFactory(opts);
	const tokenizedCLPosition = opts.tokenizedCLPosition || await makeTokenizedCLPosition({
		t0: opts.t0, token0: opts.token0,
		t1: opts.t1, token1: opts.token1,
	});
	const collateralAddr = await factory.createCollateral.call(tokenizedCLPosition.address);
	const borrowable0Addr = await factory.createBorrowable0.call(tokenizedCLPosition.address);
	const borrowable1Addr = await factory.createBorrowable1.call(tokenizedCLPosition.address);
	await factory.createCollateral(tokenizedCLPosition.address);
	await factory.createBorrowable0(tokenizedCLPosition.address);
	await factory.createBorrowable1(tokenizedCLPosition.address);
	const collateral = await CollateralProduction.at(collateralAddr);
	const borrowable0 = await BorrowableProduction.at(borrowable0Addr);
	const borrowable1 = await BorrowableProduction.at(borrowable1Addr);
	await factory.initializeLendingPool(tokenizedCLPosition.address);
	return { factory, tokenizedCLPosition, collateral, borrowable0, borrowable1 };
}

//EIP712

function getDomainSeparator(name, tokenAddress) {
	return keccak256(
		encode(
			['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
			[
				keccak256(toUtf8Bytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')),
				keccak256(toUtf8Bytes(name)),
				keccak256(toUtf8Bytes('1')),
				1337, // ganache chain id
				tokenAddress
			]
		)
	);
}

async function getApprovalDigest(name, tokenAddress, approve, nonce, deadline) {
	const DOMAIN_SEPARATOR = getDomainSeparator(name, tokenAddress);
	const PERMIT_TYPEHASH = keccak256(
		toUtf8Bytes('Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)')
	);
	return keccak256(
		encodePacked(
			['bytes1', 'bytes1', 'bytes32', 'bytes32'],
			[
				'0x19',
				'0x01',
				DOMAIN_SEPARATOR,
				keccak256(
					encode(
						['bytes32', 'address', 'address', 'uint256', 'uint256', 'uint256'],
						[PERMIT_TYPEHASH, approve.owner, approve.spender, approve.value.toString(), nonce.toString(), deadline.toString()]
					)
				)
			]
		)
	);
}

async function getBorrowApprovalDigest(name, tokenAddress, approve, nonce, deadline) {
	const DOMAIN_SEPARATOR = getDomainSeparator(name, tokenAddress);
	const BORROW_PERMIT_TYPEHASH = keccak256(
		toUtf8Bytes('BorrowPermit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)')
	);
	return keccak256(
		encodePacked(
			['bytes1', 'bytes1', 'bytes32', 'bytes32'],
			[
				'0x19',
				'0x01',
				DOMAIN_SEPARATOR,
				keccak256(
					encode(
						['bytes32', 'address', 'address', 'uint256', 'uint256', 'uint256'],
						[BORROW_PERMIT_TYPEHASH, approve.owner, approve.spender, approve.value.toString(), nonce.toString(), deadline.toString()]
					)
				)
			]
		)
	);
}

async function getNftApprovalDigest(name, tokenAddress, approve, nonce, deadline) {
	const DOMAIN_SEPARATOR = getDomainSeparator(name, tokenAddress);
	const PERMIT_TYPEHASH = keccak256(
		toUtf8Bytes('Permit(address spender,uint256 tokenId,uint256 nonce,uint256 deadline)')
	);
	return keccak256(
		encodePacked(
			['bytes1', 'bytes1', 'bytes32', 'bytes32'],
			[
				'0x19',
				'0x01',
				DOMAIN_SEPARATOR,
				keccak256(
					encode(
						['bytes32', 'address', 'uint256', 'uint256', 'uint256'],
						[PERMIT_TYPEHASH, approve.spender, approve.tokenId.toString(), nonce.toString(), deadline.toString()]
					)
				)
			]
		)
	);
}

async function sendPermit(opts) {
	const {token, owner, spender, value, deadline, private_key} = opts;
	const name = await token.name();
	const nonce = await token.nonces(owner);
	const digest = await getApprovalDigest(
		name,
		token.address,
		{owner, spender, value},
		nonce,
		deadline
	);
	const { v, r, s } = ecsign(Buffer.from(digest.slice(2), 'hex'), Buffer.from(private_key, 'hex'));
	return token.permit(owner, spender, value, deadline, v, hexlify(r), hexlify(s));
}

async function sendBorrowPermit(opts) {
	const {token, owner, spender, value, deadline, private_key} = opts;
	const name = await token.name();
	const nonce = await token.nonces(owner);
	const digest = await getBorrowApprovalDigest(
		name,
		token.address,
		{owner, spender, value},
		nonce,
		deadline
	);
	const { v, r, s } = ecsign(Buffer.from(digest.slice(2), 'hex'), Buffer.from(private_key, 'hex'));
	return token.borrowPermit(owner, spender, value, deadline, v, hexlify(r), hexlify(s));
}

async function sendNftPermit(opts) {
	const {token, spender, tokenId, deadline, private_key} = opts;
	const name = await token.name();
	const nonce = await token.nonces(tokenId);
	const digest = await getNftApprovalDigest(
		name,
		token.address,
		{spender, tokenId},
		nonce,
		deadline
	);
	const { v, r, s } = ecsign(Buffer.from(digest.slice(2), 'hex'), Buffer.from(private_key, 'hex'));
	return token.permit(spender, tokenId, deadline, v, hexlify(r), hexlify(s));
}


module.exports = {
	MockERC20,
	MockTokenizedCLPosition,
	BDeployer,
	CDeployer,
	Factory,
	ImpermaxERC20,
	ImpermaxERC721,
	PoolToken,
	CollateralProduction,
	BorrowableProduction,
	Collateral,
	Borrowable,
	BAllowance,
	BInterestRateModel,
	ImpermaxCallee,
	ReentrantCallee,
	Recipient,
	MockBorrowTracker,
	Liquidator,
	
	makeErc20Token,
	makeUniswapV2Factory,
	makeTokenizedCLPosition,
	//makeBDeployer,
	//makeCDeployer,
	makeFactory,
	makePoolToken,
	makeLendingPool,
	
	getDomainSeparator,
	getApprovalDigest,
	getBorrowApprovalDigest,
	getNftApprovalDigest,
	sendPermit,
	sendBorrowPermit,
	sendNftPermit,
};
