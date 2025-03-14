pragma solidity =0.5.16;

library StringHelpers {
    function append(string memory a, string memory b) internal pure returns (string memory) {
        return string(abi.encodePacked(a, b));
    }

    /**
     * Returns the first string if it is not-empty, otherwise the second.
     */
    function orElse(string memory a, string memory b) internal pure returns (string memory) {
        if (bytes(a).length > 0) {
            return a;
        }
        return b;
    }
	
    function equals(string memory a, string memory b) internal pure returns (bool) {
        return (keccak256(abi.encodePacked((a))) == keccak256(abi.encodePacked((b))));
    }
}