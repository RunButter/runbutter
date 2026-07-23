import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// The shadcn/ui class helper: merge conditional classes (clsx) and let later
// Tailwind utilities win over earlier conflicting ones (tailwind-merge). Every
// shadcn-style primitive uses this. Kept here so `npx shadcn add <x>` drops
// components in and finds cn() at the expected path.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
