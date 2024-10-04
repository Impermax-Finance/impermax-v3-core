pragma solidity =0.5.16;

import "../../contracts/interfaces/IBorrowable.sol";
import "../../contracts/interfaces/ICollateral.sol";
import "../../contracts/interfaces/IImpermaxCallee.sol";
import "../../contracts/interfaces/IERC721Receiver.sol";

contract ReentrantCallee is IImpermaxCallee, IERC721Receiver {
	
	constructor () public {}

	function impermaxBorrow(address sender, uint256 tokenId, uint borrowAmount, bytes calldata data) external {
		sender; tokenId; borrowAmount;
		address a = address(this);
		(uint i) = abi.decode(data, (uint));
		require(i != 0, "TEST");
		if (i == 1) IBorrowable(msg.sender).mint(a);
		else if (i == 2) IBorrowable(msg.sender).redeem(a);
		else if (i == 3) IBorrowable(msg.sender).skim(a);
		else if (i == 4) IBorrowable(msg.sender).sync();
		else if (i == 5) IBorrowable(msg.sender).borrow(0, a, 0, new bytes(0));
		else if (i == 6) IBorrowable(msg.sender).liquidate(0, 0, a, new bytes(0));
		else if (i == 7) IBorrowable(msg.sender).restructureDebt(0, 0);
		else if (i == 8) IBorrowable(msg.sender).underlying();
	}
	
    function impermaxRedeem(address sender, uint256 tokenId, uint256 redeemTokenId, bytes calldata data) external {
		sender; tokenId; redeemTokenId;
		address a = address(this);
		(uint i) = abi.decode(data, (uint));
		require(i != 0, "TEST");
		if (i == 1) ICollateral(msg.sender).mint(a, 0);
		else if (i == 2) ICollateral(msg.sender).redeem(a, 0, 0);
		else if (i == 3) ICollateral(msg.sender).seize(0, 0, a, data);
		else if (i == 4) ICollateral(msg.sender).restructureBadDebt(0);
	}

	function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external returns (bytes4) {
		from; tokenId;
		address a = address(this);
		(uint i) = abi.decode(data, (uint));
		require(i != 0, "TEST");
		if (i == 1) ICollateral(operator).mint(a, 0);
		else if (i == 2) ICollateral(operator).redeem(a, 0, 0);
		else if (i == 3) ICollateral(operator).seize(0, 0, a, data);
		else if (i == 4) ICollateral(operator).restructureBadDebt(0);
		return bytes4(keccak256("onERC721Received(address,address,uint256,bytes)"));
	}
	
}