# Saga Prediction Market

This repository contains two main programs, **AMM** and **Conditional Vault**, designed to work together to power a decentralized prediction market on Solana. The **AMM** program facilitates trading, while the **Conditional Vault** program handles the creation, resolution, and management of conditional tokens representing possible outcomes.

## Overview

The **Solana Prediction Market** allows users to create prediction markets for any event, trade conditional tokens representing the outcomes, and participate in decentralized speculation using an Automated Market Maker (AMM).

### Key Features

- **AMM for Trading**: A simple AMM program that enables users to trade conditional tokens in a liquidity pool.
- **Conditional Vault for Market Management**: Handles all market functions, including:
  - Creation and initialization of new prediction markets
  - Minting and managing conditional tokens
  - Resolving markets based on event outcomes
  - Supporting actions like canceling, disputing, or merging conditional tokens

## Programs

### 1. `amm` Program

The AMM program provides the core trading functionality within the prediction market. The following key functions are included:

- **create_amm**: Initializes an AMM pool for trading.
- **add_liquidity**: Allows users to add liquidity to a pool.
- **remove_liquidity**: Lets users withdraw their liquidity from a pool.
- **swap**: Enables trading between conditional tokens using an AMM.

### 2. `conditional_vault` Program

The Conditional Vault program manages prediction market lifecycle events and allows users to interact with conditional tokens. Major functionalities include:

- **initialize_conditional_vault**: Initializes a vault for a new prediction market.
- **add_metadata_to_conditional_tokens**: Adds metadata to conditional tokens.
- **resolve_conditional_vault**: Resolves the market based on the outcome and settles positions.
- **dispute_conditional_vault**: Allows disputes on the resolution of the market.
- **cancel_conditional_vault**: Cancels the market, allowing users to redeem their assets.
- **merge_conditional_tokens_for_underlying_tokens**: Merges conditional tokens back to the underlying asset.
- **mint_conditional_tokens**: Mints conditional tokens for each possible outcome.
- **redeem_conditional_tokens_for_underlying_tokens**: Redeems conditional tokens for underlying assets when conditions are met.
- **redeem_on_cancel**: Lets users redeem tokens if the market is canceled.

## Usage

1. **Cloning the Repository**

   ```bash
   git clone https://github.com/hsyndeniz/saga.git
   cd solana-saga
   ```

2. **Build and Deploy Programs**
   Using the Solana CLI and Anchor, you can build and deploy each program as follows:

   ```bash
   anchor build
   anchor deploy
   ```

3. **Interact with Programs**
   After deploying, you can start interacting with the programs either via CLI or by integrating with a frontend client.

## Example Workflow

1. **Initialize a Conditional Vault**
   - Create a new prediction market for an upcoming event.
   - Define the event’s outcomes and metadata for conditional tokens.

2. **Add Liquidity to the AMM**
   - Users provide liquidity to the AMM, which facilitates trading between conditional tokens.

3. **Mint Conditional Tokens**
   - Users mint conditional tokens representing different outcomes for the event.

4. **Trade Conditional Tokens**
   - The AMM enables users to trade conditional tokens, speculating on the outcome.

5. **Resolve or Cancel Market**
   - Once the event is concluded, the Conditional Vault is resolved to distribute assets based on the outcome, or in case of cancellation, users can redeem their positions.

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

### TODO

1. [X] Cannot cancel market if already resolved
2. [X] Mint only one conditional token
3. [ ] Do we get any fee to create a market?
4. [ ] Do we get any fee on winning market or we just make money over the trading fees?
5. [ ] Handle winning calculation by choosing an algorithm for the market
6. [ ] Should we have a wind-down period for the withdrawal of winnings?
