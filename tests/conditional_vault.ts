import crypto from 'crypto';
import Arweave from 'arweave';
import { assert, expect } from 'chai';
import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import {
	mintTo,
	getMint,
	Account,
	getAccount,
	createMint,
	unpackMint,
	TOKEN_PROGRAM_ID,
	getAssociatedTokenAddress,
	getAssociatedTokenAddressSync,
	getOrCreateAssociatedTokenAccount,
	createAssociatedTokenAccountIdempotentInstruction,
} from '@solana/spl-token';

import type { Amm } from '../target/types/amm';
import type { ConditionalVault } from '../target/types/conditional_vault';
import type { JWKInterface } from 'arweave/node/lib/wallet';
import type Transaction from 'arweave/node/lib/transaction';

const BN_TEN = new anchor.BN(10);
const PRICE_SCALE = BN_TEN.pow(new anchor.BN(12));
const PRICE_SCALE_NUMBER = 1e12;

describe('conditional_vault', () => {
	// Configure the client to use the local cluster.
	anchor.setProvider(anchor.AnchorProvider.env());
	const connection = anchor.getProvider().connection;

	const program = anchor.workspace.ConditionalVault as Program<ConditionalVault>;
	const amm = anchor.workspace.Amm as Program<Amm>;

	const payer = Keypair.fromSecretKey(
		new Uint8Array([
			32, 163, 129, 210, 1, 13, 187, 206, 98, 34, 149, 86, 187, 218, 206, 186, 220, 153, 25, 119, 9, 36, 162, 45, 132,
			42, 141, 246, 250, 16, 79, 96, 226, 190, 46, 128, 85, 72, 41, 178, 41, 27, 238, 128, 192, 33, 55, 18, 50, 27, 8,
			46, 86, 132, 94, 33, 12, 25, 85, 80, 121, 158, 208, 55,
		]),
	);

	let underlyingTokenMint: PublicKey;
	let vault: PublicKey;
	let vaultUnderlyingTokenAccount: PublicKey;
	let conditionalPositiveTokenMint: PublicKey;
	let conditionalNegativeTokenMint: PublicKey;

	let arweaveWallet: JWKInterface;
	let arweaveAddress: string;
	let arweaveTx: Transaction;

	let claim = 'Will the price of BTC be above $80,000 by the end of 2024?';

	const arweave = Arweave.init({ host: '127.0.0.1', port: 1984, protocol: 'http' });

	// AMM
	let baseMint: PublicKey;
	let quoteMint: PublicKey;

	let ammPda: PublicKey;
	let ammBump: number;
	let lpMint: PublicKey;

	let userBaseAccount: Account;
	let userQuoteAccount: Account;

	before(async () => {
		const airdrop = await connection.requestAirdrop(payer.publicKey, 1000000000);
		await connection.confirmTransaction(airdrop);

		underlyingTokenMint = await createMint(connection, payer, payer.publicKey, null, 6);

		arweaveWallet = await arweave.wallets.generate();
		arweaveAddress = await arweave.wallets.jwkToAddress(arweaveWallet);

		await fetch(`http://127.0.0.1:1984/mint/${arweaveAddress}/1000000000000000`, { method: 'GET' });

		const arweaveBalance = await arweave.wallets.getBalance(arweaveAddress);

		console.log({ arweaveAddress, arweaveBalance: arweave.ar.winstonToAr(arweaveBalance) });
	});

	it('creates an arweave transaction', async () => {
		arweaveTx = await arweave.createTransaction({ data: Buffer.from(claim, 'utf-8') }, arweaveWallet);
		arweaveTx.addTag('Content-Type', 'text/plain');
		arweaveTx.addTag('App-Name', 'arweave-test');
		arweaveTx.addTag('App-Version', '0.0.1');
		arweaveTx.addTag('Title', claim);
		arweaveTx.addTag('Description', 'This is a test event');

		await arweave.transactions.sign(arweaveTx, arweaveWallet);
		await arweave.transactions.post(arweaveTx);
		await fetch(`http://127.0.0.1:1984/mine`, { method: 'GET' });

		const txStatus = await arweave.transactions.getStatus(arweaveTx.id);
		const txData = await arweave.transactions.getData(arweaveTx.id, { decode: true, string: true });
		console.log({ transaction: arweaveTx.id, status: txStatus.status, data: txData });
	});

	it('Is initializes conditional vault', async () => {
		// max length of seed is 32 bytes so we need to hash the arweaveId
		let hexString = crypto.createHash('sha256').update(arweaveTx.id).digest('hex');

		[vault] = PublicKey.findProgramAddressSync(
			[
				Buffer.from('conditional_vault'),
				payer.publicKey.toBuffer(),
				underlyingTokenMint.toBuffer(),
				Buffer.from(hexString, 'hex'),
			],
			program.programId,
		);

		vaultUnderlyingTokenAccount = await getAssociatedTokenAddress(underlyingTokenMint, vault, true);

		[conditionalPositiveTokenMint] = PublicKey.findProgramAddressSync(
			[Buffer.from('conditional_on_finalize_mint'), vault.toBuffer()],
			program.programId,
		);

		[conditionalNegativeTokenMint] = PublicKey.findProgramAddressSync(
			[Buffer.from('conditional_on_revert_mint'), vault.toBuffer()],
			program.programId,
		);

		await program.methods
			.initializeConditionalVault({ settlementAuthority: payer.publicKey, arweaveId: arweaveTx.id, claim })
			.accounts({
				vault,
				underlyingTokenMint,
				vaultUnderlyingTokenAccount,
				conditionalOnFinalizeTokenMint: conditionalPositiveTokenMint,
				conditionalOnRevertTokenMint: conditionalNegativeTokenMint,
			})
			.preInstructions([
				createAssociatedTokenAccountIdempotentInstruction(
					payer.publicKey,
					vaultUnderlyingTokenAccount,
					vault,
					underlyingTokenMint,
				),
			])
			.signers([payer])
			.rpc();
	});

	it('Can mint conditional tokens', async () => {
		let amount = 100000000;

		const userUnderlyingTokenAccount = await getOrCreateAssociatedTokenAccount(
			connection,
			payer,
			underlyingTokenMint,
			payer.publicKey,
			true,
		);
		const userConditionalPositiveTokenAccount = await getOrCreateAssociatedTokenAccount(
			connection,
			payer,
			conditionalPositiveTokenMint,
			payer.publicKey,
			true,
		);
		const userConditionalNegativeTokenAccount = await getOrCreateAssociatedTokenAccount(
			connection,
			payer,
			conditionalNegativeTokenMint,
			payer.publicKey,
			true,
		);

		// mint some underlying tokens to the user
		await mintTo(connection, payer, underlyingTokenMint, userUnderlyingTokenAccount.address, payer, amount * 3, [], {
			commitment: 'confirmed',
		});

		checkUserBalance(
			connection,
			userUnderlyingTokenAccount.address,
			userConditionalPositiveTokenAccount.address,
			userConditionalNegativeTokenAccount.address,
		);

		await program.methods
			.mintConditionalTokens(new anchor.BN(amount * 2), { positive: {} })
			.accounts({
				authority: payer.publicKey,
				vault,
				vaultUnderlyingTokenAccount,
				userUnderlyingTokenAccount: userUnderlyingTokenAccount.address,
				conditionalOnFinalizeTokenMint: conditionalPositiveTokenMint,
				conditionalOnRevertTokenMint: conditionalNegativeTokenMint,
				userConditionalOnFinalizeTokenAccount: userConditionalPositiveTokenAccount.address,
				userConditionalOnRevertTokenAccount: userConditionalNegativeTokenAccount.address,
			})
			.signers([payer])
			.rpc();

		checkUserBalance(
			connection,
			userUnderlyingTokenAccount.address,
			userConditionalPositiveTokenAccount.address,
			userConditionalNegativeTokenAccount.address,
		);
	});

	it('Can cancel vault', async () => {
		await program.methods
			.cancelConditionalVault()
			.accounts({
				settlementAuthority: payer.publicKey,
				vault,
			})
			.signers([payer])
			.rpc();
	});

	it('Can redeem conditional tokens after cancel', async () => {
		const userUnderlyingTokenAccount = await getOrCreateAssociatedTokenAccount(
			connection,
			payer,
			underlyingTokenMint,
			payer.publicKey,
			true,
		);
		const userConditionalPositiveTokenAccount = await getOrCreateAssociatedTokenAccount(
			connection,
			payer,
			conditionalPositiveTokenMint,
			payer.publicKey,
			true,
		);
		const userConditionalNegativeTokenAccount = await getOrCreateAssociatedTokenAccount(
			connection,
			payer,
			conditionalNegativeTokenMint,
			payer.publicKey,
			true,
		);

		await program.methods
			.redeemOnCancel()
			.accounts({
				authority: payer.publicKey,
				userConditionalOnFinalizeTokenAccount: userConditionalPositiveTokenAccount.address,
				userConditionalOnRevertTokenAccount: userConditionalNegativeTokenAccount.address,
				userUnderlyingTokenAccount: userUnderlyingTokenAccount.address,
				vaultUnderlyingTokenAccount,
				vault,
				conditionalOnFinalizeTokenMint: conditionalPositiveTokenMint,
				conditionalOnRevertTokenMint: conditionalNegativeTokenMint,
				tokenProgram: TOKEN_PROGRAM_ID,
			})
			.signers([payer])
			.rpc();

		await checkUserBalance(
			connection,
			userUnderlyingTokenAccount.address,
			userConditionalPositiveTokenAccount.address,
			userConditionalNegativeTokenAccount.address,
		);
	});

	it('Will create a new vault', async () => {
		claim = 'Will the price of BTC be above $100,000 by the end of 2024?';
		arweaveTx = await arweave.createTransaction({ data: Buffer.from(claim, 'utf-8') }, arweaveWallet);
		arweaveTx.addTag('Content-Type', 'text/plain');
		arweaveTx.addTag('App-Name', 'arweave-test');
		arweaveTx.addTag('App-Version', '0.0.1');
		arweaveTx.addTag('Title', claim);
		arweaveTx.addTag('Description', 'This is a test event');

		await arweave.transactions.sign(arweaveTx, arweaveWallet);
		await arweave.transactions.post(arweaveTx);
		await fetch(`http://127.0.0.1:1984/mine`, { method: 'GET' });

		let hexString = crypto.createHash('sha256').update(arweaveTx.id).digest('hex');

		[vault] = PublicKey.findProgramAddressSync(
			[
				Buffer.from('conditional_vault'),
				payer.publicKey.toBuffer(),
				underlyingTokenMint.toBuffer(),
				Buffer.from(hexString, 'hex'),
			],
			program.programId,
		);

		vaultUnderlyingTokenAccount = await getAssociatedTokenAddress(underlyingTokenMint, vault, true);

		[conditionalPositiveTokenMint] = PublicKey.findProgramAddressSync(
			[Buffer.from('conditional_on_finalize_mint'), vault.toBuffer()],
			program.programId,
		);

		[conditionalNegativeTokenMint] = PublicKey.findProgramAddressSync(
			[Buffer.from('conditional_on_revert_mint'), vault.toBuffer()],
			program.programId,
		);

		await program.methods
			.initializeConditionalVault({ settlementAuthority: payer.publicKey, arweaveId: arweaveTx.id, claim: claim })
			.accounts({
				vault,
				underlyingTokenMint,
				vaultUnderlyingTokenAccount,
				conditionalOnFinalizeTokenMint: conditionalPositiveTokenMint,
				conditionalOnRevertTokenMint: conditionalNegativeTokenMint,
			})
			.preInstructions([
				createAssociatedTokenAccountIdempotentInstruction(
					payer.publicKey,
					vaultUnderlyingTokenAccount,
					vault,
					underlyingTokenMint,
				),
			])
			.signers([payer])
			.rpc();
	});

	it('Can resolve vault', async () => {
		await program.methods
			.resolveConditionalVault(true)
			.accounts({
				vault,
				settlementAuthority: payer.publicKey,
			})
			.signers([payer])
			.rpc();
	});

	it('Can redeem conditional tokens after resolve', async () => {
		const userUnderlyingTokenAccount = await getOrCreateAssociatedTokenAccount(
			connection,
			payer,
			underlyingTokenMint,
			payer.publicKey,
			true,
		);
		const userConditionalPositiveTokenAccount = await getOrCreateAssociatedTokenAccount(
			connection,
			payer,
			conditionalPositiveTokenMint,
			payer.publicKey,
			true,
		);
		const userConditionalNegativeTokenAccount = await getOrCreateAssociatedTokenAccount(
			connection,
			payer,
			conditionalNegativeTokenMint,
			payer.publicKey,
			true,
		);

		await program.methods
			.redeemConditionalTokensForUnderlyingTokens()
			.accounts({
				authority: payer.publicKey,
				userConditionalOnFinalizeTokenAccount: userConditionalPositiveTokenAccount.address,
				userConditionalOnRevertTokenAccount: userConditionalNegativeTokenAccount.address,
				userUnderlyingTokenAccount: userUnderlyingTokenAccount.address,
				vaultUnderlyingTokenAccount,
				vault,
				conditionalOnFinalizeTokenMint: conditionalPositiveTokenMint,
				conditionalOnRevertTokenMint: conditionalNegativeTokenMint,
				tokenProgram: TOKEN_PROGRAM_ID,
			})
			.signers([payer])
			.rpc();

		await checkUserBalance(
			connection,
			userUnderlyingTokenAccount.address,
			userConditionalPositiveTokenAccount.address,
			userConditionalNegativeTokenAccount.address,
		);
	});

	it('creates an amm', async () => {
		let twapInitialObservation = 500;
		let twapMaxObservationChangePerUpdate = twapInitialObservation * 0.02;

		baseMint = await createMint(connection, payer, payer.publicKey, null, 9);
		quoteMint = await createMint(connection, payer, payer.publicKey, null, 6);

		let baseDecimals = unpackMint(baseMint, await connection.getAccountInfo(baseMint)).decimals;
		let quoteDecimals = unpackMint(quoteMint, await connection.getAccountInfo(quoteMint)).decimals;

		let [twapFirstObservationScaled, twapMaxObservationChangePerUpdateScaled] = PriceMath.getAmmPrices(
			baseDecimals,
			quoteDecimals,
			twapInitialObservation,
			twapMaxObservationChangePerUpdate,
		);

		[ammPda, ammBump] = PublicKey.findProgramAddressSync(
			[Buffer.from('amm__'), baseMint.toBuffer(), quoteMint.toBuffer()],
			amm.programId,
		);

		[lpMint] = PublicKey.findProgramAddressSync([Buffer.from('amm_lp_mint'), ammPda.toBuffer()], amm.programId);

		let vaultAtaBase = getAssociatedTokenAddressSync(baseMint, ammPda, true);
		let vaultAtaQuote = getAssociatedTokenAddressSync(quoteMint, ammPda, true);

		await amm.methods
			.createAmm({
				twapInitialObservation: twapFirstObservationScaled,
				twapMaxObservationChangePerUpdate: twapMaxObservationChangePerUpdateScaled,
			})
			.accounts({
				user: payer.publicKey,
				amm: ammPda,
				lpMint,
				baseMint,
				quoteMint,
				vaultAtaBase,
				vaultAtaQuote,
			})
			.preInstructions([
				createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, vaultAtaBase, ammPda, baseMint),
				createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, vaultAtaQuote, ammPda, quoteMint),
			])
			.signers([payer])
			.rpc();

		let ammAccount = await amm.account.amm.fetch(ammPda);

		assert.equal(ammAccount.bump, ammBump);
		assert.isTrue(ammAccount.createdAtSlot.eq(ammAccount.oracle.lastUpdatedSlot));
		assert.equal(ammAccount.lpMint.toBase58(), lpMint.toBase58());
		assert.equal(ammAccount.baseMint.toBase58(), baseMint.toBase58());
		assert.equal(ammAccount.quoteMint.toBase58(), quoteMint.toBase58());
		assert.equal(ammAccount.baseMintDecimals, 9);
		assert.equal(ammAccount.quoteMintDecimals, 6);
		assert.isTrue(ammAccount.baseAmount.eqn(0));
		assert.isTrue(ammAccount.quoteAmount.eqn(0));
		assert.isTrue(ammAccount.oracle.lastObservation.eq(twapFirstObservationScaled));
		assert.isTrue(ammAccount.oracle.aggregator.eqn(0));
		assert.isTrue(ammAccount.oracle.maxObservationChangePerUpdate.eq(twapMaxObservationChangePerUpdateScaled));
		assert.isTrue(ammAccount.oracle.initialObservation.eq(twapFirstObservationScaled));
	});

	it('adds initial liquidity to an amm', async () => {
		const userLpAccount = getAssociatedTokenAddressSync(lpMint, payer.publicKey);

		userBaseAccount = await getOrCreateAssociatedTokenAccount(connection, payer, baseMint, payer.publicKey, true);
		userQuoteAccount = await getOrCreateAssociatedTokenAccount(connection, payer, quoteMint, payer.publicKey, true);

		await mintTo(connection, payer, baseMint, userBaseAccount.address, payer, 10_000 * 10 ** 9, [], {
			commitment: 'confirmed',
		});
		await mintTo(connection, payer, quoteMint, userQuoteAccount.address, payer, 1_000_000 * 10 ** 6, [], {
			commitment: 'confirmed',
		});

		await amm.methods
			.addLiquidity({
				quoteAmount: new anchor.BN(5000 * 10 ** 6),
				maxBaseAmount: new anchor.BN(6 * 10 ** 9),
				minLpTokens: new anchor.BN(0),
			})
			.accounts({
				user: payer.publicKey,
				amm: ammPda,
				lpMint,
				userLpAccount,
				userBaseAccount: getAssociatedTokenAddressSync(baseMint, payer.publicKey),
				userQuoteAccount: getAssociatedTokenAddressSync(quoteMint, payer.publicKey),
				vaultAtaBase: getAssociatedTokenAddressSync(baseMint, ammPda, true),
				vaultAtaQuote: getAssociatedTokenAddressSync(quoteMint, ammPda, true),
			})
			.preInstructions([
				createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, userLpAccount, payer.publicKey, lpMint),
			])
			.signers([payer])
			.rpc();

		let ammAccount = await amm.account.amm.fetch(ammPda);
		let userLpAccountInfo = await connection.getTokenAccountBalance(userLpAccount);
		let userBaseAccountInfo = await connection.getTokenAccountBalance(userBaseAccount.address);
		let userQuoteAccountInfo = await connection.getTokenAccountBalance(userQuoteAccount.address);

		assert.equal(
			(await getAccount(connection, getAssociatedTokenAddressSync(ammAccount.lpMint, payer.publicKey))).amount,
			BigInt(5000 * 10 ** 6),
		);
	});

	it("adds liquidity after it's already been added", async () => {
		// first transaction should fail because the max base amount is exceeded
		await amm.methods
			.addLiquidity({
				quoteAmount: new anchor.BN(5000 * 10 ** 6),
				maxBaseAmount: new anchor.BN(5 * 10 ** 9),
				minLpTokens: new anchor.BN(5000 * 10 ** 6 + 1),
			})
			.accounts({
				user: payer.publicKey,
				amm: ammPda,
				lpMint,
				userLpAccount: getAssociatedTokenAddressSync(lpMint, payer.publicKey),
				userBaseAccount: getAssociatedTokenAddressSync(baseMint, payer.publicKey),
				userQuoteAccount: getAssociatedTokenAddressSync(quoteMint, payer.publicKey),
				vaultAtaBase: getAssociatedTokenAddressSync(baseMint, ammPda, true),
				vaultAtaQuote: getAssociatedTokenAddressSync(quoteMint, ammPda, true),
			})
			.signers([payer])
			.rpc()
			.catch(err => expect(err.error.errorCode.code).to.equal('AddLiquidityMaxBaseExceeded'));

		// second transaction should succeed
		await amm.methods
			.addLiquidity({
				quoteAmount: new anchor.BN(5000 * 10 ** 6),
				maxBaseAmount: new anchor.BN(6 * 10 ** 9 + 1),
				minLpTokens: new anchor.BN(5000 * 10 ** 6),
			})
			.accounts({
				user: payer.publicKey,
				amm: ammPda,
				lpMint,
				userLpAccount: getAssociatedTokenAddressSync(lpMint, payer.publicKey),
				userBaseAccount: getAssociatedTokenAddressSync(baseMint, payer.publicKey),
				userQuoteAccount: getAssociatedTokenAddressSync(quoteMint, payer.publicKey),
				vaultAtaBase: getAssociatedTokenAddressSync(baseMint, ammPda, true),
				vaultAtaQuote: getAssociatedTokenAddressSync(quoteMint, ammPda, true),
			})
			.signers([payer])
			.rpc();

		let ammAccount = await amm.account.amm.fetch(ammPda);

		assert.equal(ammAccount.baseAmount.toNumber(), 12 * 10 ** 9 + 1);
		assert.equal(ammAccount.quoteAmount.toNumber(), 10000 * 10 ** 6);
		assert.equal(
			(await getAccount(connection, getAssociatedTokenAddressSync(ammAccount.baseMint, ammPda, true))).amount,
			BigInt(12 * 10 ** 9 + 1),
		);
		assert.equal(
			(await getAccount(connection, getAssociatedTokenAddressSync(ammAccount.quoteMint, ammPda, true))).amount,
			BigInt(10000 * 10 ** 6),
		);
		assert.equal((await getMint(connection, ammAccount.lpMint)).supply, BigInt(10000 * 10 ** 6));
	});

	it("Can't swap because of insufficient funds", async () => {
		let quoteDecimals = await unpackMint(quoteMint, await connection.getAccountInfo(quoteMint)).decimals;
		let baseDecimals = await unpackMint(baseMint, await connection.getAccountInfo(baseMint)).decimals;

		let swapType: { buy?: {} } | { sell?: {} } = { buy: {} };
		let inputAmount = 10_000_000;
		let outputAmountMin = 1;

		const receivingToken = swapType.buy ? baseMint : quoteMint;

		let inputAmountScaled: anchor.BN;
		let outputAmountMinScaled: anchor.BN;
		if (swapType.buy) {
			inputAmountScaled = PriceMath.scale(inputAmount, quoteDecimals);
			outputAmountMinScaled = PriceMath.scale(outputAmountMin, baseDecimals);
		} else {
			inputAmountScaled = PriceMath.scale(inputAmount, baseDecimals);
			outputAmountMinScaled = PriceMath.scale(outputAmountMin, quoteDecimals);
		}

		await amm.methods
			.swap({
				swapType: { buy: {} },
				inputAmount: inputAmountScaled,
				outputAmountMin: outputAmountMinScaled,
			})
			.accounts({
				user: payer.publicKey,
				amm: ammPda,
				userBaseAccount: getAssociatedTokenAddressSync(baseMint, payer.publicKey),
				userQuoteAccount: getAssociatedTokenAddressSync(quoteMint, payer.publicKey),
				vaultAtaBase: getAssociatedTokenAddressSync(baseMint, ammPda, true),
				vaultAtaQuote: getAssociatedTokenAddressSync(quoteMint, ammPda, true),
			})
			.preInstructions([
				// create the receiving token account if it doesn't exist
				createAssociatedTokenAccountIdempotentInstruction(
					payer.publicKey,
					getAssociatedTokenAddressSync(receivingToken, payer.publicKey),
					payer.publicKey,
					receivingToken,
				),
			])
			.signers([payer])
			.rpc()
			.catch(err => expect(err.error.errorCode.code).to.equal('InsufficientBalance'));

		swapType = { sell: {} };
		inputAmount = 100_000;
		outputAmountMin = 1;

		if (swapType.sell) {
			inputAmountScaled = PriceMath.scale(inputAmount, baseDecimals);
			outputAmountMinScaled = PriceMath.scale(outputAmountMin, quoteDecimals);
		} else {
			inputAmountScaled = PriceMath.scale(inputAmount, quoteDecimals);
			outputAmountMinScaled = PriceMath.scale(outputAmountMin, baseDecimals);
		}

		await amm.methods
			.swap({
				swapType: { sell: {} },
				inputAmount: inputAmountScaled,
				outputAmountMin: outputAmountMinScaled,
			})
			.accounts({
				user: payer.publicKey,
				amm: ammPda,
				userBaseAccount: getAssociatedTokenAddressSync(baseMint, payer.publicKey),
				userQuoteAccount: getAssociatedTokenAddressSync(quoteMint, payer.publicKey),
				vaultAtaBase: getAssociatedTokenAddressSync(baseMint, ammPda, true),
				vaultAtaQuote: getAssociatedTokenAddressSync(quoteMint, ammPda, true),
			})
			.preInstructions([
				// create the receiving token account if it doesn't exist
				createAssociatedTokenAccountIdempotentInstruction(
					payer.publicKey,
					getAssociatedTokenAddressSync(receivingToken, payer.publicKey),
					payer.publicKey,
					receivingToken,
				),
			])
			.signers([payer])
			.rpc()
			.catch(err => expect(err.error.errorCode.code).to.equal('InsufficientBalance'));
	});

	it('Can swap(buy) tokens', async () => {
		// USDC amount = 10,000
		// META amount = 10
		// k = (10,000 * 10) = 100,000
		// swap amount = 100
		// swap amount after fees = 99
		// new USDC amount = 10,099
		// new META amount = 100,000 / 10,099 = 9.9019...
		// meta out = 10 - 9.9019 = 0.098029507

		let inputAmount = 100;
		let expectedOut = 0.098029507 + 0.02; // 0.098029507 is the expected output, 0.02 is the slippage

		let baseDecimals = await unpackMint(baseMint, await connection.getAccountInfo(baseMint)).decimals;
		let quoteDecimals = await unpackMint(quoteMint, await connection.getAccountInfo(quoteMint)).decimals;

		let inputAmountScaled = PriceMath.scale(inputAmount, quoteDecimals);
		let outputAmountMinScaled = PriceMath.scale(expectedOut, baseDecimals);

		await amm.methods
			.swap({
				swapType: { buy: {} },
				inputAmount: inputAmountScaled,
				outputAmountMin: outputAmountMinScaled,
			})
			.accounts({
				user: payer.publicKey,
				amm: ammPda,
				userBaseAccount: getAssociatedTokenAddressSync(baseMint, payer.publicKey),
				userQuoteAccount: getAssociatedTokenAddressSync(quoteMint, payer.publicKey),
				vaultAtaBase: getAssociatedTokenAddressSync(baseMint, ammPda, true),
				vaultAtaQuote: getAssociatedTokenAddressSync(quoteMint, ammPda, true),
			})
			.preInstructions([
				// create the receiving token account if it doesn't exist
				createAssociatedTokenAccountIdempotentInstruction(
					payer.publicKey,
					getAssociatedTokenAddressSync(baseMint, payer.publicKey),
					payer.publicKey,
					baseMint,
				),
			])
			.signers([payer])
			.rpc()
			.catch(err => expect(err.error.errorCode.code).to.equal('SwapSlippageExceeded'));

		expectedOut = expectedOut - 0.02;
		outputAmountMinScaled = PriceMath.scale(expectedOut, baseDecimals);

		await amm.methods
			.swap({
				swapType: { buy: {} },
				inputAmount: inputAmountScaled,
				outputAmountMin: outputAmountMinScaled,
			})
			.accounts({
				user: payer.publicKey,
				amm: ammPda,
				userBaseAccount: getAssociatedTokenAddressSync(baseMint, payer.publicKey),
				userQuoteAccount: getAssociatedTokenAddressSync(quoteMint, payer.publicKey),
				vaultAtaBase: getAssociatedTokenAddressSync(baseMint, ammPda, true),
				vaultAtaQuote: getAssociatedTokenAddressSync(quoteMint, ammPda, true),
			})
			.preInstructions([
				// create the receiving token account if it doesn't exist
				createAssociatedTokenAccountIdempotentInstruction(
					payer.publicKey,
					getAssociatedTokenAddressSync(baseMint, payer.publicKey),
					payer.publicKey,
					baseMint,
				),
			])
			.signers([payer])
			.rpc();

		let ammAccount = await amm.account.amm.fetch(ammPda);

		assert.equal(ammAccount.quoteAmount.toNumber(), (10000 + 100) * 10 ** 6);
		assert.equal(
			(await getAccount(connection, getAssociatedTokenAddressSync(ammAccount.quoteMint, ammPda, true))).amount,
			BigInt((10000 + 100) * 10 ** 6),
		);
		assert.equal((await getMint(connection, ammAccount.lpMint)).supply, BigInt(10000 * 10 ** 6));
	});

	it('Can swap(sell) tokens', async () => {
		// USDC amount = 10,099
		// META amount = 9.9019...
		// k = (10,099 * 9.9019...) = 100,000
		// swap amount = 100
		// swap amount after fees = 99
		// new USDC amount = 10,000
		// new META amount = 100,000 / 10,000 = 10
		// meta out = 10 - 9.9019 = 0.098029507

		let inputAmount = 100;
		let expectedOut = 0.098029507 + 0.02; // 0.098029507 is the expected output, 0.02 is the slippage

		let baseDecimals = await unpackMint(baseMint, await connection.getAccountInfo(baseMint)).decimals;
		let quoteDecimals = await unpackMint(quoteMint, await connection.getAccountInfo(quoteMint)).decimals;

		let inputAmountScaled = PriceMath.scale(inputAmount, baseDecimals);
		let outputAmountMinScaled = PriceMath.scale(expectedOut, quoteDecimals);

		await amm.methods
			.swap({
				swapType: { sell: {} },
				inputAmount: inputAmountScaled,
				outputAmountMin: outputAmountMinScaled,
			})
			.accounts({
				user: payer.publicKey,
				amm: ammPda,
				userBaseAccount: getAssociatedTokenAddressSync(baseMint, payer.publicKey),
				userQuoteAccount: getAssociatedTokenAddressSync(quoteMint, payer.publicKey),
				vaultAtaBase: getAssociatedTokenAddressSync(baseMint, ammPda, true),
				vaultAtaQuote: getAssociatedTokenAddressSync(quoteMint, ammPda, true),
			})
			.preInstructions([
				// create the receiving token account if it doesn't exist
				createAssociatedTokenAccountIdempotentInstruction(
					payer.publicKey,
					getAssociatedTokenAddressSync(quoteMint, payer.publicKey),
					payer.publicKey,
					quoteMint,
				),
			])
			.signers([payer])
			.rpc()
			.catch(err => expect(err.error.errorCode.code).to.equal('SwapSlippageExceeded'));

		expectedOut = expectedOut - 0.02;
		outputAmountMinScaled = PriceMath.scale(expectedOut, quoteDecimals);

		await amm.methods
			.swap({
				swapType: { sell: {} },
				inputAmount: inputAmountScaled,
				outputAmountMin: outputAmountMinScaled,
			})
			.accounts({
				user: payer.publicKey,
				amm: ammPda,
				userBaseAccount: getAssociatedTokenAddressSync(baseMint, payer.publicKey),
				userQuoteAccount: getAssociatedTokenAddressSync(quoteMint, payer.publicKey),
				vaultAtaBase: getAssociatedTokenAddressSync(baseMint, ammPda, true),
				vaultAtaQuote: getAssociatedTokenAddressSync(quoteMint, ammPda, true),
			})
			.preInstructions([
				// create the receiving token account if it doesn't exist
				createAssociatedTokenAccountIdempotentInstruction(
					payer.publicKey,
					getAssociatedTokenAddressSync(quoteMint, payer.publicKey),
					payer.publicKey,
					quoteMint,
				),
			])
			.signers([payer])
			.rpc();
	});

	it('swap base to quote and back, should not be profitable', async () => {
		const permissionlessAmmStart = await amm.account.amm.fetch(ammPda);

		let startingBaseSwapAmount = 1 * 10 ** 9;

		await amm.methods
			.swap({
				swapType: { sell: {} },
				inputAmount: new anchor.BN(startingBaseSwapAmount),
				outputAmountMin: new anchor.BN(1),
			})
			.accounts({
				user: payer.publicKey,
				amm: ammPda,
				userBaseAccount: getAssociatedTokenAddressSync(baseMint, payer.publicKey),
				userQuoteAccount: getAssociatedTokenAddressSync(quoteMint, payer.publicKey),
				vaultAtaBase: getAssociatedTokenAddressSync(baseMint, ammPda, true),
				vaultAtaQuote: getAssociatedTokenAddressSync(quoteMint, ammPda, true),
			})
			.preInstructions([
				// create the receiving token account if it doesn't exist
				createAssociatedTokenAccountIdempotentInstruction(
					payer.publicKey,
					getAssociatedTokenAddressSync(quoteMint, payer.publicKey),
					payer.publicKey,
					quoteMint,
				),
			])
			.signers([payer])
			.rpc();

		let ammAccount = await amm.account.amm.fetch(ammPda);

		let quoteReceived = permissionlessAmmStart.quoteAmount.toNumber() - ammAccount.quoteAmount.toNumber();

		await amm.methods
			.swap({
				swapType: { buy: {} },
				inputAmount: new anchor.BN(quoteReceived),
				outputAmountMin: new anchor.BN(1),
			})
			.accounts({
				user: payer.publicKey,
				amm: ammPda,
				userBaseAccount: getAssociatedTokenAddressSync(baseMint, payer.publicKey),
				userQuoteAccount: getAssociatedTokenAddressSync(quoteMint, payer.publicKey),
				vaultAtaBase: getAssociatedTokenAddressSync(baseMint, ammPda, true),
				vaultAtaQuote: getAssociatedTokenAddressSync(quoteMint, ammPda, true),
			})
			.preInstructions([
				// create the receiving token account if it doesn't exist
				createAssociatedTokenAccountIdempotentInstruction(
					payer.publicKey,
					getAssociatedTokenAddressSync(baseMint, payer.publicKey),
					payer.publicKey,
					baseMint,
				),
			])
			.signers([payer])
			.rpc();

		let finalAmmAccount = await amm.account.amm.fetch(ammPda);

		let baseReceived = ammAccount.baseAmount.toNumber() - finalAmmAccount.baseAmount.toNumber();

		assert.isBelow(baseReceived, startingBaseSwapAmount);
		assert.isAbove(baseReceived, startingBaseSwapAmount * 0.98); // 1% swap fee both ways
	});

	it('remove some liquidity from an amm position', async function () {
		let ammStart = await amm.account.amm.fetch(ammPda);

		let userLpAccount = getAssociatedTokenAddressSync(lpMint, payer.publicKey);

		const userLpAccountStart = await getAccount(connection, userLpAccount);
		const lpMintStart = await getMint(connection, lpMint);

		await amm.methods
			.removeLiquidity({
				lpTokensToBurn: new anchor.BN(userLpAccountStart.amount.toString()).divn(2),
				minBaseAmount: new anchor.BN(0),
				minQuoteAmount: new anchor.BN(0),
			})
			.accounts({
				user: payer.publicKey,
				amm: ammPda,
				lpMint,
				userLpAccount: getAssociatedTokenAddressSync(lpMint, payer.publicKey),
				userBaseAccount: getAssociatedTokenAddressSync(baseMint, payer.publicKey),
				userQuoteAccount: getAssociatedTokenAddressSync(quoteMint, payer.publicKey),
				vaultAtaBase: getAssociatedTokenAddressSync(baseMint, ammPda, true),
				vaultAtaQuote: getAssociatedTokenAddressSync(quoteMint, ammPda, true),
			})
			.signers([payer])
			.rpc();

		const userLpAccountEnd = await getAccount(connection, userLpAccount);
		const lpMintEnd = await getMint(connection, lpMint);

		const ammEnd = await amm.account.amm.fetch(ammPda);

		assert.isBelow(Number(lpMintEnd.supply), Number(lpMintStart.supply));
		assert.isBelow(Number(userLpAccountEnd.amount), Number(userLpAccountStart.amount));
		assert.isBelow(ammEnd.baseAmount.toNumber(), ammStart.baseAmount.toNumber());
		assert.isBelow(ammEnd.quoteAmount.toNumber(), ammStart.quoteAmount.toNumber());
	});

	it('remove all liquidity from an amm position', async function () {
		let ammStart = await amm.account.amm.fetch(ammPda);

		let userLpAccount = getAssociatedTokenAddressSync(lpMint, payer.publicKey);

		const userLpAccountStart = await getAccount(connection, userLpAccount);
		const lpMintStart = await getMint(connection, lpMint);

		await amm.methods
			.removeLiquidity({
				lpTokensToBurn: new anchor.BN(userLpAccountStart.amount.toString()),
				minBaseAmount: new anchor.BN(0),
				minQuoteAmount: new anchor.BN(0),
			})
			.accounts({
				user: payer.publicKey,
				amm: ammPda,
				lpMint,
				userLpAccount: getAssociatedTokenAddressSync(lpMint, payer.publicKey),
				userBaseAccount: getAssociatedTokenAddressSync(baseMint, payer.publicKey),
				userQuoteAccount: getAssociatedTokenAddressSync(quoteMint, payer.publicKey),
				vaultAtaBase: getAssociatedTokenAddressSync(baseMint, ammPda, true),
				vaultAtaQuote: getAssociatedTokenAddressSync(quoteMint, ammPda, true),
			})
			.signers([payer])
			.rpc();

		const userLpAccountEnd = await getAccount(connection, userLpAccount);
		const lpMintEnd = await getMint(connection, lpMint);

		const ammEnd = await amm.account.amm.fetch(ammPda);

		assert.equal(Number(lpMintEnd.supply), 0);
		assert.equal(Number(userLpAccountEnd.amount), 0);
		assert.equal(ammEnd.baseAmount.toNumber(), 0);
		assert.equal(ammEnd.quoteAmount.toNumber(), 0);
	});

	it('Can create a new vault and amm with in a single atomic transaction', async () => {
		claim = 'Will the price of Ethereum be above $5000 on 2024?';
		arweaveTx = await arweave.createTransaction({ data: Buffer.from(claim, 'utf-8') }, arweaveWallet);
		arweaveTx.addTag('Content-Type', 'text/plain');
		arweaveTx.addTag('App-Name', 'arweave-test');
		arweaveTx.addTag('App-Version', '0.0.1');
		arweaveTx.addTag('Title', claim);
		arweaveTx.addTag('Description', 'This is a test event');

		await arweave.transactions.sign(arweaveTx, arweaveWallet);
		await arweave.transactions.post(arweaveTx);
		await fetch(`http://127.0.0.1:1984/mine`, { method: 'GET' });

		let hexString = crypto.createHash('sha256').update(arweaveTx.id).digest('hex');

		[vault] = PublicKey.findProgramAddressSync(
			[
				Buffer.from('conditional_vault'),
				payer.publicKey.toBuffer(),
				underlyingTokenMint.toBuffer(),
				Buffer.from(hexString, 'hex'),
			],
			program.programId,
		);

		vaultUnderlyingTokenAccount = await getAssociatedTokenAddress(underlyingTokenMint, vault, true);

		[conditionalPositiveTokenMint] = PublicKey.findProgramAddressSync(
			[Buffer.from('conditional_on_finalize_mint'), vault.toBuffer()],
			program.programId,
		);

		[conditionalNegativeTokenMint] = PublicKey.findProgramAddressSync(
			[Buffer.from('conditional_on_revert_mint'), vault.toBuffer()],
			program.programId,
		);

		// create the amm transaction
		let twapInitialObservation = 500;
		let twapMaxObservationChangePerUpdate = twapInitialObservation * 0.02;

		baseMint = await createMint(connection, payer, payer.publicKey, null, 9);
		quoteMint = await createMint(connection, payer, payer.publicKey, null, 6);

		let baseDecimals = unpackMint(baseMint, await connection.getAccountInfo(baseMint)).decimals;
		let quoteDecimals = unpackMint(quoteMint, await connection.getAccountInfo(quoteMint)).decimals;

		let [twapFirstObservationScaled, twapMaxObservationChangePerUpdateScaled] = PriceMath.getAmmPrices(
			baseDecimals,
			quoteDecimals,
			twapInitialObservation,
			twapMaxObservationChangePerUpdate,
		);

		[ammPda, ammBump] = PublicKey.findProgramAddressSync(
			[Buffer.from('amm__'), baseMint.toBuffer(), quoteMint.toBuffer()],
			amm.programId,
		);

		[lpMint] = PublicKey.findProgramAddressSync([Buffer.from('amm_lp_mint'), ammPda.toBuffer()], amm.programId);

		let vaultAtaBase = getAssociatedTokenAddressSync(baseMint, ammPda, true);
		let vaultAtaQuote = getAssociatedTokenAddressSync(quoteMint, ammPda, true);

		let ammTx = await amm.methods
			.createAmm({
				twapInitialObservation: twapFirstObservationScaled,
				twapMaxObservationChangePerUpdate: twapMaxObservationChangePerUpdateScaled,
			})
			.accounts({
				user: payer.publicKey,
				amm: ammPda,
				lpMint,
				baseMint,
				quoteMint,
				vaultAtaBase,
				vaultAtaQuote,
			})
			.preInstructions([
				createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, vaultAtaBase, ammPda, baseMint),
				createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, vaultAtaQuote, ammPda, quoteMint),
			])
			.transaction();

		await program.methods
			.initializeConditionalVault({ settlementAuthority: payer.publicKey, arweaveId: arweaveTx.id, claim: claim })
			.accounts({
				vault,
				underlyingTokenMint,
				vaultUnderlyingTokenAccount,
				conditionalOnFinalizeTokenMint: conditionalPositiveTokenMint,
				conditionalOnRevertTokenMint: conditionalNegativeTokenMint,
			})
			.preInstructions([
				createAssociatedTokenAccountIdempotentInstruction(
					payer.publicKey,
					vaultUnderlyingTokenAccount,
					vault,
					underlyingTokenMint,
				),
			])
			.postInstructions([...ammTx.instructions])
			.signers([payer])
			.rpc();

		let vaultAccount = await program.account.conditionalVault.fetch(vault);
		let ammAccount = await amm.account.amm.fetch(ammPda);

		console.log({ vaultAccount, ammAccount });
	});
});

