import { useMemo } from 'react';
import type { TUser } from 'librechat-data-provider';

const useAvatar = (user: TUser | undefined) => {
  return useMemo(() => {
    const { username, name } = user ?? {};
    const seed = name || username;
    if (!seed) {
      return '';
    }

    if (user?.avatar && user?.avatar !== '') {
      return user.avatar;
    }

    // Return empty string to force fallback to default purple UserIcon instead of generating initials
    return '';
  }, [user]);
};

export default useAvatar;
