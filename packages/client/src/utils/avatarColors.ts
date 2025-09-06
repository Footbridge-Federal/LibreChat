export interface AvatarColor {
  name: string;
  backgroundColor: string;
  displayName: string;
}

export const AVATAR_COLORS: AvatarColor[] = [
  {
    name: 'dark-grey',
    backgroundColor: 'rgb(156, 163, 175)', // gray-400
    displayName: 'Dark Grey',
  },
  {
    name: 'light-grey',
    backgroundColor: 'rgb(209, 213, 219)', // gray-300
    displayName: 'Light Grey',
  },
  {
    name: 'red',
    backgroundColor: 'rgb(252, 165, 165)', // red-300
    displayName: 'Red',
  },
  {
    name: 'blue',
    backgroundColor: 'rgb(147, 197, 253)', // blue-300
    displayName: 'Blue',
  },
  {
    name: 'green',
    backgroundColor: 'rgb(134, 239, 172)', // green-300
    displayName: 'Green',
  },
  {
    name: 'yellow',
    backgroundColor: 'rgb(253, 224, 71)', // yellow-300
    displayName: 'Yellow',
  },
  {
    name: 'purple',
    backgroundColor: 'rgb(196, 181, 253)', // purple-300
    displayName: 'Purple',
  },
  {
    name: 'orange',
    backgroundColor: 'rgb(253, 186, 116)', // orange-300
    displayName: 'Orange',
  },
];

export const getRandomAvatarColor = (): AvatarColor => {
  const randomIndex = Math.floor(Math.random() * AVATAR_COLORS.length);
  return AVATAR_COLORS[randomIndex];
};

export const getAvatarColorByName = (name: string): AvatarColor => {
  return AVATAR_COLORS.find(color => color.name === name) || AVATAR_COLORS[6]; // default to purple
};

export const getUserAvatarColor = (user: any): AvatarColor => {
  // Check localStorage for saved color preference first
  if (user?.id) {
    const savedColor = localStorage.getItem(`avatarColor_${user.id}`);
    if (savedColor) {
      return getAvatarColorByName(savedColor);
    }
  }

  // If user has selected a color in their profile, use that
  if (user?.avatarColor) {
    return getAvatarColorByName(user.avatarColor);
  }

  // For users without a selected color, assign one based on their username/email
  // This ensures consistency - same user always gets same color until they change it
  const seed = user?.username || user?.email || user?.name || 'default';
  const hash = seed.split('').reduce((acc, char) => {
    return char.charCodeAt(0) + ((acc << 5) - acc);
  }, 0);
  const colorIndex = Math.abs(hash) % AVATAR_COLORS.length;
  
  const assignedColor = AVATAR_COLORS[colorIndex];
  
  // Save this color assignment to localStorage for persistence
  if (user?.id && assignedColor) {
    localStorage.setItem(`avatarColor_${user.id}`, assignedColor.name);
  }
  
  return assignedColor;
};