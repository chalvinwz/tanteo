import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { shareUrlPath } from '@tanteo/share';

import { shareServerAvailable } from '../api.js';
import { t } from '../i18n/index.js';
import { withBase } from '../router.js';
import { useTournament } from '../state.js';
import { Button, Note, Sheet } from './primitives.js';

/**
 * Handing out the live link.
 *
 * The link carries the read token only, so a spectator who opens it, or
 * forwards it to the whole group chat, can watch the board and can do nothing
 * else. The write token stays on this phone. See packages/share.
 */

function absoluteShareUrl(readToken: string): string {
  // withBase, because a deployment mounted at /tanteo/ must hand out a link
  // that includes it. Without this the link 404s on the host that made it.
  return new URL(withBase(shareUrlPath(readToken)), window.location.origin).toString();
}

export function ShareSheet({ open, onClose }: { open: boolean; onClose: () => void }): ReactNode {
  const { share, syncState, startSharing } = useTournament();
  const [creating, setCreating] = useState(false);
  // null while we are still asking. A link is never offered before we know
  // there is somewhere for it to point.
  const [serverThere, setServerThere] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const url = share ? absoluteShareUrl(share.readToken) : null;

  useEffect(() => {
    if (!open || share) return;
    let cancelled = false;
    void shareServerAvailable().then((available) => {
      if (!cancelled) setServerThere(available);
    });
    return () => {
      cancelled = true;
    };
  }, [open, share]);

  const create = async (): Promise<void> => {
    setCreating(true);
    await startSharing();
    setCreating(false);
  };

  const copy = async (): Promise<void> => {
    if (!url) return;
    setCopyFailed(false);
    try {
      // The clipboard API needs a secure context, which a self-hosted box on
      // plain http will not have, so the link stays selectable as a fallback.
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyFailed(true);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('share.title')}>
      <div className="flex flex-col gap-4">
        {/*
          Only when a link is actually possible. Leading with "anyone with this
          link can watch" above a note saying there is no link reads as a
          contradiction, which is the opposite of the point of that note.
        */}
        {serverThere !== false ? (
          <p className="text-[14px] leading-snug text-ink-muted">{t('share.body')}</p>
        ) : null}

        {!share && serverThere === null ? <Note title={t('share.checking')} /> : null}

        {!share && serverThere === false ? (
          // Deliberately no button. Minting a link here would produce something
          // that looks right, gets pasted into a group chat, and never loads.
          <Note
            tone="alert"
            title={t('share.unavailableTitle')}
            body={t('share.unavailableBody')}
          />
        ) : null}

        {!share && serverThere === true ? (
          <Button variant="primary" full disabled={creating} onClick={() => void create()}>
            {creating ? t('share.creating') : t('share.start')}
          </Button>
        ) : null}

        {share ? (
          <>
            {/*
              A real, selectable input rather than styled text: on a box without
              a secure context the copy button cannot work, and selecting the
              link by hand has to stay possible.
            */}
            <input
              readOnly
              value={url ?? ''}
              aria-label={t('share.title')}
              onFocus={(event) => event.currentTarget.select()}
              className="w-full rounded-control border border-line-control bg-court-900 px-3 py-2.5 text-[14px] text-ink"
            />
            <div className="flex items-center gap-2">
              <Button variant="primary" className="flex-1" onClick={() => void copy()}>
                {copied ? t('share.copied') : t('share.copy')}
              </Button>
            </div>
            {copyFailed ? <Note tone="alert" title={t('share.copyFailed')} /> : null}
            <p className="text-[13px] leading-snug text-ink-muted">{t('share.castHint')}</p>

            {/*
              Sync state is worth showing plainly: courtside the push often
              fails, and an organizer who has handed out a link deserves to know
              the watchers are looking at something stale.
            */}
            {syncState?.status === 'offline' || syncState?.status === 'pushing' ? (
              <Note title={t('share.pushPending')} />
            ) : null}
            {syncState?.status === 'error' ? (
              <Note tone="alert" title={t('share.pushFailed')} />
            ) : null}
          </>
        ) : null}
      </div>
    </Sheet>
  );
}
