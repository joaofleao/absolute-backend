import { ConvexError, v } from 'convex/values'

import { Id } from './_generated/dataModel'
import { query } from './_generated/server'

import { getAuthUserId } from '@convex-dev/auth/server'
import { api } from './_generated/api'

export const getAllEditions = query({
  args: {
    public: v.optional(v.boolean()),
  },
  returns: v.array(
    v.object({
      _id: v.id('oscarEditions'),
      number: v.number(),
      year: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const allEditions = await ctx.db
      .query('oscarEditions')
      .withIndex(
        'by_public_and_number',
        args.public !== undefined ? (q) => q.eq('public', args.public ?? true) : undefined,
      )
      .order('desc')
      .collect()

    return allEditions.map((edition) => ({
      _id: edition._id,
      number: edition.number,
      year: edition.year,
    }))
  },
})

export const getEdition = query({
  args: {
    _id: v.optional(v.id('oscarEditions')),
  },
  returns: v.object({
    _id: v.id('oscarEditions'),
    number: v.number(),
    year: v.number(),
    date: v.number(),
    announcement: v.optional(v.number()),
    complete: v.optional(v.boolean()),
  }),
  handler: async (ctx, args) => {
    let edition
    if (args._id) edition = await ctx.db.get('oscarEditions', args._id)
    if (!edition)
      edition = await ctx.db
        .query('oscarEditions')
        .withIndex('by_public_and_number', (q) => q.eq('public', true))
        .order('desc')
        .first()
    if (!edition) throw new Error('Edition not found')

    return {
      _id: edition._id,
      number: edition.number,
      year: edition.year,
      date: edition.date,
      announcement: edition.announcement,
      complete: edition.complete,
    }
  },
})

export const getEditionMovies = query({
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
      nominationCount: v.number(),
    }),
  ),

  handler: async (ctx, args) => {
    const edition =
      args.editionId ?? (await ctx.db.query('oscarEditions').order('desc').first())?._id
    if (!edition) return []

    const nominations = await ctx.db
      .query('oscarNomination')
      .withIndex('by_edition', (q) => q.eq('editionId', edition))
      .collect()

    const movies = new Map<
      Id<'movies'>,
      {
        _id: Id<'movies'>
        tmdbId: number
        title: string
        posterPath: string | undefined
        nominationCount: number
      }
    >()

    for (const nomination of nominations) {
      const movieId = nomination.movieId
      const movie = await ctx.db.get(movieId)
      if (!movie) continue
      const added = movies.get(movieId)

      if (!added) {
        movies.set(movieId, {
          _id: movie._id,
          tmdbId: movie.tmdbId,
          title: movie.title[args.language ?? 'en_US'],
          posterPath: movie.posterPath ? movie.posterPath[args.language ?? 'en_US'] : undefined,
          nominationCount: 1,
        })
      } else added.nominationCount += 1
    }

    const valuesArray = Array.from(movies.values()).sort((a, b) => {
      if (b.nominationCount !== a.nominationCount) return b.nominationCount - a.nominationCount
      return a.title.localeCompare(b.title)
    })
    return valuesArray
  },
})

export const getUserWatch = query({
  args: {
    movieId: v.id('movies'),
  },
  returns: v.union(v.boolean(), v.null()),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return null

    const watchedItem = await ctx.db
      .query('watchedMovies')
      .withIndex('by_user_and_movie', (q) => q.eq('userId', userId).eq('movieId', args.movieId))
      .first()
    return !!watchedItem
  },
})

export const getUserWatches = query({
  args: {
    movies: v.array(v.id('movies')),
  },
  returns: v.array(v.id('movies')),

  handler: async (ctx, args): Promise<any> => {
    const movies = []

    for (const movie of args.movies) {
      const myWatch = await ctx.runQuery(api.oscar.getUserWatch, {
        movieId: movie,
      })
      if (myWatch) movies.push(movie)
    }

    return movies
  },
})

