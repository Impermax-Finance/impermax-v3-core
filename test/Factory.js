const {
	Factory,
	CollateralProduction,
	BorrowableProduction,
	makeErc20Token,
	makeTokenizedCLPosition,
	makeBDeployer,
	makeCDeployer,
	makeFactory
} = require('./Utils/Impermax');
const {
	expectEqual,
	expectAlmostEqualMantissa,
	expectRevert,
	expectEvent,
	bnMantissa,
} = require('./Utils/JS');
const {
	address,
	encodePacked,
} = require('./Utils/Ethereum');
const { keccak256 } = require('ethers/utils');

function getCreate2Address(create2Inputs) {
	const sanitizedInputs = '0x' + create2Inputs.map(i => i.slice(2)).join('');
	return address(keccak256(sanitizedInputs).slice(-40));
}

function getCollateralAddress(deployerAddress, factoryAddress, nftlpAddress) {
	const salt = keccak256(encodePacked(['address', 'address'], [factoryAddress, nftlpAddress]));
	console.log('Collateral bytecode: ' + keccak256(CollateralProduction.bytecode));
	return getCreate2Address([
		'0xff',
		deployerAddress,
		salt,
		keccak256(CollateralProduction.bytecode)
	]);
}

function getBorrowableAddress(deployerAddress, factoryAddress, nftlpAddress, index) {
	const salt = keccak256(encodePacked(['address', 'address', 'uint8'], [factoryAddress, nftlpAddress, index]));
	console.log('Borrowable bytecode: ' + keccak256(BorrowableProduction.bytecode));
	return getCreate2Address([
		'0xff',
		deployerAddress,
		salt,
		keccak256(BorrowableProduction.bytecode)
	]);
}

