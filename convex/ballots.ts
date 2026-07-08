import { ConvexError, v } from 'convex/values'

import { Id } from './_generated/dataModel'
import { action, internalMutation, mutation, query } from './_generated/server'

import { getAuthUserId } from '@convex-dev/auth/server'
import { api, internal } from './_generated/api'
import { countries } from './constants'

export const rankNomination = mutation({
  args: {
    editionId: v.id('oscarEditions'),
    categoryId: v.id('oscarCategories'),
    votes: v.array(v.id('oscarNomination')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new ConvexError('Not authenticated')
    if (args.votes.length === 0) return null

    const ballot = await ctx.db
      .query('oscarBallot')
      .withIndex('by_user_and_edition_category', (q) =>
        q.eq('userId', userId).eq('editionId', args.editionId).eq('categoryId', args.categoryId),
      )
      .unique()

    if (!ballot) {
      await ctx.db.insert('oscarBallot', {
        userId,
        editionId: args.editionId,
        categoryId: args.categoryId,
        rank: args.votes,
        likes: [],
      })
      return null
    }

    await ctx.db.patch(ballot._id, { rank: args.votes })
    return null
  },
})

export const toggleWishNomination = mutation({
  args: {
    editionId: v.id('oscarEditions'),
    categoryId: v.id('oscarCategories'),
    nominationId: v.id('oscarNomination'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new ConvexError('Not authenticated')

    const ballot = await ctx.db
      .query('oscarBallot')
      .withIndex('by_user_and_edition_category', (q) =>
        q.eq('userId', userId).eq('editionId', args.editionId).eq('categoryId', args.categoryId),
      )
      .unique()

    if (!ballot) {
      await ctx.db.insert('oscarBallot', {
        userId,
        editionId: args.editionId,
        categoryId: args.categoryId,
        rank: [],
        likes: [args.nominationId],
      })
      return null
    }

    const isWished = ballot.likes.includes(args.nominationId)
    const likes = isWished
      ? ballot.likes.filter((id) => id !== args.nominationId)
      : [...ballot.likes, args.nominationId]

    await ctx.db.patch(ballot._id, { likes })
    return null
  },
})

export const generateResults = action({
  args: {
    editionId: v.id('oscarEditions'),
  },
  returns: v.object({
    users: v.number(),
    results: v.number(),
  }),
  handler: async (ctx, args): Promise<any> => {
    return await ctx.runMutation(internal.ballots._generateResultsForEdition, {
      editionId: args.editionId,
    })
  },
})

export const _generateResultsForEdition = internalMutation({
  args: {
    editionId: v.id('oscarEditions'),
  },
  returns: v.object({
    users: v.number(),
    results: v.number(),
  }),
  handler: async (ctx, args) => {
    // Validate requested edition.
    const edition = await ctx.db.get(args.editionId)
    if (!edition) throw new ConvexError('Edition not found')

    // Load all nominations for this edition (source of categories, winners and movies).
    const nominations = await ctx.db
      .query('oscarNomination')
      .withIndex('by_edition', (q) => q.eq('editionId', args.editionId))
      .collect()

    // Always regenerate: remove previous stored results for this edition.
    const previousResults = await ctx.db
      .query('oscarResults')
      .withIndex('by_edition', (q) => q.eq('editionId', args.editionId))
      .collect()
    for (const result of previousResults) {
      await ctx.db.delete(result._id)
    }

    // If edition has no nominations, still return successfully.
    if (nominations.length === 0) {
      await ctx.db.patch(args.editionId, { finished: true })
      return { users: 0, results: 0 }
    }

    // Only users who submitted ballots in this edition should receive results.
    const ballots = await ctx.db
      .query('oscarBallot')
      .withIndex('by_edition', (q) => q.eq('editionId', args.editionId))
      .collect()

    const ballotUserIds = new Set<Id<'users'>>()
    for (const ballot of ballots) {
      ballotUserIds.add(ballot.userId)
    }

    if (ballotUserIds.size === 0) {
      await ctx.db.patch(args.editionId, { finished: true })
      return { users: 0, results: 0 }
    }

    // Category -> list of movie ids nominated in that category.
    const categoryMovieIds = new Map<Id<'oscarCategories'>, Id<'movies'>[]>()

    // Unique movie ids nominated in this edition.
    const editionMovieIds = new Set<Id<'movies'>>()

    // Winners grouped by category (handles ties where multiple nominations win).
    const winnersByCategory = new Map<
      Id<'oscarCategories'>,
      { nominationId: Id<'oscarNomination'>; movieId: Id<'movies'> }[]
    >()

    for (const nomination of nominations) {
      editionMovieIds.add(nomination.movieId)

      const moviesInCategory = categoryMovieIds.get(nomination.categoryId) ?? []
      if (!moviesInCategory.includes(nomination.movieId)) {
        moviesInCategory.push(nomination.movieId)
      }
      categoryMovieIds.set(nomination.categoryId, moviesInCategory)

      if (nomination.winner) {
        const categoryWinners = winnersByCategory.get(nomination.categoryId) ?? []
        categoryWinners.push({ nominationId: nomination._id, movieId: nomination.movieId })
        winnersByCategory.set(nomination.categoryId, categoryWinners)
      }
    }

    // Find Best Picture category among categories used in this edition.
    const allCategories = await ctx.db.query('oscarCategories').collect()
    const bestPictureCategoryId = allCategories.find(
      (category) =>
        categoryMovieIds.has(category._id) &&
        category.name.en_US.toLowerCase().includes('best picture'),
    )?._id

    // Categories in order by category.order for pointsByCategory array.
    const categoriesInOrder = allCategories
      .filter((cat) => winnersByCategory.has(cat._id))
      .sort((a, b) => a.order - b.order)

    // Preload nominated movie runtimes for hours calculation.
    const movieDocs = await Promise.all([...editionMovieIds].map((movieId) => ctx.db.get(movieId)))
    const movieRuntimeById = new Map<Id<'movies'>, number>()
    for (const movie of movieDocs) {
      if (movie) movieRuntimeById.set(movie._id, movie.runtime ?? 0)
    }

    // Per-user accumulator used to compute final oscarResults row.
    const userStats = new Map<
      Id<'users'>,
      {
        watchedMovieIds: Set<Id<'movies'>>
        rankByNomination: Map<Id<'oscarNomination'>, number>
        likedNominationIds: Set<Id<'oscarNomination'>>
      }
    >()

    for (const userId of ballotUserIds) {
      userStats.set(userId, {
        watchedMovieIds: new Set<Id<'movies'>>(),
        rankByNomination: new Map<Id<'oscarNomination'>, number>(),
        likedNominationIds: new Set<Id<'oscarNomination'>>(),
      })
    }

    // For each ballot user, query only their watches for edition movies via index.
    // This avoids a full table scan of watchedMovies: reads at most U × M docs
    // instead of the entire table, where U = ballot users and M = edition movies.
    for (const userId of ballotUserIds) {
      const stats = userStats.get(userId)!
      for (const movieId of editionMovieIds) {
        const watched = await ctx.db
          .query('watchedMovies')
          .withIndex('by_user_and_movie', (q) => q.eq('userId', userId).eq('movieId', movieId))
          .first()
        if (watched) stats.watchedMovieIds.add(movieId)
      }
    }

    // Fill ranking/likes from ballots submitted in this edition.
    for (const ballot of ballots) {
      const stats = userStats.get(ballot.userId)
      if (!stats) continue

      ballot.rank.forEach((nominationId, index) => {
        // Rank is 1-based (index 0 => rank 1).
        stats.rankByNomination.set(nominationId, index + 1)
      })

      ballot.likes.forEach((nominationId) => {
        stats.likedNominationIds.add(nominationId)
      })
    }

    // Generate one result row per user.
    let inserted = 0

    for (const [userId, stats] of userStats) {
      // Number of nominated movies watched by this user.
      const movies = stats.watchedMovieIds.size

      // Sum of runtime for nominated movies watched by this user.
      let watchedMinutes = 0
      for (const movieId of stats.watchedMovieIds) {
        watchedMinutes += movieRuntimeById.get(movieId) ?? 0
      }
      const hours = watchedMinutes / 60

      // Number of categories where user watched all nominated movies.
      let categories = 0
      for (const movieIds of categoryMovieIds.values()) {
        const finalized = movieIds.every((movieId) => stats.watchedMovieIds.has(movieId))
        if (finalized) categories++
      }

      // Points: scored once per category using the best-ranked winner for this user.
      // Satisfaction: a category counts as wished if the user wished at least one of its winners.
      let points = 0
      let wishedCategories = 0
      const totalWinnerCategories = winnersByCategory.size
      const pointsByCategory: number[] = []

      for (const category of categoriesInOrder) {
        const categoryId = category._id
        const categoryWinners = winnersByCategory.get(categoryId)!
        // Pick the winner the user ranked highest (lowest rank number = better position).
        let bestRank: number | undefined
        let bestWinner: { nominationId: Id<'oscarNomination'>; movieId: Id<'movies'> } | undefined
        for (const winner of categoryWinners) {
          const rank = stats.rankByNomination.get(winner.nominationId)
          if (rank !== undefined && (bestRank === undefined || rank < bestRank)) {
            bestRank = rank
            bestWinner = winner
          }
        }

        // Points for this category (only if user ranked at least one winner).
        if (bestRank !== undefined && bestWinner !== undefined) {
          let base = 0
          if (bestRank === 1) base = 5
          else if (bestRank === 2) base = 4
          else if (bestRank === 3) base = 3
          else if (bestRank === 4) base = 2
          else base = 1

          const watchedWinner = stats.watchedMovieIds.has(bestWinner.movieId)
          const bonus =
            watchedWinner && bestRank === 1 && categoryId === bestPictureCategoryId ? 5 : 0
          const penalty = watchedWinner ? 0 : 2

          const finalPoints = base + bonus - penalty
          const categoryPoints = watchedWinner ? Math.max(finalPoints, 1) : Math.max(finalPoints, 0)
          points += categoryPoints
          pointsByCategory.push(categoryPoints)
        } else {
          pointsByCategory.push(0)
        }

        // Satisfaction: wished if the user liked at least one winner in this category.
        const wishedAny = categoryWinners.some((w) => stats.likedNominationIds.has(w.nominationId))
        if (wishedAny) wishedCategories++
      }

      const satisfaction =
        totalWinnerCategories > 0 ? Math.round((wishedCategories / totalWinnerCategories) * 100) : 0

      await ctx.db.insert('oscarResults', {
        editionId: args.editionId,
        userId,
        movies,
        categories,
        hours: Math.round(hours * 10) / 10,
        points,
        satisfaction,
        pointsByCategory,
      })
      inserted++
    }

    await ctx.db.patch(args.editionId, { finished: true })

    return {
      users: ballotUserIds.size,
      results: inserted,
    }
  },
})

export const convertRankAndWishToBallot = action({
  args: {},
  returns: v.object({
    users: v.number(),
    ballotsCreated: v.number(),
  }),
  handler: async (ctx, _args): Promise<any> => {
    return await ctx.runMutation(internal.ballots._convertRankAndWishToBallot, {})
  },
})

export const _convertRankAndWishToBallot = internalMutation({
  args: {},
  returns: v.object({
    users: v.number(),
    ballotsCreated: v.number(),
  }),
  handler: async (ctx, _args) => {
    const allUsers = await ctx.db.query('users').collect()
    let ballotsCreated = 0

    for (const user of allUsers) {
      const userId = user._id

      const userRanks = await ctx.db
        .query('oscarRanks')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .collect()

      const userWishes = await ctx.db
        .query('oscarWishes')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .collect()

      if (userRanks.length === 0 && userWishes.length === 0) continue

      // Load all nominations referenced by this user's ranks and wishes.
      const nominationIds = new Set<Id<'oscarNomination'>>()
      userRanks.forEach((r) => nominationIds.add(r.nominationId))
      userWishes.forEach((w) => nominationIds.add(w.nominationId))

      const nominationDocs = await Promise.all([...nominationIds].map((id) => ctx.db.get(id)))
      const nominationById = new Map<
        Id<'oscarNomination'>,
        { editionId: Id<'oscarEditions'>; categoryId: Id<'oscarCategories'> }
      >()
      for (const nom of nominationDocs) {
        if (nom)
          nominationById.set(nom._id, { editionId: nom.editionId, categoryId: nom.categoryId })
      }

      // Determine all editions touched by this user's old data.
      const touchedEditions = new Set<Id<'oscarEditions'>>()
      for (const nom of nominationById.values()) touchedEditions.add(nom.editionId)

      for (const editionId of touchedEditions) {
        // If the user already has ANY ballot for this edition they are in the new format — skip.
        const existingBallot = await ctx.db
          .query('oscarBallot')
          .withIndex('by_user_and_edition', (q) =>
            q.eq('userId', userId).eq('editionId', editionId),
          )
          .first()
        if (existingBallot) continue

        // Group ranks by categoryId for this edition.
        const ranksByCategory = new Map<
          Id<'oscarCategories'>,
          { nominationId: Id<'oscarNomination'>; ranking: number }[]
        >()
        for (const rank of userRanks) {
          const nom = nominationById.get(rank.nominationId)
          if (!nom || nom.editionId !== editionId) continue
          const list = ranksByCategory.get(nom.categoryId) ?? []
          list.push({ nominationId: rank.nominationId, ranking: rank.ranking })
          ranksByCategory.set(nom.categoryId, list)
        }

        // Group wishes by categoryId for this edition.
        const wishesByCategory = new Map<Id<'oscarCategories'>, Id<'oscarNomination'>[]>()
        for (const wish of userWishes) {
          const nom = nominationById.get(wish.nominationId)
          if (!nom || nom.editionId !== editionId) continue
          const list = wishesByCategory.get(nom.categoryId) ?? []
          list.push(wish.nominationId)
          wishesByCategory.set(nom.categoryId, list)
        }

        // Collect all categories touched in this edition.
        const allCategories = new Set<Id<'oscarCategories'>>([
          ...ranksByCategory.keys(),
          ...wishesByCategory.keys(),
        ])

        for (const categoryId of allCategories) {
          // Build rank array sorted by ranking value (ascending = best first).
          const rank = (ranksByCategory.get(categoryId) ?? [])
            .sort((a, b) => a.ranking - b.ranking)
            .map((r) => r.nominationId)

          const likes = wishesByCategory.get(categoryId) ?? []

          await ctx.db.insert('oscarBallot', {
            userId,
            editionId,
            categoryId,
            rank,
            likes,
          })
          ballotsCreated++
        }
      }
    }

    return { users: allUsers.length, ballotsCreated }
  },
})

export const convertResultMinutesToHours = action({
  args: {},
  returns: v.object({
    resultsUpdated: v.number(),
  }),
  handler: async (ctx, _args): Promise<any> => {
    return await ctx.runMutation(internal.ballots._convertResultMinutesToHours, {})
  },
})

export const _convertResultMinutesToHours = internalMutation({
  args: {},
  returns: v.object({
    resultsUpdated: v.number(),
  }),
  handler: async (ctx, _args) => {
    const results = await ctx.db.query('oscarResults').collect()
    let resultsUpdated = 0

    for (const result of results) {
      await ctx.db.patch(result._id, {
        hours: result.hours / 60,
      })
      resultsUpdated++
    }

    return { resultsUpdated }
  },
})

export const getCategoriesWithBallots = query({
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
    const category_id = args.categoryId ?? latestCategory?._id
    const edition_id = args.editionId ?? latestEdition?._id
    const language = args.language ?? 'en_US'

    if (!category_id || !edition_id) {
      throw new ConvexError('Edition or category not found')
    }

    const nominations = await ctx.db
      .query('oscarNomination')
      .withIndex('by_edition_and_category', (q) =>
        q.eq('editionId', edition_id).eq('categoryId', category_id),
      )
      .collect()

    const category = await ctx.db.get(category_id)
    if (!category) throw new ConvexError('Category not found')

    // Single ballot lookup for this user/edition/category.
    const ballot = userId
      ? await ctx.db
          .query('oscarBallot')
          .withIndex('by_user_and_edition_category', (q) =>
            q.eq('userId', userId).eq('editionId', edition_id).eq('categoryId', category_id),
          )
          .unique()
      : null

    // Single watched lookup for this user.
    const watchedMovieIds = new Set<Id<'movies'>>()
    if (userId) {
      const watched = await ctx.db
        .query('watchedMovies')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .collect()
      watched.forEach((w) => watchedMovieIds.add(w.movieId))
    }

    const enrichedNominations = await Promise.all(
      nominations.map(
        async ({ movieId, actorId, song, _id, character, country, nominee, winner }) => {
          const movie = await ctx.db.get(movieId)
          if (!movie) throw new ConvexError('Movie not found')

          const actor = actorId ? await ctx.db.get(actorId) : null

          const rankIndex = ballot ? ballot.rank.findIndex((id) => id === _id) : -1
          const rank = rankIndex >= 0 ? rankIndex + 1 : undefined
          const wish = ballot ? ballot.likes.includes(_id) : false

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

          return {
            nominationId: _id,
            title,
            description,
            extra,
            image,
            tmdbId: movie.tmdbId,
            rank,
            watched: watchedMovieIds.has(movie._id),
            winner: !!winner,
            wish,
          }
        },
      ),
    )

    return {
      category: {
        categoryId: category._id,
        name: category.name[language],
      },
      nominations: enrichedNominations,
    }
  },
})

export const getVotedCategories = query({
  args: {
    editionId: v.optional(v.id('oscarEditions')),
  },
  returns: v.array(v.id('oscarCategories')),

  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new ConvexError('Not authenticated')

    const latestEdition = await ctx.db.query('oscarEditions').order('desc').first()
    const editionId = args.editionId ?? latestEdition?._id
    if (!editionId) throw new ConvexError('Edition not found')

    const userBallots = await ctx.db
      .query('oscarBallot')
      .withIndex('by_user_and_edition', (q) => q.eq('userId', userId).eq('editionId', editionId))
      .collect()

    return userBallots.filter((ballot) => ballot.rank.length > 0).map((ballot) => ballot.categoryId)
  },
})

