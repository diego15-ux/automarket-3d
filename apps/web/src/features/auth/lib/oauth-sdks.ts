/** SDKs oficiales: Google Identity Services y Sign in with Apple JS. */
/** `hl=es`: el botón sale en español aunque el navegador esté en inglés. */
export const GOOGLE_SDK_URL = 'https://accounts.google.com/gsi/client?hl=es';
export const APPLE_SDK_URL = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/es_ES/appleid.auth.js';

interface GoogleIdConfiguration {
  client_id: string;
  callback: (response: { credential: string }) => void;
  nonce?: string;
  ux_mode?: 'popup' | 'redirect';
}

interface GoogleButtonConfiguration {
  type?: 'standard' | 'icon';
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'large' | 'medium' | 'small';
  shape?: 'rectangular' | 'pill' | 'circle' | 'square';
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  logo_alignment?: 'left' | 'center';
  locale?: string;
  width?: number;
}

export interface AppleSignInResponse {
  authorization: { id_token: string; code: string; state?: string };
  /** Solo llega la primera vez que el usuario autoriza la app. */
  user?: { email?: string; name?: { firstName?: string; lastName?: string } };
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(configuration: GoogleIdConfiguration): void;
          renderButton(parent: HTMLElement, options: GoogleButtonConfiguration): void;
        };
      };
    };
    AppleID?: {
      auth: {
        init(configuration: { clientId: string; scope: string; redirectURI: string; usePopup: boolean; nonce?: string }): void;
        signIn(): Promise<AppleSignInResponse>;
      };
    };
  }
}