contract('Factory', function (accounts) {
	let root = accounts[0];
	let admin = accounts[1];		
	let reservesManager = accounts[2];	
	let user = accounts[3];
	let reservesAdmin = accounts[4];		
	
	describe('constructor', () => {
		it("correctly initialize Factory", async () => {
			const bDeployer = address(1);
			const cDeployer = address(2);
			const uniswapV2Factory = address(3);
			await expectRevert(
				Factory.new(admin, reservesAdmin, address(0), bDeployer, cDeployer), 
				"Impermax: INVALID_RESERVES_MANAGER"
			);
			const factory = await Factory.new(admin, reservesAdmin, reservesManager, bDeployer, cDeployer);
			expect(await factory.admin()).to.eq(admin);
			expect(await factory.pendingAdmin()).to.eq(address(0));
			expect(await factory.reservesAdmin()).to.eq(reservesAdmin);
			expect(await factory.reservesPendingAdmin()).to.eq(address(0));
			expect(await factory.reservesManager()).to.eq(reservesManager);
			expectEqual(await factory.allLendingPoolsLength(), 0);
			expect(await factory.bDeployer()).to.eq(bDeployer);
			expect(await factory.cDeployer()).to.eq(cDeployer);
		});		
	});
	
	describe('create lending pool', () => {
		let factory, nftlp1, nftlp2, nftlp3;
		let ca, ba, fa;
		let collateral1, borrowable01, borrowable11;
		let collateral2, borrowable02, borrowable12;
		let collateral3, borrowable03, borrowable13;
		before(async () => {
			factory = await makeFactory();
			ca = factory.obj.cDeployer.address; ba = factory.obj.bDeployer.address; fa = factory.address;
			nftlp1 = await makeTokenizedCLPosition({
				t0: {symbol: 'ETH'},
				t1: {symbol: 'UNI'},
			});
			nftlp2 = await makeTokenizedCLPosition();
			nftlp3 = await makeTokenizedCLPosition();
		});
		it('first contract deploy also create lendingPool', async () => {
			await factory.obj.checkLendingPool(nftlp1, {lendingPoolId: 0});
			await factory.obj.checkLendingPool(nftlp2, {lendingPoolId: 0});
			await factory.obj.checkLendingPool(nftlp3, {lendingPoolId: 0});
			collateral1 = await factory.createCollateral.call(nftlp1.address);
			await factory.createCollateral(nftlp1.address);
			borrowable02 = await factory.createBorrowable0.call(nftlp2.address);
			await factory.createBorrowable0(nftlp2.address);
			borrowable13 = await factory.createBorrowable1.call(nftlp3.address);
			await factory.createBorrowable1(nftlp3.address);
			await factory.obj.checkLendingPool(nftlp1, {lendingPoolId: 1, collateral: collateral1});
			await factory.obj.checkLendingPool(nftlp2, {lendingPoolId: 2, borrowable0: borrowable02});
			await factory.obj.checkLendingPool(nftlp3, {lendingPoolId: 3, borrowable1: borrowable13});
		});
		it('collateral and borrowable addresses can be calculated offchain', () => {
			expect(collateral1.toLowerCase()).to.eq(getCollateralAddress(ca, fa, nftlp1.address));
			expect(borrowable02.toLowerCase()).to.eq(getBorrowableAddress(ba, fa, nftlp2.address, 0));
			expect(borrowable13.toLowerCase()).to.eq(getBorrowableAddress(ba, fa, nftlp3.address, 1));
		});
		it('collateral and borrowable addresses are dependent on factory', () => {
			expect(getCollateralAddress(ca, fa, nftlp1.address)).to.not.eq(
				getCollateralAddress(ca, root, nftlp1.address)
			);
			expect(getBorrowableAddress(ba, fa, nftlp2.address, 0)).to.not.eq(
				getBorrowableAddress(ba, root, nftlp2.address, 0)
			);
		});
		it('revert if already exists', async () => {
			await expectRevert(factory.createCollateral(nftlp1.address), "Impermax: ALREADY_EXISTS");
			await expectRevert(factory.createBorrowable0(nftlp2.address), "Impermax: ALREADY_EXISTS");
			await expectRevert(factory.createBorrowable1(nftlp3.address), "Impermax: ALREADY_EXISTS");			
		});
		it('second contract deploy reuse lendingPool', async () => {
			borrowable01 = await factory.createBorrowable0.call(nftlp1.address);
			await factory.createBorrowable0(nftlp1.address);
			borrowable12 = await factory.createBorrowable1.call(nftlp2.address);
			await factory.createBorrowable1(nftlp2.address);
			collateral3 = await factory.createCollateral.call(nftlp3.address);
			await factory.createCollateral(nftlp3.address);
			await factory.obj.checkLendingPool(nftlp1, {lendingPoolId: 1, borrowable0: borrowable01});
			await factory.obj.checkLendingPool(nftlp2, {lendingPoolId: 2, borrowable1: borrowable12});
			await factory.obj.checkLendingPool(nftlp3, {lendingPoolId: 3, collateral: collateral3});
		}); 
		it('initialize revert if not all three contracts are deployed', async () => {
			await expectRevert(factory.initializeLendingPool(nftlp1.address), "Impermax: BORROWABLE1_NOT_CREATED");
			await expectRevert(factory.initializeLendingPool(nftlp2.address), "Impermax: COLLATERALIZABLE_NOT_CREATED");
			await expectRevert(factory.initializeLendingPool(nftlp3.address), "Impermax: BORROWABLE0_NOT_CREATED");
		}); 
		it('third contract deploy reuse lendingPool', async () => {
			borrowable11 = await factory.createBorrowable1.call(nftlp1.address);
			await factory.createBorrowable1(nftlp1.address);
			collateral2 = await factory.createCollateral.call(nftlp2.address);
			await factory.createCollateral(nftlp2.address);
			borrowable03 = await factory.createBorrowable0.call(nftlp3.address);
			await factory.createBorrowable0(nftlp3.address);
			await factory.obj.checkLendingPool(nftlp1, {lendingPoolId: 1, borrowable1: borrowable11});
			await factory.obj.checkLendingPool(nftlp2, {lendingPoolId: 2, collateral: collateral2});
			await factory.obj.checkLendingPool(nftlp3, {lendingPoolId: 3, borrowable0: borrowable03});
		});
		it('only the factory can initialize PoolTokens', async () => {
			const lendingPool = await factory.getLendingPool(nftlp1.address);
			await expectRevert((await CollateralProduction.at(lendingPool.collateral))._initialize(
				"", "", address(0), address(0), address(0)
			), "ImpermaxV3Collateral: UNAUTHORIZED");
			await expectRevert((await BorrowableProduction.at(lendingPool.borrowable0))._initialize(
				"", "", address(0), address(0)
			), "ImpermaxV3Borrowable: UNAUTHORIZED");
			await expectRevert((await BorrowableProduction.at(lendingPool.borrowable1))._initialize(
				"", "", address(0), address(0)
			), "ImpermaxV3Borrowable: UNAUTHORIZED");
		}); 
		it('factory can only be set once', async () => {
			const lendingPool = await factory.getLendingPool(nftlp1.address);
			await expectRevert((await CollateralProduction.at(lendingPool.collateral))._setFactory(), "ImpermaxV3Collateral: FACTORY_ALREADY_SET");
			await expectRevert((await BorrowableProduction.at(lendingPool.borrowable0))._setFactory(), "PoolToken: FACTORY_ALREADY_SET");
			await expectRevert((await BorrowableProduction.at(lendingPool.borrowable1))._setFactory(), "PoolToken: FACTORY_ALREADY_SET");
		}); 
		it('initially is not initialized', async () => {
			await factory.obj.checkLendingPool(nftlp1, {initialized: false});
			await factory.obj.checkLendingPool(nftlp2, {initialized: false});
			await factory.obj.checkLendingPool(nftlp3, {initialized: false});
		});
		it('initialize', async () => {
			const receipt1 = await factory.initializeLendingPool(nftlp1.address);
			const receipt2 = await factory.initializeLendingPool(nftlp2.address);
			const receipt3 = await factory.initializeLendingPool(nftlp3.address);
			await factory.obj.checkLendingPool(nftlp1, {initialized: true});
			await factory.obj.checkLendingPool(nftlp2, {initialized: true});
			await factory.obj.checkLendingPool(nftlp3, {initialized: true});
			expectEvent(receipt1, 'LendingPoolInitialized', {
				nftlp: nftlp1.address,
				token0: nftlp1.obj.token0.address,
				token1: nftlp1.obj.token1.address,
				collateral: collateral1,
				borrowable0: borrowable01,
				borrowable1: borrowable11,
				lendingPoolId: "1",
			});
		});
		it('collateral is initialized correctly', async () => {
			const collateral = await CollateralProduction.at(collateral1);
			expect(await collateral.underlying()).to.eq(nftlp1.address);
			expect(await collateral.borrowable0()).to.eq(borrowable01);
			expect(await collateral.borrowable1()).to.eq(borrowable11);
		});
		it('borrowable0 is initialized correctly', async () => {
			const borrowable0 = await BorrowableProduction.at(borrowable01);
			expect(await borrowable0.underlying()).to.eq(nftlp1.obj.token0.address);
			expect(await borrowable0.collateral()).to.eq(collateral1);
		});
		it('borrowable1 is initialized correctly', async () => {
			const borrowable1 = await BorrowableProduction.at(borrowable11);
			expect(await borrowable1.underlying()).to.eq(nftlp1.obj.token1.address);
			expect(await borrowable1.collateral()).to.eq(collateral1);
		});
		it('revert if already initialized', async () => {
			await expectRevert(factory.initializeLendingPool(nftlp1.address), "Impermax: ALREADY_INITIALIZED");
			await expectRevert(factory.initializeLendingPool(nftlp2.address), "Impermax: ALREADY_INITIALIZED");
			await expectRevert(factory.initializeLendingPool(nftlp3.address), "Impermax: ALREADY_INITIALIZED");
		});
	});
	
	describe('admin', () => {
		let factory;
		const initialReservesManager = address(11);
		beforeEach(async () => {
			factory = await makeFactory({admin, reservesAdmin, reservesManager: initialReservesManager});
		});
		it("change admin", async () => {
			await expectRevert(factory._setPendingAdmin(root, {from: root}), "Impermax: UNAUTHORIZED");
			await expectRevert(factory._setPendingAdmin(root, {from: reservesAdmin}), "Impermax: UNAUTHORIZED");
			await expectRevert(factory._acceptAdmin({from: root}), "Impermax: UNAUTHORIZED");
			expectEvent(await factory._setPendingAdmin(root, {from: admin}), "NewPendingAdmin", {
				'oldPendingAdmin': address(0),
				'newPendingAdmin': root,
			});
			expect(await factory.admin()).to.eq(admin);
			expect(await factory.pendingAdmin()).to.eq(root);
			receipt = await factory._acceptAdmin({from: root});
			expectEvent(receipt, "NewAdmin", {
				'oldAdmin': admin,
				'newAdmin': root,
			});
			expectEvent(receipt, "NewPendingAdmin", {
				'oldPendingAdmin': root,
				'newPendingAdmin': address(0),
			});
			expect(await factory.admin()).to.eq(root);
			expect(await factory.pendingAdmin()).to.eq(address(0));
		});
		it("change reserves admin", async () => {
			await expectRevert(factory._setReservesPendingAdmin(root, {from: root}), "Impermax: UNAUTHORIZED");
			await expectRevert(factory._setReservesPendingAdmin(root, {from: admin}), "Impermax: UNAUTHORIZED");
			await expectRevert(factory._acceptReservesAdmin({from: root}), "Impermax: UNAUTHORIZED");
			expectEvent(await factory._setReservesPendingAdmin(root, {from: reservesAdmin}), "NewReservesPendingAdmin", {
				'oldReservesPendingAdmin': address(0),
				'newReservesPendingAdmin': root,
			});
			expect(await factory.reservesAdmin()).to.eq(reservesAdmin);
			expect(await factory.reservesPendingAdmin()).to.eq(root);
			receipt = await factory._acceptReservesAdmin({from: root});
			expectEvent(receipt, "NewReservesAdmin", {
				'oldReservesAdmin': reservesAdmin,
				'newReservesAdmin': root,
			});
			expectEvent(receipt, "NewReservesPendingAdmin", {
				'oldReservesPendingAdmin': root,
				'newReservesPendingAdmin': address(0),
			});
			expect(await factory.reservesAdmin()).to.eq(root);
			expect(await factory.reservesPendingAdmin()).to.eq(address(0));
		});
		it("change reserves manager", async () => {
			await expectRevert(factory._setReservesManager(reservesManager, {from: reservesManager}), "Impermax: UNAUTHORIZED");
			await expectRevert(factory._setReservesManager(reservesManager, {from: admin}), "Impermax: UNAUTHORIZED");
			await expectRevert(factory._setReservesManager(address(0), {from: reservesAdmin}), "Impermax: INVALID_RESERVES_MANAGER");
			expectEvent(await factory._setReservesManager(reservesManager, {from: reservesAdmin}), "NewReservesManager", {
				'oldReservesManager': initialReservesManager,
				'newReservesManager': reservesManager,
			});
			expect(await factory.reservesManager()).to.eq(reservesManager);
			await factory._setReservesManager(root, {from: reservesAdmin});
			expect(await factory.reservesManager()).to.eq(root);
		});
	});
});