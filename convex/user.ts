import { ConvexError, v } from 'convex/values'

import { action, mutation, query } from './_generated/server'
import { getAuthUserId } from '@convex-dev/auth/server'

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl()
  },
})

export const getLatestVersion = query({
  args: {
    app: v.union(v.literal('absolute-cinema'), v.literal('oscar-tracker')),
    language: v.optional(v.union(v.literal('en_US'), v.literal('pt_BR'))),
  },
  returns: v.object({
    _id: v.id('versions'),
    _creationTime: v.number(),
    url: v.string(),
    version: v.string(),
    changelog: v.string(),
    app: v.optional(v.union(v.literal('absolute-cinema'), v.literal('oscar-tracker'))),
  }),
  handler: async (ctx, args) => {
    const latest = await ctx.db
      .query('versions')
      .withIndex('app_and_version', (q) => q.eq('app', args.app))
      .order('desc')
      .first()
    if (!latest) throw new ConvexError('No versions found')
    return { ...latest!, changelog: latest.changelog[args.language ?? 'en_US'] }
  },
})
export const checkUsernameAvailability = query({
  args: {
    username: v.optional(v.string()),
  },
  returns: v.union(v.boolean(), v.null()),
  handler: async (ctx, args) => {
    if (args.username === undefined) return null

    const existingUser = await ctx.db
      .query('users')
      .filter((q) => q.eq(q.field('username'), args.username))
      .first()

    return !existingUser
  },
})

export const updateUser = mutation({
  args: {
    image: v.optional(v.union(v.id('_storage'), v.null())),
    name: v.optional(v.string()),
    username: v.optional(v.string()),
    language: v.optional(v.union(v.literal('pt_BR'), v.literal('en_US'))),
    hidePlot: v.optional(v.boolean()),
    hideCast: v.optional(v.boolean()),
    hideRate: v.optional(v.boolean()),
    hidePoster: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new ConvexError('Not authenticated')
    const patch: Record<string, any> = {}

    if (args.image === null) {
      patch.image = undefined
      patch.imageURL = undefined
      const user = await ctx.db
        .query('users')
        .filter((q) => q.eq(q.field('_id'), userId))
        .first()
      if (user?.image) await ctx.storage.delete(user.image).catch(() => {})
    }
    if (args.image !== null && args.image !== undefined) {
      const user = await ctx.db
        .query('users')
        .filter((q) => q.eq(q.field('_id'), userId))
        .first()
      if (user?.image) await ctx.storage.delete(user.image).catch(() => {})
      const imageUrl = await ctx.storage.getUrl(args.image)
      if (!imageUrl) throw new ConvexError('Failed to get image URL')
      patch.image = args.image
      patch.imageURL = imageUrl
    }

    if (args.name !== undefined) patch.name = args.name
    if (args.username !== undefined) patch.username = args.username
    if (args.language !== undefined) patch.language = args.language

    if (args.hidePlot !== undefined) patch.hidePlot = args.hidePlot
    if (args.hideCast !== undefined) patch.hideCast = args.hideCast
    if (args.hideRate !== undefined) patch.hideRate = args.hideRate
    if (args.hidePoster !== undefined) patch.hidePoster = args.hidePoster

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(userId, patch)
    }
  },
})

export const getCurrentUser = query({
  args: {},
  returns: v.union(
    v.object({
      _id: v.id('users'),
      _creationTime: v.number(),
      name: v.optional(v.string()),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      image: v.optional(v.id('_storage')),
      imageURL: v.optional(v.string()),
      emailVerificationTime: v.optional(v.number()),
      phoneVerificationTime: v.optional(v.number()),
      isAnonymous: v.optional(v.boolean()),
      username: v.optional(v.string()),

      language: v.optional(v.union(v.literal('pt_BR'), v.literal('en_US'))),

      hidePlot: v.optional(v.boolean()),
      hideCast: v.optional(v.boolean()),
      hideRate: v.optional(v.boolean()),
      hidePoster: v.optional(v.boolean()),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return null

    const user = await ctx.db.get(userId)
    if (!user) return null

    return user
  },
})

export const deleteAccount = action({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new ConvexError('Not authenticated')

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Absolute Cinema <absolute-cinema@joaofleao.com>',
        to: process.env.ADMINISTRATOR_EMAIL,
        subject: 'User requesting deletion of account',
        text: `The user "${userId}" has requested to have his account deleted`,
      }),
    })

    if (!res.ok) throw new ConvexError('Resend error: ' + JSON.stringify(await res.json()))
  },
})

// export const deleteAccount = mutation({
//   args: {},
//   returns: v.null(),
//   handler: async (ctx) => {
//     const userId = await getAuthUserId(ctx)
//     if (!userId) throw new ConvexError('Not authenticated')

//     // Delete all user's watchlist entries
//     const watchlistItems = await ctx.db
//       .query('watchlist')
//       .withIndex('by_user', (q) => q.eq('userId', userId))
//       .collect()

//     for (const item of watchlistItems) {
//       await ctx.db.delete(item._id)
//     }

//     // Delete all user's watched movies entries
//     const watchedItems = await ctx.db
//       .query('watchedMovies')
//       .withIndex('by_user', (q) => q.eq('userId', userId))
//       .collect()

//     for (const item of watchedItems) {
//       await ctx.db.delete(item._id)
//     }

