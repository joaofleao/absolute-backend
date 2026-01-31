import { nativeAppleHandler } from './native_apple'
import { nativeGoogleHandler } from './native_google'
import { verify } from './verify'
import { ConvexCredentials } from '@convex-dev/auth/providers/ConvexCredentials'
import { Password } from './passwordProvider'
import { convexAuth } from '@convex-dev/auth/server'

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      verify,
    }),
    ConvexCredentials({
      id: 'native-apple',
      authorize: nativeAppleHandler,
    }),
    ConvexCredentials({
      id: 'native-google',
      authorize: nativeGoogleHandler,
    }),
  ],
})
