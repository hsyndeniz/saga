use super::*;

#[error_code]
pub enum VaultError {
  #[msg("Insufficient underlying token balance to mint this amount of conditional tokens")]
  InsufficientUnderlyingTokens,
  #[msg("This `vault_underlying_token_account` is not this vault's `underlying_token_account`")]
  InvalidVaultUnderlyingTokenAccount,
  #[msg("This conditional token mint is not this vault's conditional token mint")]
  InvalidConditionalTokenMint,
  #[msg("Vault needs to be settled as finalized before users can redeem conditional tokens for underlying tokens")]
  CantRedeemConditionalTokens,
  #[msg("Once a vault has been settled, its status as either finalized or reverted cannot be changed")]
  VaultAlreadySettled,
  #[msg("The market is not resolved yet")]
  MarketNotResolved,
  #[msg("The market is already resolved")]
  MarketAlreadyResolved,
  #[msg("The market is already disputed")]
  MarketAlreadyDisputed,
  #[msg("The market is already cancelled")]
  MarketAlreadyCancelled,
  #[msg("The market is not cancelled")]
  MarketNotCancelled,
  #[msg("The market is already locked")]
  MarketAlreadyLocked,
  #[msg("The market is already paused")]
  MarketAlreadyPaused,
  #[msg("The market is not open for betting")]
  MarketNotActive,
}
