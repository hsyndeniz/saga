use super::*;

impl InteractWithVault<'_> {
  pub fn handle_mint_conditional_tokens(ctx: Context<Self>, amount: u64, side: Side) -> Result<()> {
    let pre_vault_underlying_balance = ctx.accounts.vault_underlying_token_account.amount;

    let pre_user_conditional_balance = match side {
      Side::Positive => ctx.accounts.user_conditional_on_finalize_token_account.amount,
      Side::Negative => ctx.accounts.user_conditional_on_revert_token_account.amount,
    };
    let pre_mint_supply = match side {
      Side::Positive => ctx.accounts.conditional_on_finalize_token_mint.supply,
      Side::Negative => ctx.accounts.conditional_on_revert_token_mint.supply,
    };

    require!(
      ctx.accounts.user_underlying_token_account.amount >= amount,
      VaultError::InsufficientUnderlyingTokens
    );

    let vault = &mut ctx.accounts.vault;

    let seeds = generate_vault_seeds!(vault);
    let signer = &[&seeds[..]];

    token::transfer(
      CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
          from: ctx.accounts.user_underlying_token_account.to_account_info(),
          to: ctx.accounts.vault_underlying_token_account.to_account_info(),
          authority: ctx.accounts.authority.to_account_info(),
        },
      ),
      amount,
    )?;

    // Mint and update based on the side
    match side {
      Side::Positive => {
        token::mint_to(
          CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
              mint: ctx.accounts.conditional_on_finalize_token_mint.to_account_info(),
              to: ctx.accounts.user_conditional_on_finalize_token_account.to_account_info(),
              authority: vault.to_account_info(),
            },
            signer,
          ),
          amount,
        )?;
        vault.total_positive_tokens_minted += amount;
      }
      Side::Negative => {
        token::mint_to(
          CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
              mint: ctx.accounts.conditional_on_revert_token_mint.to_account_info(),
              to: ctx.accounts.user_conditional_on_revert_token_account.to_account_info(),
              authority: vault.to_account_info(),
            },
            signer,
          ),
          amount,
        )?;
        vault.total_negative_tokens_minted += amount;
      }
    }

    // Reload token accounts and mint supplies
    match side {
      Side::Positive => ctx.accounts.user_conditional_on_finalize_token_account.reload()?,
      Side::Negative => ctx.accounts.user_conditional_on_revert_token_account.reload()?,
    }

    ctx.accounts.vault_underlying_token_account.reload()?;

    match side {
      Side::Positive => ctx.accounts.conditional_on_finalize_token_mint.reload()?,
      Side::Negative => ctx.accounts.conditional_on_revert_token_mint.reload()?,
    }

    let post_user_conditional_balance = match side {
      Side::Positive => ctx.accounts.user_conditional_on_finalize_token_account.amount,
      Side::Negative => ctx.accounts.user_conditional_on_revert_token_account.amount,
    };

    let post_vault_underlying_balance = ctx.accounts.vault_underlying_token_account.amount;

    let post_mint_supply = match side {
      Side::Positive => ctx.accounts.conditional_on_finalize_token_mint.supply,
      Side::Negative => ctx.accounts.conditional_on_revert_token_mint.supply,
    };

    // Only the paranoid survive ;)
    assert!(post_vault_underlying_balance == pre_vault_underlying_balance + amount);
    assert!(post_user_conditional_balance == pre_user_conditional_balance + amount);
    assert!(post_mint_supply == pre_mint_supply + amount);

    Ok(())
  }
}
