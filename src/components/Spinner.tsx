import React from 'react';

export const Spinner: React.FC<{ size?: 'sm' | 'md' | 'lg'; color?: string; label?: string }> = ({
  size = 'md',
  color = 'text-green-500',
  label = 'Loading',
}) => {
  const sizes = {
    sm: 'w-4 h-4 border-2',
    md: 'w-8 h-8 border-3',
    lg: 'w-12 h-12 border-4',
  };

  return (
    <div
      className={`${sizes[size]} border-t-transparent border-solid rounded-full animate-spin ${color}`}
      role="status"
      aria-label={label}
      aria-busy="true"
    />
  );
};