//     // Delete all user's movie list enrollments
//     const enrollments = await ctx.db
//       .query('movieListEnrollments')
//       .withIndex('by_user', (q) => q.eq('userId', userId))
//       .collect()

//     for (const enrollment of enrollments) {
//       await ctx.db.delete(enrollment._id)
//     }

//     // Delete all movie lists created by the user
//     const createdLists = await ctx.db
//       .query('movieLists')
//       .withIndex('by_creator', (q) => q.eq('createdBy', userId))
//       .collect()

//     for (const list of createdLists) {
//       // First delete all enrollments for this list
//       const listEnrollments = await ctx.db
//         .query('movieListEnrollments')
//         .withIndex('by_list', (q) => q.eq('movieListId', list._id))
//         .collect()

//       for (const enrollment of listEnrollments) {
//         await ctx.db.delete(enrollment._id)
//       }

//       // Then delete the list itself
//       await ctx.db.delete(list._id)
//     }

//     // Finally, delete the user account
//     await ctx.db.delete(userId)
//   },
// })

export const reportError = action({
  args: {
    message: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Absolute Cinema <absolute-cinema@joaofleao.com>',
        to: process.env.ADMINISTRATOR_EMAIL,
        subject: 'Unknown error reported',
        text: `A user has reporter an error:\n\n${args.message}`,
      }),
    })

    if (!res.ok) throw new ConvexError('Resend error: ' + JSON.stringify(await res.json()))
  },
})

export const searchUsers = query({
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
    if (args.name === '' || args.name.length < 3) return []
    const userId = await getAuthUserId(ctx)

    const matchingUsers = await ctx.db
      .query('users')
      .withSearchIndex('search_name', (q) => q.search('username', args.name))
      .take(5)

    if (!userId)
      return matchingUsers.map((user) => ({
        _id: user._id,
        name: user.name,
        username: user.username,
        imageURL: user.imageURL,
        following: false,
        follows: false,
      }))

    return await Promise.all(
      matchingUsers.map(async (user) => {
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
          imageURL: user.imageURL,
          username: user.username,
          following,
          follows,
        }
      }),
    )
  },
})

export const startFollowing = mutation({
  args: { friendId: v.id('users') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new ConvexError('Not authenticated')
    if (userId === args.friendId) throw new ConvexError('Cannot follow yourself')

    const existing = await ctx.db
      .query('friends')
      .withIndex('by_user_and_friend', (q) => q.eq('userId', userId).eq('friendId', args.friendId))
      .first()

    if (existing) throw new ConvexError('Already Flollows')

    await ctx.db.insert('friends', {
      userId,
      friendId: args.friendId,
    })
  },
})

export const stopFollowing = mutation({
  args: { friendId: v.id('users') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new ConvexError('Not authenticated')

    const existing = await ctx.db
      .query('friends')
      .withIndex('by_user_and_friend', (q) => q.eq('userId', userId).eq('friendId', args.friendId))
      .first()

    if (!existing) throw new ConvexError('Not following this user')

    await ctx.db.delete(existing._id)
  },
})

export const getFollowing = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id('users'),
      name: v.optional(v.string()),
      username: v.optional(v.string()),
      imageURL: v.optional(v.string()),
      followsYou: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return []

    const following = await ctx.db
      .query('friends')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()

    const users = await Promise.all(
      following.map(async (f) => {
        const friend = await ctx.db.get(f.friendId)
        const followsYouRelation = await ctx.db
          .query('friends')
          .withIndex('by_user_and_friend', (q) => q.eq('userId', f.friendId).eq('friendId', userId))
          .first()
        return {
          _id: friend!._id,
          name: friend!.name,
          username: friend!.username,
          imageURL: friend!.imageURL,
          followsYou: !!followsYouRelation,
        }
      }),
    )

    return users
  },
})

export const getFollowers = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id('users'),
      name: v.optional(v.string()),
      imageURL: v.optional(v.string()),
      username: v.optional(v.string()),
      following: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return []

    const following = await ctx.db
      .query('friends')
      .withIndex('by_friend', (q) => q.eq('friendId', userId))
      .collect()

    const users = await Promise.all(
      following.map(async (f) => {
        const friend = await ctx.db.get(f.userId)
        const followsThemRelation = await ctx.db
          .query('friends')
          .withIndex('by_user_and_friend', (q) => q.eq('userId', userId).eq('friendId', f.userId))
          .first()
        return {
          _id: friend!._id,
          name: friend!.name,
          username: friend!.username,
          imageURL: friend!.imageURL,
          following: !!followsThemRelation,
        }
      }),
    )

    return users
  },
})

// export const removeFriend = mutation({
//   args: { friendId: v.id('users') },
//   returns: v.null(),
//   handler: async (ctx, args) => {
//     const userId = await getAuthUserId(ctx)
//     if (!userId) throw new ConvexError('Not authenticated')

//     const friendships = await ctx.db
//       .query('friends')
//       .filter((q) =>
//         q.or(
//           q.and(q.eq(q.field('userId'), userId), q.eq(q.field('friendId'), args.friendId)),
//           q.and(q.eq(q.field('userId'), args.friendId), q.eq(q.field('friendId'), userId)),
//         ),
//       )
//       .collect()

//     for (const friendship of friendships) {
//       await ctx.db.delete(friendship._id)
//     }
//   },
// })
