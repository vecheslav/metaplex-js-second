import { MintInfo } from '@solana/spl-token'
import { PublicKey } from '@solana/web3.js'
import BN from 'bn.js'
import { WAD, ZERO } from './constants'
import { TokenInfo } from '@solana/spl-token-registry'
import { TokenAccount } from '@metaplex/types'

export type KnownTokenMap = Map<string, TokenInfo>

export const formatPriceNumber = new Intl.NumberFormat('en-US', {
  style: 'decimal',
  minimumFractionDigits: 2,
  maximumFractionDigits: 8,
})

export const findProgramAddress = async (seeds: (Buffer | Uint8Array)[], programId: PublicKey) => {
  const result = await PublicKey.findProgramAddress(seeds, programId)
  return [result[0].toBase58(), result[1]] as [string, number]
}

// shorten the checksummed version of the input address to have 4 characters at start and end
export function shortenAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars)}...${address.slice(-chars)}`
}

export function getTokenName(
  map: KnownTokenMap,
  mint?: string | PublicKey,
  shorten = true,
): string {
  const mintAddress = typeof mint === 'string' ? mint : mint?.toBase58()

  if (!mintAddress) {
    return 'N/A'
  }

  const knownSymbol = map.get(mintAddress)?.symbol
  if (knownSymbol) {
    return knownSymbol
  }

  return shorten ? `${mintAddress.substring(0, 5)}...` : mintAddress
}
export function getVerboseTokenName(
  map: KnownTokenMap,
  mint?: string | PublicKey,
  shorten = true,
): string {
  const mintAddress = typeof mint === 'string' ? mint : mint?.toBase58()

  if (!mintAddress) {
    return 'N/A'
  }

  const knownName = map.get(mintAddress)?.name
  if (knownName) {
    return knownName
  }

  return shorten ? `${mintAddress.substring(0, 5)}...` : mintAddress
}

export function getTokenByName(tokenMap: KnownTokenMap, name: string) {
  let token: TokenInfo | null = null
  for (const val of tokenMap.values()) {
    if (val.symbol === name) {
      token = val
      break
    }
  }
  return token
}

export function getTokenIcon(
  map: KnownTokenMap,
  mintAddress?: string | PublicKey,
): string | undefined {
  const address = typeof mintAddress === 'string' ? mintAddress : mintAddress?.toBase58()
  if (!address) {
    return
  }

  return map.get(address)?.logoURI
}

export function isKnownMint(map: KnownTokenMap, mintAddress: string) {
  return !!map.get(mintAddress)
}

export const STABLE_COINS = new Set(['USDC', 'wUSDC', 'USDT'])

export function chunks<T>(array: T[], size: number): T[][] {
  return Array.apply(0, new Array(Math.ceil(array.length / size))).map((_, index) =>
    array.slice(index * size, (index + 1) * size),
  )
}

export function toLamports(account?: TokenAccount | number, mint?: MintInfo): number {
  if (!account) {
    return 0
  }

  const amount = typeof account === 'number' ? account : account.info.amount?.toNumber()

  const precision = Math.pow(10, mint?.decimals || 0)
  return Math.floor(amount * precision)
}

export function wadToLamports(amount?: BN): BN {
  return amount?.div(WAD) || ZERO
}

export function fromLamports(
  account?: TokenAccount | number | BN,
  mint?: MintInfo,
  rate = 1.0,
): number {
  if (!account) {
    return 0
  }

  const amount = Math.floor(
    typeof account === 'number'
      ? account
      : BN.isBN(account)
      ? account.toNumber()
      : account.info.amount.toNumber(),
  )

  const precision = Math.pow(10, mint?.decimals || 9)
  return (amount / precision) * rate
}

export const tryParseKey = (key: string): PublicKey | null => {
  try {
    return new PublicKey(key)
  } catch (error) {
    return null
  }
}

const SI_SYMBOL = ['', 'k', 'M', 'G', 'T', 'P', 'E']

const abbreviateNumber = (number: number, precision: number) => {
  const tier = (Math.log10(number) / 3) | 0
  let scaled = number
  const suffix = SI_SYMBOL[tier]
  if (tier !== 0) {
    const scale = Math.pow(10, tier * 3)
    scaled = number / scale
  }

  return scaled.toFixed(precision) + suffix
}

export const formatAmount = (val: number, precision = 2, abbr = true) =>
  abbr ? abbreviateNumber(val, precision) : val.toFixed(precision)

export function formatTokenAmount(
  account?: TokenAccount | number | BN,
  mint?: MintInfo,
  rate = 1.0,
  prefix = '',
  suffix = '',
  precision = 2,
  abbr = false,
): string {
  if (!account) {
    return ''
  }

  return `${[prefix]}${formatAmount(fromLamports(account, mint, rate), precision, abbr)}${suffix}`
}

export const formatUSD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})

const numberFormater = new Intl.NumberFormat('en-US', {
  style: 'decimal',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export const formatNumber = {
  format: (val?: number) => {
    if (!val) {
      return '--'
    }

    return numberFormater.format(val)
  },
}

export const formatPct = new Intl.NumberFormat('en-US', {
  style: 'percent',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function convert(account?: TokenAccount | number, mint?: MintInfo, rate = 1.0): number {
  if (!account) {
    return 0
  }

  const amount = typeof account === 'number' ? account : account.info.amount?.toNumber()

  const precision = Math.pow(10, mint?.decimals || 0)
  const result = (amount / precision) * rate

  return result
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function isValidHttpUrl(text: string) {
  if (text.startsWith('http:') || text.startsWith('https:')) {
    return true
  }

  return false
}
