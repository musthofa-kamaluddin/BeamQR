import { useCallback, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';

export type AppRoute = '/' | '/send' | '/receive';

export function normalizeRoute(pathname: string): AppRoute {
  const clean = pathname.toLowerCase().replace(/\/+$/, '') || '/';
  if (clean === '/send' || clean === '/sender') return '/send';
  if (clean === '/receive' || clean === '/receiver') return '/receive';
  return '/';
}

const ROUTE_TITLES: Record<AppRoute, string> = {
  '/': 'BeamQR — Optical Pixel File Transfer',
  '/send': 'Kirim File — BeamQR',
  '/receive': 'Terima File — BeamQR',
};

export function useRouter(headingRef: React.RefObject<HTMLHeadingElement | null>) {
  const [route, setRoute] = useState<AppRoute>(() =>
    typeof window !== 'undefined' ? normalizeRoute(window.location.pathname) : '/',
  );

  useEffect(() => {
    document.title = ROUTE_TITLES[route];
  }, [route]);

  const applyRouteChange = useCallback(
    (next: AppRoute, pushHistory: boolean) => {
      if (pushHistory && window.location.pathname !== next) {
        window.history.pushState(null, '', next);
      }

      const prefersReduced =
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      const docWithVt = document as Document & {
        startViewTransition?: (cb: () => void) => { finished: Promise<void> };
      };

      if (!docWithVt.startViewTransition || prefersReduced) {
        setRoute(next);
        window.scrollTo({ top: 0 });
        queueMicrotask(() => headingRef.current?.focus());
        return;
      }

      const transition = docWithVt.startViewTransition(() => {
        flushSync(() => {
          setRoute(next);
        });
      });

      void transition.finished.finally(() => {
        window.scrollTo({ top: 0 });
        headingRef.current?.focus();
      });
    },
    [headingRef],
  );

  const navigate = useCallback(
    (to: AppRoute) => {
      if (to === route) return;
      applyRouteChange(to, true);
    },
    [applyRouteChange, route],
  );

  useEffect(() => {
    const onPopState = () => {
      const next = normalizeRoute(window.location.pathname);
      applyRouteChange(next, false);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [applyRouteChange]);

  const onLinkClick = useCallback(
    (to: AppRoute) => (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      ) {
        return;
      }
      e.preventDefault();
      navigate(to);
    },
    [navigate],
  );

  return { route, navigate, onLinkClick };
}
