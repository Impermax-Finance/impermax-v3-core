pragma solidity =0.5.16;

import "../../contracts/interfaces/IERC721Receiver.sol";
import "../../contracts/interfaces/IERC20.sol";
import "../../contracts/interfaces/IBorrowable.sol";
import "../../contracts/interfaces/ICollateral.sol";

contract Liquidator is IERC721Receiver {

	address private underlying;
	address private borrowable;
	
	constructor (address _underlying, address _borrowable) public {
		underlying = _underlying;
		borrowable = _borrowable;
	}
	
    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external returns (bytes4) {
		operator; from; tokenId;
		(uint amount) = abi.decode(data, (uint));
		IERC20(underlying).transfer(borrowable, amount);
		return bytes4(keccak256("onERC721Received(address,address,uint256,bytes)"));
	}
	
	function liquidate(uint tokenId, uint repayAmount) external returns (uint seizeTokenId) {
		bytes memory data = abi.encode(repayAmount);
		seizeTokenId = IBorrowable(borrowable).liquidate(tokenId, repayAmount, address(this), data);
	}
	
	function restructureAndLiquidate(uint tokenId, uint repayAmount) external returns (uint seizeTokenId) {
		address collateral = IBorrowable(borrowable).collateral();
		ICollateral(collateral).restructureBadDebt(tokenId);
		bytes memory data = abi.encode(repayAmount);
		seizeTokenId = IBorrowable(borrowable).liquidate(tokenId, repayAmount, address(this), data);
	}
}