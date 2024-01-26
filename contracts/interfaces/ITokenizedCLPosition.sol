pragma solidity >=0.5.0;

// commented is what is not needed by Collateral

interface ITokenizedCLPosition {
	// ERC-721
	//function balanceOf(address _owner) external view returns (uint256);
	function ownerOf(uint256 _tokenId) external view returns (address);
	//function safeTransferFrom(address _from, address _to, uint256 _tokenId, bytes data) external payable;
	//function safeTransferFrom(address _from, address _to, uint256 _tokenId) external payable;
	function transferFrom(address _from, address _to, uint256 _tokenId) external payable;
	//function approve(address _approved, uint256 _tokenId) external payable;
	//function setApprovalForAll(address _operator, bool _approved) external;
	//function getApproved(uint256 _tokenId) external view returns (address);
	//function isApprovedForAll(address _owner, address _operator) external view returns (bool);
	
	//event Transfer(address indexed _from, address indexed _to, uint256 indexed _tokenId);
	//event Approval(address indexed _owner, address indexed _approved, uint256 indexed _tokenId);
	//event ApprovalForAll(address indexed _owner, address indexed _operator, bool _approved);
	
	// Global state
	function token0() external view returns (address);
	function token1() external view returns (address);
	// X64?
	function marketPrice() external view returns (uint);
	function oraclePrice() external returns (uint);
	
	// Position state
	// IS IT POSSIBLE TO SAVE STORAGE SPACE HERE? Potrei fare 128, 64, 64
	function position(uint256 _tokenId) external view returns (
		uint128 liquidity,
		uint64 paX64,
		uint64 pbX64,
	);
	function liquidity(uint256 _tokenId) external view returns (uint);
	function PA(uint256 _tokenId) external view returns (uint);
	function PB(uint256 _tokenId) external view returns (uint);
}
