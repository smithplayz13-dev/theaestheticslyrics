import type { Server } from 'node:http'

export interface CandidateScore {
  confidence: number
  matchType: string
  titleScore?: number
  artistScore?: number
  albumScore?: number
  durScore?: number
  penalty?: number
}

export interface ArtworkMetadata {
  trackName?: string
  artistName?: string
  collectionName?: string
  releaseDate?: string
  primaryGenreName?: string
  country?: string
}

export interface ArtworkResult {
  url: string | null
  source: 'itunes' | 'provider' | 'none'
  confidence: number
  matchType?: string
  metadata?: ArtworkMetadata | null
  cached?: boolean
}

export declare function cleanTitle(title: string): string
export declare function primaryArtist(artist: string): string
export declare function normalizeForMatch(s: string): string
export declare function upgradeArtworkUrl(url: string | null | undefined): string | null
export declare function scoreCandidate(query: any, candidate: any): CandidateScore
export declare function searchItunesArtwork(query: any, options?: any): Promise<ArtworkResult | null>
export declare function fetchArtwork(query: any, options?: any): Promise<ArtworkResult>
export declare function handleArtwork(url: URL, res: any, options?: any): Promise<void>

export declare const artworkCache: Map<string, any>
export declare const inFlightArtwork: Map<string, Promise<any>>
export declare const cache: Map<string, any>
export declare const server: Server
export declare function handleLyrics(url: URL, res: any): Promise<void>
export declare function askUpstream(params: any): Promise<any>
export declare function send(res: any, status: number, body: any, headers?: Record<string, string>): void
export declare function param(params: URLSearchParams, ...names: string[]): string
export declare const PORT: number
export declare const HOST: string
