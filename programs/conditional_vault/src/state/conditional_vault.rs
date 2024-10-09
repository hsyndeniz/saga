use super::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum VaultStatus {
  Active,    // Market is open for betting.
  Locked,    // Market is no longer accepting bets.
  Paused,    // Market is temporarily paused for some reason.
  Disputed,  // Market is in dispute.
  Cancelled, // Market has been cancelled.
  Resolved,  // Market has been resolved.
}

#[account]
pub struct ConditionalVault {
  pub status: VaultStatus,
  pub claim: String,
  pub arweave_id: String,
  /// The result of the event that the vault is based on.
  pub outcome: Option<bool>,
  /// The account that can either finalize the vault to make conditional tokens
  /// redeemable for underlying tokens or revert the vault to make deposit
  /// slips redeemable for underlying tokens.
  pub settlement_authority: Pubkey,
  /// The mint of the tokens that are deposited into the vault.
  pub underlying_token_mint: Pubkey,
  /// The vault's storage account for deposited funds.
  pub underlying_token_account: Pubkey,
  pub conditional_on_finalize_token_mint: Pubkey,
  pub conditional_on_revert_token_mint: Pubkey,
  pub total_positive_tokens_minted: u64,
  pub total_negative_tokens_minted: u64,
  pub created_at: i64,
  pub disputed_at: Option<i64>,
  pub resolved_at: Option<i64>,
  pub cancelled_at: Option<i64>,
  pub decimals: u8,
  pub pda_bump: u8,
}

#[macro_export]
macro_rules! generate_vault_seeds {
  ($vault:expr) => {{
    &[
      b"conditional_vault",
      $vault.settlement_authority.as_ref(),
      $vault.underlying_token_mint.as_ref(),
      &anchor_lang::solana_program::hash::hash($vault.arweave_id.as_bytes()).to_bytes(),
      &[$vault.pda_bump],
    ]
  }};
}
