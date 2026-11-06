import type { SocialLinkDTO } from '@automarket/contracts';
import { Logo } from '@/shared/ui/logo';
import { SocialLinks } from '@/shared/ui/social-links';

/**
 * Panel oscuro de la pantalla de acceso (PC): foto de fondo (la del panel o la predeterminada), titular y redes.
 * Sin carrusel de autos.
 */
export function LoginShowcase({ socialLinks, background = null }: { socialLinks: SocialLinkDTO[]; background?: string | null }) {
  return (
    <aside aria-label="AutoMarket" className="relative isolate flex min-h-dvh flex-col gap-7 overflow-hidden bg-night px-[clamp(28px,3.4vw,56px)] py-9 text-[#f2f3f5]">
      {background && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- fondo elegido en el panel, servido por el CDN */}
          <img src={background} alt="" className="absolute inset-0 -z-10 size-full object-cover object-[60%_62%]" />
          <div className="absolute inset-0 -z-10 bg-linear-to-b from-night/90 via-night/25 to-night/90" aria-hidden />
        </>
      )}
      <Logo href="/" tone="night" className="self-start" />
      <div>
        <p className="max-w-[460px] text-[clamp(30px,2.8vw,42px)] leading-[1.05] font-extrabold tracking-[-0.035em] text-balance">Compra y vende autos con gente verificada.</p>
        <p className="mt-3 max-w-[430px] text-[15px] leading-normal text-[#c7cbd1]">Cédula, selfie y teléfono antes de publicar o reservar. El abono de la reserva va directo al vendedor.</p>
      </div>

      <div className="mt-auto grid gap-3 border-t border-[#272a2f] pt-[18px]">
        <SocialLinks links={socialLinks} tone="dark" />
        <p className="font-mono text-[12.5px] font-medium text-[#a2a7b0]">Identidad verificada · Publicar es gratis · Reservas con abono</p>
      </div>
    </aside>
  );
}
