'use client';
import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
function keyBytes(value: string) {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
export function PushControl({ userId }: { userId: string }) {
  const [state, setState] = useState('loading');
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let stopped = false;
    async function inspect() {
      if (
        !window.isSecureContext ||
        !('serviceWorker' in navigator) ||
        !('PushManager' in window) ||
        !('Notification' in window)
      ) {
        if (!stopped) setState('unsupported');
        return;
      }
      if (Notification.permission === 'denied') {
        if (!stopped) setState('denied');
        return;
      }
      try {
        const response = await fetch('/api/push/subscriptions', { cache: 'no-store' });
        if (!response.ok) throw new Error();
        const config = await response.json();
        if (stopped) return;
        setPublicKey(config.publicKey);
        if (!config.publicKey) {
          setState('unconfigured');
          return;
        }
        const registration = await navigator.serviceWorker.register('/sw.js');
        let subscription = await registration.pushManager.getSubscription();
        const previous = localStorage.getItem('central-push-user');
        if (subscription && previous && previous !== userId) {
          await subscription.unsubscribe();
          subscription = null;
        }
        localStorage.setItem('central-push-user', userId);
        let active = false;
        if (subscription && Notification.permission === 'granted') {
          const digest = await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(subscription.endpoint),
          );
          const endpointHash = Array.from(new Uint8Array(digest), (byte) =>
            byte.toString(16).padStart(2, '0'),
          ).join('');
          const device = config.devices.find(
            (item: { endpointHash: string; currentSession: boolean }) =>
              item.endpointHash === endpointHash,
          );
          if (device && !device.currentSession) {
            // Rebind an existing opt-in to this session so logout can detach this browser.
            const rebound = await fetch('/api/push/subscriptions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(subscription.toJSON()),
            });
            if (!rebound.ok) throw new Error();
          }
          active = !!device;
        }
        if (!stopped) setState(active ? 'active' : 'inactive');
      } catch {
        if (!stopped) setState('error');
      }
    }
    void inspect();
    window.addEventListener('focus', inspect);
    return () => {
      stopped = true;
      window.removeEventListener('focus', inspect);
    };
  }, [userId]);
  async function toggle() {
    setBusy(true);
    setError('');
    try {
      if (state !== 'active') {
        // This call must remain directly inside the user's click, before awaits (iOS).
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          setState(permission === 'denied' ? 'denied' : 'inactive');
          return;
        }
      }
      await navigator.serviceWorker.register('/sw.js');
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (state === 'active') {
        if (subscription) {
          const response = await fetch('/api/push/subscriptions', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: subscription.endpoint }),
          });
          if (!response.ok) throw new Error('Não foi possível desativar. Tente novamente.');
          await subscription.unsubscribe();
        }
        setState('inactive');
        return;
      }
      if (!publicKey) throw new Error('Notificações ainda não configuradas.');
      // A changed VAPID key requires a fresh browser subscription.
      if (
        subscription &&
        subscription.options.applicationServerKey &&
        btoa(String.fromCharCode(...new Uint8Array(subscription.options.applicationServerKey)))
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '') !== publicKey
      ) {
        await subscription.unsubscribe();
        subscription = null;
      }
      subscription ??= await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(publicKey),
      });
      const response = await fetch('/api/push/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!response.ok)
        throw new Error((await response.json()).error || 'Não foi possível ativar.');
      setState('active');
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Não foi possível ativar. Tente novamente.',
      );
    } finally {
      setBusy(false);
    }
  }
  const message: Record<string, string> = {
    loading: 'Verificando notificações…',
    unsupported:
      'Notificações indisponíveis neste navegador. No iPhone/iPad, use o app adicionado à Tela de Início.',
    denied: 'Notificações bloqueadas. Você pode permiti-las nas configurações do navegador.',
    unconfigured: 'Notificações ainda não configuradas.',
    error: 'Não foi possível verificar notificações. Reabra esta tela para tentar novamente.',
    active: 'Notificações ativas neste dispositivo.',
    inactive: 'Receba avisos neste dispositivo.',
  };
  return (
    <div className="push-control">
      <Bell size={16} aria-hidden="true" />
      <span className="small" aria-live="polite">
        {message[state]}
      </span>
      {['active', 'inactive'].includes(state) && (
        <button className="button subtle" type="button" disabled={busy} onClick={toggle}>
          {busy
            ? 'Aguarde…'
            : state === 'active'
              ? 'Desativar neste dispositivo'
              : 'Ativar notificações'}
        </button>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
