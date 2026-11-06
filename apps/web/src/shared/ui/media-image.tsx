import Image, { type ImageProps } from 'next/image';

const OPTIMIZABLE_HOSTS = new Set(['images.unsplash.com', ...(process.env.NEXT_PUBLIC_MEDIA_HOST ? [process.env.NEXT_PUBLIC_MEDIA_HOST] : [])]);

/**
 * next/image para fotos de anuncios: optimiza las del CDN configurado (NEXT_PUBLIC_MEDIA_HOST)
 * y sirve tal cual las de otros orígenes (p. ej. el S3 local de desarrollo en localhost).
 */
export function MediaImage({ src, ...props }: Omit<ImageProps, 'src'> & { src: string }) {
  let optimizable = false;
  try {
    optimizable = OPTIMIZABLE_HOSTS.has(new URL(src).hostname);
  } catch {
    optimizable = false;
  }
  return <Image src={src} unoptimized={!optimizable} {...props} />;
}
