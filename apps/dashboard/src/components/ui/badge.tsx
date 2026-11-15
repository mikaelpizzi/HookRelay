import React from 'react';

export type BadgeVariant =
  | 'success'
  | 'warning'
  | 'danger'
  | 'neutral'
  | 'info'
  | 'auto';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  statusText?: string;
  size?: 'sm' | 'md';
  dot?: boolean;
  className?: string;
}

export function Badge({
  children,
  variant = 'auto',
  statusText,
  size = 'sm',
  dot = true,
  className = '',
}: BadgeProps) {
  const textValue = (statusText || (typeof children === 'string' ? children : '')).toUpperCase();

  let resolvedVariant = variant;
  if (resolvedVariant === 'auto') {
    if (
      [
        'CLOSED',
        'DELIVERED',
        'HEALTHY',
        'ONLINE',
        'SUCCESS',
        'VALID',
        'TRUE',
        'OK',
      ].includes(textValue)
    ) {
      resolvedVariant = 'success';
    } else if (
      [
        'HALF_OPEN',
        'RETRYING',
        'SLOW',
        'DEGRADED',
        'STARTING',
        'IN_FLIGHT',
        'PENDING',
      ].includes(textValue)
    ) {
      resolvedVariant = 'warning';
    } else if (
      [
        'OPEN',
        'DEAD_LETTER',
        'DOWN',
        'OFFLINE',
        'FAILED',
        'INVALID',
        'FALSE',
        'ERROR',
      ].includes(textValue)
    ) {
      resolvedVariant = 'danger';
    } else {
      resolvedVariant = 'neutral';
    }
  }

  const variantStyles = {
    success: 'bg-emerald-950/70 text-emerald-400 border-emerald-800/60',
    warning: 'bg-amber-950/70 text-amber-400 border-amber-800/60',
    danger: 'bg-rose-950/70 text-rose-400 border-rose-800/60',
    neutral: 'bg-zinc-900 text-zinc-300 border-zinc-800',
    info: 'bg-sky-950/70 text-sky-400 border-sky-800/60',
  };

  const dotColors = {
    success: 'bg-emerald-400',
    warning: 'bg-amber-400',
    danger: 'bg-rose-400',
    neutral: 'bg-zinc-400',
    info: 'bg-sky-400',
  };

  const sizeStyles = {
    sm: 'text-[11px] px-2 py-0.5 tracking-tight font-mono',
    md: 'text-xs px-2.5 py-1 tracking-tight font-mono',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border ${variantStyles[resolvedVariant]} ${sizeStyles[size]} ${className}`}
    >
      {dot && (
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColors[resolvedVariant]}`}
        />
      )}
      <span>{children}</span>
    </span>
  );
}
