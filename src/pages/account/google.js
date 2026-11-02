/* "Continue with Google". Firebase is only the doorway to Google: it opens Google's own sign-in window and hands us a
   signed ID token, which our server checks and turns into the same account session as a password sign-in
   (api/_lib/google.js). The Firebase libraries load only when the button is pressed, and nothing from Firebase is kept
   in the browser afterwards (in-memory persistence, signed out straight away), so there is a single login state: ours.
   This web config is public by design (it identifies the project, it is not a secret); who may sign in is decided by the
   project's Authorized domains in the Firebase console and by the server-side checks. */

const FIREBASE = {
  apiKey: 'AIzaSyAkjjsBV0UK0MVj5a15toMJ-9kjuXZ9YVU',
  authDomain: 'sajjad-9c9d7.firebaseapp.com',
  projectId: 'sajjad-9c9d7',
  appId: '1:473337087459:web:2eea11578c7649dfb54cd6',
}

const MESSAGES = {
  'auth/popup-blocked': 'Your browser blocked the Google window. Allow pop-ups for this site and try again.',
  'auth/operation-not-allowed': 'Google sign-in is not switched on yet. Please use your e-mail and password for now.',
  'auth/configuration-not-found': 'Google sign-in is not switched on yet. Please use your e-mail and password for now.',
  'auth/unauthorized-domain': 'Google sign-in is not enabled for this web address yet. Please use your e-mail and password for now.',
  'auth/network-request-failed': 'We could not reach Google. Check your connection and try again.',
  'auth/too-many-requests': 'Too many attempts. Please wait a few minutes and try again.',
}
const QUIET = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled'])

/** Opens Google's sign-in and resolves with a Firebase ID token, or null if the person simply closed the window. */
export async function googleIdToken() {
  try {
    const [{ initializeApp, getApps }, auth] = await Promise.all([import('@firebase/app'), import('@firebase/auth')])
    const app = getApps()[0] || initializeApp(FIREBASE)
    let a
    try { a = auth.initializeAuth(app, { persistence: auth.inMemoryPersistence, popupRedirectResolver: auth.browserPopupRedirectResolver }) } catch { a = auth.getAuth(app) }
    const provider = new auth.GoogleAuthProvider()
    provider.setCustomParameters({ prompt: 'select_account' })
    const result = await auth.signInWithPopup(a, provider)
    const token = await result.user.getIdToken()
    auth.signOut(a).catch(() => {})
    return token
  } catch (e) {
    if (QUIET.has(e?.code)) return null
    throw new Error(MESSAGES[e?.code] || 'Google sign-in did not work. Please try again or use your e-mail and password.')
  }
}
