import { ConvexError, v } from 'convex/values'

import { api, internal } from './_generated/api'
import { Id } from './_generated/dataModel'
import { internalQuery, mutation, query } from './_generated/server'
import { countries } from './constants'
import { getAuthUserId } from '@convex-dev/auth/server'

export const getOscarEditions = query({
  args: {
    public: v.optional(v.boolean()),
  },
  returns: v.array(
    v.object({
      _id: v.id('oscarEditions'),
      _creationTime: v.number(),
      number: v.number(),
      year: v.number(),
      date: v.number(),
      announcement: v.optional(v.number()),
      finished: v.boolean(), // all winners have been logged
      complete: v.boolean(), // all nominations have been logged
      public: v.boolean(), // should be displayed to public
      allowVoting: v.boolean(),
      hasVoted: v.boolean(),
      moviesNominated: v.number(),
      moviesWatched: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)

    const allEditions = await ctx.db
      .query('oscarEditions')
      .withIndex(
        'by_public_and_number',
        args.public !== undefined ? (q) => q.eq('public', args.public ?? true) : undefined,
      )
      .order('desc')
      .collect()

    // Get all nominations grouped by edition
    const nominations = await ctx.db.query('oscarNomination').collect()
    const nominationsByEdition = new Map<Id<'oscarEditions'>, typeof nominations>()
    for (const nom of nominations) {
      const existing = nominationsByEdition.get(nom.editionId) ?? []
      nominationsByEdition.set(nom.editionId, [...existing, nom])
    }

    if (!userId) {
      return allEditions.map((edition) => {
        const editionNominations = nominationsByEdition.get(edition._id) ?? []
        const moviesNominated = new Set(editionNominations.map((nom) => nom.movieId)).size

        return {
          ...edition,
          allowVoting: false,
          hasVoted: false,
          moviesNominated,
          moviesWatched: 0,
        }
      })
    }

    const userVotes = await ctx.db
      .query('oscarRanks')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()
    const votedNominationIds = new Set(userVotes.map((v) => v.nominationId))

    const userWatchedMovies = await ctx.db
      .query('watchedMovies')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()
    const watchedMovieIds = new Set(userWatchedMovies.map((w) => w.movieId))

    return allEditions.map((edition) => {
      const allowVoting =
        edition.announcement !== undefined &&
        Date.now() >= edition.announcement &&
        edition.complete === true &&
        edition.date > Date.now()

      const editionNominations = nominationsByEdition.get(edition._id) ?? []
      const hasVoted = editionNominations.some((nom) => votedNominationIds.has(nom._id))

      const nominatedMovieIds = new Set(editionNominations.map((nom) => nom.movieId))
      const moviesNominated = nominatedMovieIds.size

      const moviesWatched = Array.from(nominatedMovieIds).filter((movieId) =>
        watchedMovieIds.has(movieId),
      ).length

      return {
        ...edition,
        allowVoting,
        hasVoted,
        moviesNominated,
        moviesWatched,
      }
    })
  },
})

export const createOscarEdition = mutation({
  args: {
    number: v.number(),
    year: v.number(),
    date: v.number(),
    announcement: v.optional(v.number()),
    complete: v.boolean(),
    public: v.boolean(),
    finished: v.boolean(),
  },
  returns: v.id('oscarEditions'),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new ConvexError('Not authenticated')

    return await ctx.db.insert('oscarEditions', { ...args })
  },
})

export const updateOscarEdition = mutation({
  args: {
    _id: v.id('oscarEditions'),
    number: v.number(),
    year: v.number(),
    date: v.number(),
    announcement: v.optional(v.number()),
    complete: v.boolean(),
    public: v.boolean(),
    finished: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new ConvexError('Not authenticated')

    const { _id, ...updates } = args

    const cleanUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, value]) => value !== undefined),
    )
    await ctx.db.patch(_id, cleanUpdates)
  },
})

export const deleteOscarEdition = mutation({
  args: { _id: v.id('oscarEditions') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new ConvexError('Not authenticated')

    await ctx.db.delete(args._id)
  },
})

export const getOscarCategories = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id('oscarCategories'),
      _creationTime: v.number(),

      group: v.string(),
      name: v.object({
        pt_BR: v.string(),
        en_US: v.string(),
      }),
      order: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const allCategories = await ctx.db.query('oscarCategories').order('asc').collect()

    return await Promise.all(
      allCategories
        .sort((a, b) => a.order - b.order)
        .map(async (category) => {
          const groupData = await ctx.db.get(category.groupId)
          if (!groupData) throw new ConvexError('Group not found')
          return {
            _id: category._id,
            _creationTime: category._creationTime,
            group: groupData.name.en_US,
            name: category.name,
            order: category.order,
          }
        }),
    )
  },
})

export const getOscarGroups = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id('oscarGroups'),
      _creationTime: v.number(),
      name: v.object({
        pt_BR: v.string(),
        en_US: v.string(),
      }),
      tagline: v.object({
        pt_BR: v.string(),
        en_US: v.string(),
      }),
      order: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const allGroups = await ctx.db.query('oscarGroups').order('asc').collect()
    return allGroups
  },
})

export const createOscarGroup = mutation({
  args: {
    name: v.object({
      pt_BR: v.string(),
      en_US: v.string(),
    }),
    tagline: v.object({
      pt_BR: v.string(),
      en_US: v.string(),
    }),
    order: v.number(),
  },
  returns: v.id('oscarGroups'),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new ConvexError('Not authenticated')

    return await ctx.db.insert('oscarGroups', args)
  },
})

export const createOscarCategory = mutation({
  args: {
    groupId: v.id('oscarGroups'),
    name: v.object({
      pt_BR: v.string(),
      en_US: v.string(),
    }),
    order: v.number(),
  },
  returns: v.id('oscarCategories'),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new ConvexError('Not authenticated')

    return await ctx.db.insert('oscarCategories', args)
  },
})

export const updateOscarCategory = mutation({
  args: {
    _id: v.id('oscarCategories'),
    name: v.object({
      pt_BR: v.string(),
      en_US: v.string(),
    }),
    order: v.number(),
    groupId: v.id('oscarGroups'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new ConvexError('Not authenticated')

    const { _id, ...updates } = args

    const cleanUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, value]) => value !== undefined),
    )

    await ctx.db.patch(_id, cleanUpdates)
  },
})

