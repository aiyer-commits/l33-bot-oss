import { authkitMiddleware } from '@workos-inc/authkit-nextjs';

const getRedirectUri = () => {
  if (process.env.WORKOS_REDIRECT_URI) {
    return process.env.WORKOS_REDIRECT_URI;
  }
  if (process.env.VERCEL_ENV === 'production' && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}/callback`;
  }
  return 'http://localhost:3000/callback';
};

export default authkitMiddleware({
  redirectUri: getRedirectUri(),
  middlewareAuth: {
    enabled: false,
    unauthenticatedPaths: ['/(.*)'],
  },
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
