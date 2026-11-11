import { useEffect, useState } from 'preact/hooks';
import { parseRoute, type Route } from './route';

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export type AsyncState<T> = { status: 'loading' } | { status: 'ok'; data: T; at: Date } | { status: 'error'; error: unknown };

/**
 * 非同期処理の結果を持つ。deps が変わると取り直し、古い結果は捨てる。
 * fn が null なら何もしない（loading のまま）。
 */
export function useAsync<T>(fn: (() => Promise<T>) | null, deps: unknown[]): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' });
  useEffect(() => {
    if (!fn) return;
    let alive = true;
    setState({ status: 'loading' });
    fn().then(
      (data) => alive && setState({ status: 'ok', data, at: new Date() }),
      (error: unknown) => alive && setState({ status: 'error', error }),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}