export const updateOscarGroup = mutation({
  args: {
    _id: v.id('oscarGroups'),
    name: v.object({
      pt_BR: v.string(),
      en_US: v.string(),
    }),
    tagline: v.object({
      pt_BR: v.string(),
      en_US: v.string(),
    }),
    order: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new ConvexError('Not authenticated')
    const { _id, ...updates } = args

    const cleanUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, value]) => value !== undefined),
    )
    await ctx.db.patch(_id, cleanUpdates)
  },
})

export const deleteOscarCategory = mutation({
  args: { _id: v.id('oscarCategories') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new ConvexError('Not authenticated')

    await ctx.db.delete(args._id)
  },
})

export const deleteOscarGroup = mutation({
  args: { _id: v.id('oscarGroups') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new ConvexError('Not authenticated')
    await ctx.db.delete(args._id)
  },
})

export const createOscarNomination = mutation({
  args: {
    movieId: v.id('movies'),
    editionId: v.id('oscarEditions'),
    categoryId: v.id('oscarCategories'),
    winner: v.optional(v.boolean()),
    nominee: v.optional(
      v.object({
        pt_BR: v.string(),
        en_US: v.string(),
      }),
    ),
    actorId: v.optional(v.id('actors')),
    character: v.optional(
      v.object({
        pt_BR: v.string(),
        en_US: v.string(),
      }),
    ),
    country: v.optional(v.string()),
    song: v.optional(v.string()),
    url: v.optional(v.string()),
  },
  returns: v.id('oscarNomination'),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new ConvexError('Not authenticated')
    return await ctx.db.insert('oscarNomination', args)
  },
})

export const getNominationsByEdition = query({
  args: {
    editionId: v.optional(v.id('oscarEditions')),
  },
  returns: v.array(
    v.object({
      _id: v.id('oscarNomination'),
      movie: v.object({
        _id: v.id('movies'),
        title: v.object({
          pt_BR: v.string(),
          en_US: v.string(),
        }),
      }),
      category: v.object({
        _id: v.id('oscarCategories'),
        name: v.object({
          pt_BR: v.string(),
          en_US: v.string(),
        }),
      }),
      actor: v.optional(
        v.object({
          _id: v.id('actors'),
          name: v.string(),
        }),
      ),
      character: v.optional(
        v.object({
          pt_BR: v.string(),
          en_US: v.string(),
        }),
      ),
      nominee: v.optional(
        v.object({
          pt_BR: v.string(),
          en_US: v.string(),
        }),
      ),
      country: v.optional(v.string()),
      song: v.optional(v.string()),
      url: v.optional(v.string()),
      winner: v.optional(v.boolean()),
      watched: v.optional(v.boolean()),
    }),
  ),

  handler: async (ctx, args) => {
    const latestEdition = await ctx.db.query('oscarEditions').order('desc').first()

    const nominations = await ctx.db
      .query('oscarNomination')
      .withIndex('by_edition', (q) => q.eq('editionId', args.editionId ?? latestEdition!._id))
      .collect()

    const enrichedNominations = await Promise.all(
      nominations.map(async (nomination) => {
        const movie = await ctx.db.get(nomination.movieId)
        if (!movie) throw new ConvexError('Movie not found')

        const category = await ctx.db.get(nomination.categoryId)
        if (!category) throw new ConvexError('Category not found')

        const actor = nomination.actorId
          ? (await ctx.db.get(nomination.actorId)) || undefined
          : undefined

        const { _id, character, nominee, country, song, url, winner } = nomination
        return {
          _id,
          character,
          nominee,
          country,
          song,
          url,
          winner,
          movie: {
            _id: movie._id,
            title: {
              pt_BR: movie.title.pt_BR,
              en_US: movie.title.en_US,
            },
          },
          category: {
            _id: category._id,
            name: category.name,
          },
          actor: actor
            ? {
                _id: actor._id,
                name: actor.name,
              }
            : undefined,
        }
      }),
    )

    return enrichedNominations
  },
})

export const updateOscarNomination = mutation({
  args: {
    nominationId: v.id('oscarNomination'),
    movieId: v.id('movies'),
    editionId: v.id('oscarEditions'),
    categoryId: v.id('oscarCategories'),

    winner: v.optional(v.boolean()),
    nominee: v.optional(
      v.object({
        pt_BR: v.optional(v.string()),
        en_US: v.optional(v.string()),
      }),
    ),
    actorId: v.optional(v.id('actors')),
    character: v.optional(
      v.object({
        pt_BR: v.optional(v.string()),
        en_US: v.optional(v.string()),
      }),
    ),
    country: v.optional(v.string()),
    song: v.optional(v.string()),
    url: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new ConvexError('Not authenticated')

    const { nominationId, ...updates } = args
    const cleanUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, value]) => value !== undefined),
    )

    await ctx.db.patch(nominationId, cleanUpdates)
  },
})

export const deleteOscarNomination = mutation({
  args: { nominationId: v.id('oscarNomination') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new ConvexError('Not authenticated')

    await ctx.db.delete(args.nominationId)
  },
})
export const getWatchedMoviesFromEdition = query({
  args: {
    editionId: v.optional(v.id('oscarEditions')),
    language: v.optional(v.union(v.literal('pt_BR'), v.literal('en_US'))),
  },
  returns: v.array(
    v.object({
      _id: v.id('watchedMovies'),
      title: v.string(),
      posterPath: v.optional(v.string()),
      watchedAt: v.number(),
      tmdbId: v.number(),
      movieId: v.id('movies'),
    }),
  ),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return []
    const latestEdition = await ctx.db.query('oscarEditions').order('desc').first()

    const nominations = await ctx.db
      .query('oscarNomination')
      .withIndex('by_edition', (q) => q.eq('editionId', args.editionId ?? latestEdition!._id))
      .collect()

    const nominatedMovies = Array.from(new Set(nominations.map((n) => n.movieId)))

    const watchedMovies = await ctx.db
      .query('watchedMovies')
      .withIndex('by_user_and_movie', (q) => q.eq('userId', userId))
      .order('desc')
      .collect()

    const watchedNominatedMovies = watchedMovies.filter((wm) =>
      nominatedMovies.includes(wm.movieId),
    )
    const movies = await Promise.all(
      watchedNominatedMovies.map(async (item) => {
        const movie = await ctx.db.get(item.movieId)
        return {
          _id: item._id,
          title: movie!.title[args.language ?? 'en_US'],
          posterPath: movie!.posterPath ? movie!.posterPath[args.language ?? 'en_US'] : undefined,
          tmdbId: movie!.tmdbId,
          watchedAt: item.watchedAt,
          movieId: movie!._id,
        }
      }),
    )

    return movies
  },
})

