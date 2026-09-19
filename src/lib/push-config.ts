import { createECDH } from 'node:crypto';
import webPush from 'web-push';

export function pushConfig() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey && !privateKey && !subject) return null;
  if (!publicKey || !privateKey || !subject) throw new Error('Configure as três variáveis VAPID.');
  const key = createECDH('prime256v1');
  key.setPrivateKey(Buffer.from(privateKey, 'base64url'));
  if (key.getPublicKey().toString('base64url') !== publicKey)
    throw new Error('As chaves VAPID não correspondem.');
  webPush.setVapidDetails(subject, publicKey, privateKey);
  return { publicKey, privateKey, subject };
}

// Only native browser push services; never POST to an arbitrary client-supplied URL.
export function validPushEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    const allowed = [
      'fcm.googleapis.com',
      'updates.push.services.mozilla.com',
      'web.push.apple.com',
    ];
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.hash &&
      (!url.port || url.port === '443') &&
      (allowed.includes(url.hostname) || url.hostname.endsWith('.notify.windows.com'))
    );
  } catch {
    return false;
  }
}
