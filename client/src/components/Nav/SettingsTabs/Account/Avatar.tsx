import React from 'react';
import { useRecoilValue } from 'recoil';
import { useLocalize } from '~/hooks';
import AvatarColorPicker from './AvatarColorPicker';
import store from '~/store';

function Avatar() {
  const user = useRecoilValue(store.user);
  const localize = useLocalize();

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-base font-medium">Profile Picture</span>
      </div>
      <AvatarColorPicker user={user} />
    </div>
  );
}

export default Avatar;
