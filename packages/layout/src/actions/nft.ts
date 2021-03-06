import {
  programIds,
  sendTransactionWithRetry,
  findProgramAddress,
  StringPublicKey,
  toPublicKey,
  getAssetCostToStore,
  AR_SOL_HOLDER_ID,
  CHAIN_ENV,
} from '@metaplex/utils'
import {
  Attribute,
  createAssociatedTokenAccountInstruction,
  createMasterEdition,
  createMetadata,
  createMint,
  Creator,
  Data,
  updateMetadata,
} from './base'
import { MintLayout, Token } from '@solana/spl-token'
import { Keypair, Connection, SystemProgram, TransactionInstruction } from '@solana/web3.js'
import crypto from 'crypto'
import BN from 'bn.js'
import { WalletAdapter } from '@solana/wallet-adapter-base'
import fetch from 'cross-fetch'
import FormData from 'form-data'
import { v4 as uuidv4 } from 'uuid'

const RESERVED_TXN_MANIFEST = 'manifest.json'

interface IArweaveResult {
  error?: string
  messages?: Array<{
    filename: string
    status: 'success' | 'fail'
    transactionId?: string
    error?: string
  }>
}

export const mintNFT = async (
  connection: Connection,
  wallet: WalletAdapter | undefined,
  env: CHAIN_ENV,
  fileBuffers: Buffer[],
  metadata: {
    name: string
    symbol: string
    description: string
    image?: string
    animation_url?: string
    attributes?: Attribute[]
    external_url: string
    properties: any
    creators: Creator[] | null
    sellerFeeBasisPoints: number
  },
  maxSupply?: number,
): Promise<{
  metadataAccount: StringPublicKey
} | void> => {
  if (!wallet?.publicKey) {
    return
  }

  const metadataContent = {
    name: metadata.name,
    symbol: metadata.symbol,
    description: metadata.description,
    seller_fee_basis_points: metadata.sellerFeeBasisPoints,
    image: metadata.image,
    animation_url: metadata.animation_url,
    attributes: metadata.attributes,
    external_url: metadata.external_url,
    properties: {
      ...metadata.properties,
      creators: metadata.creators?.map((creator) => {
        return {
          address: creator.address,
          share: creator.share,
        }
      }),
    },
  }

  // const realFiles: File[] = [...files, new File([JSON.stringify(metadataContent)], 'metadata.json')]
  const fileNames = Array.from({ length: fileBuffers.length }, () => uuidv4())
  const manifestBuffer = Buffer.from(JSON.stringify(metadataContent))
  const buffers = [...fileBuffers, manifestBuffer]

  const { instructions: pushInstructions, signers: pushSigners } = await prepPayForFilesTxn(
    wallet,
    buffers,
  )

  const TOKEN_PROGRAM_ID = programIds().token

  // Allocate memory for the account
  const mintRent = await connection.getMinimumBalanceForRentExemption(MintLayout.span)
  // const accountRent = await connection.getMinimumBalanceForRentExemption(
  //   AccountLayout.span,
  // );

  // This owner is a temporary signer and owner of metadata we use to circumvent requesting signing
  // twice post Arweave. We store in an account (payer) and use it post-Arweave to update MD with new link
  // then give control back to the user.
  // const payer = new Account();
  const payerPublicKey = wallet.publicKey.toBase58()
  const instructions: TransactionInstruction[] = [...pushInstructions]
  const signers: Keypair[] = [...pushSigners]

  // This is only temporarily owned by wallet...transferred to program by createMasterEdition below
  const mintKey = createMint(
    instructions,
    wallet.publicKey,
    mintRent,
    0,
    // Some weird bug with phantom where it's public key doesnt mesh with data encode wellff
    toPublicKey(payerPublicKey),
    toPublicKey(payerPublicKey),
    signers,
  ).toBase58()

  const recipientKey = (
    await findProgramAddress(
      [wallet.publicKey.toBuffer(), programIds().token.toBuffer(), toPublicKey(mintKey).toBuffer()],
      programIds().associatedToken,
    )
  )[0]

  createAssociatedTokenAccountInstruction(
    instructions,
    toPublicKey(recipientKey),
    wallet.publicKey,
    wallet.publicKey,
    toPublicKey(mintKey),
  )

  const metadataAccount = await createMetadata(
    new Data({
      symbol: metadata.symbol,
      name: metadata.name,
      uri: ' '.repeat(64), // size of url for arweave
      sellerFeeBasisPoints: metadata.sellerFeeBasisPoints,
      creators: metadata.creators,
    }),
    payerPublicKey,
    mintKey,
    payerPublicKey,
    instructions,
    wallet.publicKey.toBase58(),
  )

  // TODO: enable when using payer account to avoid 2nd popup
  // const block = await connection.getRecentBlockhash('singleGossip');
  // instructions.push(
  //   SystemProgram.transfer({
  //     fromPubkey: wallet.publicKey,
  //     toPubkey: payerPublicKey,
  //     lamports: 0.5 * LAMPORTS_PER_SOL // block.feeCalculator.lamportsPerSignature * 3 + mintRent, // TODO
  //   }),
  // );

  const { txid } = await sendTransactionWithRetry(connection, wallet, instructions, signers)

  try {
    await connection.confirmTransaction(txid, 'max')
  } catch {
    // ignore
  }

  // Force wait for max confirmations
  // await connection.confirmTransaction(txid, 'max');
  await connection.getParsedConfirmedTransaction(txid, 'confirmed')

  // this means we're done getting AR txn setup. Ship it off to ARWeave!
  const data = new FormData()

  const tags = fileNames.reduce(
    (acc: Record<string, Array<{ name: string; value: string }>>, name) => {
      acc[name] = [{ name: 'mint', value: mintKey }]
      return acc
    },
    {},
  )
  data.append('tags', JSON.stringify(tags))
  data.append('transaction', txid)
  fileBuffers.map((f, i) => data.append('file[]', f, fileNames[i]))
  data.append('file[]', manifestBuffer, 'metadata.json')

  // TODO: convert to absolute file name for image

  const result: IArweaveResult = await (
    await fetch(
      // TODO: add CNAME
      env.startsWith('mainnet-beta')
        ? 'https://us-central1-principal-lane-200702.cloudfunctions.net/uploadFileProd2'
        : 'https://us-central1-principal-lane-200702.cloudfunctions.net/uploadFile2',
      {
        method: 'POST',
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        body: data,
      },
    )
  ).json()

  const metadataFile = result.messages?.find((m) => m.filename === RESERVED_TXN_MANIFEST)
  if (metadataFile?.transactionId && wallet.publicKey) {
    const updateInstructions: TransactionInstruction[] = []
    const updateSigners: Keypair[] = []

    // TODO: connect to testnet arweave
    const arweaveLink = `https://arweave.net/${metadataFile.transactionId}`
    await updateMetadata(
      new Data({
        name: metadata.name,
        symbol: metadata.symbol,
        uri: arweaveLink,
        creators: metadata.creators,
        sellerFeeBasisPoints: metadata.sellerFeeBasisPoints,
      }),
      undefined,
      undefined,
      mintKey,
      payerPublicKey,
      updateInstructions,
      metadataAccount,
    )

    updateInstructions.push(
      Token.createMintToInstruction(
        TOKEN_PROGRAM_ID,
        toPublicKey(mintKey),
        toPublicKey(recipientKey),
        toPublicKey(payerPublicKey),
        [],
        1,
      ),
    )
    // // In this instruction, mint authority will be removed from the main mint, while
    // // minting authority will be maintained for the Printing mint (which we want.)
    await createMasterEdition(
      maxSupply !== undefined ? new BN(maxSupply) : undefined,
      mintKey,
      payerPublicKey,
      payerPublicKey,
      payerPublicKey,
      updateInstructions,
    )

    // TODO: enable when using payer account to avoid 2nd popup
    /*  if (maxSupply !== undefined)
      updateInstructions.push(
        setAuthority({
          target: authTokenAccount,
          currentAuthority: payerPublicKey,
          newAuthority: wallet.publicKey,
          authorityType: 'AccountOwner',
        }),
      );
*/
    // TODO: enable when using payer account to avoid 2nd popup
    // Note with refactoring this needs to switch to the updateMetadataAccount command
    // await transferUpdateAuthority(
    //   metadataAccount,
    //   payerPublicKey,
    //   wallet.publicKey,
    //   updateInstructions,
    // );

    const txid = await sendTransactionWithRetry(
      connection,
      wallet,
      updateInstructions,
      updateSigners,
    )

    console.log('Art created on Solana', txid, arweaveLink)
    // TODO: refund funds

    // send transfer back to user
  }
  // TODO:
  // 1. Jordan: --- upload file and metadata to storage API
  // 2. pay for storage by hashing files and attaching memo for each file

  return { metadataAccount }
}

export const prepPayForFilesTxn = async (
  wallet: WalletAdapter,
  buffers: Buffer[],
): Promise<{
  instructions: TransactionInstruction[]
  signers: Keypair[]
}> => {
  const memo = programIds().memo

  const instructions: TransactionInstruction[] = []
  const signers: Keypair[] = []

  if (wallet.publicKey)
    instructions.push(
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: AR_SOL_HOLDER_ID,
        lamports: await getAssetCostToStore(buffers),
      }),
    )

  for (let i = 0; i < buffers.length; i++) {
    const hashSum = crypto.createHash('sha256')
    hashSum.update(buffers[i].toString())
    const hex = hashSum.digest('hex')
    instructions.push(
      new TransactionInstruction({
        keys: [],
        programId: memo,
        data: Buffer.from(hex),
      }),
    )
  }

  return {
    instructions,
    signers,
  }
}
