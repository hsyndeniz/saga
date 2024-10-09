use super::*;

#[derive(Accounts)]
pub struct SettleConditionalVault<'info> {
  pub settlement_authority: Signer<'info>,
  #[account(
      mut,
      has_one = settlement_authority,
    )]
  pub vault: Account<'info, ConditionalVault>,
}

impl SettleConditionalVault<'_> {
  pub fn resolve(ctx: Context<Self>, outcome: bool) -> Result<()> {
    let vault = &mut ctx.accounts.vault;

    // Ensure that the vault is not already resolved
    require!(vault.status != VaultStatus::Resolved, VaultError::MarketAlreadyResolved);

    // Ensure that the vault is not cancelled
    require!(vault.status != VaultStatus::Cancelled, VaultError::MarketAlreadyCancelled);

    vault.status = VaultStatus::Resolved;
    vault.outcome = Some(outcome);
    vault.resolved_at = Some(Clock::get()?.unix_timestamp);
    Ok(())
  }

  pub fn dispute(ctx: Context<Self>) -> Result<()> {
    let vault = &mut ctx.accounts.vault;

    // Ensure that the vault is not already disputed
    require!(vault.status != VaultStatus::Disputed, VaultError::MarketAlreadyDisputed);

    // Ensure that the vault is not already resolved
    require!(vault.status != VaultStatus::Resolved, VaultError::MarketAlreadyResolved);

    // Ensure that the vault is not already cancelled
    require!(vault.status != VaultStatus::Cancelled, VaultError::MarketAlreadyCancelled);

    vault.status = VaultStatus::Disputed;
    vault.disputed_at = Some(Clock::get()?.unix_timestamp);
    Ok(())
  }

  pub fn cancel(ctx: Context<Self>) -> Result<()> {
    let vault = &mut ctx.accounts.vault;

    // Ensure that the vault is not already cancelled
    require!(vault.status != VaultStatus::Cancelled, VaultError::MarketAlreadyCancelled);

    // Ensure that the vault is not already resolved
    require!(vault.status != VaultStatus::Resolved, VaultError::MarketAlreadyResolved);

    vault.status = VaultStatus::Cancelled;
    vault.cancelled_at = Some(Clock::get()?.unix_timestamp);
    Ok(())
  }
}
