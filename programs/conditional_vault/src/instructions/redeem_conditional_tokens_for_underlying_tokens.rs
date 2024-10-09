use super::*;

impl InteractWithVault<'_> {
  pub fn validate_redeem_conditional_tokens(&self) -> Result<()> {
    require!(
      self.vault.status != VaultStatus::Active,
      VaultError::CantRedeemConditionalTokens
    );

    require!(
      self.vault.status != VaultStatus::Cancelled,
      VaultError::CantRedeemConditionalTokens
    );

    Ok(())
  }

  pub fn validate_redeem_on_cancel(&self) -> Result<()> {
    // Ensure that the vault status is Cancelled
    require!(self.vault.status == VaultStatus::Cancelled, VaultError::MarketNotCancelled);

    Ok(())
  }

  pub fn handle_redeem_conditional_tokens(ctx: Context<Self>) -> Result<()> {
    let accs = &ctx.accounts;
    let vault = &accs.vault;
    let vault_outcome = vault.outcome;

    // we need to check that the vault outcome is set
    require!(vault_outcome.is_some(), VaultError::MarketNotResolved);

    // storing some numbers for later invariant checks
    let pre_vault_underlying_balance = accs.vault_underlying_token_account.amount;
    let pre_finalize_mint_supply = accs.conditional_on_finalize_token_mint.supply;
    let pre_revert_mint_supply = accs.conditional_on_revert_token_mint.supply;

    let pre_conditional_on_finalize_balance = accs.user_conditional_on_finalize_token_account.amount;
    let pre_conditional_on_revert_balance = accs.user_conditional_on_revert_token_account.amount;

    let seeds = generate_vault_seeds!(vault);
    let signer = &[&seeds[..]];

    let redeemable = match vault_outcome {
      Some(true) => pre_conditional_on_finalize_balance,
      Some(false) => pre_conditional_on_revert_balance,
      _ => unreachable!(),
    };

    // burn from both accounts even though we technically only need to burn from one
    for (conditional_mint, user_conditional_token_account) in [
      (
        &accs.conditional_on_finalize_token_mint,
        &accs.user_conditional_on_finalize_token_account,
      ),
      (
        &accs.conditional_on_revert_token_mint,
        &accs.user_conditional_on_revert_token_account,
      ),
    ] {
      token::burn(
        CpiContext::new(
          accs.token_program.to_account_info(),
          Burn {
            mint: conditional_mint.to_account_info(),
            from: user_conditional_token_account.to_account_info(),
            authority: accs.authority.to_account_info(),
          },
        ),
        user_conditional_token_account.amount,
      )?;
    }

    token::transfer(
      CpiContext::new_with_signer(
        accs.token_program.to_account_info(),
        Transfer {
          from: accs.vault_underlying_token_account.to_account_info(),
          to: accs.user_underlying_token_account.to_account_info(),
          authority: accs.vault.to_account_info(),
        },
        signer,
      ),
      redeemable,
    )?;

    ctx.accounts.user_conditional_on_finalize_token_account.reload()?;
    ctx.accounts.user_conditional_on_revert_token_account.reload()?;
    ctx.accounts.vault_underlying_token_account.reload()?;
    ctx.accounts.conditional_on_finalize_token_mint.reload()?;
    ctx.accounts.conditional_on_revert_token_mint.reload()?;

    let post_user_conditional_on_finalize_balance = ctx.accounts.user_conditional_on_finalize_token_account.amount;
    let post_user_conditional_on_revert_balance = ctx.accounts.user_conditional_on_revert_token_account.amount;
    let post_vault_underlying_balance = ctx.accounts.vault_underlying_token_account.amount;
    let post_finalize_mint_supply = ctx.accounts.conditional_on_finalize_token_mint.supply;
    let post_revert_mint_supply = ctx.accounts.conditional_on_revert_token_mint.supply;

    assert!(post_user_conditional_on_finalize_balance == 0);
    assert!(post_user_conditional_on_revert_balance == 0);
    assert!(post_finalize_mint_supply == pre_finalize_mint_supply - pre_conditional_on_finalize_balance);
    assert!(post_revert_mint_supply == pre_revert_mint_supply - pre_conditional_on_revert_balance);

    match vault_outcome {
      Some(true) => {
        assert!(post_vault_underlying_balance == pre_vault_underlying_balance - pre_conditional_on_finalize_balance);
      }
      Some(false) => {
        assert!(post_vault_underlying_balance == pre_vault_underlying_balance - pre_conditional_on_revert_balance);
      }
      _ => unreachable!(),
    }

    Ok(())
  }

  pub fn handle_redeem_on_cancel(ctx: Context<Self>) -> Result<()> {
    let accs = &ctx.accounts;
    let vault = &accs.vault;

    // In case of cancellation, redeem both types of tokens
    let total_redeemable =
      accs.user_conditional_on_finalize_token_account.amount + accs.user_conditional_on_revert_token_account.amount;

    // Burn both types of conditional tokens
    for (conditional_mint, user_conditional_token_account) in [
      (
        &accs.conditional_on_finalize_token_mint,
        &accs.user_conditional_on_finalize_token_account,
      ),
      (
        &accs.conditional_on_revert_token_mint,
        &accs.user_conditional_on_revert_token_account,
      ),
    ] {
      token::burn(
        CpiContext::new(
          accs.token_program.to_account_info(),
          Burn {
            mint: conditional_mint.to_account_info(),
            from: user_conditional_token_account.to_account_info(),
            authority: accs.authority.to_account_info(),
          },
        ),
        user_conditional_token_account.amount,
      )?;
    }

    // Transfer the combined redeemable amount back to the user
    let seeds = generate_vault_seeds!(vault);
    let signer = &[&seeds[..]];

    token::transfer(
      CpiContext::new_with_signer(
        accs.token_program.to_account_info(),
        Transfer {
          from: accs.vault_underlying_token_account.to_account_info(),
          to: accs.user_underlying_token_account.to_account_info(),
          authority: accs.vault.to_account_info(),
        },
        signer,
      ),
      total_redeemable,
    )?;

    // Reload accounts after the token operations
    ctx.accounts.user_conditional_on_finalize_token_account.reload()?;
    ctx.accounts.user_conditional_on_revert_token_account.reload()?;
    ctx.accounts.vault_underlying_token_account.reload()?;
    ctx.accounts.conditional_on_finalize_token_mint.reload()?;
    ctx.accounts.conditional_on_revert_token_mint.reload()?;

    // Post-condition checks
    assert!(ctx.accounts.user_conditional_on_finalize_token_account.amount == 0);
    assert!(ctx.accounts.user_conditional_on_revert_token_account.amount == 0);

    Ok(())
  }
}
