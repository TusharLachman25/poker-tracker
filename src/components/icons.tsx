/** Inline stroke icons — no icon package, so nothing to load at runtime. */

type Props = { className?: string };

/**
 * Every icon carries the `icon` class, which gives it a default size.
 * Inline SVG has no intrinsic dimensions, so without this an icon dropped
 * anywhere outside a sized container renders at its full box size.
 * Context rules (`.btn svg`, `.tab svg`) override it.
 */
const cx = (className?: string) => (className ? `icon ${className}` : 'icon');

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export const TrophyIcon = ({ className }: Props) => (
  <svg {...base} className={cx(className)} aria-hidden="true">
    <path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" />
    <path d="M17 5h3v2a4 4 0 0 1-3.2 3.9M7 5H4v2a4 4 0 0 0 3.2 3.9" />
    <path d="M12 14v3M9 20h6M10 17h4l.6 3H9.4l.6-3Z" />
  </svg>
);

export const CardsIcon = ({ className }: Props) => (
  <svg {...base} className={cx(className)} aria-hidden="true">
    <rect x="3.5" y="6" width="11" height="15" rx="2" />
    <path d="M8 3.6l8.6-1.1a2 2 0 0 1 2.25 1.73l1.6 12.4" />
    <path d="M9 13.5l1.2-2 1.2 2a1.45 1.45 0 1 1-2.4 0Z" />
  </svg>
);

export const PeopleIcon = ({ className }: Props) => (
  <svg {...base} className={cx(className)} aria-hidden="true">
    <circle cx="9" cy="8" r="3.2" />
    <path d="M2.8 20a6.2 6.2 0 0 1 12.4 0" />
    <path d="M16.5 5.3a3.2 3.2 0 0 1 0 5.9M17.4 14.4a6.2 6.2 0 0 1 3.8 5.6" />
  </svg>
);

export const GearIcon = ({ className }: Props) => (
  <svg {...base} className={cx(className)} aria-hidden="true">
    <circle cx="12" cy="12" r="3.1" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .32 1.77l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.6 1.6 0 0 0-1.77-.32 1.6 1.6 0 0 0-1 1.47V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.77.32l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.6 1.6 0 0 0 4.72 15a1.6 1.6 0 0 0-1.47-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.32-1.77l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.6 1.6 0 0 0 9 4.72h.08a1.6 1.6 0 0 0 1-1.47V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.47 1.6 1.6 0 0 0 1.77-.32l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.6 1.6 0 0 0 19.28 9v.08a1.6 1.6 0 0 0 1.47 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
  </svg>
);

export const PlusIcon = ({ className }: Props) => (
  <svg {...base} className={cx(className)} aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const BackIcon = ({ className }: Props) => (
  <svg {...base} className={cx(className)} aria-hidden="true">
    <path d="M15 19l-7-7 7-7" />
  </svg>
);

export const TrashIcon = ({ className }: Props) => (
  <svg {...base} className={cx(className)} aria-hidden="true">
    <path d="M3.5 6h17M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6" />
    <path d="M18.5 6l-.8 13.1a2 2 0 0 1-2 1.9H8.3a2 2 0 0 1-2-1.9L5.5 6" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);

export const SyncIcon = ({ className }: Props) => (
  <svg {...base} className={cx(className)} aria-hidden="true">
    <path d="M21 12a9 9 0 0 1-15.2 6.5L3 16" />
    <path d="M3 12a9 9 0 0 1 15.2-6.5L21 8" />
    <path d="M21 3.5V8h-4.5M3 20.5V16h4.5" />
  </svg>
);

export const CheckIcon = ({ className }: Props) => (
  <svg {...base} className={cx(className)} aria-hidden="true">
    <path d="M20 6.5L9.5 17.5 4 12" />
  </svg>
);

export const CloseIcon = ({ className }: Props) => (
  <svg {...base} className={cx(className)} aria-hidden="true">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

export const ChevronIcon = ({ className }: Props) => (
  <svg {...base} className={cx(className)} aria-hidden="true">
    <path d="M9 5l7 7-7 7" />
  </svg>
);

export const HandshakeIcon = ({ className }: Props) => (
  <svg {...base} className={cx(className)} aria-hidden="true">
    <path d="M11 6.5L8.6 8.9a2 2 0 0 0 0 2.8 2 2 0 0 0 2.8 0l1.3-1.3 3.4 3.4a1.8 1.8 0 0 1-2.5 2.5" />
    <path d="M13.6 16.3a1.8 1.8 0 0 1-2.5 2.5l-.7-.7a1.8 1.8 0 0 1-2.5 0 1.8 1.8 0 0 1-.5-1.6" />
    <path d="M2.5 8.5L6 5.5l5 1 5-1 3.5 3M2.5 14.5L5 16M21.5 14.5L19 16" />
  </svg>
);

export const DownloadIcon = ({ className }: Props) => (
  <svg {...base} className={cx(className)} aria-hidden="true">
    <path d="M12 3v12M7.5 10.5L12 15l4.5-4.5" />
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </svg>
);

export const UploadIcon = ({ className }: Props) => (
  <svg {...base} className={cx(className)} aria-hidden="true">
    <path d="M12 15V3M7.5 7.5L12 3l4.5 4.5" />
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </svg>
);

export const EditIcon = ({ className }: Props) => (
  <svg {...base} className={cx(className)} aria-hidden="true">
    <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
    <path d="M14.5 5.5l4 4" />
  </svg>
);

/** Filled spade for empty states. An SVG, not the ♠ character: most platforms
 *  render that glyph from a colour emoji font that ignores `color`. */
export const SpadeIcon = ({ className }: Props) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={cx(className)} aria-hidden="true">
    <path d="M12 2.6c-.5 0-.8.3-1.1.7-1.5 1.8-4.4 3.9-5.5 5.7-.8 1.2-1 2.2-1 3.2 0 2.3 1.7 4 3.9 4 1 0 1.8-.3 2.4-.9-.3 1.6-1 2.8-2 3.7-.4.3-.3.9.2.9h6.1c.5 0 .7-.6.3-.9-1-.9-1.8-2.1-2.1-3.7.6.6 1.4.9 2.4.9 2.2 0 3.9-1.7 3.9-4 0-1-.2-2-1-3.2-1.1-1.8-4-3.9-5.5-5.7-.3-.4-.6-.7-1-.7Z" />
  </svg>
);
