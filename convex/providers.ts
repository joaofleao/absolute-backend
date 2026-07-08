import { ConvexError, v } from 'convex/values'

import { api, internal } from './_generated/api'

import { action, internalQuery, internalAction, internalMutation } from './_generated/server'

export const fetchMovieProviders = internalAction({
  args: { tmdbId: v.number() },
  returns: v.record(
    v.string(),
    v.array(
      v.object({
        type: v.union(v.literal('buy'), v.literal('flatrate'), v.literal('rent')),
        provider_id: v.number(),
        provider_name: v.string(),
        logo_path: v.string(),
      }),
    ),
  ),
  handler: async (ctx, args) => {
    const url = `https://api.themoviedb.org/3/movie/${args.tmdbId}/watch/providers?language=en-US`

    const headers = {
      Authorization: `Bearer ${process.env.TMDB_BEARER_TOKEN}`,
      accept: 'application/json',
    }

    const response = await fetch(url, { headers })
    if (!response.ok) throw new ConvexError('Failed to fetch movie providers')

    const data = (await response.json()) as {
      results: Record<
        string,
        {
          buy?: { provider_id: number; provider_name: string; logo_path: string }[]
          flatrate?: { provider_id: number; provider_name: string; logo_path: string }[]
          rent?: { provider_id: number; provider_name: string; logo_path: string }[]
        }
      >
    }

    const finalData: Record<
      string,
      {
        type: 'buy' | 'flatrate' | 'rent'
        logo_path: string
        provider_name: string
        provider_id: number
      }[]
    > = {}

    for (const [country, providers] of Object.entries(data.results || {})) {
      const finalProviders = [
        ...(providers.buy?.map((provider) => ({
          type: 'buy',
          provider_name: provider.provider_name,
          logo_path: provider.logo_path,
          provider_id: provider.provider_id,
        })) || []),
        ...(providers.flatrate?.map((provider) => ({
          type: 'flatrate',
          provider_name: provider.provider_name,
          logo_path: provider.logo_path,
          provider_id: provider.provider_id,
        })) || []),
        ...(providers.rent?.map((provider) => ({
          type: 'rent',
          provider_name: provider.provider_name,
          logo_path: provider.logo_path,
          provider_id: provider.provider_id,
        })) || []),
      ] as {
        type: 'buy' | 'flatrate' | 'rent'
        logo_path: string
        provider_name: string
        provider_id: number
      }[]

      finalData[country] = finalProviders
    }

    return finalData
  },
})

export const patchMovieProviders = internalMutation({
  args: {
    tmdbId: v.number(),
    providers: v.record(
      v.string(),
      v.array(
        v.object({
          type: v.union(v.literal('buy'), v.literal('flatrate'), v.literal('rent')),
          provider_id: v.number(),
          provider_name: v.string(),
          logo_path: v.string(),
        }),
      ),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const movie = await ctx.db
      .query('movies')
      .withIndex('by_tmdb_id', (q) => q.eq('tmdbId', args.tmdbId))
      .unique()

    if (!movie) throw new ConvexError('Movie not found')

    const now = Date.now()

    await ctx.db.patch(movie._id, {
      providers: args.providers,
      last_update: now,
    })
  },
})

export const getMovieByTmdbId = internalQuery({
  args: { tmdbId: v.number() },
  returns: v.union(
    v.object({
      _id: v.id('movies'),
      tmdbId: v.number(),
      providers: v.optional(
        v.record(
          v.string(),
          v.array(
            v.object({
              type: v.union(v.literal('buy'), v.literal('flatrate'), v.literal('rent')),
              provider_id: v.number(),
              provider_name: v.string(),
              logo_path: v.string(),
            }),
          ),
        ),
      ),
      last_update: v.optional(v.number()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const movie = await ctx.db
      .query('movies')
      .withIndex('by_tmdb_id', (q) => q.eq('tmdbId', args.tmdbId))
      .unique()

    if (!movie) return null

    return {
      _id: movie._id,
      tmdbId: movie.tmdbId,
      providers: (movie as any).providers,
      last_update: (movie as any).last_update,
    }
  },
})

const PROVIDERS_CACHE_MS = 7 * 24 * 60 * 60 * 1000

export const getOrUpdateProviders = action({
  args: {
    tmdbId: v.number(),
  },

  returns: v.record(
    v.string(),
    v.array(
      v.object({
        type: v.union(v.literal('buy'), v.literal('flatrate'), v.literal('rent')),
        provider_id: v.number(),
        provider_name: v.string(),
        logo_path: v.string(),
      }),
    ),
  ),

  handler: async (ctx, args): Promise<any> => {
    const movie = await ctx.runQuery(internal.providers.getMovieByTmdbId, { tmdbId: args.tmdbId })
    if (!movie) throw new ConvexError('Movie not found')
    const now = Date.now()
    const lastUpdate = movie?.last_update
    const shouldRefresh = !movie?.providers || !lastUpdate || now - lastUpdate > PROVIDERS_CACHE_MS
    if (shouldRefresh) {
      const providers = await ctx.runAction(internal.providers.fetchMovieProviders, {
        tmdbId: args.tmdbId,
      })
      await ctx.runMutation(internal.providers.patchMovieProviders, {
        tmdbId: args.tmdbId,
        providers,
      })
      return providers
    }
    return movie.providers
  },
})

export const getProviders = action({
  args: {
    country: v.string(),
    movies: v.array(v.number()),
  },

  returns: v.array(
    v.object({
      movieId: v.number(),
      providers: v.optional(
        v.array(
          v.object({
            type: v.union(v.literal('buy'), v.literal('flatrate'), v.literal('rent')),
            provider_id: v.number(),
            provider_name: v.string(),
            logo_path: v.string(),
          }),
        ),
      ),
    }),
  ),

  handler: async (ctx, args): Promise<any> => {
    const movies: { movieId: number; providers: any }[] = []

    for (const movie of args.movies) {
      const providers = await ctx.runAction(api.providers.getOrUpdateProviders, { tmdbId: movie })

      movies.push({
        movieId: movie,
        providers: providers[args.country],
      })
    }

    return movies
  },
})
