import { useEffect, useRef, useState } from 'react';

const GOOGLE_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
let scriptPromise;
let initializedClientId;
let credentialHandler;

function loadGoogleIdentity() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GOOGLE_SCRIPT_URL}"]`);
    const script = existing ?? document.createElement('script');
    const loaded = () =>
      window.google?.accounts?.id
        ? resolve(window.google)
        : reject(new Error('Google Identity Services did not initialize.'));
    script.addEventListener('load', loaded, { once: true });
    script.addEventListener('error', () => reject(new Error('Google Sign-In could not load.')), {
      once: true,
    });
    if (!existing) {
      script.src = GOOGLE_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      document.head.append(script);
    }
  });
  return scriptPromise;
}

export function GoogleSignIn({ onCredential, onError, disabled = false, text = 'signin_with' }) {
  const container = useRef();
  const [ready, setReady] = useState(false);
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim();

  useEffect(() => {
    credentialHandler = onCredential;
    if (!clientId) return undefined;
    let active = true;
    loadGoogleIdentity()
      .then((google) => {
        if (!active) return;
        if (initializedClientId && initializedClientId !== clientId) {
          throw new Error('Google Sign-In client configuration changed.');
        }
        if (!initializedClientId) {
          google.accounts.id.initialize({
            client_id: clientId,
            callback: (response) => credentialHandler?.(response.credential),
            auto_select: false,
          });
          initializedClientId = clientId;
        }
        container.current.replaceChildren();
        google.accounts.id.renderButton(container.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          shape: 'rectangular',
          text,
          logo_alignment: 'left',
          width: Math.min(360, Math.max(240, container.current.clientWidth || 320)),
        });
        setReady(true);
      })
      .catch((error) => active && onError(error));
    return () => {
      active = false;
    };
  }, [clientId, onCredential, onError, text]);

  if (!clientId) {
    return <div className="google-unavailable">Google Sign-In is not configured.</div>;
  }
  return (
    <div className={`google-button-shell ${disabled ? 'is-disabled' : ''}`}>
      <div ref={container} aria-hidden={disabled} />
      {!ready && <span>Loading Google Sign-In…</span>}
    </div>
  );
}