const checkUserBalance = async (
	connection: Connection,
	collateral: PublicKey,
	positive: PublicKey,
	negative: PublicKey,
) => {
	// check underlying token balance, conditional positive token balance, conditional negative token balance
	const userUnderlyingTokenAccount = await connection.getTokenAccountBalance(collateral);
	const userConditionalPositiveTokenAccount = await connection.getTokenAccountBalance(positive);
	const userConditionalNegativeTokenAccount = await connection.getTokenAccountBalance(negative);

	console.log({
		userUnderlyingTokenAccount: userUnderlyingTokenAccount.value.uiAmount,
		userConditionalPositiveTokenAccount: userConditionalPositiveTokenAccount.value.uiAmount,
		userConditionalNegativeTokenAccount: userConditionalNegativeTokenAccount.value.uiAmount,
	});
};

export class PriceMath {
	public static getAmmPriceFromReserves(baseReserves: anchor.BN, quoteReserves: anchor.BN): anchor.BN {
		return quoteReserves.mul(PRICE_SCALE).div(baseReserves);
	}

	public static getChainAmount(humanAmount: number, decimals: number): anchor.BN {
		// you have to do it this weird way because BN can't be constructed with
		// numbers larger than 2**50
		const [integerPart, fractionalPart = ''] = humanAmount.toString().split('.');
		return new anchor.BN(integerPart + fractionalPart)
			.mul(new anchor.BN(10).pow(new anchor.BN(decimals)))
			.div(new anchor.BN(10).pow(new anchor.BN(fractionalPart.length)));
	}

