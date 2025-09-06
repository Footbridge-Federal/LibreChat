import React, { useMemo, useCallback } from 'react';
import type { TUser } from 'librechat-data-provider';
import { UserIcon } from '~/svgs';
import { getUserAvatarColor } from '~/utils/avatarColors';

export interface AvatarProps {
  user?: TUser;
  size?: number;
  className?: string;
  alt?: string;
  showDefaultWhenEmpty?: boolean;
}

const Avatar: React.FC<AvatarProps> = ({
  user,
  size = 32,
  className = '',
  alt,
  showDefaultWhenEmpty = true,
}) => {
  const avatarColor = getUserAvatarColor(user);

  const altText = useMemo(
    () => alt || `${user?.name || user?.username || user?.email || ''}'s avatar`,
    [alt, user?.name, user?.username, user?.email],
  );

  const ColoredAvatar = useCallback(
    () => (
      <div
        style={{
          backgroundColor: avatarColor?.backgroundColor || 'rgb(196, 181, 253)', // default to light purple
          width: `${size}px`,
          height: `${size}px`,
          boxShadow: 'rgba(240, 246, 252, 0.1) 0px 0px 0px 1px',
        }}
        className={`relative flex items-center justify-center rounded-full p-1 text-white ${className}`}
        aria-label={altText}
        title={altText}
      >
        <UserIcon />
      </div>
    ),
    [size, className, avatarColor, altText],
  );

  if (!showDefaultWhenEmpty) {
    return null;
  }

  return <ColoredAvatar />;
};

export default Avatar;