export const getMovies = query({
  args: {
    editionId: v.optional(v.id('oscarEditions')),
    language: v.optional(v.union(v.literal('pt_BR'), v.literal('en_US'))),
  },
  returns: v.array(
    v.object({
      _id: v.id('movies'),
      tmdbId: v.number(),
      title: v.string(),
      posterPath: v.optional(v.string()),
      watched: v.optional(v.boolean()),
      nominationCount: v.number(),
      friends_who_watched: v.array(
        v.object({
          _id: v.id('users'),
          name: v.optional(v.string()),
          imageURL: v.optional(v.string()),
        }),
      ),
    }),
  ),

  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    const latestEdition = await ctx.db.query('oscarEditions').order('desc').first()

    const nominations = await ctx.db
      .query('oscarNomination')
      .withIndex('by_edition', (q) => q.eq('editionId', args.editionId ?? latestEdition!._id))
      .collect()

    const movieIds = new Map(
      Array.from(new Set(nominations.map((n) => n.movieId))).map((id) => [
        id,
        nominations.filter((n) => n.movieId === id).length,
      ]),
    )

    const movies: {
      _id: Id<'movies'>
      tmdbId: number
      title: string
      posterPath: string | undefined
      watched: boolean | undefined
      nominationCount: number
      friends_who_watched: { _id: Id<'users'>; name?: string; imageURL?: string }[]
    }[] = []

    // Preload friends and their watched nominated movies to avoid per-movie queries
    const friendsWhoWatchedByMovie = new Map<
      Id<'movies'>,
      { _id: Id<'users'>; name?: string; imageURL?: string }[]
    >()

    if (userId) {
      const friendLinks = await ctx.db
        .query('friends')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .collect()

      const nominatedSet = new Set(movieIds.keys())

      for (const link of friendLinks) {
        const friendUser = await ctx.db.get(link.friendId)
        if (!friendUser) continue

        const friendWatched = await ctx.db
          .query('watchedMovies')
          .withIndex('by_user', (q) => q.eq('userId', link.friendId))
          .collect()

        for (const wm of friendWatched) {
          if (!nominatedSet.has(wm.movieId as Id<'movies'>)) continue

          const arr = friendsWhoWatchedByMovie.get(wm.movieId as Id<'movies'>) ?? []
          arr.push({ _id: friendUser._id, name: friendUser.name, imageURL: friendUser.imageURL })
          friendsWhoWatchedByMovie.set(wm.movieId as Id<'movies'>, arr)
        }
      }
    }

    for (const [movieId, count] of movieIds) {
      const movie = await ctx.db.get(movieId)
      if (!movie) continue

      let watched: boolean | undefined = undefined
      if (userId) {
        const watchedItem = await ctx.db
          .query('watchedMovies')
          .withIndex('by_user_and_movie', (q) => q.eq('userId', userId).eq('movieId', movieId))
          .first()
        watched = !!watchedItem
      }

      movies.push({
        _id: movie._id,
        tmdbId: movie.tmdbId,
        title: movie.title[args.language ?? 'en_US'],
        posterPath: movie.posterPath ? movie.posterPath[args.language ?? 'en_US'] : undefined,
        watched,
        nominationCount: count,
        friends_who_watched: friendsWhoWatchedByMovie.get(movieId) ?? [],
      })
    }

    return movies.sort((a, b) => {
      if (b.nominationCount !== a.nominationCount) {
        return b.nominationCount - a.nominationCount
      }

      return a.title.localeCompare(b.title)
    })
  },
})

