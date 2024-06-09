const {
	ImpermaxERC721,
	getDomainSeparator,
	sendNftPermit,
} = require('./Utils/Impermax');
const {
	expectEqual,
	expectRevert,
	expectEvent,
	BN,
} = require('./Utils/JS');
const {
	address,
} = require('./Utils/Ethereum');
const { keccak256, toUtf8Bytes } = require('ethers/utils');

const NAME = 'Tokenized Uni V3 Position';
const SYMBOL = 'WUNIV3';
const ROOT_NFT = new BN(0);
const TEST_NFT = new BN(1);
const TEST_NFT2 = new BN(2);
const TEST_PERMIT_NFT = new BN(101);
const MAX_UINT_256 = (new BN(2)).pow(new BN(256)).sub(new BN(1));

contract('ImpermaxERC721', function (accounts) {
	let root = accounts[0];
	let user = accounts[1];
	let other = accounts[2];
	let userForEip712, userForEip712PK;
	let otherForEip712, otherForEip712PK;
	let token;
	
	before(async () => {
		const { mnemonicToSeed } = require('bip39');
		const { hdkey } = require('ethereumjs-wallet');
		const mnemonic = 'horn horn horn horn horn horn horn horn horn horn horn horn';
		const seed = await mnemonicToSeed(mnemonic);
		const hdk = hdkey.fromMasterSeed(seed);
		
		const userWallet = hdk.derivePath("m/44'/60'/0'/0/0").getWallet();
		userForEip712 = userWallet.getAddressString();
		userForEip712PK = userWallet.getPrivateKey();
		
		const otherWallet = hdk.derivePath("m/44'/60'/0'/0/1").getWallet();
		otherForEip712 = otherWallet.getAddressString();
		otherForEip712PK = otherWallet.getPrivateKey();
	});
	
	beforeEach(async () => {
		token = await ImpermaxERC721.new(NAME, SYMBOL);
		await token.mint(root, ROOT_NFT);
		await token.mint(user, TEST_NFT);
		await token.mint(user, TEST_NFT2);
	});
	
	it('name, symbol, DOMAIN_SEPARATOR, PERMIT_TYPEHASH', async () => {
		expect(await token.name()).to.eq(NAME);
		expect(await token.symbol()).to.eq(SYMBOL);
		expectEqual(await token.balanceOf(root), 1);
		expectEqual(await token.balanceOf(user), 2);
		expect(await token.ownerOf(ROOT_NFT)).to.eq(root);
		expect(await token.ownerOf(TEST_NFT)).to.eq(user);
		expect(await token.ownerOf(TEST_NFT2)).to.eq(user);
		expect(await token.DOMAIN_SEPARATOR()).to.eq(getDomainSeparator(NAME, token.address));
		expect(await token.PERMIT_TYPEHASH()).to.eq(
			keccak256(toUtf8Bytes('Permit(address spender,uint256 tokenId,uint256 nonce,uint256 deadline)'))
		);
	})
	
	it('approve', async () => {
		const receipt = await token.approve(other, TEST_NFT, {from: user});
		expectEvent(receipt, 'Approval', {
			owner: user,
			approved: other,
			tokenId: TEST_NFT,
		});
		expectEqual(await token.getApproved(TEST_NFT), other);
	});
	
	it('approve is nulled after transfer', async () => {
		await token.approve(other, TEST_NFT, {from: user});
		await token.transferFrom(user, root, TEST_NFT, {from: other});
		expectEqual(await token.getApproved(TEST_NFT), address(0));
	});
	
	it('approve:fail', async () => {
		await expectRevert(
			token.approve(other, ROOT_NFT, {from: user}),
			'ImpermaxERC721: INVALID_APPROVER'
		);
	});
	
	it('approve for all', async () => {
		expectEqual(await token.isApprovedForAll(user, other), false);
		const receipt = await token.setApprovalForAll(other, true, {from: user});
		expectEvent(receipt, 'ApprovalForAll', {
			owner: user,
			operator: other,
			approved: true,
		});
		expectEqual(await token.isApprovedForAll(user, other), true);
	});

	it('transferFrom', async () => {
		const receipt = await token.transferFrom(user, other, TEST_NFT, {from: user});
		expectEvent(receipt, 'Transfer', {
			from: user,
			to: other,
			tokenId: TEST_NFT,
		});
		expectEqual(await token.ownerOf(TEST_NFT), other);
	});

	it('transferFrom:fail', async () => {
		await expectRevert(
			token.transferFrom(user, other, ROOT_NFT, {from: user}),
			'ImpermaxERC721: UNAUTHORIZED'
		);
		await expectRevert(
			token.transferFrom(user, address(0), TEST_NFT, {from: user}),
			'ImpermaxERC721: INVALID_RECEIVER'
		);
	});
	
	/* TODO SAFE TRANSFER STUFF */

	it('permit', async () => {
		await token.mint(userForEip712, TEST_PERMIT_NFT);
		const receipt = await sendNftPermit({
			token: token,
			spender: otherForEip712,
			tokenId: TEST_PERMIT_NFT,
			deadline: MAX_UINT_256,
			private_key: userForEip712PK,
		});
		expectEvent(receipt, 'Approval', {
			//owner: userForEip712,
			//to: otherForEip712,
			tokenId: TEST_PERMIT_NFT,
		});
		expectEqual(await token.getApproved(TEST_PERMIT_NFT), otherForEip712);
		expectEqual(await token.nonces(TEST_PERMIT_NFT), 1);		
	});
	
	it('permit:fail', async () => {
		await token.mint(userForEip712, TEST_PERMIT_NFT);
		await expectRevert(
			sendNftPermit({
				token: token,
				spender: otherForEip712,
				tokenId: TEST_PERMIT_NFT,
				deadline: MAX_UINT_256,
				private_key: otherForEip712PK,
			}), 'ImpermaxERC721: INVALID_SIGNATURE'
		);
	});
});