	public static getHumanAmount(chainAmount: anchor.BN, decimals: number): number {
		return chainAmount.toNumber() / 10 ** decimals;
	}

	public static getHumanPrice(ammPrice: anchor.BN, baseDecimals: number, quoteDecimals: number): number {
		const decimalScalar = BN_TEN.pow(new anchor.BN(quoteDecimals - baseDecimals).abs());
		const price1e12 = quoteDecimals > baseDecimals ? ammPrice.div(decimalScalar) : ammPrice.mul(decimalScalar);

		// in case the BN is too large to cast to number, we try
		try {
			return price1e12.toNumber() / 1e12;
		} catch (e) {
			// BN tried to cast into number larger than 53 bits so we we do division via BN methods first, then cast to number(so it is smaller before the cast)
			return price1e12.div(new anchor.BN(1e12)).toNumber();
		}
	}

	public static getAmmPrice(humanPrice: number, baseDecimals: number, quoteDecimals: number): anchor.BN {
		let price1e12 = new anchor.BN(humanPrice * PRICE_SCALE_NUMBER);

		let decimalScalar = BN_TEN.pow(new anchor.BN(quoteDecimals - baseDecimals).abs());

		let scaledPrice = quoteDecimals > baseDecimals ? price1e12.mul(decimalScalar) : price1e12.div(decimalScalar);

		return scaledPrice;
	}

	public static getAmmPrices(baseDecimals: number, quoteDecimals: number, ...prices: number[]): anchor.BN[] {
		// Map through each price, scaling it using the scalePrice method
		return prices.map(price => this.getAmmPrice(price, baseDecimals, quoteDecimals));
	}

	public static scale(number: number, decimals: number): anchor.BN {
		return new anchor.BN(number * 10 ** decimals);
		// return new anchor.BN(number).mul(new anchor.BN(10).pow(new anchor.BN(decimals)));
	}

	public static addSlippage(chainAmount: anchor.BN, slippageBps: anchor.BN): anchor.BN {
		return chainAmount.mul(slippageBps.addn(10_000)).divn(10_000);
	}

	public static subtractSlippage(chainAmount: anchor.BN, slippageBps: anchor.BN): anchor.BN {
		return chainAmount.mul(new anchor.BN(10_000).sub(slippageBps)).divn(10_000);
	}
}
