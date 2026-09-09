import { useEffect, useId, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

import { t } from '../i18n/index.js';

/**
 * The shared vocabulary of the organizer app.
 *
 * Everything here exists because DESIGN.md asks for it: court line-work as
 * structure, one optic accent held back for scores and the leader, three radii
 * used as hierarchy rather than decoration, and tap targets sized for a wet
 * thumb on a 380px phone.
 */

/** Minimum tap target, in Tailwind spacing units (11 x 4px = 44px). */
const TAP = 'min-h-11 min-w-11';

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/* -------------------------------------------------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'quiet';

/**
 * Three weights only.
 *
 * `primary` fills with the optic accent because it is the one action that
 * moves the evening forward, and dark ink on optic yellow measures 15.31:1.
 * `secondary` is a bordered surface at the 3:1 line token. `quiet` carries no
 * border, for actions that should be reachable without competing.
 */
export function Button({
  variant = 'secondary',
  full,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  full?: boolean;
}): ReactNode {
  const base = cx(
    TAP,
    'inline-flex items-center justify-center gap-2 rounded-control px-4 py-2.5',
    'text-[15px] font-semibold tracking-tight transition-colors',
    'disabled:opacity-45 disabled:cursor-not-allowed',
    full && 'w-full',
  );
  const skin: Record<ButtonVariant, string> = {
    primary: 'bg-optic text-court-950 hover:bg-optic/90 active:bg-optic/80',
    secondary:
      'border border-line-control bg-court-800 text-ink hover:bg-court-700 active:bg-court-700',
    quiet: 'text-ink-muted hover:text-ink active:text-ink',
  };
  return <button type="button" className={cx(base, skin[variant], className)} {...rest} />;
}

/* -------------------------------------------------------------------------- */

/** A court line. Structure, not decoration, so it never gets a shadow or glow. */
export function Rule({ className }: { className?: string }): ReactNode {
  return <div className={cx('h-px w-full bg-line-quiet', className)} role="presentation" />;
}

/* -------------------------------------------------------------------------- */

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: (props: { id: string; describedBy: string | undefined }) => ReactNode;
}): ReactNode {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold tracking-wide text-ink-muted">
        {label}
      </label>
      {children({ id, describedBy: hint ? hintId : undefined })}
      {hint ? (
        <p id={hintId} className="text-[13px] leading-snug text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function TextInput({
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>): ReactNode {
  return (
    <input
      className={cx(
        TAP,
        'w-full rounded-control border border-line-control bg-court-800 px-3 py-2.5',
        'text-[16px] text-ink placeholder:text-ink-muted/70',
        className,
      )}
      {...rest}
    />
  );
}

/* -------------------------------------------------------------------------- */

export interface Choice<T extends string> {
  value: T;
  label: string;
}

/**
 * A row of mutually exclusive choices, rendered as real radios so a keyboard
 * gets arrow-key movement and a screen reader gets a group, without any of it
 * being reimplemented here.
 */
export function ChoiceRow<T extends string>({
  legend,
  choices,
  value,
  onChange,
  columns = 'auto',
}: {
  legend: string;
  choices: ReadonlyArray<Choice<T>>;
  value: T;
  onChange: (next: T) => void;
  columns?: 'auto' | 'stack';
}): ReactNode {
  const name = useId();
  return (
    <fieldset className="border-0 p-0">
      <legend className="mb-1.5 text-[13px] font-semibold tracking-wide text-ink-muted">
        {legend}
      </legend>
      <div className={cx('grid gap-1.5', columns === 'stack' ? 'grid-cols-1' : 'grid-flow-col')}>
        {choices.map((choice) => {
          const selected = choice.value === value;
          return (
            <label
              key={choice.value}
              className={cx(
                TAP,
                'flex cursor-pointer items-center justify-center rounded-control border px-3 py-2.5',
                'text-center text-[15px] font-semibold tracking-tight',
                // The selected state is a border and a fill change, never colour
                // alone, so it survives a colour-blind reader and forced colours.
                selected
                  ? 'border-optic bg-optic/15 text-ink'
                  : 'border-line-control bg-court-800 text-ink-muted',
                'has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-optic has-[:focus-visible]:outline-offset-2',
              )}
            >
              <input
                type="radio"
                name={name}
                value={choice.value}
                checked={selected}
                onChange={() => onChange(choice.value)}
                className="sr-only"
              />
              {choice.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/* -------------------------------------------------------------------------- */

/** Courts and points are small integers an organizer nudges, not types. */
export function Stepper({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (next: number) => void;
}): ReactNode {
  const id = useId();
  const clamp = (next: number): number => Math.min(max, Math.max(min, next));
  return (
    <div className="flex flex-col gap-1.5">
      <span id={id} className="text-[13px] font-semibold tracking-wide text-ink-muted">
        {label}
      </span>
      <div className="flex items-center gap-2">
        <Button
          aria-label={t('stepper.decrease', { label })}
          disabled={value <= min}
          onClick={() => onChange(clamp(value - step))}
          className="w-14 text-xl"
        >
          &minus;
        </Button>
        <output
          aria-labelledby={id}
          className="numeral min-w-16 rounded-control border border-line bg-court-800 px-3 py-2.5 text-center text-2xl"
        >
          {value}
        </output>
        <Button
          aria-label={t('stepper.increase', { label })}
          disabled={value >= max}
          onClick={() => onChange(clamp(value + step))}
          className="w-14 text-xl"
        >
          +
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * A score numeral that rolls when it changes.
 *
 * This is animation number one of the two DESIGN.md allows. It fires only on a
 * real value change, so a re-render for any other reason stays still.
 */
export function Numeral({
  value,
  className,
}: {
  value: number;
  className?: string;
}): ReactNode {
  const [shown, setShown] = useState(value);
  const [ticking, setTicking] = useState(false);
  const previous = useRef(value);

  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    setShown(value);
    setTicking(true);
    const timer = window.setTimeout(() => setTicking(false), 200);
    return () => window.clearTimeout(timer);
  }, [value]);

  return (
    <span className={cx('numeral inline-block tabular-nums', className)}>
      <span key={shown} className={ticking ? 'inline-block animate-score-tick' : 'inline-block'}>
        {shown}
      </span>
    </span>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The one surface that lifts above the page, so it is the only thing carrying a
 * shadow. Escape closes it, focus moves into it on open and returns on close.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  headerClose = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /**
   * Set false when the sheet's footer already carries the one way out. Two
   * controls that do exactly the same thing are two chances to guess wrong
   * about which one commits.
   */
  headerClose?: boolean;
}): ReactNode {
  const panel = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement as HTMLElement | null;
    panel.current?.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      // Keep Tab inside the sheet; a keyboard user should not fall out of a
      // modal onto the screen behind it.
      const focusable = panel.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0] as HTMLElement;
      const last = focusable[focusable.length - 1] as HTMLElement;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      restoreTo.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        type="button"
        aria-label={t('common.cancel')}
        onClick={onClose}
        className="absolute inset-0 bg-court-950/80"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx(
          'relative max-h-[92vh] overflow-y-auto rounded-t-sheet border-t border-line-control',
          'bg-court-800 shadow-[0_-18px_40px_rgb(0_0_0/0.55)]',
          // Nothing important hides behind the home indicator.
          'pb-[max(1rem,env(safe-area-inset-bottom))]',
        )}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line-quiet bg-court-800 px-4 py-3">
          <h2 id={titleId} className="text-[17px] font-bold tracking-tight">
            {title}
          </h2>
          {headerClose ? (
            <Button variant="quiet" onClick={onClose} className="px-2">
              {t('common.done')}
            </Button>
          ) : null}
        </div>
        <div className="px-4 py-4">{children}</div>
        {footer ? <div className="border-t border-line-quiet px-4 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Empty, loading and error all render through here, so none of them can be the
 * bare spinner or the bare "No data" that R-27 exists to prevent: each one says
 * what is going on and, where there is one, offers the action that fixes it.
 */
export function Note({
  title,
  body,
  action,
  tone = 'quiet',
}: {
  title: string;
  body?: string;
  action?: ReactNode;
  tone?: 'quiet' | 'alert';
}): ReactNode {
  return (
    <div
      className={cx(
        'flex flex-col items-start gap-2 rounded-court border-l-2 px-4 py-4',
        tone === 'alert' ? 'border-optic bg-optic/10' : 'border-line-control bg-court-800',
      )}
      role={tone === 'alert' ? 'alert' : undefined}
    >
      <p className="text-[15px] font-bold tracking-tight text-ink">{title}</p>
      {body ? <p className="text-[14px] leading-snug text-ink-muted">{body}</p> : null}
      {action}
    </div>
  );
}

export { cx, TAP };
