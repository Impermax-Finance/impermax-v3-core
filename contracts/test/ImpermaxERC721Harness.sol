pragma solidity =0.5.16;

import "../../contracts/ImpermaxERC721.sol";

contract ImpermaxERC721Harness is ImpermaxERC721 {
	constructor(string memory _name, string memory _symbol) public ImpermaxERC721() {
		_setName(_name, _symbol);
	}
	
	function mint(address to, uint tokenId) public {
		super._mint(to, tokenId);
	}

	function burn(uint tokenId) public {
		super._burn(tokenId);
	}
	
	function setOwnerHarness(address to, uint tokenId) external {
		address prevOwner = _ownerOf[tokenId];
		if (prevOwner != address(0)) balanceOf[prevOwner]--;
		_ownerOf[tokenId] = to;
		balanceOf[to]++;
	}
}