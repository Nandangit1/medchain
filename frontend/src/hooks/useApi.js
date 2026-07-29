import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Runs an async loader and tracks { data, loading, error }.
 *
 * Guards against setting state after unmount, which is the usual source of
 * React warnings when a user navigates away mid-request.
 *
 * @param {Function} loader     async function returning the data
 * @param {Array}    deps       re-runs when these change
 * @param {Object}   options    { immediate = true }
 */
export const useApi = (loader, deps = [], { immediate = true } = {}) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(immediate);
  const [error, setError] = useState(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async (...args) => {
    setLoading(true);
    setError(null);

    try {
      const result = await loader(...args);
      if (mounted.current) setData(result);
      return result;
    } catch (err) {
      if (mounted.current) setError(err.message);
      throw err;
    } finally {
      if (mounted.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    if (immediate) {
      run().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, immediate]);

  return { data, loading, error, refetch: run, setData };
};

export default useApi;
