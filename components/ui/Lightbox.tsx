'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Download } from 'lucide-react';

/**
 * Full-screen image viewer.
 *
 * WHY THIS EXISTS. An image attachment was an `<a href={signedUrl}>`, and a
 * signed URL from a private bucket arrives with `Content-Disposition:
 * attachment` — so tapping a photo in a conversation downloaded it instead of
 * showing it. On a phone that is worse than useless: the picture leaves the app
 * and lands in a downloads folder, and you still have not seen it.
 *
 * Downloading is still available — it is a button here, which is where a
 * deliberate action belongs, rather than the accidental result of a tap.
 *
 * Rendered through a portal so it escapes the message row's `overflow-hidden`
 * and its stacking context; a lightbox clipped to a chat bubble is the usual
 * way this goes wrong.
 */
export default function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    // The page behind must not scroll under the overlay on touch.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
    >
      <div className="absolute top-3 right-3 flex items-center gap-1.5">
        <a
          href={src}
          download={alt}
          onClick={(e) => e.stopPropagation()}
          title="Download"
          aria-label={`Download ${alt}`}
          className="h-9 w-9 inline-flex items-center justify-center rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors"
        >
          <Download className="w-4 h-4" />
        </a>
        <button
          onClick={onClose}
          title="Close"
          aria-label="Close"
          className="h-9 w-9 inline-flex items-center justify-center rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Stop the backdrop handler firing when the picture itself is tapped —
          otherwise a pinch-to-zoom gesture closes the viewer. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived, off-origin */}
      <img
        src={src}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] max-w-full object-contain rounded-lg"
      />
    </div>,
    document.body,
  );
}
