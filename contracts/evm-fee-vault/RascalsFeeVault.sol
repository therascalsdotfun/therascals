// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IUSDC {
    function balanceOf(address) external view returns (uint256);
    function decimals() external view returns (uint8);
}
/// Chain-local custody vault. The immutable settlement router must call
/// collectFee in the SAME transaction as the swap; this contract does not prove a swap.
/// No token buyback, timelock, yield or cross-chain transfer is implemented.
contract RascalsFeeVault {
    uint256 public constant FEE_BPS = 50;
    address public immutable owner;
    address public immutable usdc;
    address public immutable settlementRouter;
    uint256 public totalCollected;
    bool public paused;
    bool private entered;
    mapping(bytes32 => bool) public collected;
    event FeeCollected(bytes32 indexed rollId, address indexed payer, uint256 gross, uint256 fee);
    event Withdrawal(address indexed recipient, uint256 amount);
    constructor(address token, address router, address admin) {
        require(token.code.length != 0 && router != address(0) && admin != address(0), "Invalid configuration");
        require(IUSDC(token).decimals() == 6, "Six-decimal USDC required");
        usdc = token; settlementRouter = router; owner = admin;
    }
    modifier guard() { require(!entered,"Reentrancy"); entered=true; _; entered=false; }
    function collectFee(bytes32 rollId, address payer, uint256 gross) external guard returns (uint256 fee) {
        require(msg.sender == settlementRouter && !paused,"Router unavailable");
        require(rollId != bytes32(0) && !collected[rollId] && payer != address(0),"Duplicate or invalid roll");
        require(gross >= 1e6 && gross <= 100e6,"Test roll 1..100 USDC");
        fee = gross * FEE_BPS / 10000;
        uint256 beforeBalance=IUSDC(usdc).balanceOf(address(this));
        collected[rollId]=true;
        transferCall(abi.encodeWithSignature("transferFrom(address,address,uint256)",payer,address(this),fee));
        require(IUSDC(usdc).balanceOf(address(this))-beforeBalance == fee,"Exact fee not received");
        totalCollected += fee;
        emit FeeCollected(rollId,payer,gross,fee);
    }
    function setPaused(bool value) external { require(msg.sender==owner,"Owner only");paused=value; }
    function withdraw(address recipient,uint256 amount) external guard {
        require(msg.sender==owner && recipient!=address(0) && amount>0,"Owner withdrawal only");
        uint256 beforeBalance=IUSDC(usdc).balanceOf(address(this));
        transferCall(abi.encodeWithSignature("transfer(address,uint256)",recipient,amount));
        require(beforeBalance-IUSDC(usdc).balanceOf(address(this))==amount,"Unexpected debit");
        emit Withdrawal(recipient,amount);
    }
    function transferCall(bytes memory payload) private {
        (bool ok,bytes memory result)=usdc.call(payload);
        require(ok && (result.length==0 || (result.length==32 && abi.decode(result,(bool)))),"USDC transfer failed");
    }
}
