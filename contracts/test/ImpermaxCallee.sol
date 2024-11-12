pragma solidity =0.5.16;

import "../../contracts/interfaces/IImpermaxCallee.sol";
import "./Recipient.sol";

contract ImpermaxCallee is IImpermaxCallee {

	address recipient;
	address underlying;
	
	constructor (address _recipient, address _underlying) public {
		recipient = _recipient;
		underlying = _underlying;
	}

	function impermaxV3Borrow(address sender, uint256 tokenId, uint borrowAmount, bytes calldata data) external {
		sender; tokenId; borrowAmount; data;
		Recipient(recipient).empty(underlying, msg.sender);
	}

    function impermaxV3Redeem(address sender, uint256 tokenId, uint256 redeemTokenId, bytes calldata data) external {
		sender; tokenId; redeemTokenId; data;
		Recipient(recipient).empty(underlying, msg.sender);
	}
}