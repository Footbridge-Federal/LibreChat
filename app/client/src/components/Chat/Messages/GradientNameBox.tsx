import React from 'react';
import { getUserAvatarColor, UserIcon } from '@librechat/client';
import { useAuthContext } from '~/hooks/AuthContext';
import { cn } from '~/utils';

interface GradientNameBoxProps {
  name: string;
  isUser: boolean;
  className?: string;
}

const GradientNameBox: React.FC<GradientNameBoxProps> = ({ name, isUser, className }) => {
  const { user } = useAuthContext();
  
  const getTextColor = () => {
    return 'text-gray-900';
  };

  const getUserStyles = () => {
    const avatarColor = getUserAvatarColor(user);
    const baseColor = avatarColor?.backgroundColor || 'rgb(196, 181, 253)';
    
    // Convert RGB to a lighter version for gradient
    const match = baseColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (match) {
      const [, r, g, b] = match.map(Number);
      const lighter = `rgb(${Math.min(255, r + 40)}, ${Math.min(255, g + 40)}, ${Math.min(255, b + 40)})`;
      const gradientStyle = `linear-gradient(135deg, ${baseColor} 0%, ${lighter} 100%)`;
      const textColor = getTextColor();
      
      return { background: gradientStyle, textColor };
    }
    
    // Fallback gradient
    return { 
      background: 'linear-gradient(135deg, rgb(196, 181, 253) 0%, rgb(221, 214, 254) 100%)', 
      textColor: 'text-gray-900'
    };
  };

  const getAirwallStyles = () => {
    // Use the same gradient as welcome message
    return {
      background: '', // Will use className instead for consistency
      textColor: 'text-gray-700 dark:text-gray-200' // Same as welcome message
    };
  };

  const styles = isUser ? getUserStyles() : getAirwallStyles();

  if (isUser) {
    return (
      <div
        className={cn(
          'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-light shadow-sm',
          'hover:shadow-md transition-all duration-200 cursor-default',
          styles.textColor,
          className
        )}
        style={{ background: styles.background }}
        title={name}
      >
        <div className={cn('h-4 w-4', styles.textColor)}>
          <UserIcon />
        </div>
        <span>{name}</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-light shadow-sm',
        'hover:shadow-md transition-all duration-200 cursor-default',
        'bg-gradient-to-r from-cyan-400/10 to-blue-500/10 hover:from-cyan-300/15 hover:to-blue-400/15',
        'backdrop-blur-sm border border-white/10 text-gray-700 dark:text-gray-200',
        className
      )}
      title={name}
    >
      <img 
        src="/assets/logo.svg" 
        alt="Airwall.Chat" 
        className="h-4 w-4 opacity-90"
      />
      <span>{name}</span>
    </div>
  );
};

export default GradientNameBox;