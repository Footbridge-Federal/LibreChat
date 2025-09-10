import React, { memo } from 'react';
import { UserIcon, getUserAvatarColor } from '@librechat/client';
import type { TUser } from 'librechat-data-provider';
import type { IconProps } from '~/common';
import MessageEndpointIcon from './MessageEndpointIcon';
import { useAuthContext } from '~/hooks/AuthContext';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

type UserAvatarProps = {
  size: number;
  user?: TUser;
  avatarSrc: string;
  username: string;
  className?: string;
};

const UserAvatar = memo(({ size, user, avatarSrc, username, className }: UserAvatarProps) => {
  const avatarColor = getUserAvatarColor(user);

  const renderColoredAvatar = () => (
    <div
      style={{
        backgroundColor: avatarColor?.backgroundColor || 'rgb(196, 181, 253)', // default to light purple
        width: `${size}px`,
        height: `${size}px`,
        boxShadow: 'rgba(240, 246, 252, 0.1) 0px 0px 0px 1px',
      }}
      className="relative flex items-center justify-center rounded-sm p-1"
    >
      <UserIcon />
    </div>
  );

  return (
    <div
      title={username}
      style={{
        width: size,
        height: size,
      }}
      className={cn('relative flex items-center justify-center', className ?? '')}
    >
      {renderColoredAvatar()}
    </div>
  );
});

UserAvatar.displayName = 'UserAvatar';

const Icon: React.FC<IconProps> = memo((props) => {
  const { user } = useAuthContext();
  const { size = 30, isCreatedByUser } = props;
  const localize = useLocalize();

  if (isCreatedByUser) {
    const username = user?.name ?? user?.username ?? localize('com_nav_user');
    return (
      <UserAvatar
        size={size}
        user={user}
        avatarSrc="" // No longer used
        username={username}
        className={props.className}
      />
    );
  }
  return <MessageEndpointIcon {...props} />;
});

Icon.displayName = 'Icon';

export default Icon;
