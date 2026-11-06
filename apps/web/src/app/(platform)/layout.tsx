import type { ReactNode } from 'react';
import { PlatformChrome } from './_components/PlatformChrome';

export default function PlatformLayout({ children }: { children: ReactNode }) {
  return <PlatformChrome>{children}</PlatformChrome>;
}