export const getResult = query({
  args: {
    editionId: v.optional(v.id('oscarEditions')),
  },
  returns: v.object({
    personal: v.object({
      movies: v.float64(),
      categories: v.float64(),
      hours: v.float64(),
      points: v.float64(),
      satisfaction: v.float64(),
      participated: v.boolean(),
    }),
    leaderboard: v.array(
      v.object({
        rank: v.number(),
        userId: v.id('users'),
        name: v.optional(v.string()),
        username: v.optional(v.string()),
        imageURL: v.optional(v.string()),
        participated: v.boolean(),
        movies: v.float64(),
        categories: v.float64(),
        hours: v.float64(),
        points: v.float64(),
        satisfaction: v.float64(),
      }),
    ),
  }),

  handler: async (ctx, args) => {
    const emptyPersonal = {
      movies: 0,
      categories: 0,
      hours: 0,
      points: 0,
      satisfaction: 0,
      participated: false,
    }

    const userId = await getAuthUserId(ctx)
    if (!userId) {
      return {
        personal: emptyPersonal,
        leaderboard: [],
      }
    }

    const latestEdition = await ctx.db.query('oscarEditions').order('desc').first()
    const editionId = args.editionId ?? latestEdition?._id
    if (!editionId) throw new ConvexError('Edition not found')

    const result = await ctx.db
      .query('oscarResults')
      .withIndex('by_edition_and_user', (q) => q.eq('editionId', editionId).eq('userId', userId))
      .unique()

    const following = await ctx.db
      .query('friends')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()

    const leaderboardUserIds = new Set<Id<'users'>>([userId])
    following.forEach((relation) => leaderboardUserIds.add(relation.friendId))

    const leaderboardBase = await Promise.all(
      [...leaderboardUserIds].map(async (id) => {
        const user = await ctx.db.get(id)
        const userResult = await ctx.db
          .query('oscarResults')
          .withIndex('by_edition_and_user', (q) => q.eq('editionId', editionId).eq('userId', id))
          .unique()

        return {
          userId: id,
          name: user?.name,
          username: user?.username,
          imageURL: user?.imageURL,
          participated: !!userResult,
          movies: userResult?.movies ?? 0,
          categories: userResult?.categories ?? 0,
          hours: userResult?.hours ?? 0,
          points: userResult?.points ?? 0,
          satisfaction: userResult?.satisfaction ?? 0,
        }
      }),
    )

    const leaderboard = leaderboardBase
      .sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points
        return b.movies - a.movies
      })
      .map((entry, index) => ({
        rank: index + 1,
        ...entry,
      }))

    return {
      personal: {
        movies: result?.movies ?? 0,
        categories: result?.categories ?? 0,
        hours: result?.hours ?? 0,
        points: result?.points ?? 0,
        satisfaction: result?.satisfaction ?? 0,
        participated: !!result,
      },
      leaderboard,
    }
  },
})
