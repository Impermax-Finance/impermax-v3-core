Notice: this code is released under [Business Source License](https://docs.impermax.finance/bsl-business-source-license)

### Impermax V3 Core
Impermax V3 inherits most of its smart contracts architecture from the first version of Impermax. To have a general undestanding of the scope of Impermax you can read the original [whitepaper](https://www.impermax.finance/documents/whitepaper.pdf).

The main innovation of **Impermax V3 is introducing the concept of NFTLP**. Impermax V1 and V2 only supported LP tokens as collateral. The NFTLP is a new type of collateral that represents a generalized liquidity position. This **enables Impermax V3 to support CPMM, CFMM, CLMM** and more.

This approach introduces some other cool new features:
- support for custom price oracles for different lending pools
- CL autocompounding as a native feature

### Contracts architecture
![enter image description here](https://i.imgur.com/5lIrL4c.png)