export const getFriendsWatch = query({
  args: {
    movieId: v.id('movies'),
  },
  returns: v.array(v.id('users')),

  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return []
    let friendsWhoWatched: Id<'users'>[] = []

    const friends = await ctx.db
      .query('friends')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()

    for (const friend of friends) {
      const friendWatched = await ctx.db
        .query('watchedMovies')
        .withIndex('by_user_and_movie', (q) =>
          q.eq('userId', friend.friendId).eq('movieId', args.movieId),
        )
        .first()

      if (friendWatched) friendsWhoWatched.push(friend.friendId)
    }

    return friendsWhoWatched
  },
})

export const getFriendsData = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id('users'),
      name: v.optional(v.string()),
      imageURL: v.optional(v.string()),
    }),
  ),

  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return []

    let friendsData: { _id: Id<'users'>; name?: string; imageURL?: string }[] = []

    const friendsIds = await ctx.db
      .query('friends')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()

    for (const friend of friendsIds) {
      const friendData = await ctx.db.get(friend.friendId)
      if (!friendData) continue

      friendsData.push({
        _id: friend.friendId,
        name: friendData.name,
        imageURL: friendData.imageURL,
      })
    }

    return friendsData
  },
})

export const getFriendsWatches = query({
  args: {
    movies: v.array(v.id('movies')),
  },
  returns: v.array(
    v.object({
      movieId: v.id('movies'),
      friends_who_watched: v.array(
        v.object({
          _id: v.id('users'),
          name: v.optional(v.string()),
          imageURL: v.optional(v.string()),
        }),
      ),
    }),
  ),

  handler: async (ctx, args): Promise<any> => {
    const movies = []

    const friendsData = await ctx.runQuery(api.oscar.getFriendsData)

    for (const movie of args.movies) {
      const friendsWatch = await ctx.runQuery(api.oscar.getFriendsWatch, {
        movieId: movie,
      })

      movies.push({
        movieId: movie,
        friends_who_watched: friendsData.filter((friend) => friendsWatch.includes(friend._id)),
      })
    }

    return movies
  },
})

export const getNominations = query({
  args: {
    editionId: v.optional(v.id('oscarEditions')),
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
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const latestEdition = await ctx.db.query('oscarEditions').order('desc').first()
    const editionId = args.editionId ?? latestEdition?._id

    if (!editionId) return []

    const edition = await ctx.db.get(editionId)
    if (!edition || !edition.complete) return []

    const nominations = await ctx.db
      .query('oscarNomination')
      .withIndex('by_edition_and_category', (q) => q.eq('editionId', editionId))
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
      nominationCount: v.number(),
    }),
  ),

  handler: async (ctx, args) => {
    const edition =
      args.editionId ?? (await ctx.db.query('oscarEditions').order('desc').first())?._id
    if (!edition) return []

    const nominations = await ctx.db
      .query('oscarNomination')
      .withIndex('by_edition', (q) => q.eq('editionId', edition))
      .collect()

    const movies = new Map<
      Id<'movies'>,
      {
        _id: Id<'movies'>
        tmdbId: number
        title: string
        posterPath: string | undefined
        nominationCount: number
      }
    >()

    for (const nomination of nominations) {
      const movieId = nomination.movieId
      const movie = await ctx.db.get(movieId)
      if (!movie) continue
      const added = movies.get(movieId)

      if (!added) {
        movies.set(movieId, {
          _id: movie._id,
          tmdbId: movie.tmdbId,
          title: movie.title[args.language ?? 'en_US'],
          posterPath: movie.posterPath ? movie.posterPath[args.language ?? 'en_US'] : undefined,
          nominationCount: 1,
        })
      } else added.nominationCount += 1
    }

    const valuesArray = Array.from(movies.values()).sort((a, b) => {
      if (b.nominationCount !== a.nominationCount) return b.nominationCount - a.nominationCount
      return a.title.localeCompare(b.title)
    })
    return valuesArray
  },
})