export const getNominations = query({
  args: {
    editionId: v.optional(v.id('oscarEditions')),
    categoryId: v.optional(v.id('oscarCategories')),
    language: v.optional(v.union(v.literal('pt_BR'), v.literal('en_US'))),
  },
  returns: v.array(
    v.object({
      category: v.object({
        _id: v.id('oscarCategories'),
        name: v.string(),
        order: v.number(),
      }),
      type: v.union(
        v.literal('person'),
        v.literal('song'),
        v.literal('movie'),
        v.literal('picture'),
      ),
      nominations: v.array(
        v.object({
          nominationId: v.id('oscarNomination'),
          movieId: v.id('movies'),
          tmdbId: v.number(),
          title: v.string(),
          posterPath: v.optional(v.string()),
          description: v.optional(v.string()),
          winner: v.optional(v.boolean()),
          watched: v.optional(v.boolean()),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    const latestEdition = await ctx.db.query('oscarEditions').order('desc').first()
    const editionId = args.editionId ?? latestEdition?._id

    if (!editionId) return []

    const edition = await ctx.db.get(editionId)
    if (!edition || !edition.complete) return []

    const nominations = await ctx.db
      .query('oscarNomination')
      .withIndex('by_edition_and_category', (q) =>
        args.categoryId
          ? q.eq('editionId', editionId).eq('categoryId', args.categoryId)
          : q.eq('editionId', editionId),
      )
      .collect()

    const categoryMap = new Map<
      Id<'oscarCategories'>,
      {
        category: {
          _id: Id<'oscarCategories'>
          name: string
          order: number
        }
        type: 'person' | 'song' | 'movie' | 'picture'
        nominations: {
          nominationId: Id<'oscarNomination'>
          movieId: Id<'movies'>
          tmdbId: number
          title: string
          posterPath: string | undefined
          description?: string
          winner?: boolean
          watched?: boolean
        }[]
      }
    >()

    for (const nomination of nominations) {
      if (!categoryMap.has(nomination.categoryId)) {
        const category = await ctx.db
          .query('oscarCategories')
          .withIndex('by_id', (q) => q.eq('_id', nomination.categoryId))
          .unique()

        const isActorCategory = !!nomination.actorId
        const isSongCategory = !!nomination.song
        const isPictureCategory = category?.name.en_US.includes('Picture')

        const type: 'person' | 'song' | 'movie' | 'picture' = isActorCategory
          ? 'person'
          : isSongCategory
            ? 'song'
            : isPictureCategory
              ? 'picture'
              : 'movie'

        categoryMap.set(nomination.categoryId, {
          category: {
            _id: category!._id,
            name: category!.name[args.language ?? 'en_US'],
            order: category!.order,
          },
          type,
          nominations: [],
        })
      }
      const movie = await ctx.db.get(nomination.movieId)
      const actor = nomination.actorId ? await ctx.db.get(nomination.actorId) : null
      const movieWatch = userId
        ? await ctx.db
            .query('watchedMovies')
            .withIndex('by_user_and_movie', (q) => q.eq('userId', userId).eq('movieId', movie!._id))
            .first()
        : undefined

      const oldValue = categoryMap.get(nomination.categoryId)

      const isActorCategory = !!nomination.actorId
      const isSongCategory = !!nomination.song

      const title =
        isActorCategory && actor
          ? actor.name
          : isSongCategory
            ? nomination.song!
            : movie!.title[args.language ?? 'en_US']

      const description =
        isActorCategory || isSongCategory ? movie!.title[args.language ?? 'en_US'] : undefined

      const posterPath =
        isActorCategory && actor?.picture_path
          ? actor.picture_path
          : movie!.posterPath
            ? movie!.posterPath[args.language ?? 'en_US']
            : undefined

      categoryMap.set(nomination.categoryId, {
        category: oldValue!.category,
        type: oldValue!.type,
        nominations: [
          ...(oldValue?.nominations || []),
          {
            nominationId: nomination._id,
            movieId: movie!._id,
            tmdbId: movie!.tmdbId,
            title,
            description,
            posterPath,
            winner: nomination.winner,
            watched: !!movieWatch,
          },
        ],
      })
    }

    const data = Array.from(categoryMap.values()).sort(
      (a, b) => a.category.order - b.category.order,
    )
    return data
  },
})

export const wishOscarNomination = mutation({
  args: {
    nominationId: v.id('oscarNomination'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new ConvexError('Not authenticated')

    await ctx.db.insert('oscarWishes', {
      userId,
      nominationId: args.nominationId,
    })
  },
})
export const unwishOscarNomination = mutation({
  args: {
    nominationId: v.id('oscarNomination'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new ConvexError('Not authenticated')
    const existing = await ctx.db
      .query('oscarWishes')
      .withIndex('by_user_and_nomination', (q) =>
        q.eq('userId', userId).eq('nominationId', args.nominationId),
      )
      .collect()

    existing.forEach((element) => {
      ctx.db.delete(element._id)
    })
  },
})

export const rankNomination = mutation({
  args: {
    votes: v.array(
      v.object({
        nominationId: v.id('oscarNomination'),
        rank: v.optional(v.number()),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new ConvexError('Not authenticated')

    for (const vote of args.votes) {
      const existing = await ctx.db
        .query('oscarRanks')
        .withIndex('by_user_and_nomination', (q) =>
          q.eq('userId', userId).eq('nominationId', vote.nominationId),
        )
        .unique()

      if (vote.rank === undefined) {
        if (existing) await ctx.db.delete(existing._id)
        continue
      }

      if (existing) {
        await ctx.db.patch(existing._id, { ranking: vote.rank })
      } else {
        await ctx.db.insert('oscarRanks', {
          userId,
          nominationId: vote.nominationId,
          ranking: vote.rank,
        })
      }
    }
  },
})

export const getNominationsByCategory = query({
  args: {
    editionId: v.optional(v.id('oscarEditions')),
    categoryId: v.optional(v.id('oscarCategories')),
    language: v.optional(v.union(v.literal('pt_BR'), v.literal('en_US'))),
  },
  returns: v.object({
    category: v.object({
      categoryId: v.id('oscarCategories'),
      name: v.string(),
    }),
    nominations: v.array(
      v.object({
        nominationId: v.id('oscarNomination'),
        title: v.string(),
        tmdbId: v.number(),
        description: v.optional(v.string()),
        extra: v.optional(v.string()),
        image: v.optional(v.string()),
        rank: v.optional(v.number()),
        winner: v.boolean(),
        watched: v.boolean(),
        wish: v.boolean(),
      }),
    ),
  }),

  handler: async (ctx, args) => {
    const latestEdition = await ctx.db.query('oscarEditions').order('desc').first()
    const latestCategory = await ctx.db.query('oscarCategories').order('desc').first()

    const userId = await getAuthUserId(ctx)
    const category_id = args.categoryId ? args.categoryId : latestCategory?._id!
    const edition_id = args.editionId ? args.editionId : latestEdition?._id!
    const language = args.language ? args.language : 'en_US'

    const nominations = await ctx.db
      .query('oscarNomination')
      .withIndex('by_edition_and_category', (q) =>
        q.eq('editionId', edition_id).eq('categoryId', category_id),
      )
      .collect()

    const category = await ctx.db
      .query('oscarCategories')
      .withIndex('by_id', (q) => q.eq('_id', category_id))
      .unique()

    const enrichedNominations = await Promise.all(
      nominations.map(
        async ({ movieId, actorId, song, _id, character, country, nominee, url, winner }) => {
          const movie = await ctx.db.get(movieId)
          if (!movie) throw new ConvexError('Movie not found')
          const actor = actorId ? await ctx.db.get(actorId) : null

          const latestWatch = userId
            ? await ctx.db
                .query('watchedMovies')
                .withIndex('by_user_and_movie', (q) =>
                  q.eq('userId', userId).eq('movieId', movie._id),
                )
                .first()
            : null

          const ballot = userId
            ? await ctx.db
                .query('oscarRanks')
                .withIndex('by_user_and_nomination', (q) =>
                  q.eq('userId', userId).eq('nominationId', _id),
                )
                .first()
            : null

          const wish = userId
            ? await ctx.db
                .query('oscarWishes')
                .withIndex('by_user_and_nomination', (q) =>
                  q.eq('userId', userId).eq('nominationId', _id),
                )
                .first()
            : null

          const title = actor ? actor.name : song ? song : movie.title[language]
          const extra = actor || song ? movie.title[language] : undefined
          const image = actor?.picture_path
            ? actor.picture_path
            : movie.posterPath
              ? movie.posterPath[language]
              : undefined

          const description =
            actor && character
              ? character[language]
              : country
                ? countries[country][language]
                : nominee && nominee[language]

          const el = {
            nominationId: _id,
            title,
            description,
            extra,
            image,
            tmdbId: movie.tmdbId,
            rank: ballot?.ranking,

            watched: !!latestWatch,
            winner: !!winner,
            wish: !!wish,
          }
          return el
        },
      ),
    )

    return {
      category: {
        categoryId: category!._id,
        name: category!.name[language],
      },
      nominations: enrichedNominations,
    }
  },
})

export const getMovieNominations = internalQuery({
  args: {
    movieId: v.id('movies'),
  },
  returns: v.array(
    v.object({
      nominationId: v.id('oscarNomination'),
      categoryId: v.id('oscarCategories'),
      categoryName: v.object({
        pt_BR: v.string(),
        en_US: v.string(),
      }),
      winner: v.optional(v.boolean()),
      actorId: v.optional(v.id('actors')),
    }),
  ),

  handler: async (ctx, args) => {
    const nomination = await ctx.db
      .query('oscarNomination')
      .withIndex('by_movie', (q) => q.eq('movieId', args.movieId))
      .collect()

    const enrichedNominations = await Promise.all(
      nomination.map(async (nom) => {
        const category = await ctx.db.get(nom.categoryId)
        return {
          nominationId: nom._id,
          categoryId: nom.categoryId,
          categoryName: {
            pt_BR: category!.name.pt_BR,
            en_US: category!.name.en_US,
          },
          winner: nom.winner,
          actorId: nom.actorId,
        }
      }),
    )

    return enrichedNominations
  },
})

export const getMovieFriends = internalQuery({
  args: {
    movieId: v.id('movies'),
  },
  returns: v.array(
    v.object({
      _id: v.id('users'),
      name: v.optional(v.string()),
      imageURL: v.optional(v.string()),
      username: v.optional(v.string()),
    }),
  ),

  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return []

    const friends = await ctx.db
      .query('friends')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()

    const enrichedFriends = await Promise.all(
      friends.map(async (fr) => {
        const watched = await ctx.db
          .query('watchedMovies')
          .withIndex('by_user_and_movie', (q) =>
            q.eq('userId', fr.friendId).eq('movieId', args.movieId),
          )
          .first()

        if (watched) {
          const friend = await ctx.db.get(fr.friendId)

          if (friend)
            return {
              _id: friend._id,
              name: friend.name,
              imageURL: friend.imageURL,
              username: friend.username,
            }
        }
      }),
    )

    return enrichedFriends.filter((e) => e !== undefined)
  },
})

export const getMovieLatestWatch = internalQuery({
  args: {
    movieId: v.id('movies'),
  },
  returns: v.union(v.id('watchedMovies'), v.null()),

  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return null

    const latestWatch = await ctx.db
      .query('watchedMovies')
      .withIndex('by_user_and_movie', (q) => q.eq('userId', userId).eq('movieId', args.movieId))
      .order('desc')
      .first()
    if (!latestWatch) return null

    return latestWatch._id
  },
})

export const getMovieDetail = query({
  args: {
    tmdbId: v.number(),
    language: v.optional(v.union(v.literal('pt_BR'), v.literal('en_US'))),
  },
  returns: v.object({
    _id: v.id('movies'),
    _creationTime: v.number(),
    title: v.object({
      original: v.string(),
      pt_BR: v.string(),
      en_US: v.string(),
    }),
    posterPath: v.optional(v.string()),
    backdropPath: v.optional(v.string()),
    imdbId: v.optional(v.string()),
    originalLanguage: v.optional(v.string()),
    plot: v.optional(v.string()),
    releaseDate: v.optional(v.string()),
    runtime: v.optional(v.number()),
    status: v.optional(v.string()),
    tagline: v.optional(v.string()),
    voteAverage: v.optional(v.number()),
    tmdbId: v.number(),
    originCountry: v.optional(
      v.array(
        v.object({
          code: v.string(),
          name: v.string(),
          url: v.string(),
        }),
      ),
    ),

    latestWatch: v.optional(v.id('watchedMovies')),
    nominations: v.array(
      v.object({
        nominationId: v.id('oscarNomination'),
        categoryId: v.id('oscarCategories'),
        categoryName: v.string(),
        winner: v.optional(v.boolean()),
        actorId: v.optional(v.id('actors')),
      }),
    ),
    friends: v.array(
      v.object({
        _id: v.id('users'),
        name: v.optional(v.string()),
        imageURL: v.optional(v.string()),
        username: v.optional(v.string()),
      }),
    ),
  }),
  // cast: v.array(
  //   v.object({
  //     id: v.number(),
  //     name: v.string(),
  //     character: v.optional(v.string()),
  //     profile_path: v.optional(v.string()),
  //     order: v.number(),
  //   }),
  // ),

  // providers: v.object({
  //   BR: v.optional(
  //     v.object({
  //       flatrate: v.optional(
  //         v.array(
  //           v.object({
  //             provider_id: v.number(),
  //             provider_name: v.string(),
  //             logo_path: v.string(),
  //           }),
  //         ),
  //       ),
  //       rent: v.optional(
  //         v.array(
  //           v.object({
  //             provider_id: v.number(),
  //             provider_name: v.string(),
  //             logo_path: v.string(),
  //           }),
  //         ),
  //       ),
  //       buy: v.optional(
  //         v.array(
  //           v.object({
  //             provider_id: v.number(),
  //             provider_name: v.string(),
  //             logo_path: v.string(),
  //           }),
  //         ),
  //       ),
  //     }),
  //   ),
  //   US: v.optional(
  //     v.object({
  //       flatrate: v.optional(
  //         v.array(
  //           v.object({
  //             provider_id: v.number(),
  //             provider_name: v.string(),
  //             logo_path: v.string(),
  //           }),
  //         ),
  //       ),
  //       rent: v.optional(
  //         v.array(
  //           v.object({
  //             provider_id: v.number(),
  //             provider_name: v.string(),
  //             logo_path: v.string(),
  //           }),
  //         ),
  //       ),
  //       buy: v.optional(
  //         v.array(
  //           v.object({
  //             provider_id: v.number(),
  //             provider_name: v.string(),
  //             logo_path: v.string(),
  //           }),
  //         ),
  //       ),
  //     }),
  //   ),
  // }),

  handler: async (ctx, args): Promise<any> => {
    const movie = await ctx.runQuery(api.movies.getMovie, {
      tmdbId: args.tmdbId,
      language: args.language,
    })

    if (!movie) throw new ConvexError('Movie not found')

    const nominations = await ctx.runQuery(internal.oscars.getMovieNominations, {
      movieId: movie?._id,
    })

    const friends = await ctx.runQuery(internal.oscars.getMovieFriends, {
      movieId: movie?._id,
    })

    const latestWatch = await ctx.runQuery(internal.oscars.getMovieLatestWatch, {
      movieId: movie?._id,
    })
    return {
      ...movie,
      latestWatch: latestWatch ? latestWatch : undefined,
      nominations: nominations.map((nom) => ({
        ...nom,
        categoryName: nom.categoryName[args.language ?? 'en_US'],
      })),

      friends,
    }

    // 2. Fetch cast from TMDB
    // let cast: {
    //   id: number
    //   name: string
    //   character?: string
    //   profile_path?: string
    //   order: number
    // }[] = []

    // try {
    //   const castUrl = `https://api.themoviedb.org/3/movie/${movie.tmdbId}/credits?language=en-US`
    //   const headers = {
    //     Authorization: `Bearer ${process.env.TMDB_BEARER_TOKEN}`,
    //     accept: 'application/json',
    //   }

    //   const castResponse = await fetch(castUrl, { headers })
    //   if (castResponse.ok) {
    //     const castData: { cast?: any[] } = await castResponse.json()
    //     cast = (castData.cast || []).slice(0, 20).map((actor, index) => ({
    //       id: actor.id,
    //       name: actor.name,
    //       character: actor.character || undefined,
    //       profile_path: actor.profile_path || undefined,
    //       order: index,
    //     }))
    //   }
    // } catch (error) {
    //   console.error('Error fetching cast from TMDB:', error)
    //   // Continue without cast if fetch fails
    // }

    // // 5. Fetch watch providers from TMDB
    // let providers: { BR?: any; US?: any } = {}
    // try {
    //   const providersUrl = `https://api.themoviedb.org/3/movie/${movie.tmdbId}/watch/providers?language=en-US`
    //   const headers = {
    //     Authorization: `Bearer ${process.env.TMDB_BEARER_TOKEN}`,
    //     accept: 'application/json',
    //   }

    //   const providersResponse = await fetch(providersUrl, { headers })
    //   if (providersResponse.ok) {
    //     const providersData: { results?: Record<string, any> } = await providersResponse.json()

    //     if (providersData.results) {
    //       // Extract Brazil (BR) providers
    //       if (providersData.results.BR) {
    //         const brData = providersData.results.BR
    //         providers.BR = {
    //           flatrate: brData.flatrate
    //             ? brData.flatrate.map((p: any) => ({
    //                 provider_id: p.provider_id,
    //                 provider_name: p.provider_name,
    //                 logo_path: p.logo_path,
    //               }))
    //             : undefined,
    //           rent: brData.rent
    //             ? brData.rent.map((p: any) => ({
    //                 provider_id: p.provider_id,
    //                 provider_name: p.provider_name,
    //                 logo_path: p.logo_path,
    //               }))
    //             : undefined,
    //           buy: brData.buy
    //             ? brData.buy.map((p: any) => ({
    //                 provider_id: p.provider_id,
    //                 provider_name: p.provider_name,
    //                 logo_path: p.logo_path,
    //               }))
    //             : undefined,
    //         }
    //       }

    //       // Extract US providers
    //       if (providersData.results.US) {
    //         const usData = providersData.results.US
    //         providers.US = {
    //           flatrate: usData.flatrate
    //             ? usData.flatrate.map((p: any) => ({
    //                 provider_id: p.provider_id,
    //                 provider_name: p.provider_name,
    //                 logo_path: p.logo_path,
    //               }))
    //             : undefined,
    //           rent: usData.rent
    //             ? usData.rent.map((p: any) => ({
    //                 provider_id: p.provider_id,
    //                 provider_name: p.provider_name,
    //                 logo_path: p.logo_path,
    //               }))
    //             : undefined,
    //           buy: usData.buy
    //             ? usData.buy.map((p: any) => ({
    //                 provider_id: p.provider_id,
    //                 provider_name: p.provider_name,
    //                 logo_path: p.logo_path,
    //               }))
    //             : undefined,
    //         }
    //       }
    //     }
    //   }
    // } catch (error) {
    //   console.error('Error fetching providers from TMDB:', error)
    //   // Continue without providers if fetch fails
    // }
  },
})
export const getBallotResults = query({
  args: {
    editionId: v.optional(v.id('oscarEditions')),
    language: v.optional(v.union(v.literal('pt_BR'), v.literal('en_US'))),
  },
  returns: v.array(
    v.object({
      group: v.object({
        groupId: v.id('oscarGroups'),
        name: v.string(),
        tagline: v.string(),
      }),
      categories: v.array(
        v.object({
          categoryId: v.id('oscarCategories'),
          name: v.string(),

          points: v.number(),
          bonus: v.number(),
          penalty: v.number(),

          nominations: v.array(
            v.object({
              nominationId: v.id('oscarNomination'),
              movieId: v.id('movies'),
              tmdbId: v.number(),
              title: v.string(),
              posterPath: v.optional(v.string()),
              winner: v.boolean(),
              watched: v.boolean(),
            }),
          ),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return []

    const language = args.language ?? 'en_US'
    const latestEdition = await ctx.db.query('oscarEditions').order('desc').first()
    const editionId = args.editionId ?? latestEdition?._id
    if (!editionId) return []

    // Get all categories with their groups
    const allCategories = await ctx.db.query('oscarCategories').order('asc').collect()

    // Get all nominations for the edition
    const nominations = await ctx.db
      .query('oscarNomination')
      .withIndex('by_edition', (q) => q.eq('editionId', editionId))
      .collect()

    // Get user's ranks
    const userRanks = await ctx.db
      .query('oscarRanks')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()

    // Get user's watched movies
    const userWatchedMovies = await ctx.db
      .query('watchedMovies')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()
    const watchedMovieIds = new Set(userWatchedMovies.map((w) => w.movieId))

    // Group nominations by category
    const nominationsByCategory = new Map<Id<'oscarCategories'>, typeof nominations>()
    for (const nom of nominations) {
      const existing = nominationsByCategory.get(nom.categoryId) ?? []
      nominationsByCategory.set(nom.categoryId, [...existing, nom])
    }

    // Only keep categories that actually have nominations in this edition
    const categoriesWithNominations = allCategories.filter(
      (cat) => (nominationsByCategory.get(cat._id)?.length ?? 0) > 0,
    )

    // Find Best Picture category (among those with nominations)
    const bestPictureCategory = categoriesWithNominations.find((cat) =>
      cat.name.en_US.toLowerCase().includes('best picture'),
    )

    // Group categories by group
    const categoryMap = new Map<
      Id<'oscarGroups'>,
      {
        categories: {
          categoryId: Id<'oscarCategories'>
          name: string
          points: number
          bonus: number
          penalty: number
          nominations: {
            nominationId: Id<'oscarNomination'>
            movieId: Id<'movies'>
            tmdbId: number
            title: string
            posterPath: string | undefined
            winner: boolean
            watched: boolean
          }[]
        }[]
      }
    >()

    // Process each category
    for (const category of categoriesWithNominations) {
      const groupId = category.groupId

      if (!categoryMap.has(groupId)) {
        categoryMap.set(groupId, {
          categories: [],
        })
      }

      const categoryNominations = nominationsByCategory.get(category._id) ?? []

      // Find the winner in this category
      const winner = categoryNominations.find((nom) => nom.winner)

      let points = 0
      let bonus = 0
      let penalty = 0

      if (winner) {
        // Find user's rank for the winner
        const userRankForWinner = userRanks.find((r) => r.nominationId === winner._id)

        if (userRankForWinner) {
          // Calculate base points: rank 1=5pts, 2=4pts, 3=3pts, 4=2pts, 5+=1pt
          const rank = userRankForWinner.ranking
          if (rank === 1) points = 5
          else if (rank === 2) points = 4
          else if (rank === 3) points = 3
          else if (rank === 4) points = 2
          else if (rank >= 5) points = 1

          // Check if movie was watched
          const watched = watchedMovieIds.has(winner.movieId)

          // Calculate bonus: 5 points for Best Picture winner at rank 1 (only if watched)
          if (watched && rank === 1 && category._id === bestPictureCategory?._id) {
            bonus = 5
          }

          // Calculate penalty: -2 points if not watched
          if (!watched) {
            penalty = 2
          }

          // Apply penalty and ensure minimum of 1 point
          const finalPoints = points + bonus - penalty
          points = finalPoints <= 0 ? 1 : finalPoints
          // Reset bonus and penalty to show net result in points
          bonus = 0
          penalty = 0
        }
      }

      // Only get nominations that the user has ranked
      const rankedNominations = categoryNominations.filter((nom) =>
        userRanks.some((r) => r.nominationId === nom._id),
      )

      // Fetch movie details for ranked nominations and sort by user's ranking
      const enrichedNominations = await Promise.all(
        rankedNominations.map(async (nom) => {
          const userRank = userRanks.find((r) => r.nominationId === nom._id)
          const movie = await ctx.db.get(nom.movieId)
          return {
            nominationId: nom._id,
            movieId: nom.movieId,
            tmdbId: movie?.tmdbId ?? 0,
            title: movie?.title[language] ?? '',
            posterPath: movie?.posterPath ? movie.posterPath[language] : undefined,
            winner: nom.winner ?? false,
            watched: watchedMovieIds.has(nom.movieId),
            ranking: userRank?.ranking ?? 999, // For sorting
          }
        }),
      )

      // Sort by user's ranking
      enrichedNominations.sort((a, b) => a.ranking - b.ranking)

      // Remove ranking from final output
      const sortedNominations = enrichedNominations.map(({ ranking, ...rest }) => rest)

      const categoryEntry = categoryMap.get(groupId)!
      categoryEntry.categories.push({
        categoryId: category._id,
        name: category.name[language],
        points,
        bonus,
        penalty,
        nominations: sortedNominations,
      })
    }

    // Fetch group data and build final result
    const result = []
    for (const [groupId, data] of categoryMap) {
      const group = await ctx.db.get(groupId)
      if (!group) continue

      result.push({
        group: {
          groupId: group._id,
          name: group.name[language],
          tagline: group.tagline[language],
        },
        categories: data.categories.sort((a, b) => {
          const catA = allCategories.find((c) => c._id === a.categoryId)
          const catB = allCategories.find((c) => c._id === b.categoryId)
          return (catA?.order ?? 0) - (catB?.order ?? 0)
        }),
      })
    }

    return result
  },
})

export const searchUsers = internalQuery({
  args: {
    name: v.string(),
  },
  returns: v.array(
    v.object({
      _id: v.id('users'),
      name: v.optional(v.string()),
      username: v.optional(v.string()),
      imageURL: v.optional(v.string()),
      following: v.boolean(),
      follows: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const searchTerm = args.name.toLowerCase()
    const userId = await getAuthUserId(ctx)

    const allUsers = await ctx.db.query('users').collect()
    const matchingUsers = allUsers.filter(
      (user) =>
        user._id !== userId &&
        ((user.name && user.name.toLowerCase().includes(searchTerm)) ||
          (user.username && user.username.toLowerCase().includes(searchTerm))),
    )

    return await Promise.all(
      matchingUsers.slice(0, 5).map(async (user) => {
        let following = false
        let follows = false

        if (userId) {
          const followingRelation = await ctx.db
            .query('friends')
            .withIndex('by_user_and_friend', (q) => q.eq('userId', userId).eq('friendId', user._id))
            .first()
          following = !!followingRelation

          const followsRelation = await ctx.db
            .query('friends')
            .withIndex('by_user_and_friend', (q) => q.eq('userId', user._id).eq('friendId', userId))
            .first()
          follows = !!followsRelation
        }

        return {
          _id: user._id,
          name: user.name,
          username: user.username,
          imageURL: user.imageURL,
          following,
          follows,
        }
      }),
    )
  },
})

export const searchMovies = internalQuery({
  args: {
    name: v.string(),
    editionId: v.optional(v.id('oscarEditions')),
    language: v.optional(v.union(v.literal('pt_BR'), v.literal('en_US'))),
  },
  returns: v.array(
    v.object({
      _id: v.id('movies'),
      tmdbId: v.number(),
      title: v.string(),
      posterPath: v.optional(v.string()),
      nominationCount: v.number(),
      watched: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const searchTerm = args.name.toLowerCase()
    const language = args.language ?? 'en_US'
    const userId = await getAuthUserId(ctx)

    // Get user's watched movies
    let userWatchedMovieIds = new Set<Id<'movies'>>()
    if (userId) {
      const userWatchedMovies = await ctx.db
        .query('watchedMovies')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .collect()
      userWatchedMovieIds = new Set(userWatchedMovies.map((wm) => wm.movieId))
    }

    // Get all nominations for filtering
    let allNominations = await ctx.db.query('oscarNomination').collect()
    if (args.editionId) {
      allNominations = allNominations.filter((n) => n.editionId === args.editionId)
    }

    // Get all nominated movie IDs
    const nominatedMovieIds = new Set(allNominations.map((n) => n.movieId))

    // Search movies that have been nominated
    const allMovies = await ctx.db.query('movies').collect()
    const nominatedMovies = allMovies.filter((movie) => nominatedMovieIds.has(movie._id))

    const matchingMovies = nominatedMovies.filter(
      (movie) =>
        movie.title.en_US.toLowerCase().includes(searchTerm) ||
        movie.title.pt_BR.toLowerCase().includes(searchTerm) ||
        movie.title.original.toLowerCase().includes(searchTerm),
    )

    // Count nominations per movie
    const nominationCountMap = new Map<Id<'movies'>, number>()
    for (const nom of allNominations) {
      nominationCountMap.set(nom.movieId, (nominationCountMap.get(nom.movieId) ?? 0) + 1)
    }

    return matchingMovies.slice(0, 10).map((movie) => ({
      _id: movie._id,
      tmdbId: movie.tmdbId,
      title: movie.title[language],
      posterPath: movie.posterPath ? movie.posterPath[language] : undefined,
      nominationCount: nominationCountMap.get(movie._id) ?? 0,
      watched: userWatchedMovieIds.has(movie._id),
    }))
  },
})

export const searchCategories = internalQuery({
  args: {
    name: v.string(),
    editionId: v.optional(v.id('oscarEditions')),
    language: v.optional(v.union(v.literal('pt_BR'), v.literal('en_US'))),
  },
  returns: v.array(
    v.object({
      _id: v.id('oscarCategories'),
      name: v.string(),
      groupName: v.string(),
      order: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const searchTerm = args.name.toLowerCase()
    const language = args.language ?? 'en_US'

    // Get all categories
    const allCategories = await ctx.db.query('oscarCategories').collect()

    // Filter by search term in both languages
    const matchingCategories = allCategories.filter(
      (category) =>
        category.name.en_US.toLowerCase().includes(searchTerm) ||
        category.name.pt_BR.toLowerCase().includes(searchTerm),
    )

    // Enrich with group names
    const enrichedCategories = await Promise.all(
      matchingCategories.map(async (category) => {
        const group = await ctx.db.get(category.groupId)
        return {
          _id: category._id,
          name: category.name[language],
          groupName: group?.name[language] ?? '',
          order: category.order,
        }
      }),
    )

    return enrichedCategories.slice(0, 10)
  },
})

export const search = query({
  args: {
    name: v.optional(v.string()),
    editionId: v.optional(v.id('oscarEditions')),
    language: v.optional(v.union(v.literal('pt_BR'), v.literal('en_US'))),
  },
  returns: v.object({
    users: v.array(
      v.object({
        _id: v.id('users'),
        name: v.optional(v.string()),
        username: v.optional(v.string()),
        imageURL: v.optional(v.string()),
        following: v.boolean(),
        follows: v.boolean(),
      }),
    ),
    movies: v.array(
      v.object({
        _id: v.id('movies'),
        tmdbId: v.number(),
        title: v.string(),
        posterPath: v.optional(v.string()),
        nominationCount: v.number(),
        watched: v.boolean(),
      }),
    ),
    categories: v.array(
      v.object({
        _id: v.id('oscarCategories'),
        name: v.string(),
        groupName: v.string(),
        order: v.number(),
      }),
    ),
  }),
  handler: async (ctx, args): Promise<any> => {
    if (!args.name || args.name.trim() === '') {
      return {
        users: [],
        movies: [],
        categories: [],
      }
    }

    const users = await ctx.runQuery(internal.oscars.searchUsers, {
      name: args.name,
    })

    const movies = await ctx.runQuery(internal.oscars.searchMovies, {
      name: args.name,
      editionId: args.editionId,
      language: args.language,
    })

    const categories = await ctx.runQuery(internal.oscars.searchCategories, {
      name: args.name,
      editionId: args.editionId,
      language: args.language,
    })

    return {
      users,
      movies,
      categories,
    }
  },
})
