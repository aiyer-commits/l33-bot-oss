import { withAuth } from '@workos-inc/authkit-nextjs';

export type AuthUser = {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
};

export async function getOptionalUser(): Promise<AuthUser | null> {
  try {
    const { user } = await withAuth();
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    };
  } catch {
    return null;
  }
}
