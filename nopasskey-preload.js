// Runs inside the embedded sites (Discord, YouTube Music, stats.cc) before their own code.
// Keeps the sign-in pages working but stops them from opening the Windows passkey pop-up.
const { webFrame } = require("electron");
webFrame.executeJavaScript(`(() => { try {
  const off = () => Promise.reject(new DOMException("Passkeys are turned off in Sothis", "NotAllowedError"));
  const c = navigator.credentials;
  if (c) {
    const get = c.get.bind(c), create = c.create.bind(c);
    c.get = o => (o && o.publicKey) ? off() : get(o);
    c.create = o => (o && o.publicKey) ? off() : create(o);
  }
  if (window.PublicKeyCredential) {
    PublicKeyCredential.isConditionalMediationAvailable = () => Promise.resolve(false);
    PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = () => Promise.resolve(false);
  }
} catch (e) {} })()`);
