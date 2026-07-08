import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

import { authTables } from '@convex-dev/auth/server'

const applicationTables = {
  versions: defineTable({
    version: v.string(),

    app: v.union(v.literal('absolute-cinema'), v.literal('oscar-tracker')),

    url: v.union(
      v.object({
        android: v.string(),
        ios: v.string(),
      }),
      v.string(),
    ),

    changelog: v.object({
      en_US: v.string(),
      pt_BR: v.string(),
    }),
    env: v.union(v.literal('test'), v.literal('prod')),
  }).index('app_and_version', ['app', 'version']),

  users: defineTable({
    name: v.optional(v.string()),
    installedVersion: v.optional(v.string()),
    image: v.optional(v.id('_storage')),
    imageURL: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    username: v.optional(v.string()),
    admin: v.optional(v.boolean()),

    language: v.optional(v.union(v.literal('pt_BR'), v.literal('en_US'))),

    hidePlot: v.optional(v.boolean()),
    hideCast: v.optional(v.boolean()),
    hideRate: v.optional(v.boolean()),
    hidePoster: v.optional(v.boolean()),
  })
    .index('email', ['email'])
    .index('by_username', ['username'])
    .searchIndex('search_name', { searchField: 'username' }),

  movies: defineTable({
    title: v.object({
      original: v.string(),
      pt_BR: v.string(),
      en_US: v.string(),
    }),
    posterPath: v.optional(
      v.object({
        pt_BR: v.string(),
        en_US: v.string(),
      }),
    ),

    plot: v.optional(
      v.object({
        pt_BR: v.string(),
        en_US: v.string(),
      }),
    ),

    backdropPath: v.optional(v.string()),
    imdbId: v.optional(v.string()),
    originalLanguage: v.optional(v.string()),
    releaseDate: v.optional(v.string()),
    runtime: v.optional(v.number()),
    status: v.optional(v.string()),
    tagline: v.optional(v.string()),
    voteAverage: v.optional(v.number()),
    tmdbId: v.number(),
    originCountry: v.optional(v.array(v.string())),

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
  })
    .index('by_tmdb_id', ['tmdbId'])
    .searchIndex('search_title', {
      searchField: 'title.en_US',
    }),

  watchlist: defineTable({
    userId: v.id('users'),
    movieId: v.id('movies'),
    addedAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_user_and_movie', ['userId', 'movieId']),

  watchedMovies: defineTable({
    userId: v.id('users'),
    movieId: v.id('movies'),
    watchedAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_user_and_movie', ['userId', 'movieId']),

  actors: defineTable({
    tmdbId: v.number(),
    picture_path: v.optional(v.string()),
    name: v.string(),
  }).index('by_tmdb_id', ['tmdbId']),

  oscarEditions: defineTable({
    number: v.number(),
    year: v.number(),
    announcement: v.optional(v.number()),
    date: v.number(),
    finished: v.boolean(),
    complete: v.boolean(),
  }).index('by_complete_and_number', ['complete', 'number']),

  oscarGroups: defineTable({
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

  oscarCategories: defineTable({
    groupId: v.id('oscarGroups'),
    name: v.object({
      pt_BR: v.string(),
      en_US: v.string(),
    }),
    order: v.number(),
  }),

  oscarRanks: defineTable({
    userId: v.id('users'),
    nominationId: v.id('oscarNomination'),
    ranking: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_user_and_nomination', ['userId', 'nominationId']),

  oscarBallot: defineTable({
    userId: v.id('users'),
    editionId: v.id('oscarEditions'),
    categoryId: v.id('oscarCategories'),
    rank: v.array(v.id('oscarNomination')),
    likes: v.array(v.id('oscarNomination')),
  })
    .index('by_user', ['userId'])
    .index('by_edition', ['editionId'])
    .index('by_user_and_edition_category', ['userId', 'editionId', 'categoryId'])
    .index('by_user_and_edition', ['userId', 'editionId']),

  oscarResults: defineTable({
    editionId: v.id('oscarEditions'),
    userId: v.id('users'),

    //number of watched movies
    movies: v.number(),
    //number of categories fully watched
    categories: v.number(),
    //number of watched hours (sum of movie.runtime)
    hours: v.number(),
    //number of points
    points: v.number(),
    //rate based on wins that were also wishes of the user
    satisfaction: v.number(),
    //points breakdown by category (ordered by category.order)
    pointsByCategory: v.optional(v.array(v.number())),
  })
    .index('by_edition', ['editionId'])
    .index('by_edition_and_user', ['editionId', 'userId']),

  oscarWishes: defineTable({
    userId: v.id('users'),
    nominationId: v.id('oscarNomination'),
  })
    .index('by_user', ['userId'])
    .index('by_user_and_nomination', ['userId', 'nominationId']),

  oscarNomination: defineTable({
    movieId: v.id('movies'),
    editionId: v.id('oscarEditions'),
    categoryId: v.id('oscarCategories'),
    actorId: v.optional(v.id('actors')),
    country: v.optional(v.string()),
    winner: v.optional(v.boolean()),
    song: v.optional(v.string()),
    url: v.optional(v.string()),
    nominee: v.optional(
      v.object({
        pt_BR: v.string(),
        en_US: v.string(),
      }),
    ),
    character: v.optional(
      v.object({
        pt_BR: v.string(),
        en_US: v.string(),
      }),
    ),
  })
    .index('by_edition', ['editionId'])
    .index('by_edition_and_category', ['editionId', 'categoryId'])
    .index('by_edition_and_movie', ['editionId', 'movieId'])
    .index('by_movie', ['movieId']),

  friends: defineTable({
    userId: v.id('users'),
    friendId: v.id('users'),
  })
    .index('by_user', ['userId'])
    .index('by_friend', ['friendId'])
    .index('by_user_and_friend', ['userId', 'friendId']),
}

export default defineSchema({
  ...authTables,
  ...applicationTables,
})
