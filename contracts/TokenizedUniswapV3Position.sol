pragma solidity =0.5.16;

import "./ImpermaxERC721.sol";
import "./interfaces/ITokenizedCLPosition.sol";

contract TokenizedUniswapV3Position is ImpermaxERC721, ITokenizedCLPosition {
	address public uniswapV3Factory;
	address public token0;
	address public token1;
	
	mapping(uint tokenId => {
		pool: address,
		idInPool: uint
	}) internal _position;
	
	mapping(address pool => uint8) public uniswapV3PoolFee;
	address[] public uniswapV3PoolsList;
	
	/*** Global state ***/
	
	function isPoolSupported(address pool) public returns (bool) {
		if (uniswapV3PoolFee[pool] > 0) return true;
		if (CHECK_IF_SUPPORTED) {
			// TODO set max number of supported pools
			uniswapV3PoolFee[pool] = fee;
			uniswapV3PoolsList.push(pool);
			return true;
		}
		return false;
	}
	
	function getMostLiquidPool() public returns (address) {
	
	}
	
	function marketPrice() external view returns (uint) {
	
	}
	
	function oraclePrice() external returns (uint) {
	
	}
 
	/*** Position state ***/

	function position(uint256 _tokenId) external view returns (
		uint128 liquidity,
		uint64 paX64,
		uint64 pbX64,
	) {
	
	}
	function liquidity(uint256 _tokenId) external view returns (uint) {
	
	}
	function PA(uint256 _tokenId) external view returns (uint) {
	
	}
	function PB(uint256 _tokenId) external view returns (uint) {
	
	}
 
	/*** Interactions ***/
	
	// this low-level function should be called from another contract
	function mint(address minter) external nonReentrant update returns (uint mintTokens) {
		uint balance = IERC20(underlying).balanceOf(address(this));
		uint mintAmount = balance.sub(totalBalance);
		mintTokens = mintAmount.mul(1e18).div(exchangeRate());

		if(totalSupply == 0) {
			// permanently lock the first MINIMUM_LIQUIDITY tokens
			mintTokens = mintTokens.sub(MINIMUM_LIQUIDITY);
			_mint(address(0), MINIMUM_LIQUIDITY);
		}
		require(mintTokens > 0, "Impermax: MINT_AMOUNT_ZERO");
		_mint(minter, mintTokens);
		emit Mint(msg.sender, minter, mintAmount, mintTokens);
	}

	// this low-level function should be called from another contract
	function redeem(address redeemer) external nonReentrant update returns (uint redeemAmount) {
		uint redeemTokens = balanceOf[address(this)];
		redeemAmount = redeemTokens.mul(exchangeRate()).div(1e18);

		require(redeemAmount > 0, "Impermax: REDEEM_AMOUNT_ZERO");
		require(redeemAmount <= totalBalance, "Impermax: INSUFFICIENT_CASH");
		_burn(address(this), redeemTokens);
		_safeTransfer(redeemer, redeemAmount);
		emit Redeem(msg.sender, redeemer, redeemAmount, redeemTokens);		
	}
	
	function claim(uint tokenId) external nonReentrant returns (uint amountA, uint amountB) {
	
	}
	
	/*** Utilities ***/
	
	// same safe transfer function used by UniSwapV2 (with fixed underlying)
	bytes4 private constant SELECTOR = bytes4(keccak256(bytes("transfer(address,uint256)")));
	function _safeTransfer(address to, uint amount) internal {
		(bool success, bytes memory data) = underlying.call(abi.encodeWithSelector(SELECTOR, to, amount));
		require(success && (data.length == 0 || abi.decode(data, (bool))), "Impermax: TRANSFER_FAILED");
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