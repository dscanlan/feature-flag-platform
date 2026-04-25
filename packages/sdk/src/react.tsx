import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { ClientSnapshot, ConnectionState, FlagClient } from "./types.js";

export interface FlagsContextValue {
  ready: boolean;
  loading: boolean;
  error: unknown | null;
  connectionState: ConnectionState;
  boolFlag: FlagClient["boolFlag"];
  jsonFlag: FlagClient["jsonFlag"];
  allFlags: FlagClient["allFlags"];
}

export interface FlagsProviderProps {
  client: FlagClient;
  children?: ReactNode;
  /** Call `client.ready()` automatically on mount. Default true. */
  autoReady?: boolean;
  /**
   * Call `client.close()` when the provider unmounts. Default false because
   * most apps create a singleton client whose lifetime exceeds the React tree.
   */
  closeOnUnmount?: boolean;
}

const FlagsContext = createContext<FlagsContextValue | null>(null);
const FlagClientContext = createContext<FlagClient | null>(null);

function selectSnapshot(client: FlagClient): () => ClientSnapshot {
  return () => client.getState();
}
function selectSubscribe(client: FlagClient): (listener: () => void) => () => void {
  return (listener) => client.subscribe(listener);
}

export function FlagsProvider({
  client,
  children,
  autoReady = true,
  closeOnUnmount = false,
}: FlagsProviderProps) {
  // Memoize subscribe/getSnapshot bindings so useSyncExternalStore sees stable
  // function references for the lifetime of this client instance.
  const subscribe = useMemo(() => selectSubscribe(client), [client]);
  const getSnapshot = useMemo(() => selectSnapshot(client), [client]);

  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (autoReady) {
      // ready() is idempotent — safe under React 18 StrictMode double-mount.
      void client.ready();
    }
    return () => {
      if (closeOnUnmount) client.close();
    };
  }, [client, autoReady, closeOnUnmount]);

  const value = useMemo<FlagsContextValue>(
    () => ({
      ready: state.ready,
      loading: !state.ready,
      error: state.error,
      connectionState: state.connectionState,
      boolFlag: client.boolFlag,
      jsonFlag: client.jsonFlag,
      allFlags: client.allFlags,
    }),
    // The `version` covers any cache or state change, so we re-build the value
    // exactly when consumers should observe a change.
    [client, state.version],
  );

  return (
    <FlagClientContext.Provider value={client}>
      <FlagsContext.Provider value={value}>{children}</FlagsContext.Provider>
    </FlagClientContext.Provider>
  );
}

export function useFlags(): FlagsContextValue {
  const value = useContext(FlagsContext);
  if (!value) {
    throw new Error(
      "useFlags() must be called inside a <FlagsProvider>. Wrap the tree that needs flags with <FlagsProvider client={...}>.",
    );
  }
  return value;
}

export function useFlagClient(): FlagClient {
  const client = useContext(FlagClientContext);
  if (!client) {
    throw new Error(
      "useFlagClient() must be called inside a <FlagsProvider>. Wrap the tree that needs the client with <FlagsProvider client={...}>.",
    );
  }
  return client;
}
