pragma solidity =0.5.16;

import "../../contracts/interfaces/IERC721Receiver.sol";
import "../../contracts/interfaces/IERC20.sol";

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
}