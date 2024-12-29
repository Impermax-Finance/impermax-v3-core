pragma solidity =0.5.16;
pragma experimental ABIEncoderV2;

import "../ImpermaxERC721.sol";
import "../interfaces/INFTLP.sol";
import "./interfaces/IUniswapV3Factory.sol";
import "./interfaces/IUniswapV3Pool.sol";
import "./interfaces/IUniswapV3AC.sol";
import "./interfaces/IUniswapV3Oracle.sol";
import "./interfaces/ITokenizedUniswapV3Position.sol";
import "./interfaces/ITokenizedUniswapV3Factory.sol";
import "./libraries/UniswapV3CollateralMath.sol";
import "./libraries/UniswapV3Position.sol";
import "./libraries/TickMath.sol";

contract TokenizedUniswapV3Position is ITokenizedUniswapV3Position, INFTLP, ImpermaxERC721 {
	using TickMath for int24;
	using UniswapV3CollateralMath for UniswapV3CollateralMath.PositionObject;
	
    uint constant Q128 = 2**128;

	uint32 constant ORACLE_T = 1800;

	address public factory;
	address public uniswapV3Factory;
	address public token0;
	address public token1;
	
	mapping(uint24 => 
		mapping(int24 => 
			mapping(int24 => uint256)
		)
	) public totalBalance;
	
	mapping(uint256 => Position) public positions;
	uint256 public positionLength;
	
	mapping(uint24 => address) public uniswapV3PoolByFee;
	address[] public poolsList;
	
	/*** Global state ***/
	
	// called once by the factory at the time of deployment
	function _initialize (
		address _uniswapV3Factory, 
		address _token0, 
		address _token1
	) external {
		require(factory == address(0), "Impermax: FACTORY_ALREADY_SET"); // sufficient check
		factory = msg.sender;
		_setName("Tokenized Uniswap V3", "NFT-UNI-V3");
		uniswapV3Factory = _uniswapV3Factory;
		token0 = _token0;
		token1 = _token1;
	}
	
	function getPool(uint24 fee) public returns (address pool) {
		pool = uniswapV3PoolByFee[fee];
		if (pool == address(0)) {
			pool = IUniswapV3Factory(uniswapV3Factory).getPool(token0, token1, fee);
			require(pool != address(0), "TokenizedUniswapV3Position: UNSUPPORTED_FEE");
			uniswapV3PoolByFee[fee] = pool;
			poolsList.push(pool);
		}
	}
	
	function _updateBalance(uint24 fee, int24 tickLower, int24 tickUpper) internal {
		address pool = getPool(fee);
		bytes32 hash = UniswapV3Position.getHash(address(this), tickLower, tickUpper);
		(uint balance,,,,) = IUniswapV3Pool(pool).positions(hash);
		totalBalance[fee][tickLower][tickUpper] = balance;
	}
	
	function oraclePriceSqrtX96() public returns (uint256) {
		address oracle = ITokenizedUniswapV3Factory(factory).oracle();
		return IUniswapV3Oracle(oracle).oraclePriceSqrtX96(poolsList);
	}
 
	/*** Position state ***/
	
	// this assumes that the position fee growth snapshot has already been updated through burn()
	function _getfeeCollectedAndGrowth(Position memory position, address pool) internal view returns (uint256 fg0, uint256 fg1, uint256 feeCollected0, uint256 feeCollected1) {
		bytes32 hash = UniswapV3Position.getHash(address(this), position.tickLower, position.tickUpper);
		(,fg0, fg1,,) = IUniswapV3Pool(pool).positions(hash);
		
		uint256 delta0 = fg0 > position.feeGrowthInside0LastX128 ? fg0 - position.feeGrowthInside0LastX128 : 0;
		uint256 delta1 = fg1 > position.feeGrowthInside1LastX128 ? fg1 - position.feeGrowthInside1LastX128 : 0;
		
		feeCollected0 = delta0.mul(position.liquidity).div(Q128).add(position.unclaimedFees0);
		feeCollected1 = delta1.mul(position.liquidity).div(Q128).add(position.unclaimedFees1);
	}
	function _getFeeCollected(Position memory position, address pool) internal view returns (uint256 feeCollected0, uint256 feeCollected1) {
		(,,feeCollected0, feeCollected1) = _getfeeCollectedAndGrowth(position, pool);
	}
	
	function getPositionData(uint256 tokenId, uint256 safetyMarginSqrt) external returns (
		uint256 priceSqrtX96,
		INFTLP.RealXYs memory realXYs
	) {
		Position memory position = positions[tokenId];
		
		// trigger update of fee growth
		address pool = getPool(position.fee);
		IUniswapV3Pool(pool).burn(position.tickLower, position.tickUpper, 0);
		(uint256 feeCollectedX, uint256 feeCollectedY) = _getFeeCollected(position, pool);
	
		require(safetyMarginSqrt >= 1e18, "TokenizedUniswapV3Position: INVALID_SAFETY_MARGIN");
		require(ownerOf[tokenId] != address(0), "TokenizedUniswapV3Position: UNINITIALIZED_POSITION");
		UniswapV3CollateralMath.PositionObject memory positionObject = UniswapV3CollateralMath.newPosition(
			position.liquidity,
			position.tickLower.getSqrtRatioAtTick(),
			position.tickUpper.getSqrtRatioAtTick()
		);
		
		priceSqrtX96 = oraclePriceSqrtX96();
		uint256 currentPrice = priceSqrtX96;
		uint256 lowestPrice = priceSqrtX96.mul(1e18).div(safetyMarginSqrt);
		uint256 highestPrice = priceSqrtX96.mul(safetyMarginSqrt).div(1e18);
		
		realXYs.lowestPrice.realX = positionObject.getRealX(lowestPrice).add(feeCollectedX);
		realXYs.lowestPrice.realY = positionObject.getRealY(lowestPrice).add(feeCollectedY);
		realXYs.currentPrice.realX = positionObject.getRealX(currentPrice).add(feeCollectedX);
		realXYs.currentPrice.realY = positionObject.getRealY(currentPrice).add(feeCollectedY);
		realXYs.highestPrice.realX = positionObject.getRealX(highestPrice).add(feeCollectedX);
		realXYs.highestPrice.realY = positionObject.getRealY(highestPrice).add(feeCollectedY);
	}
 
	/*** Interactions ***/
	
	// this low-level function should be called from another contract
	function mint(address to, uint24 fee, int24 tickLower, int24 tickUpper) external nonReentrant returns (uint256 newTokenId) {
		address pool = getPool(fee);		
		bytes32 hash = UniswapV3Position.getHash(address(this), tickLower, tickUpper);
		(uint balance, uint256 fg0, uint256 fg1,,) = IUniswapV3Pool(pool).positions(hash);
		uint liquidity = balance.sub(totalBalance[fee][tickLower][tickUpper]);
		
		newTokenId = positionLength++;
		_mint(to, newTokenId);		
		positions[newTokenId] = Position({
			fee: fee,
			tickLower: tickLower,
			tickUpper: tickUpper,
			liquidity: safe128(liquidity),
			feeGrowthInside0LastX128: fg0,
			feeGrowthInside1LastX128: fg1,
			unclaimedFees0: 0,
			unclaimedFees1: 0
		});
		
		_updateBalance(fee, tickLower, tickUpper);
		
		emit MintPosition(newTokenId, fee, tickLower, tickUpper);
		emit UpdatePositionLiquidity(newTokenId, liquidity);
		emit UpdatePositionFeeGrowthInside(newTokenId, fg0, fg1);
		emit UpdatePositionUnclaimedFees(newTokenId, 0, 0);
	}

	// this low-level function should be called from another contract
	function redeem(address to, uint256 tokenId) external nonReentrant returns (uint256 amount0, uint256 amount1) {
		_checkAuthorized(ownerOf[tokenId], msg.sender, tokenId);
		
		Position memory position = positions[tokenId];
		delete positions[tokenId];
		_burn(tokenId);
		
		address pool = getPool(position.fee);		
		(amount0, amount1) = IUniswapV3Pool(pool).burn(position.tickLower, position.tickUpper, position.liquidity);
		_updateBalance(position.fee, position.tickLower, position.tickUpper);
		
		(uint256 feeCollected0, uint256 feeCollected1) = _getFeeCollected(position, pool);
		amount0 = amount0.add(feeCollected0);
		amount1 = amount1.add(feeCollected1);

		(amount0, amount1) = IUniswapV3Pool(pool).collect(to, position.tickLower, position.tickUpper, safe128(amount0), safe128(amount1));
		
		emit UpdatePositionLiquidity(tokenId, 0);
		emit UpdatePositionUnclaimedFees(tokenId, 0, 0);
	}
	
	function _splitUint(uint256 n, uint256 percentage) internal pure returns (uint256 a, uint256 b) {
		a = n.mul(percentage).div(1e18);
		b = n.sub(a);
	}
	function split(uint256 tokenId, uint256 percentage) external nonReentrant returns (uint256 newTokenId) {
		require(percentage <= 1e18, "TokenizedUniswapV3Position: ABOVE_100_PERCENT");
		address owner = ownerOf[tokenId];
		_checkAuthorized(owner, msg.sender, tokenId);
		_approve(address(0), tokenId, address(0)); // reset approval
		
		Position memory oldPosition = positions[tokenId];
		(uint256 newLiquidity, uint256 oldLiquidity) = _splitUint(oldPosition.liquidity, percentage);
		(uint256 newUnclaimedFees0, uint256 oldUnclaimedFees0) = _splitUint(oldPosition.unclaimedFees0, percentage);
		(uint256 newUnclaimedFees1, uint256 oldUnclaimedFees1) = _splitUint(oldPosition.unclaimedFees1, percentage);
		positions[tokenId].liquidity = safe128(oldLiquidity);
		positions[tokenId].unclaimedFees0 = oldUnclaimedFees0;
		positions[tokenId].unclaimedFees1 = oldUnclaimedFees1;
		newTokenId = positionLength++;
		_mint(owner, newTokenId);
		positions[newTokenId] = Position({
			fee: oldPosition.fee,
			tickLower: oldPosition.tickLower,
			tickUpper: oldPosition.tickUpper,
			liquidity: safe128(newLiquidity),
			feeGrowthInside0LastX128: oldPosition.feeGrowthInside0LastX128,
			feeGrowthInside1LastX128: oldPosition.feeGrowthInside1LastX128,
			unclaimedFees0: newUnclaimedFees0,
			unclaimedFees1: newUnclaimedFees1
		});
		
		emit UpdatePositionLiquidity(tokenId, oldLiquidity);
		emit UpdatePositionUnclaimedFees(tokenId, oldUnclaimedFees0, oldUnclaimedFees1);
		emit MintPosition(newTokenId, oldPosition.fee, oldPosition.tickLower, oldPosition.tickUpper);
		emit UpdatePositionLiquidity(newTokenId, newLiquidity);
		emit UpdatePositionUnclaimedFees(newTokenId, newUnclaimedFees0, newUnclaimedFees1);
		emit UpdatePositionFeeGrowthInside(newTokenId, oldPosition.feeGrowthInside0LastX128, oldPosition.feeGrowthInside1LastX128);
	}
	
	function join(uint256 tokenId, uint256 tokenToJoin) external nonReentrant {
		_checkAuthorized(ownerOf[tokenToJoin], msg.sender, tokenToJoin);
		
		Position memory positionA = positions[tokenId];
		Position memory positionB = positions[tokenToJoin];
		
		require(positionA.fee == positionB.fee, "TokenizedUniswapV3Position: INCOMPATIBLE_TOKENS_META");
		require(positionA.tickLower == positionB.tickLower, "TokenizedUniswapV3Position: INCOMPATIBLE_TOKENS_META");
		require(positionA.tickUpper == positionB.tickUpper, "TokenizedUniswapV3Position: INCOMPATIBLE_TOKENS_META");
		
		// new fee growth is calculated as average of the 2 positions weighted by liquidity
		uint256 newLiquidity = uint256(positionA.liquidity).add(positionB.liquidity);
		uint256 newUnclaimedFees0 = positionA.unclaimedFees0.add(positionB.unclaimedFees0);
		uint256 newUnclaimedFees1 = positionA.unclaimedFees1.add(positionB.unclaimedFees1);
		uint256 tA0 = positionA.feeGrowthInside0LastX128.mul(positionA.liquidity);
		uint256 tA1 = positionA.feeGrowthInside1LastX128.mul(positionA.liquidity);
		uint256 tB0 = positionB.feeGrowthInside0LastX128.mul(positionB.liquidity);
		uint256 tB1 = positionB.feeGrowthInside1LastX128.mul(positionB.liquidity);
		uint256 newFeeGrowthInside0LastX128 = tA0.add(tB0).div(newLiquidity).add(1); // round up
		uint256 newFeeGrowthInside1LastX128 = tA1.add(tB1).div(newLiquidity).add(1); // round up
		
		positions[tokenId].liquidity = safe128(newLiquidity);
		positions[tokenId].feeGrowthInside0LastX128 = newFeeGrowthInside0LastX128;
		positions[tokenId].feeGrowthInside1LastX128 = newFeeGrowthInside1LastX128;
		positions[tokenId].unclaimedFees0 = newUnclaimedFees0;
		positions[tokenId].unclaimedFees1 = newUnclaimedFees1;
		delete positions[tokenToJoin];
		_burn(tokenToJoin);
		
		emit UpdatePositionLiquidity(tokenId, newLiquidity);
		emit UpdatePositionFeeGrowthInside(tokenId, newFeeGrowthInside0LastX128, newFeeGrowthInside1LastX128);
		emit UpdatePositionUnclaimedFees(tokenId, newUnclaimedFees0, newUnclaimedFees1);
		emit UpdatePositionLiquidity(tokenToJoin, 0);
		emit UpdatePositionUnclaimedFees(tokenToJoin, 0, 0);
	}
	
	/*** Autocompounding Module ***/
	
	function reinvest(uint256 tokenId, address bountyTo) external nonReentrant returns (uint256 bounty0, uint256 bounty1) {
		// 1. Initialize and read fee collected
		address acModule = ITokenizedUniswapV3Factory(factory).acModule();
		Position memory position = positions[tokenId];
		uint256 feeCollected0; uint256 feeCollected1;
		{
			address pool = getPool(position.fee);
			uint256 fg0; uint256 fg1; 
			IUniswapV3Pool(pool).burn(position.tickLower, position.tickUpper, 0);
			(fg0, fg1, feeCollected0, feeCollected1) = _getfeeCollectedAndGrowth(position, pool);
			require(feeCollected0 > 0 || feeCollected1 > 0, "TokenizedUniswapV3Position: NO_FEES_COLLECTED");
			positions[tokenId].feeGrowthInside0LastX128 = fg0;
			positions[tokenId].feeGrowthInside1LastX128 = fg1;
			
			emit UpdatePositionFeeGrowthInside(tokenId, fg0, fg1);
		}
		
		// 2. Calculate how much to collect and send it to autocompounder (and update unclaimedFees)
		bytes memory data;
		{
			uint256 collect0; uint256 collect1;
			(collect0, collect1, data) = IUniswapV3AC(acModule).getToCollect(
				position, 
				tokenId, 
				feeCollected0, 
				feeCollected1
			);
			uint256 unclaimedFees0 = feeCollected0.sub(collect0, "TokenizedUniswapV3Position: COLLECT_0_TOO_HIGH");
			uint256 unclaimedFees1 = feeCollected1.sub(collect1, "TokenizedUniswapV3Position: COLLECT_1_TOO_HIGH");
			positions[tokenId].unclaimedFees0 = unclaimedFees0;
			positions[tokenId].unclaimedFees1 = unclaimedFees1;
			
			emit UpdatePositionUnclaimedFees(tokenId, unclaimedFees0, unclaimedFees1);
			
			IUniswapV3Pool(getPool(position.fee)).collect(acModule, position.tickLower, position.tickUpper, safe128(collect0), safe128(collect1));
		}
		
		// 3. Let the autocompounder convert the fees to liquidity, and update the position
		uint256 totalBalanceBefore = totalBalance[position.fee][position.tickLower][position.tickUpper];
		(bounty0, bounty1) = IUniswapV3AC(acModule).mintLiquidity(bountyTo, data);		
		_updateBalance(position.fee, position.tickLower, position.tickUpper);
		uint256 newLiquidity = totalBalance[position.fee][position.tickLower][position.tickUpper].sub(totalBalanceBefore);
		require(newLiquidity > 0, "TokenizedUniswapV3Position: NO_LIQUIDITY_ADDED");
		
		uint128 liquidity = safe128(newLiquidity.add(position.liquidity));
		positions[tokenId].liquidity = liquidity;
		
		emit UpdatePositionLiquidity(tokenId, liquidity);
	}
	
	/*** Utilities ***/

    function safe128(uint n) internal pure returns (uint128) {
        require(n < 2**128, "Impermax: SAFE128");
        return uint128(n);
    }
	
	// prevents a contract from calling itself, directly or indirectly.
	bool internal _notEntered = true;
	modifier nonReentrant() {
		require(_notEntered, "Impermax: REENTERED");
		_notEntered = false;
		_;
		_notEntered = true;
	}
}