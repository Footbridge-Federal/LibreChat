import React, { useState, useEffect, useRef } from 'react';
import { useSetRecoilState } from 'recoil';
import { ChevronDown } from 'lucide-react';
import { AVATAR_COLORS, getUserAvatarColor } from '@librechat/client';
import type { TUser } from 'librechat-data-provider';
import { UserIcon } from '@librechat/client';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';
import store from '~/store';

interface AvatarColorPickerProps {
  user: TUser | undefined;
}

function AvatarColorPicker({ user }: AvatarColorPickerProps) {
  const setUser = useSetRecoilState(store.user);
  const localize = useLocalize();
  const currentColor = getUserAvatarColor(user);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleColorSelect = (colorName: string) => {
    // Update user with selected color - for now just store in memory
    // In a full implementation, this would save to the backend
    setUser((prevUser) => ({
      ...prevUser,
      avatarColor: colorName,
    } as TUser));

    // Store in localStorage as well for persistence
    if (user?.id) {
      localStorage.setItem(`avatarColor_${user.id}`, colorName);
    }
    
    setIsOpen(false);
  };

  return (
    <div className="mt-4 space-y-2">
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={cn(
            'flex w-full items-center justify-between rounded-lg border border-gray-300 bg-white px-3 py-2 text-left shadow-sm transition-colors hover:bg-gray-50 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500',
            'dark:border-gray-600 dark:bg-gray-700 dark:hover:bg-gray-600'
          )}
        >
          <div className="flex items-center space-x-3">
            <div
              className="h-6 w-6 rounded-full border border-white shadow-sm"
              style={{ backgroundColor: currentColor?.backgroundColor || 'rgb(196, 181, 253)' }}
            />
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {currentColor?.displayName || 'Purple'}
            </span>
          </div>
          <ChevronDown className={cn('h-4 w-4 text-gray-500 transition-transform', isOpen && 'rotate-180')} />
        </button>

        {isOpen && (
          <div className="absolute top-full z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-700">
            <div className="grid grid-cols-2 gap-1 p-2">
              {AVATAR_COLORS.map((color) => (
                <button
                  key={color.name}
                  onClick={() => handleColorSelect(color.name)}
                  className={cn(
                    'flex items-center space-x-3 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-gray-100 dark:hover:bg-gray-600',
                    currentColor?.name === color.name && 'bg-blue-50 text-blue-700 dark:bg-blue-900 dark:text-blue-200'
                  )}
                >
                  <div
                    className="h-5 w-5 rounded-full border border-white shadow-sm"
                    style={{ backgroundColor: color.backgroundColor }}
                  />
                  <span className="font-medium">{color.displayName}</span>
                  {currentColor?.name === color.name && (
                    <svg className="ml-auto h-4 w-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default AvatarColorPicker;