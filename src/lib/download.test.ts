import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportCsv } from './data';

describe('CSV browser/native export boundary', () => {
  let link: { href: string; download: string; click: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers();
    link = { href: '', download: '', click: vi.fn() };
    vi.stubGlobal('document', { createElement: vi.fn(() => link) });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:csv-export');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('sends escaped CSV, original Unicode content and filename to the iOS bridge', () => {
    const postMessage = vi.fn();
    vi.stubGlobal('window', {
      webkit: { messageHandlers: { replayExport: { postMessage } } },
    });
    exportCsv(
      [
        ['Symbol', 'Note'],
        ['^GSPC', '€ "quoted", value\nnext line'],
        ['=1+1', undefined, -2],
      ],
      'replay-^GSPC.csv',
    );
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({
      filename: 'replay-^GSPC.csv',
      mimeType: 'text/csv;charset=utf-8;',
      content:
        '"Symbol","Note"\r\n"^GSPC","€ ""quoted"", value\nnext line"\r\n"\'=1+1","","-2"',
    });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(link.click).not.toHaveBeenCalled();
  });

  it('preserves the normal browser download and revokes its Blob URL', async () => {
    vi.stubGlobal('window', {});
    expect(
      exportCsv(
        [
          ['Ticker', 'P&L'],
          ['AAPL', 12.5],
        ],
        'session.csv',
      ),
    ).toBeUndefined();
    expect(link).toMatchObject({
      href: 'blob:csv-export',
      download: 'session.csv',
    });
    expect(link.click).toHaveBeenCalledTimes(1);
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    expect(await blob.text()).toBe('"Ticker","P&L"\r\n"AAPL","12.5"');
    expect(blob.type).toBe('text/csv;charset=utf-8;');
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(
      'blob:csv-export',
    );
  });

  it('falls back synchronously when a stale native handler throws', () => {
    vi.stubGlobal('window', {
      webkit: {
        messageHandlers: {
          replayExport: {
            postMessage: () => {
              throw new Error('handler removed');
            },
          },
        },
      },
    });
    expect(() => exportCsv([['AAPL']], 'session.csv')).not.toThrow();
    expect(link.click).toHaveBeenCalledTimes(1);
    expect(link.download).toBe('session.csv');
  });

  it('does not mistake unrelated WebKit message handlers for the export bridge', () => {
    vi.stubGlobal('window', {
      webkit: {
        messageHandlers: { someOtherFeature: { postMessage: vi.fn() } },
      },
    });
    exportCsv([['AAPL']], 'session.csv');
    expect(link.click).toHaveBeenCalledTimes(1);
  });
});
