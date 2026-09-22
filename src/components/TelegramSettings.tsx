import { useEffect, useState } from 'react';
import { api } from '../lib/server';

type Settings = {
  configured: boolean;
  chatId: string;
  enabled: boolean;
  replay: boolean;
  username: string;
  delivery: { status: string; error?: string } | null;
};
export function TelegramSettings() {
  const [settings, setSettings] = useState<Settings>();
  const [token, setToken] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [chats, setChats] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    api<Settings>('/notifications/telegram')
      .then(setSettings)
      .catch((e) => setMessage(e.message));
  }, []);
  async function act(work: () => Promise<void>) {
    setBusy(true);
    setMessage('');
    try {
      await work();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Telegram request failed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="telegram-settings">
      <summary>Telegram notifications</summary>
      <p>
        Send chart alerts to your phone. Live alerts can continue with
        Background monitoring enabled. Replay alerts require this browser to
        stay open unless replay is running in another connected browser.
      </p>
      <ol>
        <li>
          Open{' '}
          <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">
            @BotFather
          </a>{' '}
          in Telegram, send /newbot, and copy the bot token.
        </li>
        <li>
          Open your new bot and send /start. Paste the token below, then find
          and select your chat (or enter a chat ID).
        </li>
        <li>
          Save the connection and send a test message. Enable notifications and
          create an alert in the chart’s Alerts menu.
        </li>
      </ol>
      {settings && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              setSettings(
                await api<Settings>(
                  '/notifications/telegram',
                  {
                    token,
                    chatId: settings.chatId,
                    enabled: settings.enabled,
                    replay: settings.replay,
                  },
                  'PUT',
                ),
              );
              setToken('');
              setMessage('Telegram connection saved.');
            });
          }}
        >
          <label className="field-label" htmlFor="telegram-token">
            Bot token
          </label>
          <input
            className="text-input"
            id="telegram-token"
            type="password"
            autoComplete="new-password"
            value={token}
            placeholder={
              settings.configured
                ? 'Saved on server; leave blank to keep'
                : 'Paste token from BotFather'
            }
            onChange={(e) => setToken(e.target.value)}
          />
          <p>
            The token stays on this server and is excluded from workspace
            exports. These settings apply to everyone using this server.
          </p>
          <button
            type="button"
            disabled={busy || (!token && !settings.configured)}
            onClick={() =>
              void act(async () => {
                const found = await api<{ id: string; name: string }[]>(
                  '/notifications/telegram/chats',
                  { token },
                );
                setChats(found);
                setMessage(
                  found.length
                    ? 'Select your Telegram chat below.'
                    : 'No recent chats found. Send /start to your bot, then try again.',
                );
              })
            }
          >
            Find Telegram chats
          </button>
          {!!chats.length && (
            <label className="field-label">
              Recent Telegram chats
              <select
                aria-label="Recent Telegram chats"
                value=""
                onChange={(e) =>
                  setSettings({ ...settings, chatId: e.target.value })
                }
              >
                <option value="">Select a chat</option>
                {chats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.id})
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field-label" htmlFor="telegram-chat">
            Telegram chat ID
          </label>
          <input
            className="text-input"
            id="telegram-chat"
            value={settings.chatId}
            onChange={(e) =>
              setSettings({ ...settings, chatId: e.target.value })
            }
            required
          />
          <label className="telegram-toggle">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) =>
                setSettings({ ...settings, enabled: e.target.checked })
              }
            />
            Enable Telegram notifications
          </label>
          <label className="telegram-toggle">
            <input
              type="checkbox"
              checked={settings.replay}
              onChange={(e) =>
                setSettings({ ...settings, replay: e.target.checked })
              }
            />
            Also send replay alerts
          </label>
          <div className="telegram-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const current = await api<Settings>(
                    '/notifications/telegram',
                  );
                  setSettings((previous) =>
                    previous
                      ? { ...previous, delivery: current.delivery }
                      : current,
                  );
                  setMessage('Delivery status refreshed.');
                })
              }
            >
              Refresh delivery status
            </button>
            <button type="submit" disabled={busy}>
              Save Telegram connection
            </button>
            <button
              type="button"
              disabled={busy || !settings.configured}
              onClick={() =>
                void act(async () => {
                  await api('/notifications/telegram/test', {});
                  setMessage('Test message sent. Check Telegram.');
                })
              }
            >
              Send test message
            </button>
            <button
              type="button"
              disabled={busy || !settings.configured}
              onClick={() =>
                void act(async () => {
                  setSettings(
                    await api<Settings>(
                      '/notifications/telegram',
                      undefined,
                      'DELETE',
                    ),
                  );
                  setToken('');
                  setChats([]);
                  setMessage('Telegram disconnected.');
                })
              }
            >
              Disconnect Telegram
            </button>
          </div>
          {settings.username && <p>Connected bot: @{settings.username}</p>}
          {settings.delivery && (
            <p>
              Latest queued alert: {settings.delivery.status}
              {settings.delivery.error && ` · ${settings.delivery.error}`}
            </p>
          )}
        </form>
      )}
      <p role="status">{busy ? 'Contacting Telegram…' : message}</p>
    </details>
  );
}
